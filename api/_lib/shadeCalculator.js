import SunCalc from 'suncalc'
import { projector, pointInRing, distToPolyline } from './geo.js'
import { estimateUvIndex } from './sun.js'

const TREE_RADIUS_M = 9
const GREEN_LINE_RADIUS_M = 10
// A building only shades a point if the point falls within this angle of
// due-opposite the sun, as seen from the building — buildings aren't
// infinitely thin, so this is the point's "angular width" tolerance rather
// than a single exact bearing.
const SHADOW_ANGLE_TOLERANCE_DEG = 35
// Cap how far a shadow is allowed to reach — right at the horizon
// height/tan(altitude) blows up (a 12m building "reaches" 700m at 1°), which
// stops being a useful routing signal long before the geometry says so.
const MAX_SHADOW_REACH_M = 60

/* Heuristic shade estimate for one route.
   - canopy shade: does the point fall inside/near a park, wood, tree row or
     tree (treated as omnidirectional — canopies are roughly round, unlike
     buildings, so "which side" doesn't matter the way it does for a wall).
   - building shade: is this point actually on the shadow side of a nearby
     building, given the sun's azimuth and the building's height (real when
     OSM has height/building:levels, a flat default otherwise) — NOT just
     "is there a building somewhere nearby". A route can pass two buildings
     of the same height and be shaded by one but not the other depending on
     which side of the street it's tagged against; this is what makes that
     distinction instead of averaging it away.
*/
export function computeShade({ points, osm, date }) {
  const anchor = points[0]
  const project = projector(anchor)

  const rings = osm.greenAreas.map((ring) => ring.map(project))
  const lines = osm.greenLines.map((line) => line.map(project))
  const trees = osm.trees.map(project)
  const buildings = (osm.buildings || []).map((b) => ({ ...project(b), heightM: b.heightM }))

  const mid = points[Math.floor(points.length / 2)] || anchor
  const sun = SunCalc.getPosition(date, mid.lat, mid.lng)
  const altitudeDeg = (sun.altitude * 180) / Math.PI
  const azimuthDeg = ((sun.azimuth * 180) / Math.PI + 180 + 360) % 360
  const isNight = altitudeDeg <= -0.833
  // Shadows point away from the sun.
  const shadowDirectionDeg = (azimuthDeg + 180) % 360
  const altitudeRad = (Math.max(altitudeDeg, 0.5) * Math.PI) / 180 // guard tan() blowing up at the horizon

  // osm may now cover several route alternatives at once (one shared
  // Overpass fetch instead of one per route — see overpass.js), so all of
  // the per-point checks below are measured against THIS route's own points
  // rather than anything bbox-wide, and stay correct regardless of how much
  // extra area the shared fetch pulled in for the other alternatives.
  // `pointShade` mirrors this per-point call for the map's route highlight —
  // one 'shade' | 'sun' entry per entry in `points`.
  let greenHits = 0
  let buildingShadowHits = 0
  const pointShade = []
  for (const p of points) {
    const pp = project(p)
    const greenHit =
      rings.some((r) => pointInRing(pp, r)) ||
      lines.some((l) => distToPolyline(pp, l) <= GREEN_LINE_RADIUS_M) ||
      trees.some((t) => Math.hypot(pp.x - t.x, pp.y - t.y) <= TREE_RADIUS_M)

    const buildingShadowed =
      !isNight &&
      !greenHit &&
      buildings.some((b) => isInBuildingShadow(pp, b, shadowDirectionDeg, altitudeRad))

    if (greenHit) greenHits++
    if (buildingShadowed) buildingShadowHits++
    pointShade.push(isNight || greenHit || buildingShadowed ? 'shade' : 'sun')
  }
  const greenCoverage = points.length ? greenHits / points.length : 0
  // Now a direct measure of "how much of this route a building actually
  // shades", not a proxy for building density — see the isInBuildingShadow
  // check above.
  const builtUpFactor = points.length ? buildingShadowHits / points.length : 0

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

  // Each point is now classified directly (canopy or an actual, directional
  // building shadow) rather than blended from area-wide density estimates,
  // so the route's overall shadeFraction is just the share of shaded points.
  const shadedCount = pointShade.filter((s) => s === 'shade').length
  const shadeFraction = points.length ? shadedCount / points.length : 0

  return {
    shadeFraction: round2(shadeFraction),
    isNight: false,
    sunAltitude: round1(altitudeDeg),
    sunAzimuth: round1(azimuthDeg),
    uvIndex: estimateUvIndex(altitudeDeg),
    greenCoverage: round2(greenCoverage),
    builtUpFactor: round2(builtUpFactor),
    canopyShare: round2(greenCoverage),
    pointShade,
  }
}

/* Does building `b` (projected {x,y,heightM}) cast a shadow reaching
   projected point `pp`, given the sun's shadow direction and altitude? */
function isInBuildingShadow(pp, b, shadowDirectionDeg, altitudeRad) {
  const dx = pp.x - b.x
  const dy = pp.y - b.y
  const dist = Math.hypot(dx, dy)
  if (dist < 1) return true // practically on top of the building
  const heightM = Number.isFinite(b.heightM) && b.heightM > 0 ? b.heightM : 12
  const reach = Math.min(heightM / Math.tan(altitudeRad), MAX_SHADOW_REACH_M)
  if (dist > reach) return false
  // Compass bearing from the building to the point (0 = north, clockwise) —
  // x is east and y is north in this local projection (see geo.js).
  const bearingFromBuilding = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
  return angularDiff(bearingFromBuilding, shadowDirectionDeg) <= SHADOW_ANGLE_TOLERANCE_DEG
}

function angularDiff(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

const round1 = (n) => Math.round(n * 10) / 10
const round2 = (n) => Math.round(n * 100) / 100
