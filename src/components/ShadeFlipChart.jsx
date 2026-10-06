import { useMemo } from 'react'
import { rankColor } from '../lib/ranking'
import { formatClockAt, formatPercent, hourAt, offsetDiffers } from '../lib/format'
import { bestDeparture, curveOf, nearestSample, shadeAt, spread } from '../lib/shadeCurve'

const W = 320
const H = 104
const PAD = { l: 26, r: 8, t: 8, b: 18 }

/* "When should I leave?" — each route's share of shade for every departure
   time of the day, so you can see the moments the shady option flips (a
   street that's cool at 10am is baking at 3pm). Tap the chart to leave then:
   the same routes are re-analyzed for that time, no new search needed. */
export default function ShadeFlipChart({ routes, selectedId, departure, onScrub, busy, utcOffsetSeconds = null, placeName = null }) {
  const at = (d) => formatClockAt(d, utcOffsetSeconds)
  const series = useMemo(
    () =>
      routes
        .map((r) => ({ id: r.id, rank: r.rank, label: r.label, samples: curveOf(r) }))
        .filter((s) => s.samples.length > 1),
    [routes]
  )
  if (!series.length) return null

  const selected = series.find((s) => s.id === selectedId) || series[0]
  const ref = series[0].samples
  const t0 = new Date(ref[0].t).getTime()
  const t1 = new Date(ref[ref.length - 1].t).getTime()
  const x = (t) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.l - PAD.r)
  const y = (f) => PAD.t + (1 - f) * (H - PAD.t - PAD.b)

  const depMs = departure.getTime()
  const best = bestDeparture(selected.samples, depMs)
  const now = shadeAt(selected.samples, depMs)
  const varies = spread(selected.samples) >= 0.08
  const bestIsNow = best && Math.abs(new Date(best.t).getTime() - depMs) < 20 * 60 * 1000

  const nightBands = []
  for (let i = 0; i < ref.length; i++) {
    if (!ref[i].isNight) continue
    const a = i === 0 ? t0 : (new Date(ref[i - 1].t).getTime() + new Date(ref[i].t).getTime()) / 2
    const b = i === ref.length - 1 ? t1 : (new Date(ref[i].t).getTime() + new Date(ref[i + 1].t).getTime()) / 2
    nightBands.push([a, b])
  }

  const path = (samples) =>
    samples
      .map((s, i) => `${i ? 'L' : 'M'}${x(new Date(s.t).getTime()).toFixed(1)},${y(s.shadeFraction).toFixed(1)}`)
      .join(' ')

  const onPointer = (e) => {
    if (busy) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const t = t0 + ((px - PAD.l) / (W - PAD.l - PAD.r)) * (t1 - t0)
    const s = nearestSample(selected.samples, Math.min(t1, Math.max(t0, t)))
    if (s) onScrub(new Date(s.t))
  }

  const hours = []
  for (let t = Math.ceil(t0 / 3600e3) * 3600e3; t <= t1; t += 3600e3) {
    const h = new Date(t)
    if (hourAt(h, utcOffsetSeconds) % 3 === 0) hours.push(h)
  }
  const remoteClock = offsetDiffers(departure, utcOffsetSeconds)

  return (
    <section className="flip" aria-label="Shade by departure time">
      <div className="flip__head">
        <span className="flip__title">Shade by departure time</span>
        {busy ? (
          <span className="flip__busy">updating…</span>
        ) : (
          remoteClock && <span className="flip__tz">{placeName ? `${placeName} time` : 'route’s local time'}</span>
        )}
      </div>

      <svg
        className="flip__svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Chart of shade share for each route by departure time"
        onPointerUp={onPointer}
      >
        {nightBands.map(([a, b], i) => (
          <rect key={i} x={x(a)} y={PAD.t} width={Math.max(0, x(b) - x(a))} height={H - PAD.t - PAD.b} className="flip__night" />
        ))}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(f)} y2={y(f)} className="flip__grid" />
            <text x={PAD.l - 4} y={y(f) + 3} className="flip__axis" textAnchor="end">
              {Math.round(f * 100)}%
            </text>
          </g>
        ))}
        {hours.map((h) => (
          <text key={h.getTime()} x={x(h.getTime())} y={H - 4} className="flip__axis" textAnchor="middle">
            {at(h).replace(':00', '')}
          </text>
        ))}

        {series
          .filter((s) => s.id !== selected.id)
          .map((s) => (
            <path key={s.id} d={path(s.samples)} fill="none" stroke={rankColor(s.rank)} strokeWidth="1.5" opacity="0.45" />
          ))}
        <path d={path(selected.samples)} fill="none" stroke={rankColor(selected.rank)} strokeWidth="2.75" strokeLinejoin="round" />

        {depMs >= t0 && depMs <= t1 && (
          <g>
            <line x1={x(depMs)} x2={x(depMs)} y1={PAD.t} y2={H - PAD.b} className="flip__now" />
            {now != null && <circle cx={x(depMs)} cy={y(now)} r="4" className="flip__nowdot" />}
          </g>
        )}
        {best && !bestIsNow && (
          <g>
            <circle cx={x(new Date(best.t).getTime())} cy={y(best.shadeFraction)} r="5" className="flip__best" />
          </g>
        )}
      </svg>

      <p className="flip__msg">
        {!best ? (
          'The sun is too low (or it’s dark) for shade to matter in this window.'
        ) : !varies ? (
          'Leaving earlier or later won’t change much on this route.'
        ) : bestIsNow ? (
          <>
            You’re already leaving at the shadiest time — <strong>{formatPercent(best.shadeFraction)}</strong> shade.
          </>
        ) : (
          <>
            Shadiest at <strong>{at(new Date(best.t))}</strong> —{' '}
            <strong>{formatPercent(best.shadeFraction)}</strong> shade
            {now != null && <> vs {formatPercent(now)} at {at(departure)}</>}
            {best.overcast ? ' (overcast then)' : ''}.{' '}
            <button type="button" className="flip__go" disabled={busy} onClick={() => onScrub(new Date(best.t))}>
              Leave then
            </button>
          </>
        )}
      </p>
    </section>
  )
}
