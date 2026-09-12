/* Client-side haversine distance — a standalone copy of the server's
   api/_lib/geo.js version (that file isn't bundled into the browser build). */
const R = 6371000 // metres

export function haversineMeters(a, b) {
  if (!a || !b) return Infinity
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Perpendicular distance from `pos` to a segment, done in a small flat
// projection (equirectangular, scaled by latitude) since path segments here
// are always short enough that curvature doesn't matter — this avoids
// re-deriving great-circle-to-segment math for a metres-scale check.
function distToSegmentMeters(pos, a, b) {
  const lat0 = ((a.lat + b.lat) / 2) * (Math.PI / 180)
  const mPerDegLat = 111320
  const mPerDegLng = 111320 * Math.cos(lat0)
  const toXY = (p) => ({ x: (p.lng - a.lng) * mPerDegLng, y: (p.lat - a.lat) * mPerDegLat })
  const p = toXY(pos)
  const bXY = toXY(b)
  const abLenSq = bXY.x ** 2 + bXY.y ** 2
  if (abLenSq === 0) return haversineMeters(pos, a)
  let t = (p.x * bXY.x + p.y * bXY.y) / abLenSq
  t = Math.max(0, Math.min(1, t))
  const projX = bXY.x * t
  const projY = bXY.y * t
  return Math.hypot(p.x - projX, p.y - projY)
}

// Shortest distance from `pos` to any segment of `path` — used to detect
// drifting off the planned route during live navigation.
export function distanceToPath(pos, path) {
  if (!pos || !path?.length) return Infinity
  if (path.length === 1) return haversineMeters(pos, path[0])
  let min = Infinity
  for (let i = 0; i < path.length - 1; i++) {
    const d = distToSegmentMeters(pos, path[i], path[i + 1])
    if (d < min) min = d
  }
  return min
}
