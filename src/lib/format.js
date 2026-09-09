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
