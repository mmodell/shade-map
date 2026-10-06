import SunCalc from 'suncalc'

/* Clear-sky UV index from solar altitude, reduced for cloud cover.
   Mirrors src/lib/uv.js so the client fallback and the server agree. */
export function estimateUvIndex(sunAltitudeDeg, cloudsPct = 0) {
  if (sunAltitudeDeg == null || sunAltitudeDeg <= 0) return 0
  const rad = (sunAltitudeDeg * Math.PI) / 180
  const clearSky = 10.2 * Math.sin(rad) ** 1.1
  const c = Math.min(100, Math.max(0, cloudsPct)) / 100
  const cloudFactor = 1 - 0.7 * c ** 2
  return Math.max(0, Math.min(12, Math.round(clearSky * cloudFactor)))
}


const STEP_MS = 30 * 60 * 1000

/* The departure times worth charting for a trip on `date` near (lat, lng):
   every 30 minutes from half an hour before sunrise to half an hour after
   sunset. If it's already dark for the evening, chart tomorrow instead —
   that's the day you can still plan. Polar day/night (no sunrise) falls back
   to a plain window around `date`. */
export function departureWindow(date, lat, lng) {
  let times = SunCalc.getTimes(date, lat, lng)
  if (Number.isNaN(times.sunrise?.getTime()) || Number.isNaN(times.sunset?.getTime())) {
    const start = Math.floor((date.getTime() - 3 * 3600e3) / STEP_MS) * STEP_MS
    return Array.from({ length: 25 }, (_, i) => new Date(start + i * STEP_MS))
  }
  if (date.getTime() > times.sunset.getTime() + STEP_MS) {
    times = SunCalc.getTimes(new Date(date.getTime() + 24 * 3600e3), lat, lng)
  }
  const start = Math.floor((times.sunrise.getTime() - STEP_MS) / STEP_MS) * STEP_MS
  const end = times.sunset.getTime() + STEP_MS
  const out = []
  for (let t = start; t <= end && out.length < 49; t += STEP_MS) out.push(new Date(t))
  return out
}
