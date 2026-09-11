import { useMemo } from 'react'
import { formatClock, formatTemp } from '../lib/format'
import { uvCategory } from '../lib/uv'

const CONDITION_GLYPH = {
  Clear: '☀️',
  Clouds: '⛅',
  Rain: '🌧️',
  Drizzle: '🌦️',
  Thunderstorm: '⛈️',
  Snow: '🌨️',
  Mist: '🌫️',
  Fog: '🌫️',
  Haze: '🌫️',
  Smoke: '🌫️',
}

export default function WeatherTimeline({ weather, shade, departure, durationSeconds }) {
  const units = weather?.units || 'imperial'
  const arrival = useMemo(
    () => new Date(departure.getTime() + (durationSeconds || 0) * 1000),
    [departure, durationSeconds]
  )

  const steps = useMemo(() => {
    if (!weather?.points?.length) return []
    const from = departure.getTime() - 60 * 60 * 1000
    const to = arrival.getTime() + 60 * 60 * 1000
    const within = weather.points
      .map((p) => ({ ...p, t: new Date(p.time).getTime() }))
      .filter((p) => p.t >= from && p.t <= to)
    return (within.length
      ? within
      : weather.points.slice(0, 4).map((p) => ({ ...p, t: new Date(p.time).getTime() }))
    ).slice(0, 6)
  }, [weather, departure, arrival])

  // UV: prefer the forecast timeline, fall back to the route's sun-angle estimate.
  const uv = steps.length
    ? Math.max(...steps.map((s) => s.uvIndex ?? 0))
    : shade?.uvIndex ?? null
  const uvCat = uvCategory(uv)
  const isNight = shade?.isNight || (uv === 0 && (shade?.sunAltitude ?? 1) <= 0)

  if (!steps.length && uv == null && !isNight) return null

  const start = steps[0]

  return (
    <div className="weather">
      <div className="weather__summary">
        {start ? (
          <>
            <span className="weather__glyph">
              {CONDITION_GLYPH[start.condition] || '🌡️'}
            </span>
            <span>
              {formatTemp(start.temp, units)}{' '}
              <span className="weather__dim">feels {formatTemp(start.feelsLike, units)}</span> ·{' '}
              {start.description}
            </span>
          </>
        ) : (
          <span className="weather__glyph">{isNight ? '🌙' : '☀︎'}</span>
        )}

        {isNight ? (
          <span className="weather__uv" style={{ color: 'var(--text-dim)' }}>
            After sunset
          </span>
        ) : (
          <span className="weather__uv" style={{ color: uvCat.color }}>
            UV {uv} · {uvCat.label}
          </span>
        )}
        {!start && shade?.sunAltitude != null && !isNight && (
          <span className="weather__dim">sun {Math.round(shade.sunAltitude)}° up</span>
        )}
        {advice(steps, uv, units) && (
          <span className="weather__advice">{advice(steps, uv, units)}</span>
        )}
      </div>

      {steps.length > 0 && (
        <div className="weather__strip">
          {steps.map((s) => (
            <div className="wstep" key={s.time}>
              <span className="wstep__time">{formatClock(new Date(s.t))}</span>
              <span className="wstep__glyph">{CONDITION_GLYPH[s.condition] || '•'}</span>
              <span className="wstep__temp">{formatTemp(s.temp, units)}</span>
              {s.uvIndex != null && s.uvIndex > 0 && (
                <span className="wstep__uv" style={{ color: uvCategory(s.uvIndex).color }}>
                  UV {s.uvIndex}
                </span>
              )}
              {s.pop != null && s.pop >= 0.2 && (
                <span className="wstep__pop">{Math.round(s.pop * 100)}%</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function advice(steps, uv, units) {
  const bits = []
  if (steps.length) {
    const maxFeels = Math.max(...steps.map((s) => s.feelsLike ?? s.temp ?? -Infinity))
    const hot = units === 'metric' ? 27 : 80
    if (maxFeels >= hot) bits.push('hot — take the shaded route, bring water')
    if (steps.some((s) => (s.pop ?? 0) >= 0.4 || /rain|storm/i.test(s.condition)))
      bits.push('rain likely')
  }
  if (uv >= 8) bits.push('wear sunscreen')
  return bits.join(' · ')
}
