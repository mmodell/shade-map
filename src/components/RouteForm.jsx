import { useState } from 'react'
import PlaceField from './PlaceField'

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
  status,
  onSubmit,
}) {
  const [origin, setOrigin] = useState(null) // { text, location }
  const [destination, setDestination] = useState(null)
  const [geoOrigin, setGeoOrigin] = useState(null) // { lat, lng } from the ◎ button
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')

  const busy = status === 'loading'

  function handleSubmit(e) {
    e.preventDefault()
    const originValue = geoOrigin || origin?.location || origin?.text
    const destValue = destination?.location || destination?.text
    if (!originValue || !destValue) {
      setError('Pick a start point and a destination from the suggestions.')
      return
    }
    setError('')
    onSubmit({ origin: originValue, destination: destValue })
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

      <fieldset className="form__weights">
        <legend>What matters most</legend>
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

      {error && <p className="form__err">{error}</p>}

      <button className="form__submit" type="submit" disabled={busy || !isLoaded}>
        {busy ? 'Finding shade…' : 'Find routes'}
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
