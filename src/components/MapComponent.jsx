import { useEffect, useMemo, useRef, useState } from 'react'
import { GoogleMap, Polyline, Marker } from '@react-google-maps/api'
import { rankColor } from '../lib/ranking'

const MAP_OPTIONS = {
  disableDefaultUI: true,
  zoomControl: true,
  clickableIcons: false,
  gestureHandling: 'greedy',
  styles: [
    { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
    { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ color: '#0f5132' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
    { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  ],
}

const FALLBACK_CENTER = { lat: 40.7128, lng: -74.006 }

export default function MapComponent({ isLoaded, routes, paths, selectedId, onSelect }) {
  const mapRef = useRef(null)
  const wrapRef = useRef(null)
  const [myLocation, setMyLocation] = useState(null)
  const centeredOnMeRef = useRef(false)

  // Ask for the user's location once, the way Google Maps itself does — a
  // blue dot on the map, and (if there's no route yet) center there.
  useEffect(() => {
    if (!navigator.geolocation) return
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 10000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  const endpoints = useMemo(() => {
    const first = routes[0]?.overview
    if (!first?.length) return null
    return { start: first[0], end: first[first.length - 1] }
  }, [routes])

  const fitToRoutes = () => {
    if (!mapRef.current || !window.google || !routes.length) return
    const bounds = new window.google.maps.LatLngBounds()
    routes.forEach((r) => (r.overview || []).forEach((p) => bounds.extend(p)))
    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 64)
  }

  const goToMyLocation = () => {
    const pan = (loc) => {
      mapRef.current?.panTo(loc)
      mapRef.current?.setZoom(15)
    }
    if (myLocation) {
      pan(myLocation)
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setMyLocation(loc)
        pan(loc)
      })
    }
  }

  useEffect(fitToRoutes, [routes])

  // First fix with no route on screen yet → open there instead of NYC.
  useEffect(() => {
    if (myLocation && !routes.length && !centeredOnMeRef.current && mapRef.current) {
      centeredOnMeRef.current = true
      mapRef.current.panTo(myLocation)
      mapRef.current.setZoom(14)
    }
  }, [myLocation, routes.length])

  // The panel collapses/expands around the map — keep Google Maps in sync with
  // its container size so it doesn't render grey bands. Debounced and just
  // triggers 'resize' (no forced re-fit) so it can't fight a user's own pan/zoom.
  useEffect(() => {
    if (!wrapRef.current || typeof ResizeObserver === 'undefined') return
    let raf = 0
    let lastSize = ''
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      const size = `${Math.round(width)}x${Math.round(height)}`
      if (size === lastSize) return
      lastSize = size
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (mapRef.current && window.google) {
          window.google.maps.event.trigger(mapRef.current, 'resize')
        }
      })
    })
    ro.observe(wrapRef.current)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])

  if (!isLoaded) {
    return <div className="map map--loading">Loading map…</div>
  }

  return (
    <div className="map" ref={wrapRef}>
      <GoogleMap
        mapContainerClassName="map__canvas"
        center={FALLBACK_CENTER}
        zoom={12}
        options={MAP_OPTIONS}
        onLoad={(m) => (mapRef.current = m)}
      >
        {[...routes].reverse().map((r) => {
          const path = paths.get(r.id) || r.overview
          if (!path?.length) return null
          const isSel = r.id === selectedId
          return (
            <Polyline
              key={r.id}
              path={path}
              onClick={() => onSelect(r.id)}
              options={{
                strokeColor: rankColor(r.rank),
                strokeOpacity: isSel ? 1 : 0.55,
                strokeWeight: isSel ? 7 : 4,
                zIndex: isSel ? 10 : 1,
              }}
            />
          )
        })}

        {endpoints && (
          <>
            <Marker position={endpoints.start} label={{ text: 'A', color: '#0f172a' }} />
            <Marker position={endpoints.end} label={{ text: 'B', color: '#0f172a' }} />
          </>
        )}

        {myLocation && (
          <Marker
            position={myLocation}
            zIndex={5}
            title="Your location"
            icon={{
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: '#4285f4',
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 2,
            }}
          />
        )}
      </GoogleMap>

      <div className="map__controls">
        <button
          type="button"
          className="map__ctrlbtn"
          onClick={goToMyLocation}
          title="My location"
          aria-label="My location"
        >
          🎯
        </button>
        {routes.length > 0 && (
          <button
            type="button"
            className="map__ctrlbtn"
            onClick={fitToRoutes}
            title="Center on route"
            aria-label="Center on route"
          >
            ⌖
          </button>
        )}
      </div>
    </div>
  )
}
