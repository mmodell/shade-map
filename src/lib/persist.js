/* Keep the last search across a page refresh. sessionStorage (not
   localStorage) on purpose — it survives a reload but not reopening the app
   days later with stale routes and an old departure time. */

const KEY = 'shademap.session.v1'

export function loadSession() {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function saveSession(data) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    /* storage full / disabled — the app still works, it just won't survive a refresh */
  }
}
