import { describe, it, expect } from 'vitest'
import { computeShade, prepareShade, shadeCurve, isShadowedByFootprint } from './shadeCalculator.js'
import { departureWindow } from './sun.js'

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

describe('footprint shadows', () => {
  // A 30m-wide, 10m-deep slab, 24m tall, centred on the origin of a local
  // metric frame. Sun due east (dx=1,dy=0) at 30 degrees → shadow reaches
  // 24 / tan(30deg) ≈ 41.6m west of the slab's west face.
  const ring = [
    { x: -15, y: -5 }, { x: 15, y: -5 }, { x: 15, y: 5 }, { x: -15, y: 5 },
  ]
  const slab = { ring, minX: -15, maxX: 15, minY: -5, maxY: 5, heightM: 24 }
  const tan30 = Math.tan((30 * Math.PI) / 180)

  it('shades points behind the slab out to height / tan(altitude), and no further', () => {
    // sun in the WEST here: dx=-1 means "toward the sun"; points to the east of the slab are shaded
    const toSun = [-1, 0]
    expect(isShadowedByFootprint({ x: 15 + 30, y: 0 }, slab, toSun[0], toSun[1], tan30)).toBe(true)
    expect(isShadowedByFootprint({ x: 15 + 50, y: 0 }, slab, toSun[0], toSun[1], tan30)).toBe(false)
  })
  it('only shades the strip the footprint actually covers — not a wide cone', () => {
    const toSun = [-1, 0]
    // 12m off the slab's centreline in y: outside its 10m depth → full sun
    expect(isShadowedByFootprint({ x: 30, y: 12 }, slab, toSun[0], toSun[1], tan30)).toBe(false)
    expect(isShadowedByFootprint({ x: 30, y: 3 }, slab, toSun[0], toSun[1], tan30)).toBe(true)
  })
  it('does not shade the sun-facing side', () => {
    expect(isShadowedByFootprint({ x: -30, y: 0 }, slab, -1, 0, tan30)).toBe(false)
  })
  it('a low building casts a shorter shadow than a tall one at the same sun angle', () => {
    const low = { ...slab, heightM: 6 }
    const p = { x: 15 + 20, y: 0 }
    expect(isShadowedByFootprint(p, low, -1, 0, tan30)).toBe(false) // 6/tan30 ≈ 10m
    expect(isShadowedByFootprint(p, slab, -1, 0, tan30)).toBe(true)
  })

  it('computeShade uses footprints: a point behind a long slab is shaded, one beside it is not', () => {
    const lat = 40.75, lng = -73.99
    const mPerLat = 111320, mPerLng = 111320 * Math.cos((lat * Math.PI) / 180)
    const at = (x, y) => ({ lat: lat + y / mPerLat, lng: lng + x / mPerLng })
    // 60m-wide (E-W) x 10m-deep slab, 30m tall
    const slabRing = [at(-30, -5), at(30, -5), at(30, 5), at(-30, 5)].map((p) => [p.lat, p.lng])
    const osm = { ...EMPTY_OSM, buildings: [{ ...at(0, 0), heightM: 30, ring: slabRing }] }
    // Sun in the south-ish evening: pick the date where azimuth ≈ south and altitude ≈ 35° (noon in late March)
    const noon = new Date('2026-03-20T17:00:00Z')
    const north = at(0, 25) // directly north of the slab: in its shadow with the sun to the south
    const wayWest = at(-80, 25) // north of where the slab ends: out of its shadow
    const res = computeShade({ points: [north, wayWest], osm, date: noon })
    expect(res.pointShade[0]).toBe('shade')
    expect(res.pointShade[1]).toBe('sun')
  })
})

describe('time-aware shade', () => {
  const lat = 40.75, lng = -73.99
  const mPerLat = 111320, mPerLng = 111320 * Math.cos((lat * Math.PI) / 180)
  const at = (x, y) => ({ lat: lat + y / mPerLat, lng: lng + x / mPerLng })
  const tower = [at(-8, -8), at(8, -8), at(8, 8), at(-8, 8)].map((p) => [p.lat, p.lng])
  const osm = { ...EMPTY_OSM, buildings: [{ ...at(0, 0), heightM: 40, ring: tower }] }
  const westSide = [at(-30, 0), at(-31, 0)]
  const eastSide = [at(30, 0), at(31, 0)]
  const morning = new Date('2026-09-23T12:30:00Z') // sun in the east
  const evening = new Date('2026-09-23T21:30:00Z') // sun in the west

  it("a spot's shade flips from one side of the tower to the other over the day", () => {
    expect(computeShade({ points: westSide, osm, date: morning }).shadeFraction).toBe(1)
    expect(computeShade({ points: westSide, osm, date: evening }).shadeFraction).toBe(0)
    expect(computeShade({ points: eastSide, osm, date: morning }).shadeFraction).toBe(0)
    expect(computeShade({ points: eastSide, osm, date: evening }).shadeFraction).toBe(1)
  })

  it('uses the sun at arrival: a long route that crosses sunset ends in shade', () => {
    // 20 points over ~600m, with the walk taking 3 hours starting 90 min before sunset
    const long = Array.from({ length: 20 }, (_, i) => at(i * 30, 400))
    const before = new Date('2026-09-23T21:30:00Z')
    const quick = computeShade({ points: long, osm: EMPTY_OSM, date: before, durationSeconds: 60 })
    const slow = computeShade({ points: long, osm: EMPTY_OSM, date: before, durationSeconds: 3 * 3600 })
    expect(quick.shadeFraction).toBe(0)
    expect(slow.shadeFraction).toBeGreaterThan(0.3) // dusk falls partway along it
    expect(slow.isNight).toBe(false)
    expect(slow.note).toMatch(/sun sets/i)
  })

  it('shadeCurve returns one sample per departure and finds the shady hour', () => {
    const ctx = prepareShade({ points: westSide, osm })
    const dates = [morning, evening]
    const curve = shadeCurve(ctx, { dates })
    expect(curve.map((c) => c.shadeFraction)).toEqual([1, 0])
    expect(curve[0].t).toBe(morning.toISOString())
  })

  it('shadeCurve is night-aware', () => {
    const ctx = prepareShade({ points: westSide, osm })
    const [c] = shadeCurve(ctx, { dates: [new Date('2026-09-23T05:00:00Z')] })
    expect(c.isNight).toBe(true)
    expect(c.shadeFraction).toBe(1)
  })
})

describe('departureWindow', () => {
  it('spans sunrise to sunset in 30-minute steps', () => {
    const w = departureWindow(new Date('2026-09-23T17:00:00Z'), 40.75, -73.99)
    expect(w.length).toBeGreaterThan(20)
    expect(w.length).toBeLessThanOrEqual(49)
    for (let i = 1; i < w.length; i++) expect(w[i] - w[i - 1]).toBe(30 * 60 * 1000)
    const mid = w[Math.floor(w.length / 2)]
    expect(Math.abs(mid - new Date('2026-09-23T17:00:00Z'))).toBeLessThan(3 * 3600e3)
  })
  it("moves to tomorrow once tonight's sun has set", () => {
    const night = new Date('2026-09-24T03:00:00Z') // 11pm New York
    const w = departureWindow(night, 40.75, -73.99)
    expect(w[0].getTime()).toBeGreaterThan(night.getTime())
  })
})
