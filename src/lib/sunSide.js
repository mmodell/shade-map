/* Which side of the street is shaded, given the direction you're walking and
   where the sun is. A building/treeline on the sun's side of the street
   throws its shadow across to the far sidewalk — so shade falls on the side
   opposite the sun, relative to your direction of travel. */

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

function norm(deg) {
  return ((deg % 360) + 360) % 360
}

function angleDiff(a, b) {
  const d = Math.abs(norm(a) - norm(b))
  return d > 180 ? 360 - d : d
}

export function compassLabel(deg) {
  return COMPASS[Math.round(norm(deg) / 45) % 8]
}

/* Compass bearing from point a to point b (0 = north, 90 = east). */
export function bearingDeg(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const toDeg = (r) => (r * 180) / Math.PI
  const phi1 = toRad(a.lat)
  const phi2 = toRad(b.lat)
  const dLambda = toRad(b.lng - a.lng)
  const y = Math.sin(dLambda) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda)
  return norm(toDeg(Math.atan2(y, x)))
}

/* travelBearingDeg: direction of travel along the segment.
   sunAzimuthDeg: compass direction of the sun (0 = north, from SunCalc + 180). */
export function shadeSideForBearing(travelBearingDeg, sunAzimuthDeg) {
  const rightBearing = norm(travelBearingDeg + 90)
  const leftBearing = norm(travelBearingDeg - 90)
  const sunOnRight = angleDiff(rightBearing, sunAzimuthDeg) < angleDiff(leftBearing, sunAzimuthDeg)
  const shadeBearing = sunOnRight ? leftBearing : rightBearing
  return { side: sunOnRight ? 'left' : 'right', compass: compassLabel(shadeBearing) }
}
