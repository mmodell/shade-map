import { fetchOsmFeatures } from './_lib/overpass.js'
import { matchHighways } from './_lib/wayMatch.js'
import { computeShade } from './_lib/shadeCalculator.js'
import { computeLighting } from './_lib/lightingService.js'
import { computeSafety } from './_lib/safetyService.js'
import { getWeather } from './_lib/weatherService.js'
import { getStateCrimeContext } from './_lib/crimeService.js'

const MAX_ROUTES = 4
const EMPTY_OSM = { greenAreas: [], greenLines: [], trees: [], highways: [], buildingCount: 0 }

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
  const routes = Array.isArray(body?.routes) ? body.routes.slice(0, MAX_ROUTES) : []
  if (!routes.length) return res.status(400).json({ error: 'No routes provided' })

  // Crime context is state-level, so it's the same for every route in this
  // search — fetch it once from the first route's midpoint rather than once
  // per route.
  let crime = null
  try {
    const ref = sanitizePoints(routes[0].points)
    const refMid = ref[Math.floor(ref.length / 2)] || ref[0]
    if (refMid) crime = await getStateCrimeContext({ lat: refMid.lat, lng: refMid.lng })
  } catch {
    crime = null
  }

  const analyzed = []
  for (const route of routes) {
    const points = sanitizePoints(route.points)
    if (points.length < 2) {
      analyzed.push({ id: route.id, shade: nightSafeDefault(), safety: { score: 0.5 }, lighting: null })
      continue
    }
    const mid = points[Math.floor(points.length / 2)]

    let osm = EMPTY_OSM
    let osmOk = true
    try {
      osm = await fetchOsmFeatures(points)
    } catch {
      osmOk = false
    }

    const matched = matchHighways(points, osm.highways)
    const shade = computeShade({ points, osm, date })
    if (!osmOk) {
      shade.note = 'Map data was unavailable — shade estimated from sun angle only.'
      shade.greenCoverage = null
    }
    const lighting = computeLighting({ matchedTags: matched, date, lat: mid.lat, lng: mid.lng })
    const safety = computeSafety({ matchedTags: matched, lighting, date, lat: mid.lat, lng: mid.lng, crime })

    analyzed.push({ id: route.id, shade, safety, lighting })
  }

  let weather = null
  try {
    const ref = sanitizePoints(routes[0].points)
    const mid = ref[Math.floor(ref.length / 2)] || ref[0]
    if (mid) weather = await getWeather({ lat: mid.lat, lng: mid.lng, units })
  } catch {
    weather = null
  }

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
