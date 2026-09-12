/* Recently searched places, like Google Maps' "Recents" list — kept in
   localStorage since this app has no accounts. */

const KEY = 'shademap.recents.v1'
const MAX = 6

export function getRecentPlaces() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function pushRecentPlace(place) {
  if (!place?.text) return getRecentPlaces()
  const list = getRecentPlaces().filter((p) => p.text !== place.text)
  list.unshift(place) // { text, location }
  const trimmed = list.slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed))
  } catch {
    /* storage full/disabled — fine, just won't remember it */
  }
  return trimmed
}
