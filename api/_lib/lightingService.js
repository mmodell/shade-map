import SunCalc from 'suncalc'

/* Share of the route that runs along ways explicitly tagged lit=yes.
   Only meaningful around and after dusk. */
export function computeLighting({ matchedTags, date, lat, lng }) {
  const matched = matchedTags.filter(Boolean)
  let lit = 0
  let unlit = 0
  for (const tags of matched) {
    if (tags.lit === 'yes' || tags.lit === '24/7') lit++
    else if (tags.lit === 'no') unlit++
  }
  const known = lit + unlit
  const litFraction = known ? lit / known : null

  const sun = SunCalc.getPosition(date, lat, lng)
  const altitudeDeg = (sun.altitude * 180) / Math.PI
  const relevant = altitudeDeg < 3 // dusk or darker

  return {
    litFraction: litFraction == null ? null : round2(litFraction),
    knownShare: matched.length ? round2(known / matched.length) : 0,
    relevant,
    note:
      relevant && litFraction != null
        ? `${Math.round(litFraction * 100)}% of tagged segments are lit`
        : null,
  }
}

const round2 = (n) => Math.round(n * 100) / 100
