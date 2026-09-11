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
