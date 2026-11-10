// 환경 계산용 칸(격자). 좌표는 대지 중심 기준 미터(동쪽 x, 북쪽 y), 0행이 북쪽.

import { deflateSync, inflateSync } from 'fflate'
import type { XY } from '../network'

export interface GridSpec {
  /** 왼쪽 가장자리 x */
  x0: number
  /** 위쪽(북쪽) 가장자리 y */
  y0: number
  cell: number
  nx: number
  ny: number
}

export function gridAround(halfM: number, cell: number): GridSpec {
  const n = Math.ceil((halfM * 2) / cell)
  return { x0: -(n * cell) / 2, y0: (n * cell) / 2, cell, nx: n, ny: n }
}

export function cellXY(g: GridSpec, k: number): XY {
  const r = Math.floor(k / g.nx)
  const c = k - r * g.nx
  return [g.x0 + (c + 0.5) * g.cell, g.y0 - (r + 0.5) * g.cell]
}

export function cellAt(g: GridSpec, x: number, y: number): number {
  const c = Math.floor((x - g.x0) / g.cell)
  const r = Math.floor((g.y0 - y) / g.cell)
  if (c < 0 || r < 0 || c >= g.nx || r >= g.ny) return -1
  return r * g.nx + c
}

/**
 * 다각형(여러 고리, 짝홀 규칙)을 칸 가운데 기준으로 칠한다. fn(k)를 칸마다 부른다.
 * 볼록이 아니어도 된다 (행마다 교차점을 정렬해 짝지음).
 */
export function rasterize(g: GridSpec, rings: XY[][], fn: (k: number) => void): void {
  let minY = Infinity
  let maxY = -Infinity
  for (const ring of rings)
    for (const [, y] of ring) {
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  const r0 = Math.max(0, Math.floor((g.y0 - maxY) / g.cell))
  const r1 = Math.min(g.ny - 1, Math.floor((g.y0 - minY) / g.cell))
  const xs: number[] = []
  for (let r = r0; r <= r1; r++) {
    const y = g.y0 - (r + 0.5) * g.cell
    xs.length = 0
    for (const ring of rings)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi))
      }
    if (xs.length < 2) continue
    xs.sort((a, b) => a - b)
    for (let p = 0; p + 1 < xs.length; p += 2) {
      const c0 = Math.max(0, Math.ceil((xs[p] - g.x0) / g.cell - 0.5))
      const c1 = Math.min(g.nx - 1, Math.floor((xs[p + 1] - g.x0) / g.cell - 0.5))
      for (let c = c0; c <= c1; c++) fn(r * g.nx + c)
    }
  }
}

/** 볼록 껍질 (모노톤 체인) */
export function convexHull(pts: XY[]): XY[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: XY[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: XY[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

// ───────────────────────── 지형 (대지 중심 기준 미터, 10m) ─────────────────────────

export interface LocalTerrain extends GridSpec {
  /** 대지 중심 = 0m 상대 높이, 자료 없으면 NaN */
  z: Float32Array
}

export function terrainZ(t: LocalTerrain | null, x: number, y: number): number {
  if (!t) return 0
  const fc = (x - t.x0) / t.cell - 0.5
  const fr = (t.y0 - y) / t.cell - 0.5
  const c = Math.floor(fc)
  const r = Math.floor(fr)
  if (c < 0 || r < 0 || c + 1 >= t.nx || r + 1 >= t.ny) return 0
  const a = fc - c
  const b = fr - r
  const k = r * t.nx + c
  const v00 = t.z[k]
  const v01 = t.z[k + 1]
  const v10 = t.z[k + t.nx]
  const v11 = t.z[k + t.nx + 1]
  const v = (v00 * (1 - a) + v01 * a) * (1 - b) + (v10 * (1 - a) + v11 * a) * b
  return Number.isFinite(v) ? v : 0
}

// ───────────────────────── 저장 (압축 + base64) ─────────────────────────

export interface PackedGrid extends GridSpec {
  /** 값 = 저장값 × scale + offset (255 = 값 없음) */
  scale: number
  offset: number
  data: string
}

export const NODATA = 255

function toBase64(u8: Uint8Array): string {
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const u8 = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i)
  return u8
}

/** Float 값 → 0~254 바이트 (NaN·범위 밖 = 255) */
export function packGrid(g: GridSpec, values: ArrayLike<number>, scale: number, offset = 0): PackedGrid {
  const u8 = new Uint8Array(g.nx * g.ny)
  for (let i = 0; i < u8.length; i++) {
    const v = values[i]
    if (!Number.isFinite(v)) {
      u8[i] = NODATA
      continue
    }
    u8[i] = Math.max(0, Math.min(254, Math.round((v - offset) / scale)))
  }
  return { x0: g.x0, y0: g.y0, cell: g.cell, nx: g.nx, ny: g.ny, scale, offset, data: toBase64(deflateSync(u8, { level: 6 })) }
}

export interface UnpackedGrid extends GridSpec {
  raw: Uint8Array
  scale: number
  offset: number
  /** 값 (NODATA면 NaN) */
  at: (k: number) => number
}

const unpackCache = new WeakMap<PackedGrid, UnpackedGrid>()

export function unpackGrid(p: PackedGrid): UnpackedGrid {
  let u = unpackCache.get(p)
  if (!u) {
    const raw = inflateSync(fromBase64(p.data))
    u = { x0: p.x0, y0: p.y0, cell: p.cell, nx: p.nx, ny: p.ny, raw, scale: p.scale, offset: p.offset, at: (k) => (raw[k] === NODATA ? NaN : raw[k] * p.scale + p.offset) }
    unpackCache.set(p, u)
  }
  return u
}
