/* Thin wrapper around google.maps.DirectionsService, plus helpers to turn an
   overview path into an evenly sampled point list and to pull out turn-by-turn
   steps. */

export const TRAVEL_MODES = [
  { id: 'WALKING', label: 'Walk', glyph: '🚶' },
  { id: 'BICYCLING', label: 'Bike', glyph: '🚴' },
  { id: 'DRIVING', label: 'Drive', glyph: '🚗' },
]

export function requestRoutes({ origin, destination, waypoints = [], mode = 'WALKING' }) {
  return new Promise((resolve, reject) => {
    if (!window.google?.maps) {
      reject(new Error('Google Maps is not loaded yet.'))
      return
    }
    const travelMode = window.google.maps.TravelMode[mode] || window.google.maps.TravelMode.WALKING
    const service = new window.google.maps.DirectionsService()
    service.route(
      {
        origin,
        destination,
        travelMode,
        // Alternatives and waypoints don't mix well in the Directions API —
        // with stops set, Google effectively returns just the one route.
        provideRouteAlternatives: waypoints.length === 0,
        waypoints: waypoints.map((location) => ({ location, stopover: true })),
      },
      (result, status) => {
        if (status === 'OK' && result?.routes?.length) {
          resolve(result)
        } else if (status === 'ZERO_RESULTS') {
          reject(new Error('No route found between those points for that mode.'))
        } else {
          reject(new Error(`Directions request failed (${status}).`))
        }
      }
    )
  })
}

/* Sample the route's overview path roughly every `stepMeters` metres so the
   shade analysis has a manageable, evenly-spaced set of points. */
export function samplePath(overviewPath, stepMeters = 40, maxPoints = 300) {
  const geometry = window.google?.maps?.geometry?.spherical
  const pts = overviewPath.map((p) => ({ lat: p.lat(), lng: p.lng() }))
  if (!geometry || pts.length < 2) return pts.slice(0, maxPoints)

  const out = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = new window.google.maps.LatLng(pts[i - 1].lat, pts[i - 1].lng)
    const b = new window.google.maps.LatLng(pts[i].lat, pts[i].lng)
    const segLen = geometry.computeDistanceBetween(a, b)
    if (segLen === 0) continue
    let d = stepMeters - carry
    while (d < segLen) {
      const f = d / segLen
      out.push({
        lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * f,
        lng: pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * f,
      })
      d += stepMeters
    }
    carry = segLen - (d - stepMeters)
  }
  out.push(pts[pts.length - 1])

  if (out.length <= maxPoints) return out
  // Downsample uniformly if the route is very long.
  const stride = Math.ceil(out.length / maxPoints)
  return out.filter((_, i) => i % stride === 0 || i === out.length - 1)
}

export function routeSummary(route) {
  const leg = route.legs?.[0]
  const legs = route.legs || []
  const distanceMeters = legs.reduce((s, l) => s + (l.distance?.value || 0), 0)
  const durationSeconds = legs.reduce((s, l) => s + (l.duration?.value || 0), 0)
  return {
    distanceMeters,
    durationSeconds,
    startAddress: leg?.start_address,
    endAddress: leg?.end_address,
    summary: route.summary,
    steps: routeSteps(route),
  }
}

/* Flatten Google's per-leg steps into a plain turn-by-turn list.
   `instructions` is HTML from Google — we reduce it to text to render safely. */
export function routeSteps(route) {
  const out = []
  for (const leg of route.legs || []) {
    for (const s of leg.steps || []) {
      out.push({
        text: stripHtml(s.instructions || ''),
        distance: s.distance?.text || '',
        maneuver: s.maneuver || '',
      })
    }
  }
  return out
}

function stripHtml(html) {
  // Google tucks a second sentence ("Destination will be on the right") into
  // a sibling <div> with no separator — add a space before block tags so it
  // doesn't get glued onto the previous word.
  const spaced = html.replace(/<(div|br)/gi, ' <$1')
  if (typeof document !== 'undefined') {
    const doc = new DOMParser().parseFromString(spaced, 'text/html')
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
  }
  return spaced.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
