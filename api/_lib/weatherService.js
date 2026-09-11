import SunCalc from 'suncalc'
import { estimateUvIndex } from './sun.js'

const BASE = 'https://api.openweathermap.org/data/2.5'

/* Weather timeline for a location using OpenWeather's free endpoints
   (current conditions + 3-hour / 5-day forecast). Returns null if no key. */
export async function getWeather({ lat, lng, units }) {
  const key = process.env.OPENWEATHER_API_KEY
  if (!key) return null

  const u = units === 'metric' ? 'metric' : 'imperial'
  const qs = `lat=${lat}&lon=${lng}&units=${u}&appid=${key}`

  const [current, forecast] = await Promise.all([
    safeJson(`${BASE}/weather?${qs}`),
    safeJson(`${BASE}/forecast?${qs}`),
  ])

  const points = []
  if (current?.main) points.push(normalize(current, lat, lng, current.dt))
  for (const item of forecast?.list || []) {
    points.push(normalize(item, lat, lng, item.dt))
  }
  if (!points.length) return null

  points.sort((a, b) => new Date(a.time) - new Date(b.time))

  return {
    provider: 'openweather',
    units: u,
    location: { lat, lng, name: forecast?.city?.name || current?.name || null },
    points,
  }
}

function normalize(src, lat, lng, dtSeconds) {
  const date = new Date(dtSeconds * 1000)
  const w = (src.weather && src.weather[0]) || {}
  const clouds = src.clouds?.all ?? 0
  return {
    time: date.toISOString(),
    temp: src.main?.temp ?? null,
    feelsLike: src.main?.feels_like ?? src.main?.temp ?? null,
    clouds,
    pop: src.pop ?? 0,
    wind: src.wind?.speed ?? null,
    condition: w.main || 'Clear',
    description: w.description || '',
    icon: w.icon || null,
    uvIndex: estimateUvIndex((SunCalc.getPosition(date, lat, lng).altitude * 180) / Math.PI, clouds),
  }
}

async function safeJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
