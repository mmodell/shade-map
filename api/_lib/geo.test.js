import { describe, it, expect } from 'vitest'
import { haversine, bbox, pointInRing, distToSegment, distToPolyline, pathLengthMeters } from './geo.js'

describe('haversine', () => {
  it('returns 0 for identical points', () => {
    const p = { lat: 40.75, lng: -73.99 }
    expect(haversine(p, p)).toBeCloseTo(0, 3)
  })
})

describe('bbox', () => {
  it('encloses all input points with padding on every side', () => {
    const points = [
      { lat: 40.75, lng: -73.99 },
      { lat: 40.76, lng: -73.98 },
    ]
    const b = bbox(points, 50)
    expect(b.south).toBeLessThan(40.75)
    expect(b.north).toBeGreaterThan(40.76)
    expect(b.west).toBeLessThan(-73.99)
    expect(b.east).toBeGreaterThan(-73.98)
  })
})

describe('pointInRing', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]
  it('detects a point inside the polygon', () => {
    expect(pointInRing({ x: 5, y: 5 }, square)).toBe(true)
  })
  it('detects a point outside the polygon', () => {
    expect(pointInRing({ x: 50, y: 50 }, square)).toBe(false)
  })
})

describe('distToSegment / distToPolyline', () => {
  it('is zero for a point on the segment', () => {
    expect(distToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0)
  })
  it('is the perpendicular distance off the segment', () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3)
  })
  it('finds the closest segment in a multi-segment polyline', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]
    expect(distToPolyline({ x: 10, y: 5 }, line)).toBeCloseTo(0)
  })
})

describe('pathLengthMeters', () => {
  it('sums the distance between consecutive points', () => {
    const points = [
      { lat: 40.0, lng: -73.99 },
      { lat: 40.001, lng: -73.99 },
      { lat: 40.002, lng: -73.99 },
    ]
    const total = pathLengthMeters(points)
    const oneLeg = pathLengthMeters(points.slice(0, 2))
    expect(total).toBeCloseTo(oneLeg * 2, 0)
  })
  it('is 0 for a single point', () => {
    expect(pathLengthMeters([{ lat: 40, lng: -73.99 }])).toBe(0)
  })
})
