// 높이 재기 (2026-11-17): 모형의 높이 함수(땅·물)를 '자료 + 계산식'으로 나눔.
// 자료(격자·숫자)만 일꾼(Web Worker)에 넘기고 거기서 같은 계산식으로 함수를 다시 만든다 — 라이노 파일 쓰기를 일꾼에서 하려고
// (2026-11-17 사용자 요청: 파일 쓰는 단계에서 화면이 멈춤). 다리·고가 상판 높이는 bridges.ts의 deckZFn.

import type { TerrainGrid } from '../lib/terrain'

/** 다듬은 지형 격자 + 모형 원점(EPSG:5179) + 대지 중심 높이 */
export interface GroundData {
  g: TerrainGrid
  X0: number
  Y0: number
  z0: number
}

/** 물 높이 격자 (해발): 땅 다듬기(groundShape)에서 고른 물 면 */
export interface WaterData {
  level: Float32Array
  W: number
  H: number
  cell: number
  /** 칸 위치 = (x + ox) / cell − 0.5 − c0, (oy − y) / cell − 0.5 − r0 */
  ox: number
  oy: number
  c0: number
  r0: number
}

/** 지형 격자 위 높이 (모형 높이): 메시와 같은 대각선(북서–남동)으로 나눈 삼각형 안에서 보간, 자료 없으면 0 */
export function groundZ(d: GroundData | null): (x: number, y: number) => number {
  if (!d) return () => 0
  const { g, X0, Y0, z0 } = d
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= g.nx || r >= g.ny ? NaN : g.z[r * g.nx + c])
  return (x: number, y: number): number => {
    const fc = (x + X0 - g.x0) / g.cell - 0.5
    const fr = (g.y0 - (y + Y0)) / g.cell - 0.5
    const c = Math.floor(fc)
    const r = Math.floor(fr)
    const u = fc - c
    const v = fr - r
    const tl = at(c, r)
    const tr = at(c + 1, r)
    const bl = at(c, r + 1)
    const br = at(c + 1, r + 1)
    let z = v >= u ? tl + v * (bl - tl) + u * (br - bl) : tl + u * (tr - tl) + v * (br - tr)
    if (!Number.isFinite(z)) {
      // 자료 없는 칸 옆: 가장 가까운 값
      const near = [tl, tr, bl, br].filter(Number.isFinite)
      z = near.length ? near.reduce((s, t) => s + t, 0) / near.length : NaN
    }
    return Number.isFinite(z) ? z - z0 : 0
  }
}

/** 물 높이 (해발, 겹선형). 물 근처가 아니면 null */
export function waterLevelFn(d: WaterData | null): (x: number, y: number) => number | null {
  if (!d) return () => null
  const { level, W, H, cell, ox, oy, c0, r0 } = d
  return (x: number, y: number): number | null => {
    const fc = (x + ox) / cell - 0.5 - c0
    const fr = (oy - y) / cell - 0.5 - r0
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
}

/** 물 높이 (모형 높이 = 해발 − 대지 중심 높이) */
export function waterAtFn(d: WaterData | null, z0: number): (x: number, y: number) => number | null {
  const lv = waterLevelFn(d)
  return (x, y) => {
    const l = lv(x, y)
    return l === null ? null : l - z0
  }
}

/** 항공사진 UV 격자: 모형 범위(±h)를 N×N 칸으로 나눠 꼭짓점마다 정확히 구해 둔 UV (aerialTexture.ts) */
export interface AerialGrid {
  N: number
  h: number
  gu: Float64Array
  gv: Float64Array
}

/** 모형 좌표 (m) → 사진 UV (0~1, v는 북쪽이 1): 칸 사이는 겹선형 (꼭짓점 수십만 개를 좌표 변환하지 않게) */
export function aerialUv(a: AerialGrid, x: number, y: number): [number, number] {
  const { N, h, gu, gv } = a
  const step = (2 * h) / N
  const fi = Math.min(N - 1e-9, Math.max(0, (x + h) / step))
  const fj = Math.min(N - 1e-9, Math.max(0, (y + h) / step))
  const i = Math.floor(fi)
  const j = Math.floor(fj)
  const p = fi - i
  const q = fj - j
  const k = j * (N + 1) + i
  const lerp = (arr: Float64Array) => arr[k] * (1 - p) * (1 - q) + arr[k + 1] * p * (1 - q) + arr[k + N + 1] * (1 - p) * q + arr[k + N + 2] * p * q
  return [lerp(gu), lerp(gv)]
}
