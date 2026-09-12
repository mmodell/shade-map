import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useJsApiLoader } from '@react-google-maps/api'
import RouteForm from './components/RouteForm'
import MapComponent from './components/MapComponent'
import WeatherTimeline from './components/WeatherTimeline'
import RouteList from './components/RouteList'
import RouteSteps from './components/RouteSteps'
import Navigator from './components/Navigator'
import { requestRoutes, samplePath, routeSummary } from './lib/googleDirections'
import { analyzeRoutes } from './lib/analyze'
import { rankRoutes } from './lib/ranking'
import { loadSession, saveSession } from './lib/persist'
import { formatClock } from './lib/format'
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

  // `departure` is whatever's typed into the datetime-local input — its
  // meaning depends on `arriveBy`. The actual instant used for shade/weather
  // (`resolvedDeparture`) is only known after a search resolves it, since
  // "arrive by" has to back-calculate from a route's duration.
  const [departure, setDeparture] = useState(() =>
    restored?.departure ? new Date(restored.departure) : roundToNextQuarterHour(new Date())
  )
  const [arriveBy, setArriveBy] = useState(() => restored?.arriveBy || false)
  const [resolvedDeparture, setResolvedDeparture] = useState(() =>
    restored?.resolvedDeparture ? new Date(restored.resolvedDeparture) : departure
  )
  const [resolvedArrival, setResolvedArrival] = useState(() =>
    restored?.resolvedArrival ? new Date(restored.resolvedArrival) : null
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
  const [navigating, setNavigating] = useState(false)
  const [userPos, setUserPos] = useState(null)
  const [focusedStepIndex, setFocusedStepIndex] = useState(null)
  const pathsRef = useRef(new Map(restored?.paths || []))
  const stepsRef = useRef(new Map(restored?.steps || []))

  const ranked = useMemo(() => rankRoutes(analyzed, weights), [analyzed, weights])
  const selected = ranked.find((r) => r.id === selectedId) || ranked[0] || null
  const selectedSteps = selected ? stepsRef.current.get(selected.id) : null
  const focusedStep =
    focusedStepIndex != null ? selectedSteps?.[focusedStepIndex] || null : null

  // A step preview only makes sense for whatever route/search is currently
  // on screen — drop it the moment either changes so it can't point at a
  // step from a route you're no longer looking at.
  useEffect(() => {
    setFocusedStepIndex(null)
  }, [selectedId, analyzed])
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
      arriveBy,
      resolvedDeparture: resolvedDeparture.toISOString(),
      resolvedArrival: resolvedArrival ? resolvedArrival.toISOString() : null,
      status,
      trip,
      analyzed,
      meta,
      selectedId,
      paths: [...pathsRef.current.entries()],
      steps: [...stepsRef.current.entries()],
    })
  }, [weights, mode, departure, arriveBy, resolvedDeparture, resolvedArrival, status, trip, analyzed, meta, selectedId])

  const runSearch = useCallback(
    async ({ origin, destination, waypoints, mode: reqMode, originText, destText, stopCount }) => {
      if (!origin || !destination) return
      setStatus('loading')
      setErrorMsg('')
      try {
        const result = await requestRoutes({ origin, destination, waypoints, mode: reqMode, departure })
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
            durationInTrafficSeconds: summary.durationInTrafficSeconds,
            startAddress: summary.startAddress,
            endAddress: summary.endAddress,
          }
        })
        pathsRef.current = paths
        stepsRef.current = steps

        // Directions has no native "arrive by" — back-calculate from the
        // primary route's duration. One pass, not iterative: for driving
        // this reuses the traffic estimate anchored on the arrival time
        // itself, which is already a reasonable stand-in for the actual
        // departure's traffic.
        const primaryDurationSeconds =
          candidates[0]?.durationInTrafficSeconds || candidates[0]?.durationSeconds || 0
        const actualDeparture = arriveBy
          ? new Date(departure.getTime() - primaryDurationSeconds * 1000)
          : departure
        const actualArrival = new Date(actualDeparture.getTime() + primaryDurationSeconds * 1000)
        setResolvedDeparture(actualDeparture)
        setResolvedArrival(actualArrival)

        const analysis = await analyzeRoutes({ candidates, departure: actualDeparture })
        setAnalyzed(analysis.routes)
        setMeta({
          degraded: analysis.degraded,
          degradedReason: analysis.degradedReason,
          weather: analysis.weather,
          crime: analysis.crime,
        })
        setSelectedId(null)
        setStatus('done')
        setFormOpen(false)
        setNavigating(false)
        setTrip({
          originText,
          destText,
          stopCount,
          arriveBy,
          resolvedDeparture: actualDeparture.toISOString(),
          resolvedArrival: actualArrival.toISOString(),
        })
      } catch (err) {
        setErrorMsg(String(err.message || err))
        setStatus('error')
      }
    },
    [departure, arriveBy]
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
            arriveBy={arriveBy}
            onArriveByChange={setArriveBy}
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

          {arriveBy && status === 'done' && resolvedArrival && (
            <p className="app__notice">
              🕑 Leave by <strong>{formatClock(resolvedDeparture)}</strong> to arrive by{' '}
              <strong>{formatClock(resolvedArrival)}</strong> (based on the top route — other
              options may take a little longer or shorter).
            </p>
          )}

          {hasResults && (
            <>
              <RouteList
                routes={ranked}
                selectedId={selected?.id}
                onSelect={setSelectedId}
              />
              {selected && !navigating && (
                <button
                  type="button"
                  className="nav__start"
                  onClick={() => setNavigating(true)}
                  disabled={!stepsRef.current.get(selected.id)?.length}
                >
                  ▶ Start navigation
                </button>
              )}
              {selected && (
                <RouteSteps
                  steps={selectedSteps}
                  shade={selected.shade}
                  focusedIndex={focusedStepIndex}
                  onFocusStep={setFocusedStepIndex}
                />
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
            navigating={navigating}
            onLocationChange={setUserPos}
            focusedStep={navigating ? null : focusedStep}
          />
          {navigating && selected && (
            <Navigator
              key={selected.id}
              steps={stepsRef.current.get(selected.id)}
              mode={mode}
              userPos={userPos}
              onEnd={() => setNavigating(false)}
            />
          )}
          {!navigating && hasResults && selected && (
            <WeatherTimeline
              weather={meta.weather}
              shade={selected.shade}
              departure={resolvedDeparture}
              durationSeconds={selected.durationInTrafficSeconds || selected.durationSeconds}
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
