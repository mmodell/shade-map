/* Home / Work quick picks, kept in localStorage (this app has no accounts,
   so "saved" means "saved on this device/browser"). */

const KEY = 'shademap.places.v1'

export function getSavedPlaces() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {}
  } catch {
    return {}
  }
}

export function savePlace(kind, place) {
  const all = getSavedPlaces()
  all[kind] = place // { text, location }
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* storage full/disabled — the app still works, it just won't remember it */
  }
  return all
}

export function removePlace(kind) {
  const all = getSavedPlaces()
  delete all[kind]
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
  return all
}
