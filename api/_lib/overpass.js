import { bbox } from './geo.js'
import { cached } from './cache.js'

// Snap the query bbox outward to this grid before fetching/caching, so two
// searches in the same neighborhood reuse one Overpass result instead of
// each firing its own — always rounds south/west down and north/east up, so
// the snapped box is a superset of what was actually asked for.
const GRID_DEG = 0.005 // ~550m of latitude
const OSM_TTL_MS = 24 * 60 * 60 * 1000 // building/tree/road data barely changes day to day

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

const GREEN_AREA_QUERY = [
  'way["leisure"~"park|garden|nature_reserve|common|dog_park"]',
  'way["landuse"~"forest|recreation_ground|meadow|grass|village_green|cemetery"]',
  'way["natural"~"wood|scrub|heath|grassland"]',
]
const GREEN_LINE_QUERY = ['way["natural"="tree_row"]', 'way["barrier"="hedge"]']
const HIGHWAY_QUERY =
  'way["highway"~"footway|path|pedestrian|steps|cycleway|living_street|residential|service|unclassified|tertiary|secondary|primary|track"]'

/* Returns { greenAreas: [[latlng]], greenLines: [[latlng]], trees: [latlng],
   highways: [{ path:[latlng], tags }],
   buildings: [{lat,lng,heightM,ring?:[[lat,lng]]}] } for
   the given bbox. `points` can span several route alternatives at once —
   pass their combined points to fetch one shared dataset instead of one per
   route. `heightM` is real when OSM has height/building:levels tagged,
   otherwise a flat default — see shadeCalculator.js's shadow casting. */
export async function fetchOsmFeatures(points) {
  const b = snapBbox(bbox(points, 70))
  const box = `${b.south},${b.west},${b.north},${b.east}`

  // Two independent requests. The greenery/footpath layer is what the app
  // has always relied on; building outlines are the heavy, optional upgrade.
  // Keeping them apart means a slow or failed building download can never
  // take the parks, trees and sidewalks down with it.
  const [base, buildings] = await Promise.all([
    cached(`osm:${box}`, OSM_TTL_MS, async () => {
      const q = `[out:json][timeout:25];
(
  ${GREEN_AREA_QUERY.map((s) => `${s}(${box});`).join('\n  ')}
  ${GREEN_LINE_QUERY.map((s) => `${s}(${box});`).join('\n  ')}
  node["natural"="tree"](${box});
  ${HIGHWAY_QUERY}(${box});
);
out geom tags;`
      return parseBase(await runQuery(q))
    }),
    fetchBuildings(b, box).catch(() => null),
  ])
  return { ...base, buildings: buildings ?? [], buildingsOk: buildings != null }
}

// Full outlines for every building in a box get very large very fast (a
// 7-mile drive across a dense city is tens of megabytes), so past this area
// we ask for just a centre point + height per building — the older, much
// lighter query — and shadows fall back to the directional-cone model.
const MAX_FOOTPRINT_AREA_KM2 = 5

function bboxAreaKm2(b) {
  const midLat = ((b.north + b.south) / 2) * (Math.PI / 180)
  const h = (b.north - b.south) * 111.32
  const w = (b.east - b.west) * 111.32 * Math.cos(midLat)
  return h * w
}

function fetchBuildings(b, box) {
  const footprints = bboxAreaKm2(b) <= MAX_FOOTPRINT_AREA_KM2
  return cached(`bld:${footprints ? 'geom' : 'ctr'}:${box}`, OSM_TTL_MS, async () => {
    const q = `[out:json][timeout:25];
way["building"](${box});
out ${footprints ? 'geom tags' : 'tags center'};`
    return parseBuildings(await runQuery(q))
  })
}

function snapBbox(b) {
  return {
    south: Math.floor(b.south / GRID_DEG) * GRID_DEG,
    west: Math.floor(b.west / GRID_DEG) * GRID_DEG,
    north: Math.ceil(b.north / GRID_DEG) * GRID_DEG,
    east: Math.ceil(b.east / GRID_DEG) * GRID_DEG,
  }
}

async function runQuery(q) {
  const failures = []
  for (const url of ENDPOINTS) {
    const host = new URL(url).host
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          // Overpass's usage policy asks clients to identify themselves, and
          // some instances turn away anonymous default-agent traffic.
          'user-agent': 'shade-map/1.0 (+https://github.com/mmodell/shade-map)',
          accept: 'application/json',
        },
        body: 'data=' + encodeURIComponent(q),
        // A slow-but-working mirror can legitimately take several seconds
        // for a complex query, but 26s before even trying the next mirror
        // (of 3, tried one at a time) meant one degraded/unreachable mirror
        // could stall an entire search for the better part of a minute.
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      const why = err?.name === 'TimeoutError' ? 'timed out' : String(err?.message || err)
      failures.push(`${host}: ${why}`)
    }
  }
  // Say *why* — "unavailable" alone is impossible to diagnose from a screenshot.
  throw new Error(`overpass unavailable (${failures.join('; ')})`)
}

function parseBase(json) {
  const greenAreas = []
  const greenLines = []
  const trees = []
  const highways = []

  for (const el of json.elements || []) {
    const tags = el.tags || {}
    if (el.type === 'node' && tags.natural === 'tree') {
      trees.push({ lat: el.lat, lng: el.lon })
      continue
    }
    if (el.type !== 'way' || !el.geometry) continue
    const path = el.geometry.map((g) => ({ lat: g.lat, lng: g.lon }))

    if (tags.highway) {
      highways.push({ path, tags })
    } else if (tags.natural === 'tree_row' || tags.barrier === 'hedge') {
      greenLines.push(path)
    } else {
      greenAreas.push(path)
    }
  }

  return { greenAreas, greenLines, trees, highways }
}

// Buildings arrive either with their full outline (small areas) or as a bare
// centre point (large areas) — both are handled, with height/building:levels
// for how far each shadow reaches.
function parseBuildings(json) {
  const buildings = []
  for (const el of json.elements || []) {
    const tags = el.tags || {}
    if (el.type !== 'way' || !tags.building) continue
    if (el.geometry && el.geometry.length >= 3) {
      const ring = el.geometry.map((g) => [g.lat, g.lon])
      let sLat = 0
      let sLng = 0
      for (const [la, ln] of ring) {
        sLat += la
        sLng += ln
      }
      buildings.push({ lat: sLat / ring.length, lng: sLng / ring.length, heightM: buildingHeightMeters(tags), ring })
    } else if (el.center) {
      buildings.push({ lat: el.center.lat, lng: el.center.lon, heightM: buildingHeightMeters(tags) })
    }
  }
  return buildings
}

const DEFAULT_BUILDING_HEIGHT_M = 12 // ~4 stories — used when OSM has no height/levels tag

function buildingHeightMeters(tags) {
  const height = parseFloat(tags.height)
  if (Number.isFinite(height) && height > 0) return height
  const levels = parseFloat(tags['building:levels'])
  if (Number.isFinite(levels) && levels > 0) return levels * 3.2 // rough metres-per-storey
  return DEFAULT_BUILDING_HEIGHT_M
}
