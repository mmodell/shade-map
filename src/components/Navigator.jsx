import { useEffect, useRef, useState } from 'react'
import { formatDistance } from '../lib/format'
import { speak, stopSpeaking, ttsSupported } from '../lib/tts'
import { haversineMeters, distanceToPath } from '../lib/geoMath'

// How close counts as "you've made this turn" / "you've arrived", and how
// far out to give the heads-up voice prompt — wider for driving since you
// cover the distance faster.
const ARRIVE_METERS = { WALKING: 15, BICYCLING: 15, DRIVING: 30 }
const HEADS_UP_METERS = { WALKING: 40, BICYCLING: 60, DRIVING: 150 }

// How far off the planned line counts as "off-route" before we consider
// rerouting — wider for driving/biking since GPS drift and road width are
// both bigger there than for a sidewalk.
const OFF_ROUTE_METERS = { WALKING: 35, BICYCLING: 45, DRIVING: 70 }
// Require the drift to persist this long before triggering, so a single
// noisy GPS fix (or crossing a wide intersection) doesn't cause a reroute.
const OFF_ROUTE_SUSTAIN_MS = 8000
// Don't fire another reroute within this long of the last one, even if
// still off-route (e.g. the new route also gets left) — the recalculation
// itself takes a few seconds and needs room to take effect.
const REROUTE_COOLDOWN_MS = 15000

/* Turn-by-turn guidance driven by live position (passed down from
   MapComponent's own geolocation watch, not a second one here) — advances
   through `steps` by proximity to each step's end point, speaks each turn
   as you approach it, and reroutes automatically if you drift off the
   planned path. No heading-up map rotation here — that's handled by
   MapComponent. */
export default function Navigator({ steps, mode, userPos, routePath, onReroute, onEnd }) {
  const [stepIndex, setStepIndex] = useState(0)
  const [distToNext, setDistToNext] = useState(null)
  const [arrived, setArrived] = useState(false)
  const [muted, setMuted] = useState(false)
  const [rerouting, setRerouting] = useState(false)
  // Two separate sets, deliberately not one ref: `entered` tracks which
  // step's OWN instruction has been spoken (step 0 gets this on mount);
  // `headsUp` tracks which step's *upcoming* turn has been warned about
  // while still finishing the previous one. Firing the heads-up for step
  // N+1 also marks it "entered" so arriving at it doesn't repeat the same
  // line right back — collapsing these into one tracker previously made the
  // heads-up warning never fire at all, since step 0's own mount-announcement
  // looked identical to "already warned about step 0".
  const enteredRef = useRef(new Set())
  const headsUpRef = useRef(new Set())
  const mutedRef = useRef(false)
  // When off-route drift started (null while on-route) and when the last
  // reroute fired — both plain refs since they drive a side effect, not render.
  const offRouteSinceRef = useRef(null)
  const lastRerouteRef = useRef(0)

  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  const arriveRadius = ARRIVE_METERS[mode] || 15
  const headsUpRadius = HEADS_UP_METERS[mode] || 40

  // A reroute swaps in a new `steps` array — reset step-tracking so
  // guidance starts fresh from the new route's beginning, but leave `muted`
  // alone since it's the rider's own preference, not part of the route.
  useEffect(() => {
    setStepIndex(0)
    setArrived(false)
    setDistToNext(null)
    enteredRef.current = new Set()
    headsUpRef.current = new Set()
    offRouteSinceRef.current = null
  }, [steps])

  // Speak a step's own instruction the first time we're on it.
  useEffect(() => {
    if (!steps?.length || enteredRef.current.has(stepIndex)) return
    enteredRef.current.add(stepIndex)
    if (!mutedRef.current) speak(steps[stepIndex].text)
  }, [stepIndex, steps])

  // Off-route detection: if the live position drifts far enough from the
  // planned path for long enough, ask App to recalculate from here.
  useEffect(() => {
    if (!userPos || !routePath?.length || !onReroute || arrived) return
    const threshold = OFF_ROUTE_METERS[mode] || 35
    const d = distanceToPath(userPos, routePath)
    const now = Date.now()
    if (d <= threshold) {
      offRouteSinceRef.current = null
      return
    }
    if (!offRouteSinceRef.current) {
      offRouteSinceRef.current = now
      return
    }
    const sustained = now - offRouteSinceRef.current >= OFF_ROUTE_SUSTAIN_MS
    const cooledDown = now - lastRerouteRef.current >= REROUTE_COOLDOWN_MS
    if (!sustained || !cooledDown || rerouting) return
    offRouteSinceRef.current = null
    lastRerouteRef.current = now
    setRerouting(true)
    if (!mutedRef.current) speak('Recalculating your route.')
    Promise.resolve(onReroute(userPos))
      .catch(() => {})
      .finally(() => setRerouting(false))
  }, [userPos, routePath, mode, onReroute, arrived, rerouting])

  useEffect(() => {
    if (!userPos || !steps?.length || arrived) return
    const step = steps[stepIndex]
    if (!step?.end) return
    const d = haversineMeters(userPos, step.end)
    setDistToNext(d)

    const isLast = stepIndex === steps.length - 1
    if (d <= headsUpRadius && !headsUpRef.current.has(stepIndex) && !isLast) {
      headsUpRef.current.add(stepIndex)
      enteredRef.current.add(stepIndex + 1) // heads-up already covered this step's instruction
      const next = steps[stepIndex + 1]
      if (!mutedRef.current && next) speak(`In ${formatDistance(d)}, ${next.text}`)
    }
    if (d <= arriveRadius) {
      if (isLast) {
        setArrived(true)
        if (!mutedRef.current) speak('You have arrived at your destination.')
      } else {
        setStepIndex((i) => i + 1)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPos])

  useEffect(() => stopSpeaking, [])

  function toggleMute() {
    setMuted((m) => {
      if (!m) stopSpeaking()
      return !m
    })
  }

  if (!steps?.length) return null
  const step = steps[stepIndex]
  const nextStep = steps[stepIndex + 1]

  return (
    <div className="nav">
      <div className="nav__banner">
        {rerouting ? (
          <div className="nav__rerouting">🔄 Recalculating route…</div>
        ) : arrived ? (
          <div className="nav__arrived">🏁 You’ve arrived at your destination</div>
        ) : (
          <>
            <div className="nav__main">
              <span className="nav__dist">{formatDistance(distToNext)}</span>
              <span className="nav__instruction">{step.text}</span>
            </div>
            {nextStep && <div className="nav__then">Then {nextStep.text}</div>}
          </>
        )}
      </div>
      <div className="nav__controls">
        {ttsSupported() && (
          <button
            type="button"
            className="nav__ctrlbtn"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute voice guidance' : 'Mute voice guidance'}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        )}
        <button type="button" className="nav__end" onClick={onEnd}>
          ✕ End
        </button>
      </div>
    </div>
  )
}
