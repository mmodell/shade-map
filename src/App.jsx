import { useCallback, useMemo, useRef, useState } from 'react'
import { useJsApiLoader } from '@react-google-maps/api'
import RouteForm from './components/RouteForm'
import MapComponent from './components/MapComponent'
import WeatherTimeline from './components/WeatherTimeline'
import RouteList from './components/RouteList'
import { requestWalkingRoutes, samplePath, routeSummary } from './lib/googleDirections'
import { analyzeRoutes } from './lib/analyze'
import { rankRoutes } from './lib/ranking'
import './App.css'

const MAPS_LIBRARIES = ['places', 'geometry']
const MAX_ROUTES = 4

const DEFAULT_WEIGHTS = { shade: 0.7, distance: 0.4, safety: 0.5 }

export default function App() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'shade-map-google-maps',
    googleMapsApiKey: apiKey || '',
    libraries: MAPS_LIBRARIES,
  })

  const [departure, setDeparture] = useState(() => roundToNextQuarterHour(new Date()))
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS)
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [errorMsg, setErrorMsg] = useState('')
  const [analyzed, setAnalyzed] = useState([])
  const [meta, setMeta] = useState({ degraded: false, weather: null })
  const [selectedId, setSelectedId] = useState(null)
  const pathsRef = useRef(new Map())

  const ranked = useMemo(() => rankRoutes(analyzed, weights), [analyzed, weights])
  const selected = ranked.find((r) => r.id === selectedId) || ranked[0] || null

  const runSearch = useCallback(
    async ({ origin, destination }) => {
      if (!origin || !destination) return
      setStatus('loading')
      setErrorMsg('')
      try {
        const result = await requestWalkingRoutes({ origin, destination })
        const routes = result.routes.slice(0, MAX_ROUTES)
        const paths = new Map()
        const candidates = routes.map((route, i) => {
          const id = String(i)
          const overview = route.overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() }))
          paths.set(id, overview)
          const summary = routeSummary(route)
          return {
            id,
            label: routeLabel(i, summary),
            points: samplePath(route.overview_path),
            overview,
            distanceMeters: summary.distanceMeters,
            durationSeconds: summary.durationSeconds,
            startAddress: summary.startAddress,
            endAddress: summary.endAddress,
          }
        })
        pathsRef.current = paths

        const analysis = await analyzeRoutes({ candidates, departure })
        setAnalyzed(analysis.routes)
        setMeta({
          degraded: analysis.degraded,
          degradedReason: analysis.degradedReason,
          weather: analysis.weather,
        })
        setSelectedId(null)
        setStatus('done')
      } catch (err) {
        setErrorMsg(String(err.message || err))
        setStatus('error')
      }
    },
    [departure]
  )

  if (loadError) {
    return <Fatal title="Google Maps failed to load" detail={String(loadError)} />
  }
  if (!apiKey) {
    return (
      <Fatal
        title="Add your Google Maps API key"
        detail="Set VITE_GOOGLE_MAPS_API_KEY in .env.local (local) or in the Vercel project's Environment Variables, then reload."
      />
    )
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>
          <span className="app__mark" aria-hidden="true">☀︎</span> Shade Map
        </h1>
        <p className="app__tag">Walking routes ranked by shade, comfort &amp; safety</p>
      </header>

      <main className="app__body">
        <section className="app__panel">
          <RouteForm
            isLoaded={isLoaded}
            departure={departure}
            onDepartureChange={setDeparture}
            weights={weights}
            onWeightsChange={setWeights}
            status={status}
            onSubmit={runSearch}
          />

          {status === 'error' && <p className="app__error">{errorMsg}</p>}

          {meta.degraded && status === 'done' && (
            <p className="app__notice">
              Showing a sun-angle-only estimate — the analyzer wasn’t reachable
              {meta.degradedReason ? ` (${meta.degradedReason})` : ''}. Deploy to Vercel or run
              <code> npm run dev:full </code> for tree, park and safety data.
            </p>
          )}

          {status === 'done' && ranked.length > 0 && (
            <RouteList
              routes={ranked}
              selectedId={selected?.id}
              onSelect={setSelectedId}
              weather={meta.weather}
            />
          )}
        </section>

        <section className="app__map">
          <MapComponent
            isLoaded={isLoaded}
            routes={ranked}
            paths={pathsRef.current}
            selectedId={selected?.id}
            onSelect={setSelectedId}
          />
          {status === 'done' && selected && meta.weather && (
            <WeatherTimeline
              weather={meta.weather}
              departure={departure}
              durationSeconds={selected.durationSeconds}
            />
          )}
        </section>
      </main>
    </div>
  )
}

function Fatal({ title, detail }) {
  return (
    <div className="app app--fatal">
      <div className="fatal">
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
    </div>
  )
}

function routeLabel(i, summary) {
  if (summary.summary) return summary.summary
  return i === 0 ? 'Route A' : `Route ${String.fromCharCode(65 + i)}`
}

function roundToNextQuarterHour(d) {
  const date = new Date(d)
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0)
  return date
}
