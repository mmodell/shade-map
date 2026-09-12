import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cacheGet, cacheSet, cached } from './cache.js'

describe('cache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns undefined for a key that was never set', () => {
    expect(cacheGet('nope-' + Math.random())).toBeUndefined()
  })

  it('returns a cached value before it expires', () => {
    cacheSet('k1', { v: 1 }, 1000)
    expect(cacheGet('k1')).toEqual({ v: 1 })
  })

  it('expires a value once its TTL has passed', () => {
    cacheSet('k2', 'value', 1000)
    vi.advanceTimersByTime(1001)
    expect(cacheGet('k2')).toBeUndefined()
  })

  it('never caches null or undefined', () => {
    cacheSet('k3', null, 1000)
    cacheSet('k4', undefined, 1000)
    expect(cacheGet('k3')).toBeUndefined()
    expect(cacheGet('k4')).toBeUndefined()
  })

  describe('cached()', () => {
    it('only calls the fetcher once for repeated calls with the same key', async () => {
      const fetcher = vi.fn().mockResolvedValue('result')
      const a = await cached('k5', 1000, fetcher)
      const b = await cached('k5', 1000, fetcher)
      expect(a).toBe('result')
      expect(b).toBe('result')
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    it('calls the fetcher again once the TTL has expired', async () => {
      const fetcher = vi.fn().mockResolvedValue('result')
      await cached('k6', 1000, fetcher)
      vi.advanceTimersByTime(1001)
      await cached('k6', 1000, fetcher)
      expect(fetcher).toHaveBeenCalledTimes(2)
    })

    it('does not cache a null result, so the next call retries', async () => {
      const fetcher = vi.fn().mockResolvedValue(null)
      await cached('k7', 1000, fetcher)
      await cached('k7', 1000, fetcher)
      expect(fetcher).toHaveBeenCalledTimes(2)
    })
  })
})
