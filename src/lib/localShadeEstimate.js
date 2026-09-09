import SunCalc from 'suncalc'

/* Rough client-only shade estimate used when the /api/route function is not
   available (e.g. plain `npm run dev` with no Vercel functions running).
   It has no OpenStreetMap greenery data, so it leans entirely on sun angle. */
export function localShadeEstimate(points, departure) {
  const mid = points[Math.floor(points.length / 2)] || points[0]
  const pos = SunCalc.getPosition(departure, mid.lat, mid.lng)
  const altitudeDeg = (pos.altitude * 180) / Math.PI
  const azimuthDeg = (pos.azimuth * 180) / Math.PI + 180

  if (altitudeDeg <= -0.833) {
    return {
      shadeFraction: 1,
      isNight: true,
      sunAltitude: altitudeDeg,
      sunAzimuth: azimuthDeg,
      source: 'local',
      note: 'After sunset — no direct sun on any route.',
    }
  }

  // Lower sun ⇒ longer shadows from whatever is beside the path.
  let urbanShade
  if (altitudeDeg >= 60) urbanShade = 0.1
  else if (altitudeDeg <= 10) urbanShade = 0.55
  else urbanShade = 0.55 - ((altitudeDeg - 10) / 50) * 0.45

  return {
    shadeFraction: round2(urbanShade),
    isNight: false,
    sunAltitude: round2(altitudeDeg),
    sunAzimuth: round2(azimuthDeg),
    greenCoverage: null,
    source: 'local',
    note: 'Estimated from sun angle only — deploy to Vercel for tree/park data.',
  }
}

function round2(n) {
  return Math.round(n * 100) / 100
}
