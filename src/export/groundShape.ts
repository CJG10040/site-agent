// 3D 모형 땅 다듬기 (2026-11-16 사용자 결정 — 하천: 물·둔치 나누기, 도로: 매끈한 면 + 땅 맞춤).
// 지형 격자(해발, EPSG:5179) 사본에서 모형 범위만 고친다. 도판·환경 계산이 쓰는 원래 지형은 그대로.
//  - 물: 물 면 안 칸마다 가까운(40m) 물가 땅 중 가장 낮은 곳 → 하천을 따라 넓게(12m) 고르게 한 것이 물 높이. 물 밑 땅은 물 높이 - 0.6m로 파냄
//    (예전: 물 면을 울퉁불퉁한 하천 바닥에 그대로 얹어 둑을 넘나들었고, 같은 하천을 자료 4개가 겹쳐 그림)
//  - 도로: 도로 면 안 높이를 넓게(약 18m) 평균한 매끈한 면으로 바꾸고, 도로 밖 4m는 원래 땅으로 서서히 이음.
//    정밀도로지도 노면 실측 높이(5m 칸)가 있으면 그 칸은 6배 무게 — 지형과의 높이 기준 차이(중앙값)를 먼저 빼고, 2.5m 넘게 어긋난 점(고가·지하차도)은 뺌.
//    교량 상판 밑은 고르지 않음 (하천 바닥이 그대로 보이게).

import type { TerrainGrid } from '../lib/terrain'

type XY = [number, number]
interface Poly {
  outer: XY[]
  holes: XY[][]
}

export interface ShapeInput {
  X0: number
  Y0: number
  half: number
  roads: Poly[]
  /** 땅을 고르지 않을 곳 (교량 상판 밑) */
  noRoad: Poly[]
  water: Poly[]
  /** 정밀도로지도 노면 높이 (모형 좌표 x·y, 높이는 자료 그대로) */
  hd: { x: number; y: number; z: number }[]
}

export interface ShapeResult {
  grid: TerrainGrid
  /** 물 높이 (해발). 물 면 근처가 아니면 null */
  waterLevel: (x: number, y: number) => number | null
  stats: { roadCells: number; waterCells: number; hdCells: number; hdOffset: number | null }
}

const MARGIN = 40
const WATER_DEPTH = 0.6
const BLEND = 4

/** 가로·세로 상자 흐림 (밖은 0) — 무게를 같이 흐려 나누면 정규화된 평균 */
function boxBlur(src: Float32Array, W: number, H: number, rad: number): Float32Array {
  const tmp = new Float32Array(W * H)
  const out = new Float32Array(W * H)
  for (let r = 0; r < H; r++) {
    let s = 0
    const o = r * W
    for (let c = 0; c <= Math.min(rad, W - 1); c++) s += src[o + c]
    for (let c = 0; c < W; c++) {
      tmp[o + c] = s
      const add = c + rad + 1
      const sub = c - rad
      if (add < W) s += src[o + add]
      if (sub >= 0) s -= src[o + sub]
    }
  }
  for (let c = 0; c < W; c++) {
    let s = 0
    for (let r = 0; r <= Math.min(rad, H - 1); r++) s += tmp[r * W + c]
    for (let r = 0; r < H; r++) {
      out[r * W + c] = s
      const add = r + rad + 1
      const sub = r - rad
      if (add < H) s += tmp[add * W + c]
      if (sub >= 0) s -= tmp[sub * W + c]
    }
  }
  return out
}

export function shapeGround(g: TerrainGrid, inp: ShapeInput): ShapeResult {
  const { X0, Y0, half } = inp
  const cell = g.cell
  const c0 = Math.max(0, Math.floor((X0 - half - MARGIN - g.x0) / cell))
  const c1 = Math.min(g.nx - 1, Math.ceil((X0 + half + MARGIN - g.x0) / cell))
  const r0 = Math.max(0, Math.floor((g.y0 - (Y0 + half + MARGIN)) / cell))
  const r1 = Math.min(g.ny - 1, Math.ceil((g.y0 - (Y0 - half - MARGIN)) / cell))
  const W = c1 - c0 + 1
  const H = r1 - r0 + 1
  const none: ShapeResult = { grid: g, waterLevel: () => null, stats: { roadCells: 0, waterCells: 0, hdCells: 0, hdOffset: null } }
  if (W < 3 || H < 3) return none
  const N = W * H
  // 칸 가운데 (모형 좌표)
  const ly = (r: number) => g.y0 - (r0 + r + 0.5) * cell - Y0
  const colOf = (x: number) => (x + X0 - g.x0) / cell - 0.5 - c0
  const rowOf = (y: number) => (g.y0 - Y0 - y) / cell - 0.5 - r0
  const Z0 = new Float32Array(N)
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) Z0[r * W + c] = g.z[(r0 + r) * g.nx + c0 + c]
  const Z = Z0.slice()

  /** 면 → 칸 (칸 가운데가 안에 있으면 val, 홀짝 규칙이라 구멍도 바르게) */
  const raster = (polys: Poly[], mask: Uint8Array, val: number) => {
    for (const p of polys) {
      const rings = [p.outer, ...p.holes]
      let ymin = Infinity
      let ymax = -Infinity
      for (const [, y] of p.outer) {
        if (y < ymin) ymin = y
        if (y > ymax) ymax = y
      }
      const ra = Math.max(0, Math.ceil(rowOf(ymax)))
      const rb = Math.min(H - 1, Math.floor(rowOf(ymin)))
      for (let r = ra; r <= rb; r++) {
        const y = ly(r)
        const xs: number[] = []
        for (const ring of rings)
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [ax, ay] = ring[j]
            const [bx, by] = ring[i]
            if (ay > y !== by > y) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay))
          }
        xs.sort((a, b) => a - b)
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const ca = Math.max(0, Math.ceil(colOf(xs[k])))
          const cb = Math.min(W - 1, Math.floor(colOf(xs[k + 1])))
          for (let c = ca; c <= cb; c++) mask[r * W + c] = val
        }
      }
    }
  }

  // ── 물
  const mW = new Uint8Array(N)
  raster(inp.water, mW, 1)
  let waterCells = 0
  for (let i = 0; i < N; i++) if (mW[i] && Number.isFinite(Z0[i])) waterCells++
  const level = new Float32Array(N).fill(NaN)
  if (waterCells) {
    // 물 높이 = 가까운(40m) 물가 땅(물 면 바로 바깥 칸) 중 가장 낮은 곳 — 2026-11-16 고침: 수치지도에는 하천 바닥 등고선이 없어
    // 물 면 안 지형이 둑 높이로 메워져 있어(광암교: 물 0.1~0.5m, 바로 옆 둔치·도로 -1.7~-2.1m) 물 안 가장 낮은 땅을 쓰면 물이 둔치보다 높았음
    const rad = Math.max(1, Math.round(40 / cell))
    const a = new Float32Array(N).fill(Infinity)
    for (let r = 0; r < H; r++)
      for (let c = 0; c < W; c++) {
        const i = r * W + c
        if (mW[i] || !Number.isFinite(Z0[i])) continue
        // 물 칸과 맞닿은 물가 칸
        if ((c > 0 && mW[i - 1]) || (c + 1 < W && mW[i + 1]) || (r > 0 && mW[i - W]) || (r + 1 < H && mW[i + W])) a[i] = Z0[i]
      }
    const b = new Float32Array(N).fill(Infinity)
    for (let r = 0; r < H; r++)
      for (let c = 0; c < W; c++) {
        let m = Infinity
        for (let k = Math.max(0, c - rad); k <= Math.min(W - 1, c + rad); k++) m = Math.min(m, a[r * W + k])
        b[r * W + c] = m
      }
    const lo = new Float32Array(N).fill(Infinity)
    for (let c = 0; c < W; c++)
      for (let r = 0; r < H; r++) {
        let m = Infinity
        for (let k = Math.max(0, r - rad); k <= Math.min(H - 1, r + rad); k++) m = Math.min(m, b[k * W + c])
        lo[r * W + c] = m
      }
    // 하천을 따라 고르게 (물 칸끼리만 평균)
    const w = new Float32Array(N)
    const v = new Float32Array(N)
    for (let i = 0; i < N; i++)
      if (mW[i] && Number.isFinite(lo[i])) {
        w[i] = 1
        v[i] = lo[i]
      }
    const rs = Math.max(1, Math.round(12 / cell))
    const bw = boxBlur(boxBlur(w, W, H, rs), W, H, rs)
    const bv = boxBlur(boxBlur(v, W, H, rs), W, H, rs)
    for (let i = 0; i < N; i++) if (mW[i] && bw[i] > 1e-6) level[i] = bv[i] / bw[i]
    // 넓은 하천 가운데(물가에서 40m 넘게)는 이웃 물 칸 값으로 채움
    for (let pass = 0; pass < 80; pass++) {
      const add: [number, number][] = []
      for (let r = 0; r < H; r++)
        for (let c = 0; c < W; c++) {
          const i = r * W + c
          if (!mW[i] || Number.isFinite(level[i])) continue
          let s2 = 0
          let n2 = 0
          if (c > 0 && Number.isFinite(level[i - 1])) (s2 += level[i - 1]), n2++
          if (c + 1 < W && Number.isFinite(level[i + 1])) (s2 += level[i + 1]), n2++
          if (r > 0 && Number.isFinite(level[i - W])) (s2 += level[i - W]), n2++
          if (r + 1 < H && Number.isFinite(level[i + W])) (s2 += level[i + W]), n2++
          if (n2) add.push([i, s2 / n2])
        }
      if (!add.length) break
      for (const [i, q] of add) level[i] = q
    }
    // 물 면 가장자리 꼭짓점도 값을 갖게 둘레 몇 칸 넓힘
    for (let pass = 0; pass < 3; pass++) {
      const add: [number, number][] = []
      for (let r = 0; r < H; r++)
        for (let c = 0; c < W; c++) {
          const i = r * W + c
          if (Number.isFinite(level[i])) continue
          let s = 0
          let n = 0
          for (const [dr, dc] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ]) {
            const rr = r + dr
            const cc = c + dc
            if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue
            const q = level[rr * W + cc]
            if (Number.isFinite(q)) {
              s += q
              n++
            }
          }
          if (n) add.push([i, s / n])
        }
      for (const [i, q] of add) level[i] = q
    }
    // 물 밑 땅 파기
    for (let i = 0; i < N; i++) if (mW[i] && Number.isFinite(level[i]) && Number.isFinite(Z[i])) Z[i] = Math.min(Z[i], level[i] - WATER_DEPTH)
  }

  // ── 도로
  const mR = new Uint8Array(N)
  raster(inp.roads, mR, 1)
  raster(inp.noRoad, mR, 0)
  let roadCells = 0
  for (let i = 0; i < N; i++) {
    if (mW[i]) mR[i] = 0
    if (mR[i] && Number.isFinite(Z0[i])) roadCells++
  }
  let hdCells = 0
  let hdOffset: number | null = null
  if (roadCells) {
    // 정밀도로지도 노면 높이: 지형과의 기준 차이(중앙값)를 빼고 칸마다 평균
    const hdSum = new Float32Array(N)
    const hdCnt = new Uint16Array(N)
    const pts: { i: number; z: number }[] = []
    for (const p of inp.hd) {
      const c = Math.round(colOf(p.x))
      const r = Math.round(rowOf(p.y))
      if (c < 0 || r < 0 || c >= W || r >= H) continue
      const i = r * W + c
      if (!mR[i] || !Number.isFinite(Z0[i])) continue
      pts.push({ i, z: p.z })
    }
    if (pts.length >= 20) {
      const diffs = pts.map((p) => p.z - Z0[p.i]).sort((a, b) => a - b)
      hdOffset = diffs[Math.floor(diffs.length / 2)]
      for (const p of pts) {
        const z = p.z - hdOffset
        if (Math.abs(z - Z0[p.i]) > 2.5) continue
        hdSum[p.i] += z
        hdCnt[p.i]++
      }
      for (let i = 0; i < N; i++) if (hdCnt[i]) hdCells++
    }
    const w = new Float32Array(N)
    const v = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      if (!mR[i]) continue
      if (hdCnt[i]) {
        w[i] = 6
        v[i] = (hdSum[i] / hdCnt[i]) * 6
      } else if (Number.isFinite(Z[i])) {
        w[i] = 1
        v[i] = Z[i]
      }
    }
    const rr = Math.max(1, Math.round(9 / cell))
    const bw = boxBlur(boxBlur(w, W, H, rr), W, H, rr)
    const bv = boxBlur(boxBlur(v, W, H, rr), W, H, rr)
    // 도로 밖 칸까지의 거리 (칸, 3-4 거리 근사)
    const INF = 1e9
    const dist = new Float32Array(N).fill(INF)
    for (let i = 0; i < N; i++) if (mR[i]) dist[i] = 0
    for (let r = 0; r < H; r++)
      for (let c = 0; c < W; c++) {
        const i = r * W + c
        if (c > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1)
        if (r > 0) dist[i] = Math.min(dist[i], dist[i - W] + 1)
        if (r > 0 && c > 0) dist[i] = Math.min(dist[i], dist[i - W - 1] + 1.414)
        if (r > 0 && c + 1 < W) dist[i] = Math.min(dist[i], dist[i - W + 1] + 1.414)
      }
    for (let r = H - 1; r >= 0; r--)
      for (let c = W - 1; c >= 0; c--) {
        const i = r * W + c
        if (c + 1 < W) dist[i] = Math.min(dist[i], dist[i + 1] + 1)
        if (r + 1 < H) dist[i] = Math.min(dist[i], dist[i + W] + 1)
        if (r + 1 < H && c + 1 < W) dist[i] = Math.min(dist[i], dist[i + W + 1] + 1.414)
        if (r + 1 < H && c > 0) dist[i] = Math.min(dist[i], dist[i + W - 1] + 1.414)
      }
    const blend = Math.max(cell, BLEND)
    for (let i = 0; i < N; i++) {
      if (bw[i] < 1e-6 || !Number.isFinite(Z[i]) || mW[i]) continue
      const S = bv[i] / bw[i]
      if (mR[i]) {
        Z[i] = S
        continue
      }
      const d = dist[i] * cell
      if (d >= blend) continue
      const t = d / blend
      const k = t * t * (3 - 2 * t)
      Z[i] = S + (Z[i] - S) * k
    }
  }

  const z = g.z.slice()
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) z[(r0 + r) * g.nx + c0 + c] = Z[r * W + c]
  const waterLevel = (x: number, y: number): number | null => {
    if (!waterCells) return null
    const fc = colOf(x)
    const fr = rowOf(y)
    const c = Math.floor(fc)
    const r = Math.floor(fr)
    const u = fc - c
    const v = fr - r
    let s = 0
    let n = 0
    for (const [dc, dr, wt] of [
      [0, 0, (1 - u) * (1 - v)],
      [1, 0, u * (1 - v)],
      [0, 1, (1 - u) * v],
      [1, 1, u * v],
    ]) {
      const cc = c + dc
      const rr = r + dr
      if (cc < 0 || rr < 0 || cc >= W || rr >= H) continue
      const q = level[rr * W + cc]
      if (Number.isFinite(q)) {
        s += q * wt
        n += wt
      }
    }
    return n > 1e-6 ? s / n : null
  }
  return { grid: { ...g, z }, waterLevel, stats: { roadCells, waterCells, hdCells, hdOffset } }
}
