// Procedural city. Everything is a heightfield on an N×N grid of C-metre cells,
// which is what lets the GPU and the CPU shadow-cast the same geometry.

export const N = 224
export const C = 6 // metres per cell
export const W = N * C // 1344 m across
export const HMAX = 140

export const MAT = {
  ROAD: 0, BUILDING: 1, PARK: 2, TREE: 3, PLAZA: 4, SIDEWALK: 5, WATER: 6, BRIDGE: 7,
}

// Walking cost multiplier per material; 0 = not walkable.
export const WALK_COST = [1.7, 0, 1, 1, 1, 1, 0, 1]

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function bands(rand, total, avenueEvery) {
  // returns [{start, w, avenue}] street bands and block intervals between them
  const streets = []
  const blocks = []
  let pos = 0
  let idx = 0
  while (pos < total) {
    const avenue = idx % avenueEvery === avenueEvery - 1
    const w = avenue ? 5 : 3
    if (pos + w >= total) { streets.push({ start: pos, w: Math.min(w, total - pos) }); break }
    streets.push({ start: pos, w })
    pos += w
    const bs = 8 + Math.floor(rand() * 6)
    if (pos + bs >= total - 3) { blocks.push([pos, total - 1]); streets.push({ start: total - 1, w: 1 }); break }
    blocks.push([pos, pos + bs])
    pos += bs
    idx++
  }
  return { streets, blocks }
}

export function generateCity(seed = 7) {
  const rand = mulberry32(seed)
  const mat = new Uint8Array(N * N).fill(MAT.ROAD)
  const height = new Float32Array(N * N)
  const id = new Float32Array(N * N)
  const ix = (x, z) => z * N + x

  const bx = bands(rand, N, 4)
  const bz = bands(rand, N, 4)

  // street bands: local index tells sidewalk (edge) from road (interior)
  const bandX = new Int16Array(N).fill(-1) // -1 = not a street column
  const bandZ = new Int16Array(N).fill(-1)
  const edgeX = new Uint8Array(N)
  const edgeZ = new Uint8Array(N)
  for (const s of bx.streets) for (let k = 0; k < s.w; k++) { bandX[s.start + k] = k; edgeX[s.start + k] = k === 0 || k === s.w - 1 ? 1 : 0 }
  for (const s of bz.streets) for (let k = 0; k < s.w; k++) { bandZ[s.start + k] = k; edgeZ[s.start + k] = k === 0 || k === s.w - 1 ? 1 : 0 }

  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const inX = bandX[x] >= 0, inZ = bandZ[z] >= 0
    if (inX && inZ) mat[ix(x, z)] = edgeX[x] && edgeZ[z] ? MAT.SIDEWALK : MAT.ROAD
    else if (inX) mat[ix(x, z)] = edgeX[x] ? MAT.SIDEWALK : MAT.ROAD
    else if (inZ) mat[ix(x, z)] = edgeZ[z] ? MAT.SIDEWALK : MAT.ROAD
  }

  const cx = N * 0.46, cz = N * 0.5
  const downtown = (x, z) => Math.exp(-(((x - cx) / (N * 0.26)) ** 2 + ((z - cz) / (N * 0.26)) ** 2))
  let nextId = 1

  function lot(x0, z0, x1, z1, d) {
    // x1,z1 exclusive
    const w = x1 - x0, h = z1 - z0
    const splitAxis = w >= h ? 0 : 1
    const len = splitAxis === 0 ? w : h
    if (len >= 9 && rand() < 0.85) {
      const cut = 3 + Math.floor(rand() * (len - 6))
      const open = rand() < 0.55
      if (splitAxis === 0) {
        lot(x0, z0, x0 + cut, z1, d)
        lot(x0 + cut + 1, z0, x1, z1, d)
        for (let z = z0; z < z1; z++) mat[ix(x0 + cut, z)] = open ? MAT.SIDEWALK : MAT.BUILDING
        if (!open) for (let z = z0; z < z1; z++) { height[ix(x0 + cut, z)] = 6 + rand() * 6; id[ix(x0 + cut, z)] = nextId++ }
      } else {
        lot(x0, z0, x1, z0 + cut, d)
        lot(x0, z0 + cut + 1, x1, z1, d)
        for (let x = x0; x < x1; x++) mat[ix(x, z0 + cut)] = open ? MAT.SIDEWALK : MAT.BUILDING
        if (!open) for (let x = x0; x < x1; x++) { height[ix(x, z0 + cut)] = 6 + rand() * 6; id[ix(x, z0 + cut)] = nextId++ }
      }
      return
    }
    const dt = downtown((x0 + x1) / 2, (z0 + z1) / 2)
    let H = 9 + rand() * 12 + Math.pow(dt, 1.4) * (20 + rand() * 105) * (rand() < 0.15 ? 1.35 : 0.8 + rand() * 0.4)
    H = Math.min(HMAX - 8, H)
    const bid = nextId++
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const ring = x === x0 || z === z0 || x === x1 - 1 || z === z1 - 1
      mat[ix(x, z)] = MAT.BUILDING
      height[ix(x, z)] = ring && w >= 5 && h >= 5 && H > 34 ? H * 0.5 : H
      id[ix(x, z)] = bid
    }
  }

  function park(x0, z0, x1, z1, plaza) {
    const midX = Math.floor((x0 + x1) / 2), midZ = Math.floor((z0 + z1) / 2)
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const onPath = x === midX || z === midZ
      mat[ix(x, z)] = plaza ? MAT.PLAZA : onPath ? MAT.SIDEWALK : MAT.PARK
      if (!onPath && rand() < (plaza ? 0.06 : 0.34)) {
        mat[ix(x, z)] = MAT.TREE
        height[ix(x, z)] = 6 + rand() * 7
        id[ix(x, z)] = rand()
      }
    }
  }

  for (let bi = 0; bi < bx.blocks.length; bi++) for (let bj = 0; bj < bz.blocks.length; bj++) {
    const [x0, x1] = bx.blocks[bi], [z0, z1] = bz.blocks[bj]
    const r = rand()
    const dt = downtown((x0 + x1) / 2, (z0 + z1) / 2)
    if (r < 0.13 && dt < 0.7) park(x0, z0, x1, z1, false)
    else if (r < 0.19) park(x0, z0, x1, z1, true)
    else lot(x0, z0, x1, z1, dt)
  }

  // river with bridges where N-S streets cross it
  const riverZ = (x) => N * 0.62 + Math.sin(x / 31) * 9 + Math.sin(x / 11) * 2
  for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) {
    if (Math.abs(z - riverZ(x)) < 3.2) {
      const bridge = bandX[x] >= 0
      mat[ix(x, z)] = bridge ? MAT.BRIDGE : MAT.WATER
      height[ix(x, z)] = 0
      id[ix(x, z)] = 0
    }
  }
  // a promenade along the river banks so it's not just building walls
  for (let x = 1; x < N - 1; x++) for (let z = 1; z < N - 1; z++) {
    if (mat[ix(x, z)] !== MAT.BUILDING) continue
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (mat[ix(x + dx, z + dz)] === MAT.WATER) { mat[ix(x, z)] = MAT.SIDEWALK; height[ix(x, z)] = 0; id[ix(x, z)] = 0 }
    }
  }

  const walk = new Float32Array(N * N)
  for (let i = 0; i < N * N; i++) walk[i] = WALK_COST[mat[i]]

  return { N, C, W, seed, mat, height, id, walk }
}

export function cellOf(x, z) {
  return [Math.min(N - 1, Math.max(0, Math.floor(x / C))), Math.min(N - 1, Math.max(0, Math.floor(z / C)))]
}

/** Nearest walkable cell (spiral search) to a cell, or null. */
export function snapWalkable(city, cx, cz, maxR = 12) {
  const { walk } = city
  if (cx >= 0 && cx < N && cz >= 0 && cz < N && walk[cz * N + cx] > 0) return [cx, cz]
  let best = null, bd = Infinity
  for (let r = 1; r <= maxR; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, z = cz + dz
      if (x < 0 || z < 0 || x >= N || z >= N || walk[z * N + x] <= 0) continue
      const d = dx * dx + dz * dz
      if (d < bd) { bd = d; best = [x, z] }
    }
    if (best) return best
  }
  return null
}
