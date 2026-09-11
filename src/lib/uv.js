/* Rough UV-index estimate from the sun's altitude and cloud cover.
   OpenWeather's free tier doesn't include UV, so we model clear-sky UV from
   solar elevation (Fioletov et al. approximation) and knock it down for cloud. */
export function estimateUvIndex(sunAltitudeDeg, cloudsPct = 0) {
  if (sunAltitudeDeg == null || sunAltitudeDeg <= 0) return 0
  const rad = (sunAltitudeDeg * Math.PI) / 180
  const clearSky = 10.2 * Math.sin(rad) ** 1.1
  const c = Math.min(100, Math.max(0, cloudsPct)) / 100
  const cloudFactor = 1 - 0.7 * c ** 2
  return Math.max(0, Math.min(12, Math.round(clearSky * cloudFactor)))
}

export function uvCategory(uv) {
  if (uv == null) return { label: '—', color: 'var(--text-dim)' }
  if (uv <= 2) return { label: 'Low', color: '#4ade80' }
  if (uv <= 5) return { label: 'Moderate', color: '#facc15' }
  if (uv <= 7) return { label: 'High', color: '#fb923c' }
  if (uv <= 10) return { label: 'Very high', color: '#f87171' }
  return { label: 'Extreme', color: '#c084fc' }
}
