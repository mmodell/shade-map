import { useEffect, useRef, useState } from 'react'
import PlaceField from './PlaceField'
import MicButton from './MicButton'
import { TRAVEL_MODES } from '../lib/googleDirections'
import { formatClock } from '../lib/format'
import { getSavedPlaces, savePlace } from '../lib/savedPlaces'
import { getRecentPlaces, pushRecentPlace } from '../lib/recentPlaces'
import { NEARBY_CATEGORIES, searchNearby } from '../lib/nearbyPlaces'

const WEIGHT_FIELDS = [
  { key: 'shade', label: 'Shade', minLabel: 'More sun exposure', maxLabel: 'No sun exposure' },
  { key: 'distance', label: 'Directness', minLabel: 'Longer route', maxLabel: 'Shortest route' },
  { key: 'safety', label: 'Safety', minLabel: 'Dangerous', maxLabel: 'Safe' },
]

const MAX_STOPS = 6

export default function RouteForm({
  isLoaded,
  departure,
  onDepartureChange,
  arriveBy,
  onArriveByChange,
  weights,
  onWeightsChange,
  avoidRisk,
  onAvoidRiskChange,
  mode,
  onModeChange,
  status,
  collapsed,
  resultsMode,
  onExpand,
  onCollapse,
  onToggleResults,
  score,
  onSubmit,
  trip,
  nightMode,
  overcastMode,
}) {
  const [origin, setOrigin] = useState(null) // { text, location }
  const [destination, setDestination] = useState(null)
  const [geoOrigin, setGeoOrigin] = useState(null) // { lat, lng } from the ◎ button
  const [stops, setStops] = useState([]) // [{ id, value: { text, location } | null }]
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(() => getSavedPlaces())
  const [recents, setRecents] = useState(() => getRecentPlaces())
  const [dragIndex, setDragIndex] = useState(null)
  const nextStopId = useRef(0)
  const dragInfo = useRef(null)
  const autoLocateAttempted = useRef(false)

  // Default the start point to current location, same as the real Google
  // Maps app — the ◎ button and the ✕ on the resulting chip are still there
  // for switching to a typed start, this just saves the tap for the common
  // case. Only ever tried once per form load: re-running it every time the
  // chip is cleared would fight the user right back into "Current location".
  useEffect(() => {
    if (autoLocateAttempted.current || !navigator.geolocation) return
    autoLocateAttempted.current = true
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeoOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        /* denied or unavailable — leave the From field for manual entry */
      },
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }, [])

  const busy = status === 'loading'
  const originText = geoOrigin ? 'Current location' : origin?.text
  const modeInfo = TRAVEL_MODES.find((m) => m.id === mode) || TRAVEL_MODES[0]
  // Where a stop's category search is centered — the trip's destination if
  // it's picked, otherwise wherever the trip starts.
  const stopSearchCenter = destination?.location || geoOrigin || origin?.location

  function addStop() {
    if (stops.length >= MAX_STOPS) return
    setStops((s) => [...s, { id: nextStopId.current++, value: null }])
  }
  function removeStop(id) {
    setStops((s) => s.filter((stop) => stop.id !== id))
  }
  function setStopValue(id, value) {
    setStops((s) => s.map((stop) => (stop.id === id ? { ...stop, value } : stop)))
  }

  // Drag-to-reorder for stops, via Pointer Events so the same code handles
  // touch and mouse — plain HTML5 drag-and-drop doesn't fire on touch.
  // Pointer capture (not a window listener) keeps move/up events targeted
  // at the handle itself for the rest of the gesture, even once the cursor
  // strays over a stop field's own widget — those can have their own
  // internal event handling that would otherwise swallow the event before
  // it bubbles. The dragged row's current index lives in a ref so
  // onStopDragMove always reads the latest value without a stale closure.
  function startStopDrag(e, index) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragInfo.current = { index, pointerId: e.pointerId }
    setDragIndex(index)
  }
  function onStopDragMove(e) {
    const info = dragInfo.current
    if (!info || e.pointerId !== info.pointerId) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const row = el?.closest('[data-stop-index]')
    if (!row) return
    const overIndex = Number(row.dataset.stopIndex)
    if (overIndex === info.index) return
    const fromIdx = info.index
    setStops((prev) => {
      const next = [...prev]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(overIndex, 0, moved)
      return next
    })
    info.index = overIndex
    setDragIndex(overIndex)
  }
  function onStopDragEnd(e) {
    if (dragInfo.current && e.pointerId !== dragInfo.current.pointerId) return
    dragInfo.current = null
    setDragIndex(null)
  }

  function saveAs(kind, place) {
    setSaved(savePlace(kind, place))
  }

  function swapOD() {
    const oldOriginAsPlace = geoOrigin ? { text: 'Current location', location: geoOrigin } : origin
    const oldDestination = destination
    setOrigin(oldDestination)
    setDestination(oldOriginAsPlace)
    setGeoOrigin(null)
  }

  function handleSubmit(e) {
    e.preventDefault()
    const originValue = geoOrigin || origin?.location || origin?.text
    const destValue = destination?.location || destination?.text
    if (!originValue || !destValue) {
      setError('Pick a start point and a destination from the suggestions.')
      return
    }
    if (stops.some((s) => !s.value)) {
      setError('Pick a place for each stop, or remove the empty one.')
      return
    }
    setError('')
    if (!geoOrigin && origin) pushRecentPlace(origin)
    if (destination) setRecents(pushRecentPlace(destination))
    const waypoints = stops.map((s) => s.value.location || s.value.text)
    onSubmit({
      origin: originValue,
      destination: destValue,
      waypoints,
      mode,
      originText: originText || 'Start',
      destText: destination?.text || 'Destination',
      stopCount: stops.length,
    })
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError('This device has no location access.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocating(false)
        setError('')
      },
      () => {
        setLocating(false)
        setError('Could not get your location.')
      },
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  if (collapsed) {
    // Sourced from the last submitted search (App's `trip`), not the live form
    // fields — this is what lets the trip bar survive a page refresh even
    // though the Places widgets themselves can't be pre-filled.
    const stopCount = trip?.stopCount ?? stops.length
    const isMinimal = resultsMode === 'collapsed'
    // A div, not a button: it needs to contain its own real <button> ("Edit")
    // for the separate "open the full form" action, and a button can't
    // nest another interactive element.
    return (
      <div
        className="tripbar"
        role="button"
        tabIndex={0}
        onClick={onToggleResults}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggleResults?.()
          }
        }}
      >
        <span className="tripbar__mode">{modeInfo.glyph}</span>
        <span className="tripbar__route">
          <span className="tripbar__pt">{trip?.originText || originText || 'Start'}</span>
          <span className="tripbar__arrow">→</span>
          {stopCount > 0 && (
            <span className="tripbar__stops">+{stopCount} stop{stopCount > 1 ? 's' : ''} →</span>
          )}
          <span className="tripbar__pt">{trip?.destText || destination?.text || 'Destination'}</span>
        </span>
        {isMinimal && score != null && <span className="tripbar__score">{score}</span>}
        <span className="tripbar__time">
          {trip?.arriveBy && trip?.resolvedArrival
            ? `Arrive ${formatClock(new Date(trip.resolvedArrival))}`
            : formatClock(departure)}
        </span>
        <button
          type="button"
          className="tripbar__edit"
          onClick={(e) => {
            e.stopPropagation()
            onExpand()
          }}
        >
          Edit
        </button>
        <span className="tripbar__chevron" aria-hidden="true">
          {isMinimal ? '▾' : '▴'}
        </span>
      </div>
    )
  }

  const originTrailing = (
    <>
      <MicButton onSelect={setOrigin} onError={setError} />
      <button
        type="button"
        className="form__ghost"
        onClick={useMyLocation}
        disabled={locating}
        title="Use my current location"
      >
        {locating ? '…' : '◎'}
      </button>
    </>
  )

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="modes-row">
        <div className="modes" role="group" aria-label="Travel mode">
          {TRAVEL_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`modes__btn${m.id === mode ? ' modes__btn--on' : ''}`}
              aria-pressed={m.id === mode}
              onClick={() => onModeChange(m.id)}
            >
              <span aria-hidden="true">{m.glyph}</span> {m.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="form__collapse"
          onClick={onCollapse}
          title="Minimize"
          aria-label="Minimize"
        >
          ⌄
        </button>
      </div>

      {geoOrigin ? (
        <div className="form__field">
          <label>From</label>
          <div className="form__inline">
            <span className="pac-chip">
              📍 Current location
              <button
                type="button"
                aria-label="Clear current location"
                onClick={() => setGeoOrigin(null)}
              >
                ✕
              </button>
            </span>
          </div>
        </div>
      ) : isLoaded ? (
        <PlaceField
          id="origin"
          label="From"
          placeholder="Address or place"
          onSelect={setOrigin}
          trailing={originTrailing}
        />
      ) : (
        <LoadingField label="From" trailing={originTrailing} />
      )}
      {origin && !geoOrigin && (
        <SaveAsRow place={origin} saved={saved} onSave={saveAs} />
      )}

      <button
        type="button"
        className="swap-btn"
        onClick={swapOD}
        title="Swap start and destination"
        aria-label="Swap start and destination"
      >
        ⇅
      </button>

      {isLoaded &&
        stops.map((stop, i) => (
          <div
            key={stop.id}
            className={`stop-row${dragIndex === i ? ' stop-row--dragging' : ''}`}
            data-stop-index={i}
          >
            {stops.length > 1 && (
              <button
                type="button"
                className="stop-row__handle"
                aria-label={`Drag to reorder stop ${i + 1}`}
                onPointerDown={(e) => startStopDrag(e, i)}
                onPointerMove={onStopDragMove}
                onPointerUp={onStopDragEnd}
                onPointerCancel={onStopDragEnd}
              >
                ⠿
              </button>
            )}
            <div className="stop-row__field">
              <PlaceStopField
                id={`stop-${stop.id}`}
                index={i}
                stop={stop}
                searchCenter={stopSearchCenter}
                onSelect={(v) => setStopValue(stop.id, v)}
                onRemove={() => removeStop(stop.id)}
                onError={setError}
              />
            </div>
          </div>
        ))}

      {/* Adding a stop is for inserting one into a trip you already have,
          not something offered while still building the first search —
          gated on an actual found route (not just a picked destination),
          so it only ever shows once you've reopened an existing result to
          change it. Category search (Coffee/Food/Parks/Sights) lives on
          each stop field itself once it exists, not here — this is just
          the "give me a slot to fill" action. */}
      {isLoaded && status === 'done' && stops.length < MAX_STOPS && (
        <button type="button" className="form__addstop" onClick={addStop}>
          + Add stop
        </button>
      )}

      {(saved.home || saved.work || recents.length > 0) && (
        <div className="quick-row">
          <span className="quick-row__label">Go to</span>
          {saved.home && (
            <button type="button" className="quick-chip" onClick={() => setDestination(saved.home)}>
              🏠 Home
            </button>
          )}
          {saved.work && (
            <button type="button" className="quick-chip" onClick={() => setDestination(saved.work)}>
              💼 Work
            </button>
          )}
          {recents
            .filter((p) => p.text !== saved.home?.text && p.text !== saved.work?.text)
            .slice(0, 3)
            .map((p) => (
              <button
                key={p.text}
                type="button"
                className="quick-chip"
                title={p.text}
                onClick={() => setDestination(p)}
              >
                🕑 {shortLabel(p.text)}
              </button>
            ))}
        </div>
      )}

      {isLoaded ? (
        <PlaceField
          id="destination"
          label="To"
          placeholder="Address or place"
          onSelect={setDestination}
          trailing={<MicButton onSelect={setDestination} onError={setError} />}
          bias={geoOrigin || origin?.location}
        />
      ) : (
        <LoadingField label="To" />
      )}
      {destination && <SaveAsRow place={destination} saved={saved} onSave={saveAs} />}

      <div className="form__field">
        <label htmlFor="departure">{arriveBy ? 'Arrive by' : 'Leave at'}</label>
        <div className="time-toggle" role="group" aria-label="Leave at or arrive by">
          <button
            type="button"
            className={`time-toggle__btn${!arriveBy ? ' time-toggle__btn--on' : ''}`}
            aria-pressed={!arriveBy}
            onClick={() => onArriveByChange(false)}
          >
            Leave at
          </button>
          <button
            type="button"
            className={`time-toggle__btn${arriveBy ? ' time-toggle__btn--on' : ''}`}
            aria-pressed={arriveBy}
            onClick={() => onArriveByChange(true)}
          >
            Arrive by
          </button>
        </div>
        <div className="form__inline">
          <input
            id="departure"
            type="datetime-local"
            value={toLocalInput(departure)}
            onChange={(e) => onDepartureChange(fromLocalInput(e.target.value))}
            required
          />
          {!arriveBy && (
            <button
              type="button"
              className="form__ghost"
              onClick={() => onDepartureChange(new Date())}
            >
              Now
            </button>
          )}
        </div>
      </div>

      <details className="form__weights-wrap">
        <summary>
          <span className="form__weights-sum">
            shade {Math.round(weights.shade * 100)} · direct {Math.round(weights.distance * 100)} ·
            safety {Math.round(weights.safety * 100)}
          </span>
        </summary>
        <fieldset className="form__weights">
          {WEIGHT_FIELDS.map(({ key, label, minLabel, maxLabel }) => {
            const isShadeMuted = key === 'shade' && (nightMode || overcastMode)
            return (
              <div className={`weight${isShadeMuted ? ' weight--dim' : ''}`} key={key}>
                <div className="weight__row">
                  <span className="weight__label">{label}</span>
                  <span className="weight__val">{Math.round(weights[key] * 100)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(weights[key] * 100)}
                  disabled={isShadeMuted}
                  onChange={(e) =>
                    onWeightsChange({ ...weights, [key]: Number(e.target.value) / 100 })
                  }
                  aria-label={`${label} priority, from ${minLabel} to ${maxLabel}`}
                />
                {isShadeMuted ? (
                  <span className="weight__hint">
                    {nightMode
                      ? '🌙 Not relevant after dark — try Safety instead'
                      : '☁️ Overcast — no direct sun to route around — try Safety instead'}
                  </span>
                ) : (
                  <div className="weight__scale">
                    <span>{minLabel}</span>
                    <span>{maxLabel}</span>
                  </div>
                )}
              </div>
            )
          })}
        </fieldset>
        <label className="avoid-risk">
          <input
            type="checkbox"
            checked={avoidRisk}
            onChange={(e) => onAvoidRiskChange(e.target.checked)}
          />
          <span>
            <strong>🚫 Avoid risky stretches</strong>
            <small>Sorts routes by least exposure to busy, unlit, sidewalk-free roads first — overrides the sliders above.</small>
          </span>
        </label>
      </details>

      {error && <p className="form__err">{error}</p>}

      <button className="form__submit" type="submit" disabled={busy || !isLoaded}>
        {busy ? 'Finding routes…' : 'Find routes'}
      </button>
    </form>
  )
}

function PlaceStopField({ id, index, stop, searchCenter, onSelect, onRemove, onError }) {
  const [results, setResults] = useState(null) // array of matches | null (closed)
  const [activeCategory, setActiveCategory] = useState(null)
  const [searching, setSearching] = useState(false)

  // A real search, not a guess: shows every nearby match for the category
  // and lets you pick one, instead of silently grabbing whichever result
  // happened to come back first (there's often several of the same kind of
  // place nearby, and the closest one isn't necessarily the one you want).
  async function searchCategory(category) {
    if (!searchCenter) {
      onError('Pick a destination first, then search near it.')
      return
    }
    onError('')
    setActiveCategory(category)
    setSearching(true)
    setResults(null)
    try {
      const found = await searchNearby({ category, center: searchCenter, radiusMeters: 2500 })
      setResults(found)
    } catch {
      onError('Could not search nearby places.')
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  function pick(place) {
    onSelect({ text: place.name, location: place.location })
    setResults(null)
  }

  return (
    <>
      <PlaceField
        id={id}
        label={`Stop ${index + 1}`}
        placeholder="Address or place"
        onSelect={(v) => {
          onSelect(v)
          setResults(null)
        }}
        bias={searchCenter}
        trailing={
          <>
            <MicButton onSelect={onSelect} onError={onError} />
            <button
              type="button"
              className="form__ghost"
              aria-label={`Remove stop ${index + 1}`}
              onClick={onRemove}
            >
              ✕
            </button>
          </>
        }
      />
      {/* PlaceField can't show a value inside the box itself (same
          limitation as SaveAsRow below) — confirm what's actually set,
          whether typed, spoken, or picked from a category search below. */}
      {stop.value?.text && (
        <span className="save-row__current" title={stop.value.text}>
          ✓ {stop.value.text}
        </span>
      )}
      <div className="category-row">
        {NEARBY_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className="quick-chip"
            disabled={searching}
            onClick={() => searchCategory(c)}
          >
            {searching && activeCategory?.id === c.id ? '…' : c.glyph} {c.label}
          </button>
        ))}
      </div>
      {results && (
        <div className="category-results">
          <div className="category-results__head">
            <span>
              {results.length} {activeCategory?.label.toLowerCase()} nearby
            </span>
            <button type="button" onClick={() => setResults(null)}>
              ✕
            </button>
          </div>
          {results.length === 0 ? (
            <p className="category-results__empty">Nothing found nearby — try a different category.</p>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                className="category-results__item"
                onClick={() => pick(r)}
              >
                {r.name}
              </button>
            ))
          )}
        </div>
      )}
    </>
  )
}

function SaveAsRow({ place, saved, onSave }) {
  const sameAs = (kind) => saved[kind]?.text && saved[kind].text === place.text
  return (
    <div className="save-row">
      {/* PlaceAutocompleteElement can't be pre-filled, so when a value comes
          from voice input or a Home/Work chip the box itself looks empty —
          confirm what's actually selected. */}
      <span className="save-row__current" title={place.text}>
        ✓ {place.text}
      </span>
      {!sameAs('home') && (
        <button type="button" className="save-link" onClick={() => onSave('home', place)}>
          ☆ Save as Home
        </button>
      )}
      {!sameAs('work') && (
        <button type="button" className="save-link" onClick={() => onSave('work', place)}>
          ☆ Save as Work
        </button>
      )}
    </div>
  )
}

function LoadingField({ label, trailing }) {
  return (
    <div className="form__field">
      <label>{label}</label>
      <div className="form__inline">
        <input disabled placeholder="Loading maps…" />
        {trailing}
      </div>
    </div>
  )
}

function toLocalInput(date) {
  const d = new Date(date)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`
}

function shortLabel(text) {
  const first = text.split(',')[0].trim()
  return first.length > 22 ? `${first.slice(0, 21)}…` : first
}

function fromLocalInput(value) {
  const parsed = value ? new Date(value) : new Date()
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}
