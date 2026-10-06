import { generateCity, N, C, W, snapWalkable, cellOf } from './city.js'
import { sunPosition, daylight, dayLabel, hourLabel } from './sun.js'
import { sunlitMap } from './shade.js'
import { findRoute, evaluatePath, smoothPath, WALK_SPEED } from './route.js'
import { VERT, FRAG, RT } from './shader.js'

const $ = (id) => document.getElementById(id)
const params = new URLSearchParams(location.search)

const PLACES = [
  { name: 'Phoenix', lat: 33.4 }, { name: 'Seville', lat: 37.4 }, { name: 'Cairo', lat: 30.0 },
  { name: 'New York', lat: 40.7 }, { name: 'London', lat: 51.5 }, { name: 'Reykjavík', lat: 64.1 },
  { name: 'Singapore', lat: 1.35 }, { name: 'Sydney', lat: -33.9 },
]

const state = {
  seed: Number(params.get('seed')) || 7,
  lat: params.has('lat') ? Number(params.get('lat')) : PLACES[3].lat,
  day: Number(params.get('day')) || 172,
  hour: params.has('t') ? Number(params.get('t')) : 13,
  lambda: params.has('seek') ? Number(params.get('seek')) : 4,
  thermal: params.get('thermal') === '1',
  playing: false,
  A: null, B: null, nextPick: 'A',
}
let city = generateCity(state.seed)

// ---------------------------------------------------------------- WebGL setup
const canvas = $('gl')
const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' })
if (!gl) {
  document.body.insertAdjacentHTML('beforeend', '<div class="nogl">Umbra needs WebGL2.</div>')
  throw new Error('no webgl2')
}

function compile(type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src); gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s)
    console.error(log)
    throw new Error('shader: ' + log)
  }
  return s
}
const prog = gl.createProgram()
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
gl.linkProgram(prog)
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
gl.useProgram(prog)

const vbo = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
const aPos = gl.getAttribLocation(prog, 'aPos')
gl.enableVertexAttribArray(aPos)
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

const U = {}
for (const n of ['uMap', 'uRoute', 'uRes', 'uCam', 'uF', 'uR', 'uU', 'uTan', 'uAspect', 'uTime', 'uSun', 'uL', 'uLCol',
  'uDay', 'uTw', 'uSunStr', 'uThermal', 'uLen']) U[n] = gl.getUniformLocation(prog, n)

function makeTex(unit) {
  const t = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, t)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}
const mapTex = makeTex(0)
const routeTex = makeTex(1)
gl.uniform1i(U.uMap, 0)
gl.uniform1i(U.uRoute, 1)

function uploadCity() {
  const data = new Float32Array(N * N * 4)
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = city.height[i]
    data[i * 4 + 1] = city.mat[i]
    data[i * 4 + 2] = city.id[i]
  }
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, mapTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, N, 0, gl.RGBA, gl.FLOAT, data)
}

// ---------------------------------------------------------------- camera
const cam = { az: 0.62, el: 0.62, dist: 1250, tx: W * 0.5, tz: W * 0.5 }
const FOV_TAN = Math.tan((38 * Math.PI) / 360)
let basis = null
function updateCamera() {
  cam.el = Math.max(0.1, Math.min(1.5, cam.el))
  cam.dist = Math.max(160, Math.min(2300, cam.dist))
  const ce = Math.cos(cam.el)
  const pos = [cam.tx + cam.dist * ce * Math.sin(cam.az), cam.dist * Math.sin(cam.el), cam.tz + cam.dist * ce * Math.cos(cam.az)]
  const f = norm([cam.tx - pos[0], 0 - pos[1], cam.tz - pos[2]])
  const r = norm(cross(f, [0, 1, 0]))
  const u = cross(r, f)
  basis = { pos, f, r, u }
}
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l] }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

function rayFromPixel(px, py) {
  const w = canvas.clientWidth, h = canvas.clientHeight
  const x = (px / w) * 2 - 1, y = 1 - (py / h) * 2
  const asp = w / h
  const { f, r, u } = basis
  return norm([
    f[0] + r[0] * x * FOV_TAN * asp + u[0] * y * FOV_TAN,
    f[1] + r[1] * x * FOV_TAN * asp + u[1] * y * FOV_TAN,
    f[2] + r[2] * x * FOV_TAN * asp + u[2] * y * FOV_TAN,
  ])
}
function project(p) {
  const w = canvas.clientWidth, h = canvas.clientHeight
  const d = [p[0] - basis.pos[0], p[1] - basis.pos[1], p[2] - basis.pos[2]]
  const z = dot(d, basis.f)
  if (z <= 1) return null
  return [(dot(d, basis.r) / (z * FOV_TAN * (w / h)) + 1) * 0.5 * w, (1 - dot(d, basis.u) / (z * FOV_TAN)) * 0.5 * h, z]
}
function pickCell(px, py) {
  const rd = rayFromPixel(px, py)
  const o = basis.pos
  for (let t = 20; t < 7000; t += 2) {
    const x = o[0] + rd[0] * t, y = o[1] + rd[1] * t, z = o[2] + rd[2] * t
    if (y <= 0.5) {
      return cellOf(x, z)
    }
    if (x >= 0 && z >= 0 && x < W && z < W) {
      const [cx, cz] = cellOf(x, z)
      if (y <= city.height[cz * N + cx]) return [cx, cz]
    }
  }
  return null
}

// ---------------------------------------------------------------- sun / shade cache
let shadeCache = new Map()
let cacheKey = ''
const ZERO = new Uint8Array(N * N)
function resetShadeCache() { shadeCache = new Map(); cacheKey = `${state.seed}|${state.lat}|${state.day}` }
function shadeAt(hour) {
  const h = ((hour % 24) + 24) % 24
  const bucket = Math.round(h * 6)
  let e = shadeCache.get(bucket)
  if (!e) {
    const sp = sunPosition(state.lat, state.day, bucket / 6)
    e = sp.sinEl > 0.01
      ? { map: sunlitMap(city, sp.dir), strength: Math.min(1, sp.sinEl * 2.2) }
      : { map: ZERO, strength: 0 }
    shadeCache.set(bucket, e)
  }
  return e
}

// ---------------------------------------------------------------- routes
const routeData = new Uint8Array(RT * RT * 4)
let routes = { short: null, cool: null, shortStats: null, coolStats: null, shortPts: null, coolPts: null }

function rasterRoute(pts, chan, totalLen) {
  // chan 0 → R(mask)/G(progress); chan 1 → B/A
  const mi = chan * 2, pi = chan * 2 + 1
  const k = RT / W
  let acc = 0
  for (let s = 0; s < pts.length - 1; s++) {
    const [x0, z0] = pts[s], [x1, z1] = pts[s + 1]
    const segLen = Math.hypot(x1 - x0, z1 - z0)
    const minx = Math.max(0, Math.floor((Math.min(x0, x1) * k) - 3)), maxx = Math.min(RT - 1, Math.ceil(Math.max(x0, x1) * k) + 3)
    const minz = Math.max(0, Math.floor((Math.min(z0, z1) * k) - 3)), maxz = Math.min(RT - 1, Math.ceil(Math.max(z0, z1) * k) + 3)
    const vx = x1 - x0, vz = z1 - z0, vv = vx * vx + vz * vz || 1
    for (let tz = minz; tz <= maxz; tz++) for (let tx = minx; tx <= maxx; tx++) {
      const wx = (tx + 0.5) / k, wz = (tz + 0.5) / k
      let u = ((wx - x0) * vx + (wz - z0) * vz) / vv
      u = Math.max(0, Math.min(1, u))
      const d = Math.hypot(wx - (x0 + vx * u), wz - (z0 + vz * u))
      const m = Math.max(0, Math.min(1, 1.5 - d / 1.45)) // ~3 m wide ribbon with soft edge
      if (m <= 0) continue
      const o = (tz * RT + tx) * 4
      const v = Math.round(m * 255)
      if (v >= routeData[o + mi]) { routeData[o + mi] = v; routeData[o + pi] = Math.round(((acc + segLen * u) / totalLen) * 255) }
    }
    acc += segLen
  }
}
const polyLen = (pts) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0)

let shortCells = null, shortKey = ''
function recomputeRoutes() {
  if (!state.A || !state.B) return
  if (cacheKey !== `${state.seed}|${state.lat}|${state.day}`) resetShadeCache()
  const k = `${state.seed}|${state.A}|${state.B}`
  if (k !== shortKey) { shortCells = findRoute(city, state.A, state.B, { lambda: 0 }); shortKey = k }
  const coolCells = findRoute(city, state.A, state.B, { lambda: state.lambda, t0: state.hour, shadeAt })
  if (!shortCells || !coolCells) { routes = { short: null }; return }
  routeData.fill(0)
  const sp = smoothPath(shortCells), cp = smoothPath(coolCells)
  routes = {
    short: shortCells, cool: coolCells, shortPts: sp, coolPts: cp,
    shortStats: evaluatePath(city, shortCells, state.hour, shadeAt),
    coolStats: evaluatePath(city, coolCells, state.hour, shadeAt),
  }
  routes.lenS = polyLen(sp); routes.lenC = polyLen(cp)
  rasterRoute(sp, 0, routes.lenS)
  rasterRoute(cp, 1, routes.lenC)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, routeTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, RT, RT, 0, gl.RGBA, gl.UNSIGNED_BYTE, routeData)
  renderStats()
}

function fmtMin(sec) { const m = sec / 60; return m < 10 ? m.toFixed(1) + ' min' : Math.round(m) + ' min' }
function renderStats() {
  const { shortStats: s, coolStats: c } = routes
  if (!s || !c) { $('stats').innerHTML = '<p class="hint">No walkable route between those points.</p>'; return }
  const sp = sunPosition(state.lat, state.day, state.hour)
  const sunUp = sp.sinEl > 0.01
  const pct = (x) => Math.round(x * 100)
  const card = (cls, name, st) => `
    <div class="card ${cls}">
      <div class="name"><i></i>${name}</div>
      <div class="big">${fmtMin(st.seconds)}<small>${Math.round(st.meters)} m</small></div>
      <div class="bar"><b style="width:${pct(st.sunFraction)}%"></b></div>
      <div class="sub">${sunUp ? `☀ ${pct(st.sunFraction)}% in direct sun` : '☾ sun is down'}</div>
    </div>`
  let verdict
  if (!sunUp) verdict = 'The sun is down — both routes are equally cool. Slide the clock to daytime.'
  else if (c.meters - s.meters < 3 && s.sunFraction - c.sunFraction < 0.03) verdict = 'The shortest path is already about as shady as it gets right now.'
  else {
    const extra = Math.max(0, c.seconds - s.seconds)
    verdict = `Take the cool route: <b>+${fmtMin(extra)}</b> buys <b>−${pct(Math.max(0, s.sunFraction - c.sunFraction))}%</b> sun.`
  }
  $('stats').innerHTML = card('short', 'Shortest', s) + card('cool', 'Coolest', c) + `<p class="verdict">${verdict}</p>`
}

// ---------------------------------------------------------------- the shade-flip chart
let chart = { key: '', samples: [], token: 0, ready: false }
const STEP = 1 / 3
function scheduleChart() {
  clearTimeout(scheduleChart.t)
  scheduleChart.t = setTimeout(runChart, 250)
}
function runChart() {
  if (!state.A || !state.B) return
  if (cacheKey !== `${state.seed}|${state.lat}|${state.day}`) resetShadeCache()
  const token = ++chart.token
  chart.ready = false
  chart.samples = []
  const sCells = findRoute(city, state.A, state.B, { lambda: 0 })
  let h = 0
  const tick = () => {
    if (token !== chart.token) return
    const t0 = performance.now()
    while (h <= 24 + 1e-6 && performance.now() - t0 < 14) {
      const sp = sunPosition(state.lat, state.day, h)
      let short = 0, cool = 0, extra = 0
      if (sp.sinEl > 0.01) {
        const cc = findRoute(city, state.A, state.B, { lambda: state.lambda, t0: h, shadeAt })
        const es = evaluatePath(city, sCells, h, shadeAt), ec = evaluatePath(city, cc, h, shadeAt)
        short = es.sunFraction; cool = ec.sunFraction; extra = (ec.meters - es.meters) / WALK_SPEED
      }
      chart.samples.push({ h, short, cool, extra, up: sp.sinEl > 0.01 })
      h += STEP
    }
    drawChart()
    if (h <= 24 + 1e-6) setTimeout(tick, 0)
    else { chart.ready = true; drawChart(); renderBest() }
  }
  tick()
}
function renderBest() {
  const up = chart.samples.filter((s) => s.up)
  if (!up.length) { $('best').textContent = ''; return }
  let best = up[0]
  for (const s of up) if (s.short - s.cool > best.short - best.cool) best = s
  const gain = Math.round((best.short - best.cool) * 100)
  $('best').innerHTML = gain >= 3
    ? `Biggest shade payoff at <b>${hourLabel(best.h)}</b> — the cool route skips <b>${gain}%</b> of the sun`
    : `On this walk the shortest route is nearly always as shady as any other`
}

const cv = $('chart')
function drawChart() {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = cv.clientWidth, h = cv.clientHeight
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
  const g = cv.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  const S = chart.samples
  if (!S.length) return
  const X = (hr) => (hr / 24) * w
  const Y = (v) => h - 4 - v * (h - 10)
  const area = (key, color) => {
    g.beginPath(); g.moveTo(X(S[0].h), Y(0))
    for (const s of S) g.lineTo(X(s.h), Y(s[key]))
    g.lineTo(X(S[S.length - 1].h), Y(0)); g.closePath()
    g.fillStyle = color; g.fill()
  }
  const line = (key, color) => {
    g.beginPath()
    S.forEach((s, i) => (i ? g.lineTo(X(s.h), Y(s[key])) : g.moveTo(X(s.h), Y(s[key]))))
    g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke()
  }
  area('short', 'rgba(255,128,40,0.20)')
  area('cool', 'rgba(60,255,200,0.22)')
  line('short', '#ff8228'); line('cool', '#3cffc8')
  // gridlines
  g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1
  for (const v of [0.5, 1]) { g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(w, Y(v)); g.stroke() }
}

// ---------------------------------------------------------------- timeline strip
function drawTimeline() {
  const c = $('daystrip')
  const w = c.clientWidth || 600, h = 14
  c.width = w; c.height = h
  const g = c.getContext('2d')
  for (let x = 0; x < w; x++) {
    const sp = sunPosition(state.lat, state.day, (x / w) * 24)
    const e = sp.sinEl
    let col
    if (e > 0.25) col = [255, 222, 120]
    else if (e > 0.02) { const k = (e - 0.02) / 0.23; col = [255, 120 + k * 100, 40 + k * 80] }
    else if (e > -0.2) { const k = (e + 0.2) / 0.22; col = [28 + k * 140, 30 + k * 40, 70 + k * 10] }
    else col = [10, 14, 34]
    g.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`
    g.fillRect(x, 0, 1, h)
  }
}

// ---------------------------------------------------------------- frame
let sunNow = null
function sunUniforms() {
  const sp = sunPosition(state.lat, state.day, state.hour)
  const e = sp.sinEl
  const day = smoothstep(-0.14, 0.18, e)
  const tw = Math.exp(-(((e - 0.0) / 0.13) ** 2)) * 0.9
  const sunI = smoothstep(0.0, 0.12, e)
  const moonDir = [-sp.dir[0], -sp.dir[1], -sp.dir[2]]
  const moonI = smoothstep(0.0, 0.2, -e) * 0.26 * (1 - sunI)
  const warm = smoothstep(0.0, 0.35, e)
  const sc = [1.0, 0.42 + 0.52 * warm, 0.18 + 0.7 * warm]
  let L, col
  if (e > 0) { L = sp.dir; col = sc.map((v) => v * 3.4 * sunI) }
  else { L = moonDir; col = [0.45 * moonI * 3.2, 0.58 * moonI * 3.2, 1.0 * moonI * 3.2] }
  sunNow = { sp, day, tw, L, col, str: Math.min(1, Math.max(0, e * 2.2)) }
}
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

let scale = 0.75
let maxScale = Math.min(window.devicePixelRatio || 1, 1.5)
let startT = performance.now()
function resize() {
  const w = Math.max(2, Math.round(canvas.clientWidth * scale)), h = Math.max(2, Math.round(canvas.clientHeight * scale))
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
  const ov = $('ov'), dpr = Math.min(2, window.devicePixelRatio || 1)
  const ow = Math.round(ov.clientWidth * dpr), oh = Math.round(ov.clientHeight * dpr)
  if (ov.width !== ow) { ov.width = ow; ov.height = oh }
}
function draw(time) {
  resize()
  updateCamera(); sunUniforms()
  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.uniform2f(U.uRes, canvas.width, canvas.height)
  gl.uniform3fv(U.uCam, basis.pos); gl.uniform3fv(U.uF, basis.f); gl.uniform3fv(U.uR, basis.r); gl.uniform3fv(U.uU, basis.u)
  gl.uniform1f(U.uTan, FOV_TAN); gl.uniform1f(U.uAspect, canvas.width / canvas.height)
  gl.uniform1f(U.uTime, (time - startT) / 1000)
  gl.uniform3fv(U.uSun, sunNow.sp.dir); gl.uniform3fv(U.uL, sunNow.L); gl.uniform3fv(U.uLCol, sunNow.col)
  gl.uniform1f(U.uDay, sunNow.day); gl.uniform1f(U.uTw, sunNow.tw); gl.uniform1f(U.uSunStr, sunNow.str)
  gl.uniform1f(U.uThermal, state.thermal ? 1 : 0)
  gl.uniform2f(U.uLen, routes.lenS || 1, routes.lenC || 1)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  drawOverlay()
}

function drawOverlay() {
  const ov = $('ov'), g = ov.getContext('2d')
  const dpr = ov.width / Math.max(1, ov.clientWidth)
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, ov.clientWidth, ov.clientHeight)
  const pin = (cellPt, label, color) => {
    if (!cellPt) return
    const wx = (cellPt[0] + 0.5) * C, wz = (cellPt[1] + 0.5) * C
    const a = project([wx, 0, wz]), b = project([wx, 46, wz])
    if (!a || !b) return
    g.strokeStyle = color; g.lineWidth = 2
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke()
    g.fillStyle = color
    g.beginPath(); g.arc(b[0], b[1], 13, 0, 7); g.fill()
    g.fillStyle = '#071018'; g.font = '700 14px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(label, b[0], b[1] + 0.5)
    g.beginPath(); g.arc(a[0], a[1], 4, 0, 7); g.fillStyle = color; g.fill()
  }
  pin(state.A, 'A', '#ffd966'); pin(state.B, 'B', '#ff7ab8')
}

let last = performance.now(), ema = 16, routeAt = 0
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  ema = ema * 0.92 + dt * 1000 * 0.08
  if (state.playing) {
    state.hour = (state.hour + dt * (24 / 40)) % 24
    syncTimeUI()
    if (now - routeAt > 180) { routeAt = now; recomputeRoutes() }
  }
  if (ema > 36 && scale > 0.35) { scale *= 0.92; ema = 24 }
  else if (ema < 19 && scale < maxScale) { scale = Math.min(maxScale, scale * 1.04) }
  draw(now)
  requestAnimationFrame(frame)
}

// ---------------------------------------------------------------- UI
function syncTimeUI() {
  $('time').value = state.hour
  $('clock').textContent = hourLabel(state.hour)
  const sp = sunPosition(state.lat, state.day, state.hour)
  const el = (sp.elevation * 180) / Math.PI
  $('sunmeta').textContent = el > 0 ? `sun ${Math.round(el)}° up` : 'sun below horizon'
  $('playhead').style.left = (state.hour / 24) * 100 + '%'
  document.documentElement.dataset.night = el < -1 ? '1' : '0'
}
function syncDayUI() {
  $('day').value = state.day
  $('daylabel').textContent = dayLabel(state.day)
  const d = daylight(state.lat, state.day)
  $('daylight').textContent = d.polar === 'day' ? 'midnight sun' : d.polar === 'night' ? 'polar night'
    : `${hourLabel(d.sunrise)} → ${hourLabel(d.sunset)}`
  drawTimeline()
}

function setPoint(which, cell) {
  const s = snapWalkable(city, cell[0], cell[1])
  if (!s) return
  state[which] = s
  state.nextPick = which === 'A' ? 'B' : 'A'
  $('hint').classList.add('gone')
  recomputeRoutes(); scheduleChart()
}

function randomPair() {
  const rng = (a, b) => a + Math.random() * (b - a)
  for (let tries = 0; tries < 50; tries++) {
    const a = snapWalkable(city, Math.floor(rng(0.08, 0.35) * N), Math.floor(rng(0.55, 0.92) * N))
    const b = snapWalkable(city, Math.floor(rng(0.65, 0.92) * N), Math.floor(rng(0.08, 0.5) * N))
    if (a && b && findRoute(city, a, b, { lambda: 0 })) { state.A = a; state.B = b; return }
  }
}

function init() {
  uploadCity()
  const sel = $('place')
  PLACES.forEach((p, i) => sel.insertAdjacentHTML('beforeend', `<option value="${i}">${p.name} · ${p.lat > 0 ? p.lat + '°N' : -p.lat + '°S'}</option>`))
  const idx = PLACES.findIndex((p) => p.lat === state.lat)
  sel.value = idx >= 0 ? idx : 3
  $('seek').value = state.lambda
  $('thermalBtn').classList.toggle('on', state.thermal)

  sel.oninput = () => { state.lat = PLACES[sel.value].lat; resetShadeCache(); syncDayUI(); syncTimeUI(); recomputeRoutes(); scheduleChart() }
  $('day').oninput = (e) => { state.day = Number(e.target.value); resetShadeCache(); syncDayUI(); syncTimeUI(); recomputeRoutes(); scheduleChart() }
  $('time').oninput = (e) => { state.hour = Number(e.target.value); state.playing = false; $('play').classList.remove('on'); syncTimeUI(); recomputeRoutes() }
  $('seek').oninput = (e) => { state.lambda = Number(e.target.value); recomputeRoutes(); scheduleChart() }
  $('play').onclick = () => { state.playing = !state.playing; $('play').classList.toggle('on', state.playing) }
  $('thermalBtn').onclick = () => { state.thermal = !state.thermal; $('thermalBtn').classList.toggle('on', state.thermal) }
  $('swap').onclick = () => { [state.A, state.B] = [state.B, state.A]; shortKey = ''; recomputeRoutes(); scheduleChart() }
  $('reroll').onclick = () => {
    state.seed = Math.floor(Math.random() * 9000) + 1
    city = generateCity(state.seed); uploadCity(); resetShadeCache(); shortKey = ''
    randomPair(); recomputeRoutes(); scheduleChart()
  }
  $('menu').onclick = () => $('panel').classList.toggle('open')
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
    if (e.key === ' ') { e.preventDefault(); $('play').click() }
    else if (e.key === 't' || e.key === 'T') $('thermalBtn').click()
    else if (e.key === 'ArrowLeft') { state.hour = (state.hour + 23.75) % 24; syncTimeUI(); recomputeRoutes() }
    else if (e.key === 'ArrowRight') { state.hour = (state.hour + 0.25) % 24; syncTimeUI(); recomputeRoutes() }
  })

  // pointer: drag = orbit, shift/right/two-finger = pan, wheel/pinch = zoom, tap = place pin
  const pts = new Map()
  let moved = 0, pinch = 0
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; pinch = 0 })
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return
    const p = pts.get(e.pointerId)
    const dx = e.clientX - p[0], dy = e.clientY - p[1]
    pts.set(e.pointerId, [e.clientX, e.clientY]); moved += Math.abs(dx) + Math.abs(dy)
    if (pts.size === 2) {
      const [a, b] = [...pts.values()]
      const d = Math.hypot(a[0] - b[0], a[1] - b[1])
      if (pinch) cam.dist *= pinch / d
      pinch = d
      panBy(dx * 0.5, dy * 0.5)
    } else if (e.shiftKey || e.buttons === 2) panBy(dx, dy)
    else { cam.az -= dx * 0.006; cam.el += dy * 0.005 }
  })
  const up = (e) => {
    if (pts.size === 1 && moved < 6) { const c = pickCell(e.offsetX, e.offsetY); if (c) setPoint(state.nextPick, c) }
    pts.delete(e.pointerId); pinch = 0
  }
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId) })
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist *= Math.exp(e.deltaY * 0.0012) }, { passive: false })
  addEventListener('resize', () => { drawTimeline(); drawChart() })

  if (!state.A) randomPairDefault()
  syncDayUI(); syncTimeUI()
  recomputeRoutes(); scheduleChart()
  requestAnimationFrame(frame)
}
function panBy(dx, dy) {
  const k = cam.dist * 0.0014
  const rx = Math.cos(cam.az), rz = -Math.sin(cam.az)
  const fx = -Math.sin(cam.az), fz = -Math.cos(cam.az)
  cam.tx = Math.max(0, Math.min(W, cam.tx - dx * k * rx - dy * k * fx * -1 * -1))
  cam.tz = Math.max(0, Math.min(W, cam.tz - dx * k * rz - dy * k * fz * -1 * -1))
}
function randomPairDefault() {
  state.A = snapWalkable(city, Math.floor(0.12 * N), Math.floor(0.82 * N))
  state.B = snapWalkable(city, Math.floor(0.86 * N), Math.floor(0.16 * N))
  $('hint').classList.remove('gone')
}

// test/debug hook
window.__umbra = { state, cam, draw: () => draw(performance.now()), recompute: recomputeRoutes, get routes() { return routes }, get chart() { return chart }, syncTimeUI, syncDayUI, scheduleChart }
init()
