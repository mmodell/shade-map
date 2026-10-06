import SunCalc from 'suncalc'
import { projector, pointInRing, distToPolyline, rayPolygonEntry } from './geo.js'
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
// Footprint buildings are ray-cast, so the old 60m cap (a stand-in for
// "the cone gets silly") isn't needed — only a sanity limit for grazing sun.
const MAX_FOOTPRINT_REACH_M = 250
const INDEX_CELL_M = 40
// Cloud cover (0-100%) above which direct sun isn't really reaching the
// ground at all — past this point, which side of the street is "sun" vs
// "shade" stops being a meaningful comfort difference (see `isOvercast`).
const OVERCAST_CLOUDS_PCT = 75

/* Shade estimate for one route.
   - canopy shade: does the point fall inside/near a park, wood, tree row or
     tree (treated as omnidirectional — canopies are roughly round, unlike
     buildings, so "which side" doesn't matter the way it does for a wall).
   - building shade: a real shadow cast from the building's footprint. From
     each point a ray is traced toward the sun; if it enters a building's
     outline at distance s and the building is taller than s * tan(altitude),
     the point is in shadow. That's what makes a long slab shade the whole
     frontage behind it while a narrow tower only shades a thin stripe.
     Buildings that only have a centre point (no footprint) fall back to a
     directional cone.
   - time-aware: when the route's duration is known, each point is evaluated
     with the sun where it will be when you actually *reach* that point, not
     where it was when you left.

   Split in two so the expensive, time-independent half (projection, canopy
   hits, spatial index) is done once and then reused for every departure time
   in `shadeCurve`. */
export function prepareShade({ points, osm }) {
  const anchor = points[0]
  const project = projector(anchor)

  const rings = osm.greenAreas.map((ring) => ring.map(project))
  const lines = osm.greenLines.map((line) => line.map(project))
  const trees = osm.trees.map(project)

  const polys = []
  const legacy = []
  for (const b of osm.buildings || []) {
    if (b.ring && b.ring.length >= 3) {
      const ring = b.ring.map(([lat, lng]) => project({ lat, lng }))
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const p of ring) {
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
      }
      polys.push({ ring, minX, minY, maxX, maxY, heightM: validHeight(b.heightM) })
    } else {
      legacy.push({ ...project(b), heightM: b.heightM })
    }
  }
  const index = buildIndex(polys)

  const pts = points.map(project)
  const greenHit = pts.map(
    (pp) =>
      rings.some((r) => pointInRing(pp, r)) ||
      lines.some((l) => distToPolyline(pp, l) <= GREEN_LINE_RADIUS_M) ||
      trees.some((t) => Math.hypot(pp.x - t.x, pp.y - t.y) <= TREE_RADIUS_M)
  )
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  }
  const maxHeight = polys.reduce((m, b) => Math.max(m, b.heightM), 0)
  return { points, pts, greenHit, cum, polys, legacy, index, maxHeight }
}

export function evaluateShade(ctx, { date, durationSeconds = 0, cloudsPct = null }) {
  const { points, pts, greenHit, cum } = ctx
  const isOvercast = cloudsPct != null && cloudsPct >= OVERCAST_CLOUDS_PCT
  const total = cum[cum.length - 1]
  const mid = points[Math.floor(points.length / 2)] || points[0]
  const midIdx = Math.floor(points.length / 2)

  // osm may cover several route alternatives at once (one shared Overpass
  // fetch — see overpass.js), so every check below is measured against THIS
  // route's own points. `pointShade` mirrors this per-point call for the map's
  // route highlight — one 'shade' | 'sun' entry per entry in `points`.
  let greenHits = 0
  let buildingShadowHits = 0
  let nightPoints = 0
  let midSun = null
  const pointShade = []
  for (let i = 0; i < points.length; i++) {
    const frac = durationSeconds > 0 && total > 0 ? cum[i] / total : 0
    const arrival = frac ? new Date(date.getTime() + frac * durationSeconds * 1000) : date
    const sun = sunAt(arrival, points[i])
    if (i === midIdx) midSun = sun
    const night = sun.altitudeDeg <= -0.833
    const green = greenHit[i]
    const built = !night && !green && buildingShadows(ctx, pts[i], sun)
    if (night) nightPoints++
    if (green) greenHits++
    if (built) buildingShadowHits++
    pointShade.push(night || green || built ? 'shade' : 'sun')
  }
  const greenCoverage = points.length ? greenHits / points.length : 0
  // A direct measure of "how much of this route a building actually shades",
  // not a proxy for building density.
  const builtUpFactor = points.length ? buildingShadowHits / points.length : 0
  midSun = midSun || sunAt(date, mid)
  const { altitudeDeg, azimuthDeg } = midSun
  const isNight = points.length > 0 && nightPoints === points.length

  if (isNight) {
    return {
      shadeFraction: 1,
      isNight: true,
      isOvercast: false, // moot after dark — the note already covers it
      cloudsPct,
      sunAltitude: round1(altitudeDeg),
      sunAzimuth: round1(azimuthDeg),
      uvIndex: 0,
      greenCoverage: round2(greenCoverage),
      builtUpFactor: round2(builtUpFactor),
      pointShade,
      note: 'After sunset — comfort comes down to lighting and safety.',
    }
  }

  // Each point is classified directly (canopy, an actual building shadow, or
  // after dark), so the route's overall shadeFraction is the share of shaded
  // points.
  const shadedCount = pointShade.filter((s) => s === 'shade').length
  const shadeFraction = points.length ? shadedCount / points.length : 0

  return {
    shadeFraction: round2(shadeFraction),
    isNight: false,
    // Heavy overcast means there's no harsh direct sun to dodge in the first
    // place, so which side of the street counts as "sun" stops being a real
    // comfort difference — surfaced so the UI can tell the user their Shade
    // preference isn't doing anything useful right now (the same treatment
    // `isNight` already gets).
    isOvercast,
    cloudsPct,
    sunAltitude: round1(altitudeDeg),
    sunAzimuth: round1(azimuthDeg),
    uvIndex: estimateUvIndex(altitudeDeg, cloudsPct ?? 0),
    greenCoverage: round2(greenCoverage),
    builtUpFactor: round2(builtUpFactor),
    canopyShare: round2(greenCoverage),
    pointShade,
    note: nightPoints
      ? 'Sun sets partway along this route — the last stretch is after dark.'
      : isOvercast
        ? `Overcast (${Math.round(cloudsPct)}% cloud cover) — little direct sun to route around either way.`
        : undefined,
  }
}

export function computeShade({ points, osm, date, cloudsPct = null, durationSeconds = 0 }) {
  return evaluateShade(prepareShade({ points, osm }), { date, durationSeconds, cloudsPct })
}

/* The same route's shade for each of several departure times — what powers
   the "when should I leave" chart. `cloudsAt(date)` may return a cloud cover
   % (or null) for each departure. */
export function shadeCurve(ctx, { dates, durationSeconds = 0, cloudsAt = null }) {
  return dates.map((d) => {
    const r = evaluateShade(ctx, { date: d, durationSeconds, cloudsPct: cloudsAt ? cloudsAt(d) : null })
    return {
      t: d.toISOString(),
      shadeFraction: r.shadeFraction,
      isNight: r.isNight,
      overcast: r.isOvercast,
      sunAltitude: r.sunAltitude,
    }
  })
}

function sunAt(date, p) {
  const sun = SunCalc.getPosition(date, p.lat, p.lng)
  return {
    altitudeDeg: (sun.altitude * 180) / Math.PI,
    azimuthDeg: ((sun.azimuth * 180) / Math.PI + 180 + 360) % 360,
  }
}

function validHeight(h) {
  return Number.isFinite(h) && h > 0 ? h : 12
}

function buildIndex(polys) {
  const cells = new Map()
  polys.forEach((b, i) => {
    const x0 = Math.floor(b.minX / INDEX_CELL_M)
    const x1 = Math.floor(b.maxX / INDEX_CELL_M)
    const y0 = Math.floor(b.minY / INDEX_CELL_M)
    const y1 = Math.floor(b.maxY / INDEX_CELL_M)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = cx * 100003 + cy
        const list = cells.get(k)
        if (list) list.push(i)
        else cells.set(k, [i])
      }
    }
  })
  return cells
}

function buildingShadows(ctx, pp, sun) {
  const altitudeRad = (Math.max(sun.altitudeDeg, 0.5) * Math.PI) / 180 // guard tan() blowing up at the horizon
  // Centre-point buildings (no footprint) keep the directional-cone model.
  if (ctx.legacy.length) {
    const shadowDirectionDeg = (sun.azimuthDeg + 180) % 360
    if (ctx.legacy.some((b) => isInBuildingShadow(pp, b, shadowDirectionDeg, altitudeRad))) return true
  }
  if (!ctx.polys.length) return false
  const tanAlt = Math.tan(altitudeRad)
  const reach = Math.min(ctx.maxHeight / tanAlt, MAX_FOOTPRINT_REACH_M)
  const az = (sun.azimuthDeg * Math.PI) / 180
  const dx = Math.sin(az) // x is east, y is north — toward the sun
  const dy = Math.cos(az)
  const seen = new Set()
  const stepM = INDEX_CELL_M / 4
  for (let s = 0; s <= reach + stepM; s += stepM) {
    const cx = Math.floor((pp.x + dx * s) / INDEX_CELL_M)
    const cy = Math.floor((pp.y + dy * s) / INDEX_CELL_M)
    const list = ctx.index.get(cx * 100003 + cy)
    if (!list) continue
    for (const i of list) {
      if (seen.has(i)) continue
      seen.add(i)
      const b = ctx.polys[i]
      if (isShadowedByFootprint(pp, b, dx, dy, tanAlt)) return true
    }
  }
  return false
}

/* Is point `pp` in the shadow of footprint building `b`, with unit vector
   (dx,dy) pointing at the sun and tanAlt the tangent of its altitude? */
export function isShadowedByFootprint(pp, b, dx, dy, tanAlt) {
  const maxS = Math.min(b.heightM / tanAlt, MAX_FOOTPRINT_REACH_M)
  // cheap reject: nearest the bounding box can be to the point
  const nx = Math.max(b.minX - pp.x, 0, pp.x - b.maxX)
  const ny = Math.max(b.minY - pp.y, 0, pp.y - b.maxY)
  if (Math.hypot(nx, ny) > maxS) return false
  const s = rayPolygonEntry(pp.x, pp.y, dx, dy, b.ring)
  return s <= maxS
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
