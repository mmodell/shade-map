/* Tiny in-memory TTL cache, scoped to a single warm serverless instance.
   Vercel reuses a warm Lambda across requests that land close together in
   time, so this cuts repeat Overpass/weather/crime calls for the same area
   without standing up an external cache service — it just won't survive a
   cold start, which is an acceptable trade for a free-tier personal project.
   Negative/failed lookups (null, undefined) are deliberately never cached,
   so a transient upstream hiccup doesn't get baked in for the full TTL. */

const MAX_ENTRIES = 500
const store = new Map()

export function cacheGet(key) {
  const entry = store.get(key)
  if (!entry) return undefined
  if (entry.expires < Date.now()) {
    store.delete(key)
    return undefined
  }
  return entry.value
}

export function cacheSet(key, value, ttlMs) {
  if (value == null) return
  if (!store.has(key) && store.size >= MAX_ENTRIES) {
    store.delete(store.keys().next().value) // evict oldest to bound memory
  }
  store.set(key, { value, expires: Date.now() + ttlMs })
}

export async function cached(key, ttlMs, fetcher) {
  const hit = cacheGet(key)
  if (hit !== undefined) return hit
  const value = await fetcher()
  cacheSet(key, value, ttlMs)
  return value
}
