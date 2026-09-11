import { useRef, useState } from 'react'
import PlaceField from './PlaceField'
import MicButton from './MicButton'
import { TRAVEL_MODES } from '../lib/googleDirections'
import { formatClock } from '../lib/format'
import { getSavedPlaces, savePlace } from '../lib/savedPlaces'

const WEIGHT_FIELDS = [
  { key: 'shade', label: 'Shade', hint: 'Prefer tree cover & shadow' },
  { key: 'distance', label: 'Directness', hint: 'Prefer shorter routes' },
  { key: 'safety', label: 'Safety', hint: 'Prefer lit paths & sidewalks' },
]

const MAX_STOPS = 6

export default function RouteForm({
  isLoaded,
  departure,
  onDepartureChange,
  weights,
  onWeightsChange,
  mode,
  onModeChange,
  status,
  collapsed,
  onExpand,
  onCollapse,
  onSubmit,
  trip,
  nightMode,
}) {
  const [origin, setOrigin] = useState(null) // { text, location }
  const [destination, setDestination] = useState(null)
  const [geoOrigin, setGeoOrigin] = useState(null) // { lat, lng } from the ◎ button
  const [stops, setStops] = useState([]) // [{ id, value: { text, location } | null }]
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(() => getSavedPlaces())
  const nextStopId = useRef(0)

  const busy = status === 'loading'
  const originText = geoOrigin ? 'Current location' : origin?.text
  const modeInfo = TRAVEL_MODES.find((m) => m.id === mode) || TRAVEL_MODES[0]

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

  function saveAs(kind, place) {
    setSaved(savePlace(kind, place))
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
    return (
      <button type="button" className="tripbar" onClick={onExpand}>
        <span className="tripbar__mode">{modeInfo.glyph}</span>
        <span className="tripbar__route">
          <span className="tripbar__pt">{trip?.originText || originText || 'Start'}</span>
          <span className="tripbar__arrow">→</span>
          {stopCount > 0 && (
            <span className="tripbar__stops">+{stopCount} stop{stopCount > 1 ? 's' : ''} →</span>
          )}
          <span className="tripbar__pt">{trip?.destText || destination?.text || 'Destination'}</span>
        </span>
        <span className="tripbar__time">{formatClock(departure)}</span>
        <span className="tripbar__edit">Edit</span>
      </button>
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

      {isLoaded &&
        stops.map((stop, i) => (
          <PlaceField
            key={stop.id}
            id={`stop-${stop.id}`}
            label={`Stop ${i + 1}`}
            placeholder="Address or place"
            onSelect={(v) => setStopValue(stop.id, v)}
            trailing={
              <>
                <MicButton onSelect={(v) => setStopValue(stop.id, v)} onError={setError} />
                <button
                  type="button"
                  className="form__ghost"
                  aria-label={`Remove stop ${i + 1}`}
                  onClick={() => removeStop(stop.id)}
                >
                  ✕
                </button>
              </>
            }
          />
        ))}

      {isLoaded && stops.length < MAX_STOPS && (
        <button type="button" className="form__addstop" onClick={addStop}>
          + Add stop
        </button>
      )}

      {(saved.home || saved.work) && (
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
        </div>
      )}

      {isLoaded ? (
        <PlaceField
          id="destination"
          label="To"
          placeholder="Address or place"
          onSelect={setDestination}
          trailing={<MicButton onSelect={setDestination} onError={setError} />}
        />
      ) : (
        <LoadingField label="To" />
      )}
      {destination && <SaveAsRow place={destination} saved={saved} onSave={saveAs} />}

      <div className="form__field">
        <label htmlFor="departure">Leaving at</label>
        <div className="form__inline">
          <input
            id="departure"
            type="datetime-local"
            value={toLocalInput(departure)}
            onChange={(e) => onDepartureChange(fromLocalInput(e.target.value))}
            required
          />
          <button
            type="button"
            className="form__ghost"
            onClick={() => onDepartureChange(new Date())}
          >
            Now
          </button>
        </div>
      </div>

      <details className="form__weights-wrap">
        <summary>
          What matters most
          <span className="form__weights-sum">
            shade {Math.round(weights.shade * 100)} · direct {Math.round(weights.distance * 100)} ·
            safety {Math.round(weights.safety * 100)}
          </span>
        </summary>
        <fieldset className="form__weights">
          {WEIGHT_FIELDS.map(({ key, label, hint }) => {
            const isShadeAtNight = key === 'shade' && nightMode
            return (
              <div className={`weight${isShadeAtNight ? ' weight--dim' : ''}`} key={key}>
                <div className="weight__row">
                  <span className="weight__label">{label}</span>
                  <span className="weight__val">{Math.round(weights[key] * 100)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(weights[key] * 100)}
                  disabled={isShadeAtNight}
                  onChange={(e) =>
                    onWeightsChange({ ...weights, [key]: Number(e.target.value) / 100 })
                  }
                  aria-label={`${label} priority`}
                />
                <span className="weight__hint">
                  {isShadeAtNight ? '🌙 Not relevant after dark — try Safety instead' : hint}
                </span>
              </div>
            )
          })}
        </fieldset>
      </details>

      {error && <p className="form__err">{error}</p>}

      <button className="form__submit" type="submit" disabled={busy || !isLoaded}>
        {busy ? 'Finding routes…' : 'Find routes'}
      </button>
    </form>
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

function fromLocalInput(value) {
  const parsed = value ? new Date(value) : new Date()
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}
