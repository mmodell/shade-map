import { describe, it, expect } from 'vitest'
import { rankRoutes, rankColor } from './ranking.js'

function route(id, { distanceMeters, shadeFraction, safetyScore, pointSafety }) {
  return {
    id,
    distanceMeters,
    shade: { shadeFraction },
    safety: { score: safetyScore, pointSafety },
  }
}

describe('rankRoutes', () => {
  it('returns an empty array for no routes', () => {
    expect(rankRoutes([], { shade: 1, distance: 1, safety: 1 })).toEqual([])
  })

  it('picks the shorter route when only distance is weighted', () => {
    const routes = [
      route('long', { distanceMeters: 1000, shadeFraction: 0, safetyScore: 0.5 }),
      route('short', { distanceMeters: 500, shadeFraction: 0, safetyScore: 0.5 }),
    ]
    const ranked = rankRoutes(routes, { shade: 0, distance: 1, safety: 0 })
    expect(ranked[0].id).toBe('short')
    expect(ranked[0].rank).toBe(0)
  })

  it('picks the shadier route when only shade is weighted, even if longer', () => {
    const routes = [
      route('shady-long', { distanceMeters: 1000, shadeFraction: 0.9, safetyScore: 0.5 }),
      route('sunny-short', { distanceMeters: 500, shadeFraction: 0.1, safetyScore: 0.5 }),
    ]
    const ranked = rankRoutes(routes, { shade: 1, distance: 0, safety: 0 })
    expect(ranked[0].id).toBe('shady-long')
  })

  it('assigns sequential rank 0..n-1 in sorted order', () => {
    const routes = [
      route('a', { distanceMeters: 300, shadeFraction: 0.2, safetyScore: 0.5 }),
      route('b', { distanceMeters: 200, shadeFraction: 0.2, safetyScore: 0.5 }),
      route('c', { distanceMeters: 100, shadeFraction: 0.2, safetyScore: 0.5 }),
    ]
    const ranked = rankRoutes(routes, { shade: 0, distance: 1, safety: 0 })
    expect(ranked.map((r) => r.rank)).toEqual([0, 1, 2])
    expect(ranked.map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('rankRoutes — avoidRisk override', () => {
  const shadyButRisky = route('shady-risky', {
    distanceMeters: 400,
    shadeFraction: 0.9,
    safetyScore: 0.6,
    pointSafety: [...Array(6).fill('risk'), ...Array(4).fill('safe')], // 60% risk
  })
  const sunnyButSafe = route('sunny-safe', {
    distanceMeters: 500,
    shadeFraction: 0.2,
    safetyScore: 0.9,
    pointSafety: Array(10).fill('safe'), // 0% risk
  })
  // Sliders that would normally favor the shadier route regardless of distance.
  const shadeHeavyWeights = { shade: 0.9, distance: 0.1, safety: 0.1 }

  it('without avoidRisk, follows the sliders (shadier route wins)', () => {
    const ranked = rankRoutes([shadyButRisky, sunnyButSafe], shadeHeavyWeights, false)
    expect(ranked[0].id).toBe('shady-risky')
  })

  it('with avoidRisk, the least risky route wins regardless of the same sliders', () => {
    const ranked = rankRoutes([shadyButRisky, sunnyButSafe], shadeHeavyWeights, true)
    expect(ranked[0].id).toBe('sunny-safe')
  })

  it('exposes riskShare on each route’s scores', () => {
    const ranked = rankRoutes([shadyButRisky, sunnyButSafe], shadeHeavyWeights, true)
    const risky = ranked.find((r) => r.id === 'shady-risky')
    const safe = ranked.find((r) => r.id === 'sunny-safe')
    expect(risky.scores.riskShare).toBeCloseTo(0.6)
    expect(safe.scores.riskShare).toBe(0)
  })
})

describe('rankColor', () => {
  it('returns a distinct color for the first few ranks', () => {
    const colors = [0, 1, 2].map(rankColor)
    expect(new Set(colors).size).toBe(3)
  })

  it('does not throw for a rank beyond the palette length', () => {
    expect(() => rankColor(50)).not.toThrow()
  })
})
