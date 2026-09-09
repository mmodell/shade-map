import { rankColor } from '../lib/ranking'
import { formatDistance, formatDuration, formatPercent } from '../lib/format'

export default function RouteList({ routes, selectedId, onSelect }) {
  return (
    <ul className="routes">
      {routes.map((r) => {
        const isSel = r.id === selectedId
        const night = r.shade?.isNight
        return (
          <li key={r.id}>
            <button
              className={`route${isSel ? ' route--selected' : ''}`}
              onClick={() => onSelect(r.id)}
              style={{ '--route-color': rankColor(r.rank) }}
            >
              <div className="route__head">
                <span className="route__dot" />
                <span className="route__name">
                  {r.rank === 0 ? 'Best' : `#${r.rank + 1}`} · {r.label}
                </span>
                <span className="route__score">{Math.round(r.composite * 100)}</span>
              </div>

              <div className="route__stats">
                <Stat label="Shade" value={night ? 'night' : formatPercent(r.shade?.shadeFraction)} />
                <Stat label="Distance" value={formatDistance(r.distanceMeters)} />
                <Stat label="Time" value={formatDuration(r.durationSeconds)} />
                <Stat
                  label="Safety"
                  value={r.safety?.score != null ? formatPercent(r.safety.score) : '—'}
                />
              </div>

              {r.shade?.note && <p className="route__note">{r.shade.note}</p>}
              {!r.shade?.note && r.shade?.greenCoverage != null && (
                <p className="route__note">
                  {formatPercent(r.shade.greenCoverage)} of this route runs past parks, trees or
                  greenway. Sun {Math.round(r.shade.sunAltitude)}° up.
                </p>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
    </div>
  )
}
