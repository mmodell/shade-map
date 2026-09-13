import { useEffect, useRef } from 'react'

/* Wraps Google's current Places widget — google.maps.places.PlaceAutocompleteElement
   (the legacy google.maps.places.Autocomplete is closed to accounts created after
   March 2025). Fires onSelect({ text, location }) when a suggestion is chosen. */
export default function PlaceField({ label, id, placeholder, onSelect, trailing, bias }) {
  const hostRef = useRef(null)
  const elRef = useRef(null)
  // Read fresh inside the (async, run-once) mount effect without adding
  // `bias` to its dependency array — recreating the widget on every bias
  // change would drop whatever the user's mid-typing.
  const biasRef = useRef(bias)
  biasRef.current = bias

  // Without a location bias, typing a category like "coffee" has no "near
  // me" context the way it does in the actual Google Maps app — Places
  // treats it as a near-exact name search and comes back empty for
  // anything that isn't a literally-named match. Bias search around
  // wherever the trip already anchors (current location, the chosen
  // start, etc.) so generic keyword searches behave like a real search.
  useEffect(() => {
    if (elRef.current) {
      elRef.current.locationBias = bias ? { center: bias, radius: 50000 } : null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bias?.lat, bias?.lng])

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
      if (biasRef.current) {
        el.locationBias = { center: biasRef.current, radius: 50000 }
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
        // Left to itself, the widget fills its own box with the full
        // selected address and — being a closed shadow-DOM input we can't
        // reach to reset scroll/caret position on — shows whichever end
        // the browser's caret-follow scrolling happens to land on, which
        // for a long address is the city/state tail, not the street. We
        // already show the real selection in our own confirmation line
        // below (always left-to-right, never truncated from the wrong
        // end), so just clear the widget's own copy back to placeholder
        // rather than leave a second, differently-truncated copy visible.
        try {
          el.value = ''
        } catch {
          /* no settable value on this version — leave it be */
        }
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
