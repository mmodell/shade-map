import { useEffect, useRef } from 'react'

/* Wraps Google's current Places widget — google.maps.places.PlaceAutocompleteElement
   (the legacy google.maps.places.Autocomplete is closed to accounts created after
   March 2025). Fires onSelect({ text, location }) when a suggestion is chosen. */
export default function PlaceField({ label, id, placeholder, onSelect, trailing }) {
  const hostRef = useRef(null)
  const elRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function mount() {
      const g = window.google
      if (!g?.maps || !hostRef.current) return

      const places =
        g.maps.places?.PlaceAutocompleteElement != null
          ? g.maps.places
          : await g.maps.importLibrary('places')
      if (cancelled || !hostRef.current) return

      const el = new places.PlaceAutocompleteElement()
      if (id) el.id = id
      el.className = 'pac-el'
      try {
        if (placeholder) el.setAttribute('placeholder', placeholder)
      } catch {
        /* placeholder unsupported on this version — the <label> covers it */
      }
      hostRef.current.replaceChildren(el)
      elRef.current = el

      el.addEventListener('gmp-select', async (event) => {
        const prediction = event.placePrediction
        if (!prediction) return
        const place = prediction.toPlace()
        try {
          await place.fetchFields({
            fields: ['formattedAddress', 'displayName', 'location'],
          })
        } catch {
          /* fall through with whatever resolved */
        }
        const loc = place.location
        onSelect({
          text:
            place.formattedAddress ||
            place.displayName ||
            prediction.text?.text ||
            '',
          location: loc ? { lat: loc.lat(), lng: loc.lng() } : null,
        })
      })
    }

    mount()
    return () => {
      cancelled = true
      elRef.current?.remove()
      elRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="form__field">
      <label htmlFor={id}>{label}</label>
      <div className="form__inline">
        <div className="pac-host" ref={hostRef} />
        {trailing}
      </div>
    </div>
  )
}
