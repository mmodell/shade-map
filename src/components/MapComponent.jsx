import { useEffect, useMemo, useRef } from 'react'
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

  const endpoints = useMemo(() => {
    const first = routes[0]?.overview
    if (!first?.length) return null
    return { start: first[0], end: first[first.length - 1] }
  }, [routes])

  useEffect(() => {
    if (!mapRef.current || !window.google || !routes.length) return
    const bounds = new window.google.maps.LatLngBounds()
    routes.forEach((r) => (r.overview || []).forEach((p) => bounds.extend(p)))
    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 64)
  }, [routes])

  if (!isLoaded) {
    return <div className="map map--loading">Loading map…</div>
  }

  return (
    <div className="map">
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
      </GoogleMap>
    </div>
  )
}
