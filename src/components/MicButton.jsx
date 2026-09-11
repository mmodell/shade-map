import { useRef, useState } from 'react'

/* Voice input for a place field. Speech-to-text via the Web Speech API, then
   geocoded directly with google.maps.Geocoder — sidesteps trying to type
   into PlaceAutocompleteElement's shadow DOM, which has no public API for it. */
export default function MicButton({ onSelect, onError }) {
  const [state, setState] = useState('idle') // idle | listening | working
  const recRef = useRef(null)

  function start() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      onError?.('Voice input isn’t supported in this browser.')
      return
    }
    const rec = new SR()
    recRef.current = rec
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.maxAlternatives = 1

    rec.onresult = async (e) => {
      const transcript = e.results?.[0]?.[0]?.transcript?.trim()
      if (!transcript) {
        setState('idle')
        return
      }
      setState('working')
      try {
        const place = await geocode(transcript)
        if (place) onSelect(place)
        else onError?.(`Couldn’t find "${transcript}".`)
      } catch {
        onError?.('Could not look that address up.')
      } finally {
        setState('idle')
      }
    }
    rec.onerror = (e) => {
      setState('idle')
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        onError?.('Microphone access was denied.')
      } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
        onError?.('Voice input failed — try again.')
      }
    }
    rec.onend = () => setState((s) => (s === 'listening' ? 'idle' : s))

    setState('listening')
    rec.start()
  }

  function stop() {
    recRef.current?.stop()
  }

  return (
    <button
      type="button"
      className={`form__ghost mic${state !== 'idle' ? ' mic--active' : ''}`}
      onClick={state === 'idle' ? start : stop}
      title="Speak an address"
      aria-label="Speak an address"
    >
      {state === 'working' ? '…' : '🎤'}
    </button>
  )
}

function geocode(text) {
  return new Promise((resolve) => {
    if (!window.google?.maps) {
      resolve(null)
      return
    }
    const geocoder = new window.google.maps.Geocoder()
    geocoder.geocode({ address: text }, (results, status) => {
      if (status === 'OK' && results?.[0]) {
        const r = results[0]
        resolve({
          text: r.formatted_address,
          location: { lat: r.geometry.location.lat(), lng: r.geometry.location.lng() },
        })
      } else {
        resolve(null)
      }
    })
  })
}
