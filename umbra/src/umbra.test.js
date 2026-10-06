import { describe, it, expect } from 'vitest'
import { sunPosition, daylight, dayLabel, hourLabel } from './sun.js'
import { generateCity, N, C, MAT, snapWalkable } from './city.js'
import { pointLit, sunlitMap } from './shade.js'
import { findRoute, evaluatePath, smoothPath } from './route.js'

const deg = (r) => (r * 180) / Math.PI

describe('sun', () => {
  it('is overhead at the equator on the equinox at noon', () => {
    expect(deg(sunPosition(0, 80, 12).elevation)).toBeGreaterThan(88)
  })
  it('matches 90 - lat + declination at solar noon (40N, June solstice)', () => {
    expect(deg(sunPosition(40, 172, 12).elevation)).toBeCloseTo(73.4, 0)
  })
  it('rises in the east, sets in the west, noon sun is south in the north hemisphere', () => {
    expect(sunPosition(40, 172, 8).dir[0]).toBeGreaterThan(0)
    expect(sunPosition(40, 172, 16).dir[0]).toBeLessThan(0)
    expect(sunPosition(40, 172, 12).dir[2]).toBeGreaterThan(0) // +z = south
  })
  it('handles polar day and night', () => {
    expect(daylight(80, 172).polar).toBe('day')
    expect(daylight(80, 355).polar).toBe('night')
    const d = daylight(40, 80)
    expect(d.sunset - d.sunrise).toBeCloseTo(12, 0)
  })
  it('formats labels', () => {
    expect(dayLabel(1)).toBe('Jan 1')
    expect(dayLabel(172)).toBe('Jun 21')
    expect(hourLabel(13.5)).toBe('13:30')
  })
})

describe('city', () => {
  const city = generateCity(7)
  it('is deterministic and has walkable + solid cells', () => {
    const again = generateCity(7)
    expect(Array.from(again.mat.slice(0, 500))).toEqual(Array.from(city.mat.slice(0, 500)))
    expect(city.mat.some((m) => m === MAT.BUILDING)).toBe(true)
    expect(city.mat.some((m) => m === MAT.WATER)).toBe(true)
    expect(city.mat.some((m) => m === MAT.BRIDGE)).toBe(true)
  })
  it('only puts height on solid or canopy cells', () => {
    for (let i = 0; i < N * N; i++) {
      if (city.height[i] > 0) expect([MAT.BUILDING, MAT.TREE]).toContain(city.mat[i])
    }
  })
  it('snaps to walkable cells', () => {
    const i = city.mat.findIndex((m) => m === MAT.BUILDING)
    const s = snapWalkable(city, i % N, Math.floor(i / N))
    expect(city.walk[s[1] * N + s[0]]).toBeGreaterThan(0)
  })
})

function flatCity() {
  const height = new Float32Array(N * N)
  const walk = new Float32Array(N * N).fill(1)
  return { N, C, height, walk, mat: new Uint8Array(N * N), id: new Float32Array(N * N) }
}

describe('shade', () => {
  it('casts a shadow of length h / tan(elevation) away from the sun', () => {
    const c = flatCity()
    // 30 m tower occupying cell (100,100); sun due east, 45 degrees up -> shadow ~30 m west
    c.height[100 * N + 100] = 30
    c.walk[100 * N + 100] = 0
    const e = Math.SQRT1_2
    const dir = [e, e, 0]
    const west = (100 - 2 + 0.5) * C // ~12 m west of the tower's west face
    expect(pointLit(c.height, west, 1.4, 100.5 * C, dir)).toBe(false)
    const far = (100 - 12 + 0.5) * C
    expect(pointLit(c.height, far, 1.4, 100.5 * C, dir)).toBe(true)
    const east = (100 + 3 + 0.5) * C
    expect(pointLit(c.height, east, 1.4, 100.5 * C, dir)).toBe(true)
  })
  it('is dark when the sun is down', () => {
    const c = flatCity()
    expect(sunlitMap(c, [0, -0.5, 0.8]).every((v) => v === 0)).toBe(true)
  })
})

describe('routing', () => {
  // A wide open plane with a tall wall casting a shade stripe the long way round.
  function stripeCity() {
    const c = flatCity()
    for (let x = 60; x < 140; x++) for (let z = 100; z < 102; z++) { c.height[z * N + x] = 60; c.walk[z * N + x] = 0 }
    return c
  }
  const e = Math.SQRT1_2
  const dir = [0, e, -e] // sun from the north: wall shades the cells south of it
  const city = stripeCity()
  const map = sunlitMap(city, dir)
  const shadeAt = () => ({ map, strength: 1 })

  it('lambda 0 is the shortest path', () => {
    const r = findRoute(city, [70, 90], [130, 90], { lambda: 0, t0: 12, shadeAt })
    expect(r.length).toBe(61) // straight 60 steps
    expect(evaluatePath(city, r, 12, shadeAt).sunFraction).toBe(1)
  })
  it('shade-seeking detours into the shadow and cuts sun exposure', () => {
    const a = [70, 98], b = [130, 98] // standing in sun just north of the wall? sun is from north -> wall shades south
    const short = findRoute(city, a, b, { lambda: 0, t0: 12, shadeAt })
    const shady = findRoute(city, a, b, { lambda: 6, t0: 12, shadeAt })
    const ms = evaluatePath(city, short, 12, shadeAt)
    const mh = evaluatePath(city, shady, 12, shadeAt)
    expect(mh.sunFraction).toBeLessThan(ms.sunFraction)
    expect(mh.meters).toBeGreaterThanOrEqual(ms.meters)
  })
  it('smoothing keeps endpoints', () => {
    const r = findRoute(city, [70, 90], [75, 95], { lambda: 0, t0: 12, shadeAt })
    const p = smoothPath(r)
    expect(p[0]).toEqual([(70 + 0.5) * C, (90 + 0.5) * C])
    expect(p[p.length - 1]).toEqual([(75 + 0.5) * C, (95 + 0.5) * C])
  })
  it('can cross the generated city river', () => {
    const g = generateCity(7)
    const a = snapWalkable(g, 20, 20), b = snapWalkable(g, 200, 210)
    const r = findRoute(g, a, b, { lambda: 0, t0: 12 })
    expect(r).not.toBeNull()
  })
})
