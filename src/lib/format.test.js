import { describe, it, expect } from 'vitest'
import {
  formatDistance,
  formatDuration,
  formatPercent,
  formatTemp,
  formatClockAt,
  hourAt,
  offsetDiffers,
} from './format.js'

describe('formatDistance', () => {
  it('shows feet under ~0.1 miles', () => {
    expect(formatDistance(30)).toBe('98 ft')
  })
  it('shows miles at longer distances', () => {
    expect(formatDistance(1609.344)).toBe('1.0 mi')
  })
  it('handles null gracefully', () => {
    expect(formatDistance(null)).toBe('—')
  })
})

describe('formatDuration', () => {
  it('shows minutes under an hour', () => {
    expect(formatDuration(600)).toBe('10 min')
  })
  it('shows hours and minutes over an hour', () => {
    expect(formatDuration(5400)).toBe('1 hr 30 min')
  })
  it('drops the minutes when exactly on the hour', () => {
    expect(formatDuration(7200)).toBe('2 hr')
  })
  it('handles null gracefully', () => {
    expect(formatDuration(null)).toBe('—')
  })
})

describe('formatPercent', () => {
  it('rounds to the nearest whole percent', () => {
    expect(formatPercent(0.666)).toBe('67%')
  })
  it('handles null and NaN gracefully', () => {
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(NaN)).toBe('—')
  })
})

describe('formatTemp', () => {
  it('uses Fahrenheit by default / imperial', () => {
    expect(formatTemp(72.4, 'imperial')).toBe('72°F')
  })
  it('uses Celsius for metric', () => {
    expect(formatTemp(22.4, 'metric')).toBe('22°C')
  })
  it('handles null gracefully', () => {
    expect(formatTemp(null, 'imperial')).toBe('—')
  })
})

describe('route-local clock', () => {
  const noonUtc = new Date('2026-10-06T16:00:00Z')
  it('shows the clock at the place, not the viewer', () => {
    expect(formatClockAt(noonUtc, -4 * 3600)).toBe('12:00 PM') // New York (EDT)
    expect(formatClockAt(noonUtc, -7 * 3600)).toBe('9:00 AM') // Los Angeles (PDT)
    expect(formatClockAt(new Date('2026-10-06T21:30:00Z'), 9 * 3600)).toBe('6:30 AM') // Tokyo, next day
  })
  it('hourAt follows the place', () => {
    expect(hourAt(noonUtc, -4 * 3600)).toBe(12)
    expect(hourAt(noonUtc, 5.5 * 3600)).toBe(21)
  })
  it('falls back to the viewer when the offset is unknown', () => {
    expect(hourAt(noonUtc, null)).toBe(noonUtc.getHours())
    expect(offsetDiffers(noonUtc, null)).toBe(false)
  })
  it('knows when the place and viewer clocks differ', () => {
    const viewer = -noonUtc.getTimezoneOffset() * 60
    expect(offsetDiffers(noonUtc, viewer)).toBe(false)
    expect(offsetDiffers(noonUtc, viewer + 3 * 3600)).toBe(true)
  })
})
