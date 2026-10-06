import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fetchOsmFeatures } from './overpass.js'

function mockFetchOnce() {
  return {
    ok: true,
    json: async () => ({ elements: [{ type: 'node', lat: 40.75, lon: -73.99, tags: { natural: 'tree' } }] }),
  }
}

describe('fetchOsmFeatures caching', () => {
  let fetchMock

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(mockFetchOnce())
    vi.stubGlobal('fetch', fetchMock)
  })

  it('reuses one Overpass call for two nearby point sets in the same grid cell', async () => {
    // Random-ish base so this test's cache keys never collide with another
    // test run's, since the cache module is a shared singleton — but placed
    // dead-center in a 0.005deg grid cell (not just anywhere in [10,40)), so
    // an unlucky roll landing within the bbox padding of a cell boundary
    // can't flakily snap `a` and `b` to different cells.
    const GRID = 0.005
    const base = 10 + Math.floor(Math.random() * 1000) * GRID + GRID / 2
    const a = [{ lat: base, lng: base }]
    const b = [{ lat: base + 0.0002, lng: base + 0.0002 }] // well within one 0.005deg grid cell

    await fetchOsmFeatures(a)
    await fetchOsmFeatures(b)

    expect(fetchMock).toHaveBeenCalledTimes(2) // greenery + buildings, once
  })

  it('fetches separately for point sets far enough apart to land in different grid cells', async () => {
    const base = 10 + Math.random() * 30
    const a = [{ lat: base, lng: base }]
    const c = [{ lat: base + 1, lng: base + 1 }] // ~100km away — a different cell

    await fetchOsmFeatures(a)
    await fetchOsmFeatures(c)

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

const bodyOf = (opts) => decodeURIComponent(String(opts.body))
const isBuildingQuery = (opts) => bodyOf(opts).includes('way["building"]')

describe('fetchOsmFeatures building footprints', () => {
  const buildingEls = [
    {
      type: 'way',
      tags: { building: 'yes', 'building:levels': '10' },
      geometry: [
        { lat: 1, lon: 1 }, { lat: 1, lon: 1.001 }, { lat: 1.001, lon: 1.001 }, { lat: 1.001, lon: 1 }, { lat: 1, lon: 1 },
      ],
    },
    { type: 'way', tags: { building: 'house', height: '7' }, center: { lat: 2, lon: 2 } },
  ]
  const parkEl = { type: 'way', tags: { leisure: 'park' }, geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }] }

  it('keeps the outline of each building plus its height, and tolerates a bare centre', async () => {
    const fetchMock = vi.fn(async (_url, opts) => ({
      ok: true,
      json: async () => ({ elements: isBuildingQuery(opts) ? buildingEls : [parkEl] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const base = 60 + Math.random() * 5
    const osm = await fetchOsmFeatures([{ lat: base, lng: base }])
    expect(osm.buildingsOk).toBe(true)
    expect(osm.buildings).toHaveLength(2)
    expect(osm.buildings[0].ring).toHaveLength(5)
    expect(osm.buildings[0].heightM).toBeCloseTo(32)
    expect(osm.buildings[1].ring).toBeUndefined()
    expect(osm.buildings[1].heightM).toBe(7)
    expect(osm.greenAreas).toHaveLength(1) // the park — buildings never leak into it
  })

  it('asks for full outlines on a small area but only centre points on a huge one', async () => {
    const bodies = []
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      bodies.push(bodyOf(opts))
      return { ok: true, json: async () => ({ elements: [] }) }
    }))
    const base = 66 + Math.random() * 3
    await fetchOsmFeatures([{ lat: base, lng: base }, { lat: base + 0.003, lng: base + 0.003 }]) // ~0.3 km across
    await fetchOsmFeatures([{ lat: base + 1, lng: base + 1 }, { lat: base + 1.1, lng: base + 1.1 }]) // ~11 km across
    const small = bodies.filter((b) => b.includes('way["building"]'))[0]
    const huge = bodies.filter((b) => b.includes('way["building"]'))[1]
    expect(small).toMatch(/out geom tags;/)
    expect(huge).toMatch(/out tags center;/)
  })

  it('a failing building download does not lose the parks, trees and footpaths', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      if (isBuildingQuery(opts)) throw new Error('timeout')
      return { ok: true, json: async () => ({ elements: [parkEl] }) }
    }))
    const base = 70 + Math.random() * 5
    const osm = await fetchOsmFeatures([{ lat: base, lng: base }])
    expect(osm.buildingsOk).toBe(false)
    expect(osm.buildings).toEqual([])
    expect(osm.greenAreas).toHaveLength(1)
  })

  it('still throws when the greenery layer itself is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    const base = 75 + Math.random() * 5
    await expect(fetchOsmFeatures([{ lat: base, lng: base }])).rejects.toThrow()
  })
})

describe('fetchOsmFeatures failure reporting', () => {
  it('names each mirror and why it failed, and identifies itself with a User-Agent', async () => {
    const seen = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      seen.push(opts.headers['user-agent'])
      return { ok: false, status: String(url).includes('kumi') ? 429 : 406, json: async () => ({}) }
    }))
    const base = 80 + Math.random() * 5
    await expect(fetchOsmFeatures([{ lat: base, lng: base }])).rejects.toThrow(
      /overpass-api\.de: HTTP 406.*overpass\.kumi\.systems: HTTP 429/
    )
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((ua) => /shade-map/.test(ua))).toBe(true)
  })
})
