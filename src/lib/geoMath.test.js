import { describe, it, expect } from 'vitest'
import { haversineMeters, distanceToPath } from './geoMath.js'

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

describe('distanceToPath', () => {
  // A short straight path running north along one meridian.
  const path = [
    { lat: 40.0, lng: -73.99 },
    { lat: 40.001, lng: -73.99 },
    { lat: 40.002, lng: -73.99 },
  ]

  it('is ~0 for a point on the path', () => {
    expect(distanceToPath({ lat: 40.001, lng: -73.99 }, path)).toBeLessThan(1)
  })

  it('grows with perpendicular distance off the path', () => {
    // ~0.0001 deg of longitude at this latitude is roughly 8-9m.
    const near = distanceToPath({ lat: 40.001, lng: -73.9899 }, path)
    const far = distanceToPath({ lat: 40.001, lng: -73.985 }, path)
    expect(near).toBeGreaterThan(0)
    expect(far).toBeGreaterThan(near)
  })

  it('uses the closest of multiple segments, not just the first', () => {
    const d = distanceToPath({ lat: 40.002, lng: -73.99 }, path)
    expect(d).toBeLessThan(1)
  })

  it('falls back to point distance for a single-point path', () => {
    const p = { lat: 40.0, lng: -73.99 }
    expect(distanceToPath(p, [p])).toBeCloseTo(0, 3)
  })

  it('returns Infinity for missing position or empty path', () => {
    expect(distanceToPath(null, path)).toBe(Infinity)
    expect(distanceToPath({ lat: 40, lng: -73.99 }, [])).toBe(Infinity)
  })
})
