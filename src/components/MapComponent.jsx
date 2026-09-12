import { useEffect, useMemo, useRef, useState } from 'react'
import { GoogleMap } from '@react-google-maps/api'
import { rankColor } from '../lib/ranking'
import { NEARBY_CATEGORIES, searchNearby } from '../lib/nearbyPlaces'

const MAP_OPTIONS = {
  disableDefaultUI: true,
  zoomControl: true,
  scaleControl: true,
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

// Inner line: is this stretch of the selected route shaded or sun-exposed.
// Outer line: how safe that stretch looks (sidewalks/lit vs. exposed to a
// busy road with none) — see api/_lib/shadeCalculator.js / safetyService.js
// for how each point gets classified.
const SHADE_COLORS = { shade: '#38bdf8', sun: '#f59e0b' }
const SAFETY_COLORS = { safe: '#22c55e', caution: '#eab308', risk: '#ef4444' }

/* Group consecutive points that share the same classification into one
   Polyline each (a handful of runs instead of one segment per point pair). */
function toColoredSegments(points, classes, colorMap, fallbackColor) {
  if (!points?.length || !classes?.length || points.length !== classes.length) return null
  const segments = []
  let i = 0
  while (i < points.length - 1) {
    const cls = classes[i]
    let j = i
    while (j < points.length - 1 && classes[j + 1] === cls) j++
    segments.push({ path: points.slice(i, j + 2), color: colorMap[cls] || fallbackColor })
    i = j + 1
  }
  return segments
}

/* NOTE on rendering approach: @react-google-maps/api's <Polyline>/<Marker>
   React components turned out not to attach to the map reliably in this
   app's environment (verified by comparing them side-by-side against plain
   `new google.maps.Polyline(...)`/`Marker(...)` calls — the native ones
   render, the React wrapper ones silently don't). Every overlay here is
   therefore managed imperatively: created/positioned in effects and stored
   in refs, not declared as JSX children of <GoogleMap>. */
export default function MapComponent({
  isLoaded,
  routes,
  paths,
  selectedId,
  onSelect,
  navigating,
  onLocationChange,
  focusedStep,
}) {
  const mapRef = useRef(null)
  const wrapRef = useRef(null)
  const trafficLayerRef = useRef(null)
  const routeOverlaysRef = useRef([])
  const blueDotRef = useRef(null)
  const nearbyMarkersRef = useRef([])
  const focusOverlaysRef = useRef([])
  const [mapReady, setMapReady] = useState(false)
  const [myLocation, setMyLocation] = useState(null)
  const centeredOnMeRef = useRef(false)
  const navZoomedRef = useRef(false)
  const [mapType, setMapType] = useState('roadmap')
  const [trafficOn, setTrafficOn] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [nearbyCategory, setNearbyCategory] = useState(null)
  const [nearbyPlaces, setNearbyPlaces] = useState([])
  const [nearbyStatus, setNearbyStatus] = useState('idle') // idle | loading | error
  const [headingUp, setHeadingUp] = useState(false)
  const [gpsHeading, setGpsHeading] = useState(null)
  const [compassHeading, setCompassHeading] = useState(null)

  // Ask for the user's location once, the way Google Maps itself does — a
  // blue dot on the map, and (if there's no route yet) center there. Higher
  // accuracy + faster refresh while actively navigating, since Navigator
  // uses these same fixes to advance turn-by-turn.
  useEffect(() => {
    if (!navigator.geolocation) return
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setMyLocation(loc)
        onLocationChange?.(loc)
        setGpsHeading(Number.isFinite(pos.coords.heading) ? pos.coords.heading : null)
      },
      () => {},
      navigating
        ? { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
        : { enableHighAccuracy: false, maximumAge: 30000, timeout: 10000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigating])

  // Compass fallback for when GPS heading is unavailable (stationary, or the
  // device just doesn't report course-over-ground). Only listens while
  // heading-up is actually turned on, to avoid asking for a sensor nobody's
  // using.
  useEffect(() => {
    if (!headingUp || typeof window === 'undefined' || !window.DeviceOrientationEvent) return
    function onOrient(e) {
      let h = null
      if (typeof e.webkitCompassHeading === 'number') {
        h = e.webkitCompassHeading // iOS: already 0-360 clockwise from north
      } else if (typeof e.alpha === 'number') {
        h = (360 - e.alpha) % 360 // common approximation for a flat, screen-up device
      }
      if (h != null && !Number.isNaN(h)) setCompassHeading(h)
    }
    window.addEventListener('deviceorientation', onOrient)
    return () => window.removeEventListener('deviceorientation', onOrient)
  }, [headingUp])

  // GPS course-over-ground wins when we have it (reliable while actually
  // moving); the compass fills in when it doesn't (e.g. stopped at a light).
  const heading = gpsHeading ?? compassHeading

  async function toggleHeadingUp() {
    if (!headingUp) {
      const DOE = window.DeviceOrientationEvent
      // iOS 13+ gates the compass behind an explicit permission prompt that
      // must be triggered from a user gesture — this click is that gesture.
      if (DOE && typeof DOE.requestPermission === 'function') {
        try {
          const result = await DOE.requestPermission()
          if (result !== 'granted') {
            // GPS course-over-ground can still work without the compass.
            setHeadingUp(true)
            return
          }
        } catch {
          setHeadingUp(true)
          return
        }
      }
    }
    setHeadingUp((v) => !v)
  }

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

  useEffect(() => {
    if (!navigating) fitToRoutes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, navigating, mapReady])

  // First fix with no route on screen yet → open there instead of NYC.
  useEffect(() => {
    if (myLocation && !routes.length && !centeredOnMeRef.current && mapRef.current) {
      centeredOnMeRef.current = true
      mapRef.current.panTo(myLocation)
      mapRef.current.setZoom(14)
    }
  }, [myLocation, routes.length])

  // Follow-camera while navigating: recenter on every fix, and zoom in once
  // on entering nav mode (a manual zoom afterward isn't fought — only the
  // pan repeats).
  useEffect(() => {
    if (!navigating) {
      navZoomedRef.current = false
      return
    }
    if (!myLocation || !mapRef.current) return
    mapRef.current.panTo(myLocation)
    if (!navZoomedRef.current) {
      navZoomedRef.current = true
      mapRef.current.setZoom(17)
    }
  }, [navigating, myLocation])

  // Leaving nav mode always drops back to north-up.
  useEffect(() => {
    if (!navigating) setHeadingUp(false)
  }, [navigating])

  // Traffic layer is a plain Maps JS overlay, not a React child — toggle it
  // on/off the map instance directly.
  useEffect(() => {
    if (!window.google || !mapRef.current) return
    if (!trafficLayerRef.current) {
      trafficLayerRef.current = new window.google.maps.TrafficLayer()
    }
    trafficLayerRef.current.setMap(trafficOn ? mapRef.current : null)
  }, [trafficOn, mapReady])

  const selected = routes.find((r) => r.id === selectedId) || routes[0] || null
  const detailPoints = selected?.points
  const shadeSegments = toColoredSegments(
    detailPoints,
    selected?.shade?.pointShade,
    SHADE_COLORS,
    '#64748b'
  )
  const safetySegments = toColoredSegments(
    detailPoints,
    selected?.safety?.pointSafety,
    SAFETY_COLORS,
    '#64748b'
  )

  // Route polylines + A/B endpoint markers — native overlays, rebuilt
  // whenever the route set, selection, or per-point classifications change.
  useEffect(() => {
    if (!mapReady || !window.google || !mapRef.current) return
    routeOverlaysRef.current.forEach((o) => o.setMap(null))
    const overlays = []
    const g = window.google.maps

    ;[...routes].reverse().forEach((r) => {
      const isSel = r.id === selectedId
      if (isSel && (shadeSegments || safetySegments)) return // drawn below, two-tone
      const path = paths.get(r.id) || r.overview
      if (!path?.length) return
      const pl = new g.Polyline({
        path,
        strokeColor: rankColor(r.rank),
        strokeOpacity: isSel ? 1 : 0.55,
        strokeWeight: isSel ? 7 : 4,
        zIndex: isSel ? 10 : 1,
        map: mapRef.current,
      })
      pl.addListener('click', () => onSelect(r.id))
      overlays.push(pl)
    })

    if (safetySegments) {
      for (const seg of safetySegments) {
        overlays.push(
          new g.Polyline({
            path: seg.path,
            strokeColor: seg.color,
            strokeOpacity: 0.85,
            strokeWeight: 11,
            zIndex: 8,
            map: mapRef.current,
          })
        )
      }
    }
    if (shadeSegments) {
      for (const seg of shadeSegments) {
        overlays.push(
          new g.Polyline({
            path: seg.path,
            strokeColor: seg.color,
            strokeOpacity: 1,
            strokeWeight: 5,
            zIndex: 9,
            map: mapRef.current,
          })
        )
      }
    }

    if (endpoints) {
      overlays.push(
        new g.Marker({ position: endpoints.start, map: mapRef.current, label: { text: 'A', color: '#0f172a' } })
      )
      overlays.push(
        new g.Marker({ position: endpoints.end, map: mapRef.current, label: { text: 'B', color: '#0f172a' } })
      )
    }

    routeOverlaysRef.current = overlays
    return () => overlays.forEach((o) => o.setMap(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, selectedId, paths, endpoints, mapReady])

  // "Preview this step" — walk through the directions on the map before
  // (or without) starting live navigation. Highlights the step's stretch
  // and frames it, using a straight start→end line as a stand-in for the
  // exact curve (Directions gives us each step's endpoints, not its own
  // sub-path out of the route polyline).
  useEffect(() => {
    if (!mapReady || !window.google || !mapRef.current) return
    focusOverlaysRef.current.forEach((o) => o.setMap(null))
    if (!focusedStep?.start || !focusedStep?.end) {
      focusOverlaysRef.current = []
      return
    }
    const g = window.google.maps
    const overlays = [
      new g.Polyline({
        path: [focusedStep.start, focusedStep.end],
        strokeColor: '#f472b6',
        strokeOpacity: 1,
        strokeWeight: 7,
        zIndex: 20,
        map: mapRef.current,
        icons: [{ icon: { path: g.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3 }, offset: '100%' }],
      }),
      new g.Marker({
        position: focusedStep.start,
        map: mapRef.current,
        zIndex: 21,
        icon: {
          path: g.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#f472b6',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
      }),
    ]
    focusOverlaysRef.current = overlays

    const bounds = new g.LatLngBounds()
    bounds.extend(focusedStep.start)
    bounds.extend(focusedStep.end)
    mapRef.current.fitBounds(bounds, 120)
    // A single point (or near-zero-length step) fitBounds barely zooms —
    // pull in closer so the highlight is actually legible.
    g.event.addListenerOnce(mapRef.current, 'idle', () => {
      if (mapRef.current.getZoom() > 18) mapRef.current.setZoom(18)
      else if (mapRef.current.getZoom() < 16) mapRef.current.setZoom(16)
    })
  }, [focusedStep, mapReady])

  // Blue "you are here" dot — one marker, repositioned on each fix rather
  // than recreated, so it doesn't flicker during navigation's frequent GPS
  // updates.
  useEffect(() => {
    if (!mapReady || !window.google || !mapRef.current || !myLocation) return
    if (!blueDotRef.current) {
      blueDotRef.current = new window.google.maps.Marker({
        map: mapRef.current,
        position: myLocation,
        zIndex: 5,
        title: 'Your location',
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: '#4285f4',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      })
    } else {
      blueDotRef.current.setPosition(myLocation)
    }
  }, [myLocation, mapReady])

  async function toggleCategory(category) {
    if (nearbyCategory?.id === category.id) {
      setNearbyCategory(null)
      setNearbyPlaces([])
      setNearbyStatus('idle')
      return
    }
    setNearbyCategory(category)
    setNearbyStatus('loading')
    try {
      const center = mapRef.current?.getCenter()
      const loc = center ? { lat: center.lat(), lng: center.lng() } : myLocation || FALLBACK_CENTER
      const places = await searchNearby({ category, center: loc })
      setNearbyPlaces(places)
      setNearbyStatus('idle')
    } catch {
      setNearbyPlaces([])
      setNearbyStatus('error')
    }
  }

  // Nearby-category pins — native overlays, rebuilt when the results change.
  useEffect(() => {
    if (!mapReady || !window.google || !mapRef.current) return
    nearbyMarkersRef.current.forEach((m) => m.setMap(null))
    if (!nearbyCategory) {
      nearbyMarkersRef.current = []
      return
    }
    const markers = nearbyPlaces.map(
      (p) =>
        new window.google.maps.Marker({
          map: mapRef.current,
          position: p.location,
          title: p.name,
          zIndex: 4,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 6,
            fillColor: nearbyCategory.color,
            fillOpacity: 0.95,
            strokeColor: '#0b1220',
            strokeWeight: 1.5,
          },
        })
    )
    nearbyMarkersRef.current = markers
  }, [nearbyCategory, nearbyPlaces, mapReady])

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

  const rotationDeg = navigating && headingUp && heading != null ? -heading : 0

  return (
    <div className="map" ref={wrapRef}>
      <div className="map__chips" hidden={navigating}>
        {NEARBY_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`map__chip${nearbyCategory?.id === c.id ? ' map__chip--on' : ''}`}
            onClick={() => toggleCategory(c)}
          >
            {c.glyph} {c.label}
          </button>
        ))}
        {nearbyStatus === 'loading' && <span className="map__chipstatus">Searching…</span>}
        {nearbyStatus === 'error' && <span className="map__chipstatus">Couldn’t load nearby places</span>}
      </div>

      <div
        className="map__rotate"
        style={{ transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)` }}
      >
        <GoogleMap
          mapContainerClassName="map__canvas"
          center={FALLBACK_CENTER}
          zoom={12}
          mapTypeId={mapType}
          options={MAP_OPTIONS}
          onLoad={(m) => {
            mapRef.current = m
            setMapReady(true)
          }}
        />
      </div>

      {(shadeSegments || safetySegments) && (
        <div className="map__legend" hidden={navigating}>
          <span><i className="map__swatch" style={{ background: SHADE_COLORS.shade }} /> Shade</span>
          <span><i className="map__swatch" style={{ background: SHADE_COLORS.sun }} /> Sun</span>
          <span className="map__legend-sep">·</span>
          <span><i className="map__swatch" style={{ background: SAFETY_COLORS.safe }} /> Safe</span>
          <span><i className="map__swatch" style={{ background: SAFETY_COLORS.caution }} /> Caution</span>
          <span><i className="map__swatch" style={{ background: SAFETY_COLORS.risk }} /> Risk</span>
        </div>
      )}

      <div className="map__layers">
        <button
          type="button"
          className="map__ctrlbtn"
          onClick={() => setLayersOpen((v) => !v)}
          title="Map layers"
          aria-label="Map layers"
        >
          🗺️
        </button>
        {layersOpen && (
          <div className="map__layerspanel">
            <label className="map__layerrow">
              <input
                type="checkbox"
                checked={mapType === 'satellite'}
                onChange={(e) => setMapType(e.target.checked ? 'satellite' : 'roadmap')}
              />
              Satellite
            </label>
            <label className="map__layerrow">
              <input
                type="checkbox"
                checked={trafficOn}
                onChange={(e) => setTrafficOn(e.target.checked)}
              />
              Traffic
            </label>
          </div>
        )}
      </div>

      <div className="map__controls">
        {navigating && (
          <button
            type="button"
            className={`map__ctrlbtn${headingUp ? ' map__ctrlbtn--on' : ''}`}
            onClick={toggleHeadingUp}
            title={headingUp ? 'Switch to north-up' : 'Rotate map to heading'}
            aria-label={headingUp ? 'Switch to north-up' : 'Rotate map to heading'}
          >
            🧭
          </button>
        )}
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
