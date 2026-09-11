/* Coarse, state-level "is this general area safer or riskier than average"
   context from the FBI's free Crime Data Explorer API. This is deliberately
   NOT block- or neighborhood-level — no free nationwide source gives that —
   so it's used as a small nudge on the safety score, not the main input.
   Requires a free api.data.gov key in FBI_CRIME_API_KEY. Anything that
   doesn't come back in the shape we expect is treated as "unavailable"
   rather than thrown — this integration is best-effort against a public API
   whose exact response shape we can't pin down without a live key. */

const FBI_BASE = 'https://api.usa.gov/crime/fbi/cde'
const FALLBACK_NATIONAL_RATE = 380 // per 100k, rough recent US violent-crime rate

export async function getStateCrimeContext({ lat, lng }) {
  const key = process.env.FBI_CRIME_API_KEY
  if (!key) return null

  try {
    const stateAbbr = await reverseGeocodeState(lat, lng)
    if (!stateAbbr) return null

    const to = new Date().getFullYear() - 1 // FBI data lags a year or so
    const from = to - 3
    const [stateRows, nationalRows] = await Promise.all([
      safeJson(`${FBI_BASE}/estimate/state/${stateAbbr}/${from}/${to}?API_KEY=${key}`),
      safeJson(`${FBI_BASE}/estimate/national/${from}/${to}?API_KEY=${key}`),
    ])

    const stateRow = latestValidRow(stateRows)
    if (!stateRow) return null
    const stateRate = violentRatePer100k(stateRow)
    if (stateRate == null) return null

    const nationalRow = latestValidRow(nationalRows)
    const nationalRate = (nationalRow && violentRatePer100k(nationalRow)) || FALLBACK_NATIONAL_RATE

    const ratio = stateRate / nationalRate
    return {
      state: stateAbbr,
      year: stateRow.year ?? to,
      violentRatePer100k: Math.round(stateRate),
      nationalRatePer100k: Math.round(nationalRate),
      ratio: Math.round(ratio * 100) / 100,
      label: describeRatio(ratio),
    }
  } catch {
    return null
  }
}

function violentRatePer100k(row) {
  const pop = row?.population
  const violent = row?.violent_crime ?? row?.violentCrime
  if (!pop || violent == null) return null
  return (violent / pop) * 100000
}

function latestValidRow(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.data)
        ? payload.data
        : payload && typeof payload === 'object'
          ? Object.values(payload).filter((v) => v && typeof v === 'object')
          : null
  if (!Array.isArray(list) || !list.length) return null
  const rows = list.filter((r) => r && (r.population || r.year))
  if (!rows.length) return null
  rows.sort((a, b) => (b.year || 0) - (a.year || 0))
  return rows[0]
}

function describeRatio(ratio) {
  if (ratio <= 0.7) return 'well below the national average'
  if (ratio <= 0.9) return 'below the national average'
  if (ratio <= 1.1) return 'about the national average'
  if (ratio <= 1.4) return 'above the national average'
  return 'well above the national average'
}

async function reverseGeocodeState(lat, lng) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=5&addressdetails=1`,
    {
      headers: { 'User-Agent': 'shade-map-app (personal project, contact via github.com/mmodell)' },
      signal: AbortSignal.timeout(6000),
    }
  )
  if (!res.ok) return null
  const data = await res.json()
  const iso = data?.address?.['ISO3166-2-lvl4']
  if (typeof iso === 'string' && iso.startsWith('US-')) return iso.slice(3)
  return null
}

async function safeJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
