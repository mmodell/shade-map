import { projector, distToPolyline } from './geo.js'

const MATCH_RADIUS_M = 25

/* For each route point, find the tags of the nearest OSM highway within
   MATCH_RADIUS_M. Returns an array aligned with `points` (entries may be null). */
export function matchHighways(points, highways) {
  if (!points.length || !highways.length) return points.map(() => null)
  const project = projector(points[0])
  const projected = highways.map((h) => ({ tags: h.tags, line: h.path.map(project) }))

  return points.map((p) => {
    const pp = project(p)
    let best = null
    let bestD = MATCH_RADIUS_M
    for (const h of projected) {
      const d = distToPolyline(pp, h.line)
      if (d < bestD) {
        bestD = d
        best = h.tags
      }
    }
    return best
  })
}
