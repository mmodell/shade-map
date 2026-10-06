import { N, C, W, HMAX } from './city.js'

/**
 * Is a point at (x, y, z) metres lit by light travelling from direction `dir`?
 * Exact grid DDA through the heightfield — the CPU twin of the GPU shadow ray.
 */
export function pointLit(height, x, y, z, dir) {
  if (dir[1] <= 0.002) return false
  let dx = dir[0], dz = dir[2]
  if (Math.abs(dx) < 1e-9) dx = 1e-9
  if (Math.abs(dz) < 1e-9) dz = 1e-9
  let cx = Math.floor(x / C), cz = Math.floor(z / C)
  const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1
  const tdx = C / Math.abs(dx), tdz = C / Math.abs(dz)
  let tmx = ((cx + (dx > 0 ? 1 : 0)) * C - x) / dx
  let tmz = ((cz + (dz > 0 ? 1 : 0)) * C - z) / dz
  for (let i = 0; i < 700; i++) {
    let t
    if (tmx < tmz) { t = tmx; tmx += tdx; cx += sx } else { t = tmz; tmz += tdz; cz += sz }
    if (cx < 0 || cz < 0 || cx >= N || cz >= N) return true
    const yAt = y + dir[1] * t
    if (yAt > HMAX) return true
    if (yAt < height[cz * N + cx]) return false
  }
  return true
}

/** 1 = walkable cell in direct sun, 0 = shaded / not walkable. Canopy counts as shade. */
export function sunlitMap(city, dir) {
  const { height, walk } = city
  const out = new Uint8Array(N * N)
  if (dir[1] <= 0.002) return out
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = z * N + x
    if (walk[i] <= 0) continue
    if (height[i] > 2) continue // under a tree canopy
    out[i] = pointLit(height, (x + 0.5) * C, 1.4, (z + 0.5) * C, dir) ? 1 : 0
  }
  return out
}

export { W }
