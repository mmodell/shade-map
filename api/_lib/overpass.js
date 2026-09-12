import { bbox } from './geo.js'

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
   highways: [{ path:[latlng], tags }], buildings: [latlng] } for the given
   bbox. `points` can span several route alternatives at once — pass their
   combined points to fetch one shared dataset instead of one per route. */
export async function fetchOsmFeatures(points) {
  const b = bbox(points, 70)
  const box = `${b.south},${b.west},${b.north},${b.east}`
  const q = `[out:json][timeout:25];
(
  ${GREEN_AREA_QUERY.map((s) => `${s}(${box});`).join('\n  ')}
  ${GREEN_LINE_QUERY.map((s) => `${s}(${box});`).join('\n  ')}
  node["natural"="tree"](${box});
  ${HIGHWAY_QUERY}(${box});
);
out geom tags;
way["building"](${box});
out center;`

  const json = await runQuery(q)
  return parse(json)
}

async function runQuery(q) {
  let lastErr
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(26000),
      })
      if (!res.ok) throw new Error(`overpass ${res.status}`)
      return await res.json()
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error('overpass unavailable')
}

function parse(json) {
  const greenAreas = []
  const greenLines = []
  const trees = []
  const highways = []
  const buildings = []

  for (const el of json.elements || []) {
    const tags = el.tags || {}
    // Buildings come back from the separate `out center;` clause — a
    // computed centroid instead of full geometry, since we only need a
    // point to test route proximity against, not the building's footprint.
    if (el.type === 'way' && el.center && !el.geometry) {
      buildings.push({ lat: el.center.lat, lng: el.center.lon })
      continue
    }
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

  return { greenAreas, greenLines, trees, highways, buildings }
}
