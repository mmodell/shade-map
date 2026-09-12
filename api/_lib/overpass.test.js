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

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fetches separately for point sets far enough apart to land in different grid cells', async () => {
    const base = 10 + Math.random() * 30
    const a = [{ lat: base, lng: base }]
    const c = [{ lat: base + 1, lng: base + 1 }] // ~100km away — a different cell

    await fetchOsmFeatures(a)
    await fetchOsmFeatures(c)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
