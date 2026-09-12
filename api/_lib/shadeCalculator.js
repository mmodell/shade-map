import SunCalc from 'suncalc'
import { projector, pointInRing, distToPolyline } from './geo.js'
import { estimateUvIndex } from './sun.js'

const TREE_RADIUS_M = 9
const GREEN_LINE_RADIUS_M = 10
const BUILDING_RADIUS_M = 25

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
  const buildings = (osm.buildings || []).map(project)

  const mid = points[Math.floor(points.length / 2)] || anchor
  const sun = SunCalc.getPosition(date, mid.lat, mid.lng)
  const altitudeDeg = (sun.altitude * 180) / Math.PI
  const azimuthDeg = ((sun.azimuth * 180) / Math.PI + 180 + 360) % 360
  const isNight = altitudeDeg <= -0.833
  // Low-ish sun means street-level shadows are long enough to plausibly
  // reach the path near a building; high sun means they mostly don't.
  const buildingsHelp = altitudeDeg <= 25

  // osm may now cover several route alternatives at once (one shared
  // Overpass fetch instead of one per route — see overpass.js), so both
  // shares below are measured per-point against THIS route's own path
  // rather than anything bbox-wide, and stay correct regardless of how much
  // extra area the shared fetch pulled in for the other alternatives.
  // `pointShade` mirrors that per-point call for the map's route highlight —
  // one 'shade' | 'sun' entry per entry in `points`.
  let greenHits = 0
  let buildingHits = 0
  const pointShade = []
  for (const p of points) {
    const pp = project(p)
    const greenHit =
      rings.some((r) => pointInRing(pp, r)) ||
      lines.some((l) => distToPolyline(pp, l) <= GREEN_LINE_RADIUS_M) ||
      trees.some((t) => Math.hypot(pp.x - t.x, pp.y - t.y) <= TREE_RADIUS_M)
    const buildingNear = buildings.some((b) => Math.hypot(pp.x - b.x, pp.y - b.y) <= BUILDING_RADIUS_M)
    if (greenHit) greenHits++
    if (buildingNear) buildingHits++
    pointShade.push(isNight || greenHit || (buildingNear && buildingsHelp) ? 'shade' : 'sun')
  }
  const greenCoverage = points.length ? greenHits / points.length : 0
  const builtUpFactor = points.length ? buildingHits / points.length : 0

  if (isNight) {
    return {
      shadeFraction: 1,
      isNight: true,
      sunAltitude: round1(altitudeDeg),
      sunAzimuth: round1(azimuthDeg),
      uvIndex: 0,
      greenCoverage: round2(greenCoverage),
      builtUpFactor: round2(builtUpFactor),
      pointShade,
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
    pointShade,
  }
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}
const round1 = (n) => Math.round(n * 10) / 10
const round2 = (n) => Math.round(n * 100) / 100
