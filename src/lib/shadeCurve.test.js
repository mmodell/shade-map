import { describe, it, expect } from 'vitest'
import { bestDeparture, spread, nearestSample, shadeAt, curveOf } from './shadeCurve.js'

const S = (iso, shadeFraction, isNight = false) => ({ t: iso, shadeFraction, isNight })
const samples = [
  S('2026-06-21T09:30:00Z', 1, true), // before sunrise — "100% shade" by definition
  S('2026-06-21T10:00:00Z', 0.6),
  S('2026-06-21T14:00:00Z', 0.2),
  S('2026-06-21T18:00:00Z', 0.75),
  S('2026-06-21T22:00:00Z', 0.75),
  S('2026-06-22T01:00:00Z', 1, true),
]

describe('bestDeparture', () => {
  it('picks the shadiest daylight time and ignores night samples', () => {
    expect(bestDeparture(samples).shadeFraction).toBe(0.75)
  })
  it('breaks ties toward the time nearest the current departure', () => {
    const near = new Date('2026-06-21T21:00:00Z').getTime()
    expect(bestDeparture(samples, near).t).toBe('2026-06-21T22:00:00Z')
    const early = new Date('2026-06-21T17:00:00Z').getTime()
    expect(bestDeparture(samples, early).t).toBe('2026-06-21T18:00:00Z')
  })
  it('returns null when it is dark all day', () => {
    expect(bestDeparture([S('2026-06-21T01:00:00Z', 1, true)])).toBeNull()
    expect(bestDeparture([])).toBeNull()
  })
})

describe('spread / lookup', () => {
  it('measures how much daylight shade varies', () => {
    expect(spread(samples)).toBeCloseTo(0.55)
    expect(spread([S('a', 0.5), S('b', 0.52)])).toBeLessThan(0.05)
    expect(spread([])).toBe(0)
  })
  it('finds the nearest sample and reads shade off it', () => {
    const t = new Date('2026-06-21T14:20:00Z').getTime()
    expect(nearestSample(samples, t).t).toBe('2026-06-21T14:00:00Z')
    expect(shadeAt(samples, t)).toBe(0.2)
    expect(shadeAt([], t)).toBeNull()
  })
  it('curveOf tolerates routes without a curve', () => {
    expect(curveOf(null)).toEqual([])
    expect(curveOf({ shade: {} })).toEqual([])
    expect(curveOf({ shade: { byDeparture: samples } })).toHaveLength(6)
  })
})
