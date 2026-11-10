// 환경 계산 (Web Worker 안에서): 높이 모형, 지형 지평선, 일조시간, 개방감(SVF), 대지 하늘 그림, 높이별 가시권.
// 좌표는 대지 중심 기준 미터. 지형 높이는 대지 중심 = 0m.

import type { XY } from '../network'
import { cellAt, cellXY, convexHull, rasterize, terrainZ, type GridSpec, type LocalTerrain } from './grid'

export interface EnvBuilding {
  rings: XY[][]
  /** 높이(m) */
  h: number
}

export interface SunStep {
  /** 그 10분 구간의 가운데 시각 (자정부터 분, 한국 시각) */
  minute: number
  /** 고도·방위(나침반, 북=0 시계방향) ° */
  alt: number
  az: number
}

export const STEP_MIN = 10
export const EYE = 1.5

// ───────────────────────── 높이 모형 ─────────────────────────

export interface Model {
  g: GridSpec
  ground: Float32Array
  /** 건물 높이(지면 위 m), 건물 아니면 0 */
  bld: Float32Array
  /** 대지 안 칸 */
  site: Uint8Array
}

export function buildModel(g: GridSpec, buildings: EnvBuilding[], terrain: LocalTerrain | null, site: XY[][]): Model {
  const N = g.nx * g.ny
  const ground = new Float32Array(N)
  for (let k = 0; k < N; k++) {
    const [x, y] = cellXY(g, k)
    ground[k] = terrainZ(terrain, x, y)
  }
  const bld = new Float32Array(N)
  for (const b of buildings) rasterize(g, b.rings, (k) => (bld[k] = Math.max(bld[k], b.h)))
  const siteMask = new Uint8Array(N)
  rasterize(g, site, (k) => (siteMask[k] = 1))
  return { g, ground, bld, site: siteMask }
}

// ───────────────────────── 지형 지평선 ─────────────────────────

export const HZ_DIRS = 32

export interface Horizon extends GridSpec {
  /** [칸 × 32방위] 가장 높은 올려본각의 tan (0 이상) */
  tan: Float32Array
  flat: boolean
}

/** 지형만으로 본 지평선 (20m 칸, 3km까지). 기복이 3m 미만이면 평지로 보고 건너뜀 */
export function terrainHorizon(terrain: LocalTerrain | null, halfM: number): Horizon {
  const cell = 20
  const n = Math.ceil((halfM * 2) / cell)
  const g: GridSpec = { x0: -(n * cell) / 2, y0: (n * cell) / 2, cell, nx: n, ny: n }
  const tan = new Float32Array(n * n * HZ_DIRS)
  let lo = Infinity
  let hi = -Infinity
  if (terrain)
    for (const v of terrain.z)
      if (Number.isFinite(v)) {
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
  const flat = !terrain || !(hi - lo >= 3)
  if (flat) return { ...g, tan, flat: true }
  const dirs = Array.from({ length: HZ_DIRS }, (_, i) => {
    const a = (i * 2 * Math.PI) / HZ_DIRS
    return [Math.sin(a), Math.cos(a)] as XY
  })
  for (let k = 0; k < n * n; k++) {
    const [x, y] = cellXY(g, k)
    const z0 = terrainZ(terrain, x, y) + 1
    for (let a = 0; a < HZ_DIRS; a++) {
      const [dx, dy] = dirs[a]
      let best = 0
      for (let d = 20; d <= 3000; d += d < 500 ? 20 : 50) {
        const z = terrainZ(terrain, x + dx * d, y + dy * d)
        // 이 거리에서 가장 높은 지형이라도 지금 각을 못 넘으면 더 볼 필요 없음
        if ((hi - z0) / d <= best) break
        const t = (z - z0) / d
        if (t > best) best = t
      }
      tan[k * HZ_DIRS + a] = best
    }
  }
  return { ...g, tan, flat: false }
}

/** 칸마다 가장 가까운 지평선 칸 번호 */
function horizonIndex(h: Horizon, g: GridSpec): Int32Array {
  const idx = new Int32Array(g.nx * g.ny)
  for (let k = 0; k < idx.length; k++) {
    const [x, y] = cellXY(g, k)
    idx[k] = cellAt(h, x, y)
  }
  return idx
}

function horizonTan(h: Horizon, hk: number, az: number): number {
  if (h.flat || hk < 0) return 0
  const f = (((az % 360) + 360) % 360) / (360 / HZ_DIRS)
  const a0 = Math.floor(f) % HZ_DIRS
  const a1 = (a0 + 1) % HZ_DIRS
  const t = f - Math.floor(f)
  return h.tan[hk * HZ_DIRS + a0] * (1 - t) + h.tan[hk * HZ_DIRS + a1] * t
}

// ───────────────────────── 그림자·일조시간 ─────────────────────────

/** 이 시각의 그림자 칸 (건물 + 지형) */
export function shadowAt(m: Model, buildings: EnvBuilding[], hz: Horizon, hidx: Int32Array, step: { alt: number; az: number }, out?: Uint8Array): Uint8Array {
  const g = m.g
  const N = g.nx * g.ny
  const sh = out ?? new Uint8Array(N)
  sh.fill(0)
  if (step.alt <= 0.5) {
    sh.fill(1)
    return sh
  }
  const t = Math.tan((step.alt * Math.PI) / 180)
  const ar = (step.az * Math.PI) / 180
  const ux = -Math.sin(ar)
  const uy = -Math.cos(ar)
  const gx1 = g.x0 + g.nx * g.cell
  const gy0 = g.y0 - g.ny * g.cell
  for (const b of buildings) {
    if (b.h <= 0) continue
    const L = Math.min(b.h / t, 800)
    const pts: XY[] = []
    for (const p of b.rings[0]) {
      pts.push(p)
      pts.push([p[0] + ux * L, p[1] + uy * L])
    }
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const [x, y] of pts) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    if (maxX < g.x0 || minX > gx1 || maxY < gy0 || minY > g.y0) continue
    rasterize(g, [convexHull(pts)], (k) => (sh[k] = 1))
  }
  if (!hz.flat)
    for (let k = 0; k < N; k++) if (!sh[k] && horizonTan(hz, hidx[k], step.az) > t) sh[k] = 1
  return sh
}

export interface SunHours {
  /** 하루 일조 분 */
  minutes: Uint16Array
  /** 09~15시 가장 긴 연속 일조 분 (동지만) */
  cont0915?: Uint16Array
  /** 08~16시 일조 합계 분 (동지만) */
  total0816?: Uint16Array
}

export function sunHours(m: Model, buildings: EnvBuilding[], hz: Horizon, steps: SunStep[], extras: boolean): SunHours {
  const N = m.g.nx * m.g.ny
  const hidx = horizonIndex(hz, m.g)
  const minutes = new Uint16Array(N)
  const cont = extras ? new Uint16Array(N) : undefined
  const run = extras ? new Uint16Array(N) : undefined
  const total = extras ? new Uint16Array(N) : undefined
  const sh = new Uint8Array(N)
  for (const s of steps) {
    shadowAt(m, buildings, hz, hidx, s, sh)
    const in0915 = s.minute >= 540 && s.minute < 900
    const in0816 = s.minute >= 480 && s.minute < 960
    for (let k = 0; k < N; k++) {
      const lit = !sh[k]
      if (lit) minutes[k] += STEP_MIN
      if (extras) {
        if (in0816 && lit) total![k] += STEP_MIN
        if (in0915) {
          run![k] = lit ? run![k] + STEP_MIN : 0
          if (run![k] > cont![k]) cont![k] = run![k]
        }
      }
    }
  }
  return { minutes, cont0915: cont, total0816: total }
}

// ───────────────────────── 개방감 (SVF) ─────────────────────────

const SVF_DIRS = 16
const SVF_RANGE = 300

/** 건물 밖 칸마다 눈높이에서 하늘이 보이는 비율 (0~1, 건물 칸은 NaN) */
export function skyViewMap(m: Model, hz: Horizon): Float32Array {
  const g = m.g
  const N = g.nx * g.ny
  const out = new Float32Array(N).fill(NaN)
  const hidx = horizonIndex(hz, g)
  const dirs = Array.from({ length: SVF_DIRS }, (_, i) => {
    const a = (i * 2 * Math.PI) / SVF_DIRS
    return { dx: Math.sin(a), dy: Math.cos(a), az: (i * 360) / SVF_DIRS }
  })
  for (let k = 0; k < N; k++) {
    if (m.bld[k] > 0) continue
    const [x, y] = cellXY(g, k)
    const eye = m.ground[k] + EYE
    let s2 = 0
    for (const d of dirs) {
      let best = horizonTan(hz, hidx[k], d.az)
      for (let dist = g.cell; dist <= SVF_RANGE; dist += g.cell) {
        const kk = cellAt(g, x + d.dx * dist, y + d.dy * dist)
        if (kk < 0) break
        const t = (m.ground[kk] + m.bld[kk] - eye) / dist
        if (t > best) best = t
      }
      const beta = Math.atan(best)
      s2 += Math.sin(beta) ** 2
    }
    out[k] = 1 - s2 / SVF_DIRS
  }
  return out
}

/** 대지 가운데(0,0) 눈높이에서 1°마다 가장 높은 가림 각(°) — 건물 도형과 직접 교차 + 지형 지평선 */
export function skyDome(buildings: EnvBuilding[], terrain: LocalTerrain | null, hz: Horizon): { horizon: number[]; svf: number } {
  const eye = terrainZ(terrain, 0, 0) + EYE
  const hk = cellAt(hz, 0, 0)
  const horizon: number[] = []
  let s2 = 0
  for (let a = 0; a < 360; a++) {
    const ar = (a * Math.PI) / 180
    const dx = Math.sin(ar)
    const dy = Math.cos(ar)
    let best = horizonTan(hz, hk, a)
    for (const b of buildings) {
      for (const ring of b.rings) {
        for (let i = 1; i < ring.length; i++) {
          const [x1, y1] = ring[i - 1]
          const [x2, y2] = ring[i]
          const ex = x2 - x1
          const ey = y2 - y1
          const den = dx * ey - dy * ex
          if (Math.abs(den) < 1e-12) continue
          const tt = (x1 * ey - y1 * ex) / den
          const u = (x1 * dy - y1 * dx) / den
          if (tt <= 0.5 || u < 0 || u > 1) continue
          const top = terrainZ(terrain, dx * tt, dy * tt) + b.h
          const t = (top - eye) / tt
          if (t > best) best = t
        }
      }
    }
    const beta = Math.atan(best)
    horizon.push(Math.round(((beta * 180) / Math.PI) * 10) / 10)
    s2 += Math.sin(beta) ** 2
  }
  return { horizon, svf: 1 - s2 / 360 }
}

// ───────────────────────── 높이별 가시권 ─────────────────────────

/**
 * 건물 밖·대지 밖 칸마다: 그 칸 눈높이에서 대지 가운데 위의 점이 보이려면 대지에 몇 m 이상(대지 중심 지면 기준) 지어야 하는지.
 * 가리는 것이 없으면 0. 건물 칸·대지 칸은 NaN.
 */
export function visibleHeight(m: Model): Float32Array {
  const g = m.g
  const N = g.nx * g.ny
  const out = new Float32Array(N).fill(NaN)
  for (let k = 0; k < N; k++) {
    if (m.bld[k] > 0 || m.site[k]) continue
    const [x, y] = cellXY(g, k)
    const D = Math.hypot(x, y)
    if (D < g.cell * 2) continue
    const ux = -x / D
    const uy = -y / D
    const eye = m.ground[k] + EYE
    let need = 0
    for (let d = g.cell; d < D - g.cell; d += g.cell) {
      const kk = cellAt(g, x + ux * d, y + uy * d)
      if (kk < 0 || m.site[kk]) continue
      const z = m.ground[kk] + m.bld[kk]
      const T = eye + ((z - eye) * D) / d
      if (T > need) need = T
    }
    out[k] = need
  }
  return out
}
