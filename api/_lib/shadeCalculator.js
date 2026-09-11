import SunCalc from 'suncalc'
import {
  projector,
  pointInRing,
  distToPolyline,
  pathLengthMeters,
} from './geo.js'
import { estimateUvIndex } from './sun.js'

const TREE_RADIUS_M = 9
const GREEN_LINE_RADIUS_M = 10

/* Heuristic shade estimate for one route.
   - canopy shade: share of the path that passes through parks / woods / tree rows
   - street shade: buildings & walls beside the path, weighted up as the sun gets lower
*/
export function computeShade({ points, osm, date }) {
  const anchor = points[0]
  const project = projector(anchor)

  const rings = osm.greenAreas.map((ring) => ring.map(project))
  const lines = osm.greenLines.map((line) => line.map(project))
  const trees = osm.trees.map(project)

  let greenHits = 0
  for (const p of points) {
    const pp = project(p)
    if (rings.some((r) => pointInRing(pp, r))) {
      greenHits++
      continue
    }
    if (lines.some((l) => distToPolyline(pp, l) <= GREEN_LINE_RADIUS_M)) {
      greenHits++
      continue
    }
    if (trees.some((t) => Math.hypot(pp.x - t.x, pp.y - t.y) <= TREE_RADIUS_M)) {
      greenHits++
    }
  }
  const greenCoverage = points.length ? greenHits / points.length : 0

  const km = Math.max(0.05, pathLengthMeters(points) / 1000)
  const builtUpFactor = clamp01(osm.buildingCount / (km * 120))

  const mid = points[Math.floor(points.length / 2)] || anchor
  const sun = SunCalc.getPosition(date, mid.lat, mid.lng)
  const altitudeDeg = (sun.altitude * 180) / Math.PI
  const azimuthDeg = ((sun.azimuth * 180) / Math.PI + 180 + 360) % 360

  if (altitudeDeg <= -0.833) {
    return {
      shadeFraction: 1,
      isNight: true,
      sunAltitude: round1(altitudeDeg),
      sunAzimuth: round1(azimuthDeg),
      uvIndex: 0,
      greenCoverage: round2(greenCoverage),
      builtUpFactor: round2(builtUpFactor),
      note: 'After sunset — comfort comes down to lighting and safety.',
    }
  }

  const canopyShade = greenCoverage * 0.85

  let urbanBase
  if (altitudeDeg >= 60) urbanBase = 0.08
  else if (altitudeDeg <= 8) urbanBase = 0.6
  else urbanBase = 0.6 - ((altitudeDeg - 8) / 52) * 0.52
  const urbanShade = urbanBase * builtUpFactor

  const shadeFraction = clamp01(canopyShade + (1 - canopyShade) * urbanShade)

  return {
    shadeFraction: round2(shadeFraction),
    isNight: false,
    sunAltitude: round1(altitudeDeg),
    sunAzimuth: round1(azimuthDeg),
    uvIndex: estimateUvIndex(altitudeDeg),
    greenCoverage: round2(greenCoverage),
    builtUpFactor: round2(builtUpFactor),
    canopyShare: round2(canopyShade),
  }
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}
const round1 = (n) => Math.round(n * 10) / 10
const round2 = (n) => Math.round(n * 100) / 100
