import { localShadeEstimate } from './localShadeEstimate'

/* POST the candidate routes to the serverless analyzer. Falls back to a
   client-only sun-angle estimate if the function isn't reachable. */
export async function analyzeRoutes({ candidates, departure }) {
  const payload = {
    departureISO: departure.toISOString(),
    routes: candidates.map((c) => ({
      id: c.id,
      points: c.points,
      distanceMeters: c.distanceMeters,
      durationSeconds: c.durationSeconds,
    })),
  }

  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`analyzer returned ${res.status}`)
    const data = await res.json()
    return mergeById(candidates, data.routes, {
      degraded: false,
      weather: data.weather ?? null,
      crime: data.crime ?? null,
    })
  } catch (err) {
    // Offline / no serverless function — degrade gracefully.
    const routes = candidates.map((c) => ({
      shade: localShadeEstimate(c.points, departure),
      safety: { score: 0.5, note: 'Safety data needs the deployed analyzer.' },
      lighting: null,
    }))
    return mergeById(
      candidates,
      candidates.map((c, i) => ({ id: c.id, ...routes[i] })),
      { degraded: true, degradedReason: String(err.message || err), weather: null }
    )
  }
}

function mergeById(candidates, analyzed, meta) {
  const byId = new Map(analyzed.map((r) => [r.id, r]))
  return {
    ...meta,
    routes: candidates.map((c) => ({ ...c, ...(byId.get(c.id) || {}) })),
  }
}
