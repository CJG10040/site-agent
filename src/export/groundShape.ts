// 3D 모형 땅 다듬기 (2026-11-16 사용자 결정 — 하천: 물·둔치 나누기, 도로: 매끈한 면 + 땅 맞춤).
// 지형 격자(해발, EPSG:5179) 사본에서 모형 범위만 고친다. 도판·환경 계산이 쓰는 원래 지형은 그대로.
//  - 물: 물 면 안 칸마다 가까운(40m) 물가 땅 중 가장 낮은 곳 → 하천을 따라 넓게(12m) 고르게 한 것이 물 높이. 물 밑 땅은 물 높이 - 0.6m로 파냄
//    (예전: 물 면을 울퉁불퉁한 하천 바닥에 그대로 얹어 둑을 넘나들었고, 같은 하천을 자료 4개가 겹쳐 그림)
//  - 도로: 도로 면 안 높이를 넓게(약 18m) 평균한 매끈한 면으로 바꾸고, 도로 밖 4m는 원래 땅으로 서서히 이음.
//    정밀도로지도 노면 실측 높이(5m 칸)가 있으면 그 칸은 6배 무게 — 지형과의 높이 기준 차이(중앙값)를 먼저 빼고, 2.5m 넘게 어긋난 점(고가·지하차도)은 뺌.
//    교량 상판 밑은 고르지 않음 (하천 바닥이 그대로 보이게).

import type { TerrainGrid } from '../lib/terrain'
import { waterLevelFn, type WaterData } from './samplers'

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
  /** 둔치 (하천경계) — 물가에서 둑까지 비탈을 고름 */
  banks?: Poly[]
  /** 정밀도로지도 노면 높이 (모형 좌표 x·y, 높이는 자료 그대로) */
  hd: { x: number; y: number; z: number }[]
}

export interface ShapeResult {
  grid: TerrainGrid
  /** 물 높이 (해발). 물 면 근처가 아니면 null */
  waterLevel: (x: number, y: number) => number | null
  /** 같은 물 높이의 자료 (일꾼에 넘길 때 — samplers.ts), 물이 없으면 null */
  water: WaterData | null
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

/** 가로·세로 상자 안 최솟값(mode 1) 또는 최댓값(mode -1) */
function rankFilter(src: Float32Array, W: number, H: number, rad: number, mode: 1 | -1): Float32Array {
  const tmp = new Float32Array(W * H)
  const out = new Float32Array(W * H)
  const pick = mode === 1 ? Math.min : Math.max
  const init = mode === 1 ? Infinity : -Infinity
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      let m = init
      for (let k = Math.max(0, c - rad); k <= Math.min(W - 1, c + rad); k++) m = pick(m, src[r * W + k])
      tmp[r * W + c] = m
    }
  for (let c = 0; c < W; c++)
    for (let r = 0; r < H; r++) {
      let m = init
      for (let k = Math.max(0, r - rad); k <= Math.min(H - 1, r + rad); k++) m = pick(m, tmp[k * W + c])
      out[r * W + c] = m
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
  // 늘 사본 (모형 만들기에서 다리 밑을 파는 등 고쳐 써도 지형 캐시가 바뀌지 않게)
  const none: ShapeResult = { grid: { ...g, z: g.z.slice() }, waterLevel: () => null, water: null, stats: { roadCells: 0, waterCells: 0, hdCells: 0, hdOffset: null } }
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
    // 하천 깊이 어림 (2026-11-16 사용자 결정): 수치지도에는 하천 바닥 높이가 없어(물 면 약 15만㎡ 안에 표고점 998개 중 7개)
    // 물가 땅이 둑 높이에 가깝게 나와 도로와 물 높이 차가 1~2.5m뿐이었음(실제 도심 하천은 둑 위 도로가 물보다 4~6m 높음) → 다리 밑이 낮아 교각도 안 섰음.
    // 물 높이를 '둑 마루(하천경계 바로 바깥 칸, 둔치 자료가 없으면 물가 칸)의 둘레 평균 - 깊이'보다 높지 않게:
    // 깊이 = 1.5m + 물 폭 × 0.06 (물 폭 10m 2.1m · 30m 3.3m · 50m 이상 4.5m), 둔치 자료가 없으면 그 절반. 지금 물 높이보다 6m 넘게 낮추지는 않음
    {
      const mB0 = new Uint8Array(N)
      if (inp.banks?.length) raster(inp.banks, mB0, 1)
      const crest = new Float32Array(N).fill(Infinity)
      let crestN = 0
      for (let r = 0; r < H; r++)
        for (let c = 0; c < W; c++) {
          const i = r * W + c
          if (mW[i] || mB0[i] || !Number.isFinite(Z0[i])) continue
          if ((c > 0 && mB0[i - 1]) || (c + 1 < W && mB0[i + 1]) || (r > 0 && mB0[i - W]) || (r + 1 < H && mB0[i + W])) {
            crest[i] = Z0[i]
            crestN++
          }
        }
      const hasBanks = crestN > 0
      // 둑 마루 높이 = 60m 안 둑 마루 칸들의 평균 (가장 낮은 곳을 쓰면 둑 바깥 낮은 땅이 섞여 너무 깊어졌음)
      const src = hasBanks ? crest : a
      const cw = new Float32Array(N)
      const cv = new Float32Array(N)
      for (let i = 0; i < N; i++)
        if (Number.isFinite(src[i])) {
          cw[i] = 1
          cv[i] = src[i]
        }
      const cr = Math.max(1, Math.round(30 / cell))
      const cbw = boxBlur(boxBlur(cw, W, H, cr), W, H, cr)
      const cbv = boxBlur(boxBlur(cv, W, H, cr), W, H, cr)
      const crestMin = new Float32Array(N).fill(Infinity)
      for (let i = 0; i < N; i++) if (cbw[i] > 1e-6) crestMin[i] = cbv[i] / cbw[i]
      // 물 폭: 물 칸에서 물가까지 거리(칸, 3-4 거리 근사) → 30m 안 가장 큰 값 × 2
      const dIn = new Float32Array(N)
      for (let i = 0; i < N; i++) dIn[i] = mW[i] ? 1e9 : 0
      for (let r = 0; r < H; r++)
        for (let c = 0; c < W; c++) {
          const i = r * W + c
          if (!mW[i]) continue
          let m = dIn[i]
          if (c > 0) m = Math.min(m, dIn[i - 1] + 1)
          if (r > 0) m = Math.min(m, dIn[i - W] + 1)
          dIn[i] = m
        }
      for (let r = H - 1; r >= 0; r--)
        for (let c = W - 1; c >= 0; c--) {
          const i = r * W + c
          if (!mW[i]) continue
          let m = dIn[i]
          if (c + 1 < W) m = Math.min(m, dIn[i + 1] + 1)
          if (r + 1 < H) m = Math.min(m, dIn[i + W] + 1)
          dIn[i] = m
        }
      const halfW = rankFilter(dIn, W, H, Math.max(1, Math.round(30 / cell)), -1)
      for (let i = 0; i < N; i++) {
        if (!mW[i] || !Number.isFinite(lo[i]) || !Number.isFinite(crestMin[i])) continue
        const width = 2 * halfW[i] * cell
        const depth = Math.min(4.5, 1.5 + 0.06 * width) * (hasBanks ? 1 : 0.5)
        lo[i] = Math.max(lo[i] - 6, Math.min(lo[i], crestMin[i] - depth))
      }
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
    // 물 밑 땅 파기 — 물 면에 닿는 칸까지 한 칸 넓혀서 (좁은 물길은 칸 가운데가 물 면 밖이라 안 파여 땅이 물 위로 솟았음)
    const mWc = mW.slice()
    for (let r = 0; r < H; r++)
      for (let c = 0; c < W; c++) {
        const i = r * W + c
        if (mW[i]) continue
        if ((c > 0 && mW[i - 1]) || (c + 1 < W && mW[i + 1]) || (r > 0 && mW[i - W]) || (r + 1 < H && mW[i + W])) mWc[i] = 1
      }
    for (let i = 0; i < N; i++) if (mWc[i] && Number.isFinite(level[i]) && Number.isFinite(Z[i])) Z[i] = Math.min(Z[i], level[i] - (mW[i] ? WATER_DEPTH : 0.2))
    // 둔치: 물가에서 둑 쪽으로 비탈(물 높이 + 0.4m + 거리 × 0.3)보다 높은 땅은 그 비탈까지 낮춤 — 2026-11-16: 물 면만 파서 물가가 절벽이 되고
    // 둔치를 얹은 삼각형 사이로 땅이 뾰족하게 솟았음. 하천 바닥이 둑 높이로 메워진 자료(수치지도)에서 둔치의 볼록한 곳도 걷어 냄
    if (inp.banks?.length) {
      const mB = new Uint8Array(N)
      raster(inp.banks, mB, 1)
      // 물 높이를 둔치 칸까지 넓히고, 물에서 떨어진 거리(칸)
      const lv = level.slice()
      const dw = new Float32Array(N).fill(Infinity)
      let front: number[] = []
      for (let i = 0; i < N; i++)
        if (mWc[i] && Number.isFinite(lv[i])) {
          dw[i] = 0
          front.push(i)
        }
      const maxPass = Math.ceil(60 / cell)
      for (let pass = 1; pass <= maxPass && front.length; pass++) {
        const next: number[] = []
        for (const i of front) {
          const r = Math.floor(i / W)
          const c = i - r * W
          for (const [dr, dc] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ]) {
            const rr = r + dr
            const cc = c + dc
            if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue
            const j = rr * W + cc
            if (!mB[j] || mWc[j] || dw[j] <= pass) continue
            dw[j] = pass
            lv[j] = lv[i]
            next.push(j)
          }
        }
        front = next
      }
      for (let i = 0; i < N; i++) {
        if (!mB[i] || mWc[i] || !Number.isFinite(dw[i]) || !Number.isFinite(lv[i]) || !Number.isFinite(Z[i])) continue
        Z[i] = Math.min(Z[i], lv[i] + 0.4 + dw[i] * cell * 0.3)
      }
    }
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
  // 물 높이: 자료로 두고 계산식은 samplers.ts (colOf·rowOf와 같은 칸 위치)
  const water: WaterData | null = waterCells ? { level, W, H, cell, ox: X0 - g.x0, oy: g.y0 - Y0, c0, r0 } : null
  return { grid: { ...g, z }, waterLevel: waterLevelFn(water), water, stats: { roadCells, waterCells, hdCells, hdOffset } }
}
