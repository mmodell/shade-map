import { useState } from 'react'
import PlaceField from './PlaceField'
import { TRAVEL_MODES } from '../lib/googleDirections'
import { formatClock } from '../lib/format'

const WEIGHT_FIELDS = [
  { key: 'shade', label: 'Shade', hint: 'Prefer tree cover & shadow' },
  { key: 'distance', label: 'Directness', hint: 'Prefer shorter routes' },
  { key: 'safety', label: 'Safety', hint: 'Prefer lit paths & sidewalks' },
]

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
  onSubmit,
}) {
  const [origin, setOrigin] = useState(null) // { text, location }
  const [destination, setDestination] = useState(null)
  const [geoOrigin, setGeoOrigin] = useState(null) // { lat, lng } from the ◎ button
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')

  const busy = status === 'loading'
  const originText = geoOrigin ? 'Current location' : origin?.text
  const modeInfo = TRAVEL_MODES.find((m) => m.id === mode) || TRAVEL_MODES[0]

  function handleSubmit(e) {
    e.preventDefault()
    const originValue = geoOrigin || origin?.location || origin?.text
    const destValue = destination?.location || destination?.text
    if (!originValue || !destValue) {
      setError('Pick a start point and a destination from the suggestions.')
      return
    }
    setError('')
    onSubmit({
      origin: originValue,
      destination: destValue,
      mode,
      originText: originText || 'Start',
      destText: destination?.text || 'Destination',
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
    return (
      <button type="button" className="tripbar" onClick={onExpand}>
        <span className="tripbar__mode">{modeInfo.glyph}</span>
        <span className="tripbar__route">
          <span className="tripbar__pt">{originText || 'Start'}</span>
          <span className="tripbar__arrow">→</span>
          <span className="tripbar__pt">{destination?.text || 'Destination'}</span>
        </span>
        <span className="tripbar__time">{formatClock(departure)}</span>
        <span className="tripbar__edit">Edit</span>
      </button>
    )
  }

  const locationButton = (
    <button
      type="button"
      className="form__ghost"
      onClick={useMyLocation}
      disabled={locating}
      title="Use my current location"
    >
      {locating ? '…' : '◎'}
    </button>
  )

  return (
    <form className="form" onSubmit={handleSubmit}>
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
          trailing={locationButton}
        />
      ) : (
        <LoadingField label="From" trailing={locationButton} />
      )}

      {isLoaded ? (
        <PlaceField
          id="destination"
          label="To"
          placeholder="Address or place"
          onSelect={setDestination}
        />
      ) : (
        <LoadingField label="To" />
      )}

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
          {WEIGHT_FIELDS.map(({ key, label, hint }) => (
            <div className="weight" key={key}>
              <div className="weight__row">
                <span className="weight__label">{label}</span>
                <span className="weight__val">{Math.round(weights[key] * 100)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(weights[key] * 100)}
                onChange={(e) =>
                  onWeightsChange({ ...weights, [key]: Number(e.target.value) / 100 })
                }
                aria-label={`${label} priority`}
              />
              <span className="weight__hint">{hint}</span>
            </div>
          ))}
        </fieldset>
      </details>

      {error && <p className="form__err">{error}</p>}

      <button className="form__submit" type="submit" disabled={busy || !isLoaded}>
        {busy ? 'Finding routes…' : 'Find routes'}
      </button>
    </form>
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
