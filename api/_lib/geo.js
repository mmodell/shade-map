// Small self-contained geometry helpers (no dependencies).

const R = 6371000 // earth radius, metres

export function toRad(d) {
  return (d * Math.PI) / 180
}

export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Local equirectangular projection to metres around an anchor — good enough
// for the short distances involved in point-in-polygon / nearest-way tests.
export function projector(anchor) {
  const lat0 = toRad(anchor.lat)
  const cos0 = Math.cos(lat0)
  return (p) => ({
    x: toRad(p.lng - anchor.lng) * cos0 * R,
    y: toRad(p.lat - anchor.lat) * R,
  })
}

export function bbox(points, padMeters = 60) {
  let minLat = Infinity
  let minLng = Infinity
  let maxLat = -Infinity
  let maxLng = -Infinity
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
  }
  const dLat = padMeters / 111320
  const dLng = padMeters / (111320 * Math.cos(toRad((minLat + maxLat) / 2)) || 1)
  return {
    south: minLat - dLat,
    west: minLng - dLng,
    north: maxLat + dLat,
    east: maxLng + dLng,
  }
}

export function pointInRing(pt, ring) {
  // ring: [{x,y}]; pt: {x,y}; ray casting
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x
    const yi = ring[i].y
    const xj = ring[j].x
    const yj = ring[j].y
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi || 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function distToSegment(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function distToPolyline(p, line) {
  let min = Infinity
  for (let i = 1; i < line.length; i++) {
    const d = distToSegment(p, line[i - 1], line[i])
    if (d < min) min = d
  }
  return min
}

export function pathLengthMeters(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i])
  return total
}
