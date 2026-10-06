// Solar geometry on *solar time* (12:00 = sun due south/north, highest).
// World axes: x = east, y = up, z = south  (so north is -z).

const RAD = Math.PI / 180

export function declination(dayOfYear) {
  return 23.44 * RAD * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365)
}

/** Sun position for a latitude (deg), day of year (1-365) and solar hour (0-24). */
export function sunPosition(latDeg, dayOfYear, hour) {
  const lat = latDeg * RAD
  const dec = declination(dayOfYear)
  const H = (hour - 12) * 15 * RAD
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H)
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)))
  const cosEl = Math.cos(el)
  let az = 0 // from north, clockwise
  if (cosEl > 1e-6 && Math.abs(Math.cos(lat)) > 1e-6) {
    const c = (Math.sin(dec) - sinEl * Math.sin(lat)) / (cosEl * Math.cos(lat))
    az = Math.acos(Math.max(-1, Math.min(1, c)))
    if (H > 0) az = 2 * Math.PI - az
  }
  const dir = [Math.sin(az) * cosEl, sinEl, -Math.cos(az) * cosEl]
  return { elevation: el, azimuth: az, sinEl, dir }
}

/** Sunrise / sunset in solar hours, or null in polar day/night. */
export function daylight(latDeg, dayOfYear) {
  const x = -Math.tan(latDeg * RAD) * Math.tan(declination(dayOfYear))
  if (x >= 1) return { polar: 'night' }
  if (x <= -1) return { polar: 'day' }
  const h = Math.acos(x) / (15 * RAD)
  return { sunrise: 12 - h, sunset: 12 + h }
}

const MONTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function dayLabel(doy) {
  let d = doy
  for (let m = 0; m < 12; m++) {
    if (d <= MONTHS[m]) return `${NAMES[m]} ${d}`
    d -= MONTHS[m]
  }
  return 'Dec 31'
}

export function hourLabel(h) {
  const hh = ((Math.floor(h) % 24) + 24) % 24
  const mm = Math.floor((h - Math.floor(h)) * 60 + 1e-6)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}
