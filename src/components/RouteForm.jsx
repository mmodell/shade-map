import { useRef, useState } from 'react'
import { Autocomplete } from '@react-google-maps/api'

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
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [locating, setLocating] = useState(false)
  const originAc = useRef(null)
  const destAc = useRef(null)

  const busy = status === 'loading'

  function handleSubmit(e) {
    e.preventDefault()
    onSubmit({ origin: origin.trim(), destination: destination.trim() })
  }

  function useMyLocation() {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin(`${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`)
        setLocating(false)
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  function bindPlace(acRef, setter) {
    const place = acRef.current?.getPlace?.()
    if (place?.formatted_address) setter(place.formatted_address)
    else if (place?.name) setter(place.name)
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="form__field">
        <label htmlFor="origin">From</label>
        <div className="form__inline">
          <MaybeAutocomplete
            isLoaded={isLoaded}
            onLoad={(ac) => (originAc.current = ac)}
            onPlaceChanged={() => bindPlace(originAc, setOrigin)}
          >
            <input
              id="origin"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="Address or place"
              autoComplete="off"
              required
            />
          </MaybeAutocomplete>
          <button
            type="button"
            className="form__ghost"
            onClick={useMyLocation}
            disabled={locating}
            title="Use my current location"
          >
            {locating ? '…' : '◎'}
          </button>
        </div>
      </div>

      <div className="form__field">
        <label htmlFor="destination">To</label>
        <MaybeAutocomplete
          isLoaded={isLoaded}
          onLoad={(ac) => (destAc.current = ac)}
          onPlaceChanged={() => bindPlace(destAc, setDestination)}
        >
          <input
            id="destination"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Address or place"
            autoComplete="off"
            required
          />
        </MaybeAutocomplete>
      </div>

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

      <button className="form__submit" type="submit" disabled={busy || !isLoaded}>
        {busy ? 'Finding shade…' : 'Find routes'}
      </button>
    </form>
  )
}

function MaybeAutocomplete({ isLoaded, onLoad, onPlaceChanged, children }) {
  if (!isLoaded) return children
  return (
    <Autocomplete
      onLoad={onLoad}
      onPlaceChanged={onPlaceChanged}
      fields={['formatted_address', 'name', 'geometry']}
    >
      {children}
    </Autocomplete>
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
