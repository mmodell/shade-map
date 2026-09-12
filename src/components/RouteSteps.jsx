import { useEffect, useRef, useState } from 'react'
import { bearingDeg, shadeSideForBearing } from '../lib/sunSide'
import { speak, stopSpeaking, ttsSupported } from '../lib/tts'
import { haversineMeters } from '../lib/geoMath'

const MIN_STEP_METERS = 35 // shorter than this, "which side" isn't meaningful

/* Turn-by-turn list for the selected route, with an optional read-aloud
   playback (Web Speech API — no key, built into the browser). Each
   straight-enough step is also annotated with which side of the street is
   shaded, from the segment's bearing vs. the route's sun azimuth, and with
   the nearest sampled point's safety classification (sidewalks/lit streets
   vs. exposed busy roads — not crime data, see safetyService.js) so a
   risky-feeling stretch shows up on the turn itself, not just as a line
   color on the map. */
export default function RouteSteps({ steps, shade, safety, points, focusedIndex, onFocusStep }) {
  const [playingIndex, setPlayingIndex] = useState(null) // index while speaking, or null
  const [mode, setMode] = useState('idle') // idle | playing-all | playing-one
  const stopRequested = useRef(false)

  const canShade = shade && !shade.isNight && shade.sunAzimuth != null
  const pointSafety = safety?.pointSafety
  const annotated = (steps || []).map((s) => {
    const shadeSide =
      canShade && s.start && s.end && s.distanceMeters >= MIN_STEP_METERS
        ? shadeSideForBearing(bearingDeg(s.start, s.end), shade.sunAzimuth)
        : null
    const risk = nearestSafety(s, points, pointSafety)
    return { ...s, shadeSide, risk }
  })

  useEffect(() => stopSpeaking, []) // stop any speech if the route/panel changes

  if (!steps?.length) return null

  function textFor(s) {
    const bits = [s.text || 'Continue']
    if (s.shadeSide) bits.push(`shade on the ${s.shadeSide.compass} side`)
    if (s.distance) bits.push(s.distance)
    return bits.join(', ')
  }

  function playFrom(i) {
    if (i >= annotated.length) {
      setPlayingIndex(null)
      setMode('idle')
      return
    }
    setPlayingIndex(i)
    speak(textFor(annotated[i]), {
      onend: () => {
        if (stopRequested.current) return
        playFrom(i + 1)
      },
    })
  }

  function playAll() {
    stopRequested.current = false
    setMode('playing-all')
    playFrom(0)
  }

  function playOne(i) {
    stopRequested.current = false
    setMode('playing-one')
    setPlayingIndex(i)
    speak(textFor(annotated[i]), {
      onend: () => {
        setPlayingIndex(null)
        setMode('idle')
      },
    })
  }

  function stop() {
    stopRequested.current = true
    stopSpeaking()
    setPlayingIndex(null)
    setMode('idle')
  }

  const supported = ttsSupported()
  const hasFocus = focusedIndex != null
  const canFocus = typeof onFocusStep === 'function'

  function focus(i) {
    if (!canFocus) return
    onFocusStep(i === focusedIndex ? null : i) // click again to clear
  }
  function step(delta) {
    if (!canFocus) return
    const next = hasFocus ? focusedIndex + delta : delta > 0 ? 0 : annotated.length - 1
    onFocusStep(Math.max(0, Math.min(annotated.length - 1, next)))
  }

  return (
    <details className="steps" open={hasFocus || undefined}>
      <summary>
        Directions <span className="steps__count">{steps.length} steps</span>
      </summary>

      {canFocus && (
        <div className="steps__preview">
          <button type="button" className="steps__pvbtn" onClick={() => step(-1)} aria-label="Previous step">
            ◀
          </button>
          <span className="steps__pvlabel">
            {hasFocus ? `Previewing step ${focusedIndex + 1} of ${annotated.length}` : 'Tap a step to preview it on the map'}
          </span>
          <button type="button" className="steps__pvbtn" onClick={() => step(1)} aria-label="Next step">
            ▶
          </button>
          {hasFocus && (
            <button type="button" className="steps__pvclear" onClick={() => onFocusStep(null)}>
              Clear
            </button>
          )}
        </div>
      )}

      {supported && (
        <div className="steps__voice">
          {mode === 'idle' ? (
            <button type="button" className="steps__voicebtn" onClick={playAll}>
              🔊 Read directions aloud
            </button>
          ) : (
            <button type="button" className="steps__voicebtn steps__voicebtn--on" onClick={stop}>
              ⏹ Stop
            </button>
          )}
        </div>
      )}

      <ol className="steps__list">
        {annotated.map((s, i) => (
          <li
            key={i}
            className={`steps__item${playingIndex === i ? ' steps__item--active' : ''}${
              focusedIndex === i ? ' steps__item--focused' : ''
            }${canFocus ? ' steps__item--clickable' : ''}`}
            onClick={canFocus ? () => focus(i) : undefined}
          >
            <span className="steps__num">{i + 1}</span>
            <span className="steps__text">
              {s.text || 'Continue'}
              {s.shadeSide && (
                <span className="steps__shade"> · shade on the {s.shadeSide.compass} side</span>
              )}
              {s.risk === 'risk' && (
                <span className="steps__risk" title="Busy road with no sidewalk, or unlit at night">
                  {' '}
                  · ⚠️ higher-risk stretch
                </span>
              )}
            </span>
            {s.distance && <span className="steps__dist">{s.distance}</span>}
            {supported && (
              <button
                type="button"
                className="steps__speak"
                aria-label={`Read step ${i + 1} aloud`}
                onClick={(e) => {
                  e.stopPropagation()
                  playOne(i)
                }}
              >
                🔊
              </button>
            )}
          </li>
        ))}
      </ol>
    </details>
  )
}

/* Approximates "how safe does this turn's stretch look" by finding the
   sampled route point nearest this step's midpoint and reading its
   classification — steps and the analyzer's sampled points come from two
   different sources (Google's raw steps vs. our ~40m sampling), so this is
   a nearest-neighbor match rather than an exact one. */
function nearestSafety(step, points, pointSafety) {
  if (!points?.length || !pointSafety?.length || points.length !== pointSafety.length) return null
  const mid =
    step.start && step.end
      ? { lat: (step.start.lat + step.end.lat) / 2, lng: (step.start.lng + step.end.lng) / 2 }
      : step.start || step.end
  if (!mid) return null
  let bestIndex = 0
  let bestDist = Infinity
  points.forEach((p, i) => {
    const d = haversineMeters(mid, p)
    if (d < bestDist) {
      bestDist = d
      bestIndex = i
    }
  })
  return pointSafety[bestIndex]
}
