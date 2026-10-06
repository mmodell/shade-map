import { N, C } from './city.js'

const SQ2 = Math.SQRT2
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2],
]

class Heap {
  constructor() { this.k = []; this.v = [] }
  get size() { return this.k.length }
  push(key, val) {
    const k = this.k, v = this.v
    let i = k.length
    k.push(key); v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= key) break
      k[i] = k[p]; v[i] = v[p]; i = p
    }
    k[i] = key; v[i] = val
  }
  pop() {
    const k = this.k, v = this.v
    const top = v[0], lk = k.pop(), lv = v.pop()
    const n = k.length
    if (n > 0) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && k[c + 1] < k[c]) c++
        if (k[c] >= lk) break
        k[i] = k[c]; v[i] = v[c]; i = c
      }
      k[i] = lk; v[i] = lv
    }
    return top
  }
}

export const WALK_SPEED = 1.4 // m/s

/**
 * Time-aware shade-seeking route.
 *   a, b      : [cellX, cellZ]
 *   opts.lambda  : how much a metre in full sun "costs" extra (0 = plain shortest path)
 *   opts.t0      : departure, solar hours
 *   opts.shadeAt : (hour) => { map: Uint8Array, strength: 0..1 }   (strength 0 → sun is down)
 * Cost uses the shade at the moment the walker *arrives* at each cell, so the route
 * leans on shadows that will exist by the time you get there.
 */
export function findRoute(city, a, b, opts) {
  const { walk } = city
  const { lambda = 0, t0 = 12, shadeAt } = opts
  const total = N * N
  const cost = new Float64Array(total).fill(Infinity)
  const meters = new Float32Array(total)
  const prev = new Int32Array(total).fill(-1)
  const done = new Uint8Array(total)
  const start = a[1] * N + a[0], goal = b[1] * N + b[0]
  if (walk[start] <= 0 || walk[goal] <= 0) return null
  cost[start] = 0
  const heap = new Heap()
  heap.push(0, start)
  const useSun = lambda > 0 && shadeAt
  while (heap.size) {
    const u = heap.pop()
    if (done[u]) continue
    done[u] = 1
    if (u === goal) break
    const ux = u % N, uz = (u - ux) / N
    let map = null, strength = 0
    if (useSun) {
      const s = shadeAt(t0 + meters[u] / WALK_SPEED / 3600)
      map = s.map; strength = s.strength
    }
    for (let d = 0; d < 8; d++) {
      const dx = DIRS[d][0], dz = DIRS[d][1]
      const vx = ux + dx, vz = uz + dz
      if (vx < 0 || vz < 0 || vx >= N || vz >= N) continue
      const v = vz * N + vx
      if (done[v] || walk[v] <= 0) continue
      if (dx !== 0 && dz !== 0 && (walk[uz * N + vx] <= 0 || walk[vz * N + ux] <= 0)) continue
      const len = DIRS[d][2] * C
      let step = len * (walk[u] + walk[v]) * 0.5
      if (map && map[v]) step *= 1 + lambda * strength
      const nc = cost[u] + step
      if (nc < cost[v]) { cost[v] = nc; meters[v] = meters[u] + len; prev[v] = u; heap.push(nc, v) }
    }
  }
  if (!isFinite(cost[goal])) return null
  const cells = []
  for (let c = goal; c !== -1; c = prev[c]) cells.push([c % N, Math.floor(c / N)])
  cells.reverse()
  return cells
}

/** Walk a path and total up distance, time and time spent in direct sun. */
export function evaluatePath(city, cells, t0, shadeAt) {
  let meters = 0, sunMeters = 0, dose = 0
  for (let i = 1; i < cells.length; i++) {
    const [x0, z0] = cells[i - 1], [x1, z1] = cells[i]
    const len = Math.hypot(x1 - x0, z1 - z0) * C
    const s = shadeAt(t0 + meters / WALK_SPEED / 3600)
    if (s.map[z1 * N + x1]) { sunMeters += len; dose += len * s.strength }
    meters += len
  }
  return {
    meters,
    seconds: meters / WALK_SPEED,
    sunFraction: meters ? sunMeters / meters : 0,
    sunSeconds: sunMeters / WALK_SPEED,
    dose: dose / WALK_SPEED,
  }
}

/** Cell path → smooth world-space polyline (Chaikin corner cutting). */
export function smoothPath(cells, iterations = 2) {
  let pts = cells.map(([x, z]) => [(x + 0.5) * C, (z + 0.5) * C])
  if (pts.length < 3) return pts
  for (let it = 0; it < iterations; it++) {
    const out = [pts[0]]
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1]
      out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]])
      out.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]])
    }
    out.push(pts[pts.length - 1])
    pts = out
  }
  return pts
}
