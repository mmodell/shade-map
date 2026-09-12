import { describe, it, expect } from 'vitest'
import { haversineMeters } from './geoMath.js'

describe('haversineMeters', () => {
  it('returns 0 for the same point', () => {
    const p = { lat: 40.75, lng: -73.99 }
    expect(haversineMeters(p, p)).toBeCloseTo(0, 3)
  })

  it('returns Infinity if either point is missing (fails safe, not throws)', () => {
    expect(haversineMeters(null, { lat: 0, lng: 0 })).toBe(Infinity)
    expect(haversineMeters({ lat: 0, lng: 0 }, undefined)).toBe(Infinity)
  })

  it('matches a known distance within a few meters', () => {
    // ~111.32km per degree of latitude at the equator-ish scale used here;
    // 0.001deg north is close to 111.3m.
    const a = { lat: 40.0, lng: -73.99 }
    const b = { lat: 40.001, lng: -73.99 }
    const d = haversineMeters(a, b)
    expect(d).toBeGreaterThan(105)
    expect(d).toBeLessThan(115)
  })

  it('is symmetric', () => {
    const a = { lat: 40.75, lng: -73.99 }
    const b = { lat: 40.76, lng: -73.98 }
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6)
  })
})
