import { describe, it, expect } from 'vitest'
import { formatDistance, formatDuration, formatPercent, formatTemp } from './format.js'

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
