import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useJsApiLoader } from '@react-google-maps/api'
import RouteForm from './components/RouteForm'
import MapComponent from './components/MapComponent'
import WeatherTimeline from './components/WeatherTimeline'
import RouteList from './components/RouteList'
import RouteSteps from './components/RouteSteps'
import { requestRoutes, samplePath, routeSummary } from './lib/googleDirections'
import { analyzeRoutes } from './lib/analyze'
import { rankRoutes } from './lib/ranking'
import { loadSession, saveSession } from './lib/persist'
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

  // One-time restore of the last search, so a page refresh doesn't lose it.
  const restored = useMemo(() => loadSession(), [])

  const [departure, setDeparture] = useState(() =>
    restored?.departure ? new Date(restored.departure) : roundToNextQuarterHour(new Date())
  )
  const [weights, setWeights] = useState(() => restored?.weights || DEFAULT_WEIGHTS)
  const [mode, setMode] = useState(() => restored?.mode || 'WALKING')
  const [status, setStatus] = useState(() => restored?.status || 'idle') // idle | loading | done | error
  const [errorMsg, setErrorMsg] = useState('')
  const [analyzed, setAnalyzed] = useState(() => restored?.analyzed || [])
  const [meta, setMeta] = useState(() => restored?.meta || { degraded: false, weather: null })
  const [selectedId, setSelectedId] = useState(() => restored?.selectedId ?? null)
  const [formOpen, setFormOpen] = useState(() => restored?.status !== 'done')
  const [trip, setTrip] = useState(() => restored?.trip || null)
  const pathsRef = useRef(new Map(restored?.paths || []))
  const stepsRef = useRef(new Map(restored?.steps || []))

  const ranked = useMemo(() => rankRoutes(analyzed, weights), [analyzed, weights])
  const selected = ranked.find((r) => r.id === selectedId) || ranked[0] || null
  // All routes in one search share a departure time & rough location, so
  // they're all night or all day together — every route gets shadeFraction
  // ~1 after dark, which makes the Shade slider a no-op; tell the user why.
  const nightMode = analyzed.some((r) => r.shade?.isNight)

  // Persist just enough to rebuild the screen after a refresh — no re-query needed.
  useEffect(() => {
    saveSession({
      weights,
      mode,
      departure: departure.toISOString(),
      status,
      trip,
      analyzed,
      meta,
      selectedId,
      paths: [...pathsRef.current.entries()],
      steps: [...stepsRef.current.entries()],
    })
  }, [weights, mode, departure, status, trip, analyzed, meta, selectedId])

  const runSearch = useCallback(
    async ({ origin, destination, waypoints, mode: reqMode, originText, destText, stopCount }) => {
      if (!origin || !destination) return
      setStatus('loading')
      setErrorMsg('')
      setTrip({ originText, destText, stopCount })
      try {
        const result = await requestRoutes({ origin, destination, waypoints, mode: reqMode })
        const routes = result.routes.slice(0, MAX_ROUTES)
        const paths = new Map()
        const steps = new Map()
        const candidates = routes.map((route, i) => {
          const id = String(i)
          const overview = route.overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() }))
          paths.set(id, overview)
          const summary = routeSummary(route)
          steps.set(id, summary.steps)
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
        stepsRef.current = steps

        const analysis = await analyzeRoutes({ candidates, departure })
        setAnalyzed(analysis.routes)
        setMeta({
          degraded: analysis.degraded,
          degradedReason: analysis.degradedReason,
          weather: analysis.weather,
        })
        setSelectedId(null)
        setStatus('done')
        setFormOpen(false)
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

  const hasResults = status === 'done' && ranked.length > 0

  return (
    <div className={`app${!formOpen ? ' app--compact' : ''}`}>
      <header className="app__header">
        <h1>
          <span className="app__mark" aria-hidden="true">☀︎</span> Shade Map
        </h1>
        <p className="app__tag">Walking, biking &amp; driving routes ranked by shade &amp; comfort</p>
      </header>

      <main className="app__body">
        <section className="app__panel">
          <RouteForm
            isLoaded={isLoaded}
            departure={departure}
            onDepartureChange={setDeparture}
            weights={weights}
            onWeightsChange={setWeights}
            mode={mode}
            onModeChange={setMode}
            status={status}
            collapsed={!formOpen}
            onExpand={() => setFormOpen(true)}
            onCollapse={() => setFormOpen(false)}
            onSubmit={runSearch}
            trip={trip}
            nightMode={nightMode}
          />

          {status === 'error' && <p className="app__error">{errorMsg}</p>}

          {meta.degraded && status === 'done' && (
            <p className="app__notice">
              Shade estimated from sun angle only — the analyzer wasn’t reachable
              {meta.degradedReason ? ` (${meta.degradedReason})` : ''}.
            </p>
          )}

          {meta.crime && status === 'done' && (
            <p className="app__notice app__notice--crime">
              📊 {meta.crime.state} violent crime is {meta.crime.label} (FBI, {meta.crime.year}) —
              a statewide figure, not specific to this route.
            </p>
          )}

          {hasResults && (
            <>
              <RouteList
                routes={ranked}
                selectedId={selected?.id}
                onSelect={setSelectedId}
              />
              {selected && (
                <RouteSteps steps={stepsRef.current.get(selected.id)} shade={selected.shade} />
              )}
            </>
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
          {hasResults && selected && (
            <WeatherTimeline
              weather={meta.weather}
              shade={selected.shade}
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
