/* Minimal service worker: app-shell cache, network-first, never touches /api. */
const CACHE = 'shade-map-v1'
const SHELL = ['/', '/index.html', '/icon.svg', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Always go to the network for the API and for cross-origin requests
  // (Google Maps tiles/scripts manage their own caching).
  if (request.method !== 'GET' || url.pathname.startsWith('/api/') || url.origin !== location.origin) {
    return
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone()
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {})
        return response
      })
      .catch(() => caches.match(request).then((r) => r || caches.match('/index.html')))
  )
})
