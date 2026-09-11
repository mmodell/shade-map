import { bearingDeg, shadeSideForBearing } from '../lib/sunSide'

const MIN_STEP_METERS = 35 // shorter than this, "which side" isn't meaningful

/* Turn-by-turn list for the selected route. Collapsed by default on phones
   so it doesn't dominate the panel. Each straight-enough step is annotated
   with which side of the street is shaded, from the route's sun position. */
export default function RouteSteps({ steps, shade }) {
  if (!steps?.length) return null
  const canShade = shade && !shade.isNight && shade.sunAzimuth != null

  return (
    <details className="steps">
      <summary>
        Directions <span className="steps__count">{steps.length} steps</span>
      </summary>
      <ol className="steps__list">
        {steps.map((s, i) => {
          const shadeSide =
            canShade && s.start && s.end && s.distanceMeters >= MIN_STEP_METERS
              ? shadeSideForBearing(bearingDeg(s.start, s.end), shade.sunAzimuth)
              : null
          return (
            <li key={i} className="steps__item">
              <span className="steps__num">{i + 1}</span>
              <span className="steps__text">
                {s.text || 'Continue'}
                {shadeSide && (
                  <span className="steps__shade"> · shade on the {shadeSide.compass} side</span>
                )}
              </span>
              {s.distance && <span className="steps__dist">{s.distance}</span>}
            </li>
          )
        })}
      </ol>
    </details>
  )
}
