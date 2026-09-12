import { fetchOsmFeatures } from './_lib/overpass.js'
import { matchHighways } from './_lib/wayMatch.js'
import { computeShade } from './_lib/shadeCalculator.js'
import { computeLighting } from './_lib/lightingService.js'
import { computeSafety } from './_lib/safetyService.js'
import { getWeather } from './_lib/weatherService.js'
import { getStateCrimeContext } from './_lib/crimeService.js'

const MAX_ROUTES = 4
const EMPTY_OSM = { greenAreas: [], greenLines: [], trees: [], highways: [], buildings: [] }

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Use POST' })
  }

  let body
  try {
    body = await readJson(req)
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  const date = parseDate(body?.departureISO)
  const units = process.env.WEATHER_UNITS || 'imperial'
  const rawRoutes = Array.isArray(body?.routes) ? body.routes.slice(0, MAX_ROUTES) : []
  if (!rawRoutes.length) return res.status(400).json({ error: 'No routes provided' })

  const routes = rawRoutes.map((r) => ({ id: r.id, points: sanitizePoints(r.points) }))
  const refPoints = routes[0]?.points || []
  const refMid = refPoints[Math.floor(refPoints.length / 2)] || refPoints[0] || null
  const allPoints = routes.flatMap((r) => r.points)

  // Crime, weather and OSM (tree/park/sidewalk) data are each independent of
  // one another, and — for OSM — no longer fetched once per route
  // alternative. A single combined bbox covering every alternative replaces
  // what used to be a separate Overpass call (up to 3 mirrors x 25s timeout
  // each) per route, which could turn a 4-route search into minutes of
  // serial retries on a bad Overpass night. Per-route shade/safety numbers
  // stay correct off this shared dataset because they're computed by
  // checking each route's own points against it (see shadeCalculator.js),
  // not by anything that depends on the fetch's bbox size.
  const [crime, weather, osmResult] = await Promise.all([
    refMid
      ? getStateCrimeContext({ lat: refMid.lat, lng: refMid.lng }).catch(() => null)
      : Promise.resolve(null),
    refMid ? getWeather({ lat: refMid.lat, lng: refMid.lng, units }).catch(() => null) : Promise.resolve(null),
    allPoints.length
      ? fetchOsmFeatures(allPoints)
          .then((osm) => ({ osm, ok: true }))
          .catch(() => ({ osm: EMPTY_OSM, ok: false }))
      : Promise.resolve({ osm: EMPTY_OSM, ok: false }),
  ])
  const { osm, ok: osmOk } = osmResult

  const analyzed = routes.map(({ id, points }) => {
    if (points.length < 2) {
      return { id, shade: nightSafeDefault(), safety: { score: 0.5 }, lighting: null }
    }
    const mid = points[Math.floor(points.length / 2)]

    const matched = matchHighways(points, osm.highways)
    const shade = computeShade({ points, osm, date })
    if (!osmOk) {
      shade.note = 'Map data was unavailable — shade estimated from sun angle only.'
      shade.greenCoverage = null
    }
    const lighting = computeLighting({ matchedTags: matched, date, lat: mid.lat, lng: mid.lng })
    const safety = computeSafety({ matchedTags: matched, lighting, date, lat: mid.lat, lng: mid.lng, crime })

    return { id, shade, safety, lighting }
  })

  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ routes: analyzed, weather, crime, analyzedAt: new Date().toISOString() })
}

function sanitizePoints(points) {
  if (!Array.isArray(points)) return []
  return points
    .filter(
      (p) =>
        p &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        Math.abs(p.lat) <= 90 &&
        Math.abs(p.lng) <= 180
    )
    .slice(0, 400)
}

function parseDate(iso) {
  const d = iso ? new Date(iso) : new Date()
  return Number.isNaN(d.getTime()) ? new Date() : d
}

function nightSafeDefault() {
  return { shadeFraction: 0.3, isNight: false, sunAltitude: null, greenCoverage: null }
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string' && req.body) return JSON.parse(req.body)
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}
