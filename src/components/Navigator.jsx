import { useEffect, useRef, useState } from 'react'
import { formatDistance } from '../lib/format'
import { speak, stopSpeaking, ttsSupported } from '../lib/tts'
import { haversineMeters } from '../lib/geoMath'

// How close counts as "you've made this turn" / "you've arrived", and how
// far out to give the heads-up voice prompt — wider for driving since you
// cover the distance faster.
const ARRIVE_METERS = { WALKING: 15, BICYCLING: 15, DRIVING: 30 }
const HEADS_UP_METERS = { WALKING: 40, BICYCLING: 60, DRIVING: 150 }

/* Turn-by-turn guidance driven by live position (passed down from
   MapComponent's own geolocation watch, not a second one here) — advances
   through `steps` by proximity to each step's end point and speaks each
   turn as you approach it. No rerouting if you go off-path, and no
   heading-up map rotation — see the chat writeup for why those were left
   out of this pass. */
export default function Navigator({ steps, mode, userPos, onEnd }) {
  const [stepIndex, setStepIndex] = useState(0)
  const [distToNext, setDistToNext] = useState(null)
  const [arrived, setArrived] = useState(false)
  const [muted, setMuted] = useState(false)
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

  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  const arriveRadius = ARRIVE_METERS[mode] || 15
  const headsUpRadius = HEADS_UP_METERS[mode] || 40

  // Speak a step's own instruction the first time we're on it.
  useEffect(() => {
    if (!steps?.length || enteredRef.current.has(stepIndex)) return
    enteredRef.current.add(stepIndex)
    if (!mutedRef.current) speak(steps[stepIndex].text)
  }, [stepIndex, steps])

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
        {arrived ? (
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
