/* "What's nearby" category chips, like the pill row under Google Maps'
   search bar — backed by Places API (New) Nearby Search, called directly
   from the browser with the same Maps key (referrer-restricted, same as any
   other client-side Maps call). Verified against the live API: cafe,
   restaurant, park and tourist_attraction are all valid included types. */

export const NEARBY_CATEGORIES = [
  { id: 'cafe', label: 'Coffee', glyph: '☕', includedTypes: ['cafe', 'coffee_shop'], color: '#a16207' },
  { id: 'restaurant', label: 'Food', glyph: '🍽️', includedTypes: ['restaurant'], color: '#dc2626' },
  { id: 'park', label: 'Parks', glyph: '🌳', includedTypes: ['park'], color: '#16a34a' },
  { id: 'attraction', label: 'Sights', glyph: '📷', includedTypes: ['tourist_attraction'], color: '#9333ea' },
]

export async function searchNearby({ category, center, radiusMeters = 1500 }) {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (!key || !center) return []

  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location',
    },
    body: JSON.stringify({
      includedTypes: category.includedTypes,
      maxResultCount: 15,
      locationRestriction: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: radiusMeters,
        },
      },
    }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Nearby search failed (${res.status})`)
  const data = await res.json()
  return (data.places || [])
    .filter((p) => p.location)
    .map((p) => ({
      id: p.id,
      name: p.displayName?.text || category.label,
      location: { lat: p.location.latitude, lng: p.location.longitude },
    }))
}
