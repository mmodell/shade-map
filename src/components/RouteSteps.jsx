/* Turn-by-turn list for the selected route. Collapsed by default on phones
   so it doesn't dominate the panel. */
export default function RouteSteps({ steps, routeLabel }) {
  if (!steps?.length) return null
  return (
    <details className="steps">
      <summary>
        Directions <span className="steps__count">{steps.length} steps</span>
      </summary>
      <ol className="steps__list">
        {steps.map((s, i) => (
          <li key={i} className="steps__item">
            <span className="steps__num">{i + 1}</span>
            <span className="steps__text">{s.text || 'Continue'}</span>
            {s.distance && <span className="steps__dist">{s.distance}</span>}
          </li>
        ))}
      </ol>
    </details>
  )
}
