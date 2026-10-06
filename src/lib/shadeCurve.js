/* Helpers for the "shade by departure time" curve the analyzer returns on
   each route (`shade.byDeparture`: [{ t, shadeFraction, isNight, overcast }]). */

export function curveOf(route) {
  const c = route?.shade?.byDeparture
  return Array.isArray(c) ? c : []
}

const ms = (s) => new Date(s.t).getTime()

/* The daylight departure with the most shade. After-dark samples are always
   100% "shade" by definition, so they're excluded — otherwise midnight would
   win every time. Ties go to whichever is closest to `aroundMs`, so the
   suggestion doesn't jump somewhere pointless when several times are equal. */
export function bestDeparture(samples, aroundMs = 0) {
  let best = null
  for (const s of samples) {
    if (s.isNight) continue
    if (
      !best ||
      s.shadeFraction > best.shadeFraction + 1e-9 ||
      (Math.abs(s.shadeFraction - best.shadeFraction) <= 1e-9 &&
        Math.abs(ms(s) - aroundMs) < Math.abs(ms(best) - aroundMs))
    ) {
      best = s
    }
  }
  return best
}

/* How much the daylight shade varies across the day (0..1). Small = timing
   barely matters for this route. */
export function spread(samples) {
  const day = samples.filter((s) => !s.isNight).map((s) => s.shadeFraction)
  return day.length ? Math.max(...day) - Math.min(...day) : 0
}

export function nearestSample(samples, tMs) {
  let best = null
  for (const s of samples) {
    if (!best || Math.abs(ms(s) - tMs) < Math.abs(ms(best) - tMs)) best = s
  }
  return best
}

/* Shade at (roughly) a given time, read off the curve. */
export function shadeAt(samples, tMs) {
  const s = nearestSample(samples, tMs)
  return s ? s.shadeFraction : null
}
