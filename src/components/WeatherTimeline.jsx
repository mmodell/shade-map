import { useMemo } from 'react'
import { formatClock, formatTemp } from '../lib/format'

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

export default function WeatherTimeline({ weather, departure, durationSeconds }) {
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
    return (within.length ? within : weather.points.slice(0, 4).map((p) => ({ ...p, t: new Date(p.time).getTime() }))).slice(0, 6)
  }, [weather, departure, arrival])

  if (!steps.length) return null

  const start = steps[0]
  const advice = buildAdvice(steps, units)

  return (
    <div className="weather">
      <div className="weather__summary">
        <span className="weather__glyph">{CONDITION_GLYPH[start.condition] || '🌡️'}</span>
        <span>
          {formatTemp(start.temp, units)}{' '}
          <span className="weather__dim">feels {formatTemp(start.feelsLike, units)}</span> ·{' '}
          {start.description}
        </span>
        {advice && <span className="weather__advice">{advice}</span>}
      </div>
      <div className="weather__strip">
        {steps.map((s) => (
          <div className="wstep" key={s.time}>
            <span className="wstep__time">{formatClock(new Date(s.t))}</span>
            <span className="wstep__glyph">{CONDITION_GLYPH[s.condition] || '•'}</span>
            <span className="wstep__temp">{formatTemp(s.temp, units)}</span>
            {s.pop != null && s.pop >= 0.2 && (
              <span className="wstep__pop">{Math.round(s.pop * 100)}%</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function buildAdvice(steps, units) {
  const maxFeels = Math.max(...steps.map((s) => s.feelsLike ?? s.temp ?? -Infinity))
  const hotThreshold = units === 'metric' ? 27 : 80
  const rain = steps.some((s) => (s.pop ?? 0) >= 0.4 || /rain|storm/i.test(s.condition))
  const uv = Math.max(...steps.map((s) => s.uvIndex ?? 0))
  const bits = []
  if (maxFeels >= hotThreshold) bits.push('hot — favor the shaded route, bring water')
  if (uv >= 6) bits.push(`UV ${Math.round(uv)}`)
  if (rain) bits.push('rain likely — pack a layer')
  return bits.join(' · ')
}
