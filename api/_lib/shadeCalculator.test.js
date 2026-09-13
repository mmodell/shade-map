import { describe, it, expect } from 'vitest'
import { computeShade } from './shadeCalculator.js'

const EMPTY_OSM = { greenAreas: [], greenLines: [], trees: [], highways: [], buildings: [] }

function linePoints(lat0, lng0, count, step = 0.0003) {
  return Array.from({ length: count }, (_, i) => ({ lat: lat0 + i * step, lng: lng0 }))
}

describe('computeShade — canopy coverage', () => {
  it('classifies points inside a park polygon as shade', () => {
    const points = linePoints(40.75, -73.99, 10)
    const osm = {
      ...EMPTY_OSM,
      greenAreas: [
        [
          { lat: 40.751, lng: -73.9902 },
          { lat: 40.751, lng: -73.9898 },
          { lat: 40.754, lng: -73.9898 },
          { lat: 40.754, lng: -73.9902 },
        ],
      ],
    }
    const result = computeShade({ points, osm, date: new Date('2026-09-23T17:30:00Z') })
    expect(result.greenCoverage).toBeGreaterThan(0.3)
    expect(result.pointShade).toHaveLength(points.length)
  })

  it('reports zero coverage with no green features nearby', () => {
    const points = linePoints(40.75, -73.99, 10)
    const result = computeShade({ points, osm: EMPTY_OSM, date: new Date('2026-09-23T17:30:00Z') })
    expect(result.greenCoverage).toBe(0)
  })
})

describe('computeShade — directional building shadow', () => {
  // The whole point of this model: a building shades whichever side of the
  // street the sun ISN'T on, and that side flips over the course of the day.
  const lat = 40.75
  const lng = -73.99
  const dLng = 30 / (111320 * Math.cos((lat * Math.PI) / 180)) // ~30m of longitude here
  const westPoint = { lat, lng: lng - dLng }
  const eastPoint = { lat, lng: lng + dLng }
  const building = { lat, lng, heightM: 12 }
  const osm = { ...EMPTY_OSM, buildings: [building] }

  it('shades the west side when the sun is in the east (morning)', () => {
    // altitude 10°, azimuth 98.8° near this location/date
    const morning = new Date('2026-09-23T11:42:00.000Z')
    const result = computeShade({ points: [westPoint, eastPoint], osm, date: morning })
    expect(result.pointShade[0]).toBe('shade') // west
    expect(result.pointShade[1]).toBe('sun') // east
  })

  it('shades the east side when the sun is in the west (evening) — same building, same points', () => {
    // altitude 11.1°, azimuth 260° near this location/date
    const evening = new Date('2026-09-23T21:49:00.000Z')
    const result = computeShade({ points: [westPoint, eastPoint], osm, date: evening })
    expect(result.pointShade[0]).toBe('sun') // west
    expect(result.pointShade[1]).toBe('shade') // east
  })

  it('does not throw and falls back to a default height when a building has no heightM', () => {
    const noHeightOsm = { ...EMPTY_OSM, buildings: [{ lat, lng }] }
    expect(() =>
      computeShade({ points: [westPoint, eastPoint], osm: noHeightOsm, date: new Date('2026-09-23T21:49:00.000Z') })
    ).not.toThrow()
  })

  it('a building far beyond its shadow reach does not shade the point', () => {
    const farPoint = { lat: lat + 0.01, lng } // ~1.1km north — nowhere near a 12m building's shadow
    const result = computeShade({
      points: [farPoint],
      osm,
      date: new Date('2026-09-23T21:49:00.000Z'),
    })
    expect(result.pointShade[0]).toBe('sun')
  })
})

describe('computeShade — cloud cover', () => {
  const points = linePoints(40.75, -73.99, 5)
  const day = new Date('2026-09-23T17:30:00Z')

  it('defaults to not overcast when no cloud data is available', () => {
    const result = computeShade({ points, osm: EMPTY_OSM, date: day })
    expect(result.isOvercast).toBe(false)
    expect(result.cloudsPct).toBeNull()
  })

  it('flags isOvercast once cloud cover crosses the threshold, with an explanatory note', () => {
    const clear = computeShade({ points, osm: EMPTY_OSM, date: day, cloudsPct: 10 })
    const overcast = computeShade({ points, osm: EMPTY_OSM, date: day, cloudsPct: 90 })
    expect(clear.isOvercast).toBe(false)
    expect(clear.note).toBeUndefined()
    expect(overcast.isOvercast).toBe(true)
    expect(overcast.note).toMatch(/overcast/i)
  })

  it('reduces the UV index for the same sun position as cloud cover rises', () => {
    const clear = computeShade({ points, osm: EMPTY_OSM, date: day, cloudsPct: 0 })
    const cloudy = computeShade({ points, osm: EMPTY_OSM, date: day, cloudsPct: 90 })
    expect(cloudy.uvIndex).toBeLessThan(clear.uvIndex)
  })

  it('does not change the geometric shadeFraction — clouds explain the number, they do not fudge it', () => {
    const clear = computeShade({ points, osm: EMPTY_OSM, date: day, cloudsPct: 0 })
    const cloudy = computeShade({ points, osm: EMPTY_OSM, date: day, cloudsPct: 90 })
    expect(cloudy.shadeFraction).toBe(clear.shadeFraction)
  })
})

describe('computeShade — night', () => {
  it('returns shadeFraction 1 and isNight true well after sunset', () => {
    const points = linePoints(40.75, -73.99, 5)
    const result = computeShade({ points, osm: EMPTY_OSM, date: new Date('2026-09-23T04:00:00Z') })
    expect(result.isNight).toBe(true)
    expect(result.shadeFraction).toBe(1)
    expect(result.pointShade.every((s) => s === 'shade')).toBe(true)
  })
})
