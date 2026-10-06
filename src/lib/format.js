import { format } from 'date-fns'

export function formatDistance(meters) {
  if (meters == null) return '—'
  const miles = meters / 1609.344
  if (miles < 0.1) return `${Math.round(meters / 0.3048)} ft`
  return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`
}

export function formatDuration(seconds) {
  if (seconds == null) return '—'
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} hr ${m} min` : `${h} hr`
}

export function formatClock(date) {
  return format(date, 'h:mm a')
}

export function formatPercent(fraction) {
  if (fraction == null || Number.isNaN(fraction)) return '—'
  return `${Math.round(fraction * 100)}%`
}

export function formatTemp(value, units) {
  if (value == null) return '—'
  return `${Math.round(value)}°${units === 'metric' ? 'C' : 'F'}`
}

/* Clock time at a place `offsetSeconds` east of UTC (e.g. -14400 for New York
   in summer), regardless of where the viewer's own clock is. With no offset
   it falls back to the viewer's local time. */
export function formatClockAt(date, offsetSeconds) {
  if (!Number.isFinite(offsetSeconds)) return formatClock(date)
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(date.getTime() + offsetSeconds * 1000))
}

/* Hour of day (0-23) at that place. */
export function hourAt(date, offsetSeconds) {
  if (!Number.isFinite(offsetSeconds)) return date.getHours()
  return new Date(date.getTime() + offsetSeconds * 1000).getUTCHours()
}

/* True when the place's clock differs from the viewer's at that moment. */
export function offsetDiffers(date, offsetSeconds) {
  if (!Number.isFinite(offsetSeconds)) return false
  return offsetSeconds !== -date.getTimezoneOffset() * 60
}
