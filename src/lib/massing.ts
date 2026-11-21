// 설계안 매스(삼각형) → 2.5D 덩어리 (2026-11-21 묶음 C2).
// 도판·환경 계산(그림자·일조·하늘·바람·가시권)은 '발자국 + 높이' 건물만 다루므로, 매스를 위에서 내려다본 높이 지도로 바꿔
// 같은 높이 칸끼리 묶은 발자국 덩어리(층층이 쌓인 매스)로 만든다. 3D 도판·.3dm에는 원래 삼각형을 그대로 쓴다.
//  - 칸 크기: 매스 크기에 따라 0.25~1.5m
//  - 바닥 = 매스의 가장 낮은 점, 높이 = 칸마다 가장 높은 면 − 바닥 (1m 단위로 묶음)
//  - 윤곽: 칸 경계를 그대로 따라가 고리를 만든 뒤(직각 모서리가 살도록) 한 줄로 놓인 점을 빼고, 비스듬한 계단만 펴 줌
//  - 한계: 필로티·캔틸레버 아래 빈 곳은 꽉 찬 것으로 봄, 경사 대지에서는 바닥을 한 높이로 봄

import { feature, simplify } from '@turf/turf'
import type { Polygon } from 'geojson'

export interface TriMeshLike {
  positions: number[]
  indices: number[]
}

/** 높이 단계 하나의 발자국 (지역 좌표 m: 고리들 — 바깥 + 구멍) */
export interface MassBlock {
  rings: [number, number][][]
  /** 바닥에서 위까지 높이(m) */
  height: number
  /** 발자국 넓이(㎡) */
  area: number
}

export interface Massing {
  blocks: MassBlock[]
  /** 매스 바닥 높이(파일 z, m) */
  baseZ: number
  /** 가장 높은 곳 − 바닥 (m) */
  maxHeight: number
  /** 위에서 본 발자국 전체 넓이(㎡) */
  footprint: number
  cell: number
}

const STEP = 1

type Pt2 = [number, number]

/**
 * 칸 묶음(같은 높이 단계)의 경계를 칸 모서리를 따라 고리로. 안쪽을 왼쪽에 두고 돌아 바깥 고리는 반시계, 구멍은 시계.
 * 꼭짓점 (i, j) = 칸 격자의 모서리. 대각선으로만 닿은 두 칸은 왼쪽으로 꺾어 따로 떼어 냄
 */
function traceCells(inSet: (i: number, j: number) => boolean, nx: number, ny: number): Pt2[][] {
  const key = (i: number, j: number) => j * (nx + 1) + i
  const out = new Map<number, Pt2[]>() // 시작 꼭짓점 → 끝 꼭짓점들
  const add = (a: Pt2, b: Pt2) => {
    const k = key(a[0], a[1])
    const l = out.get(k)
    if (l) l.push(b)
    else out.set(k, [b])
  }
  let count = 0
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (!inSet(i, j)) continue
      if (!inSet(i, j - 1)) add([i, j], [i + 1, j])
      if (!inSet(i + 1, j)) add([i + 1, j], [i + 1, j + 1])
      if (!inSet(i, j + 1)) add([i + 1, j + 1], [i, j + 1])
      if (!inSet(i - 1, j)) add([i, j + 1], [i, j])
      count++
    }
  if (!count) return []
  const rings: Pt2[][] = []
  for (const [k0, list] of out) {
    while (list.length) {
      const start: Pt2 = [k0 % (nx + 1), Math.floor(k0 / (nx + 1))]
      const ring: Pt2[] = [start]
      let prev = start
      let cur = list.shift()!
      let guard = 0
      while (!(cur[0] === start[0] && cur[1] === start[1]) && guard++ < 1e7) {
        ring.push(cur)
        const nexts = out.get(key(cur[0], cur[1]))
        if (!nexts || !nexts.length) break
        let pick = 0
        if (nexts.length > 1) {
          // 왼쪽으로 꺾는 쪽 (진행 방향 d, 왼쪽 = (-dy, dx))
          const dx = cur[0] - prev[0]
          const dy = cur[1] - prev[1]
          const li = nexts.findIndex((n) => n[0] - cur[0] === -dy && n[1] - cur[1] === dx)
          if (li >= 0) pick = li
        }
        prev = cur
        cur = nexts.splice(pick, 1)[0]
      }
      if (ring.length >= 4) rings.push(ring)
    }
  }
  return rings
}

/** 한 줄로 놓인 점 빼기 (칸 계단의 곧은 변을 꼭짓점 두 개로) */
function dropCollinear(r: Pt2[]): Pt2[] {
  const out: Pt2[] = []
  const n = r.length
  for (let i = 0; i < n; i++) {
    const a = r[(i - 1 + n) % n]
    const b = r[i]
    const c = r[(i + 1) % n]
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b)
  }
  return out
}

function insideRing(p: Pt2, r: Pt2[]): boolean {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]
    const [xj, yj] = r[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function ringArea(r: [number, number][]): number {
  let a = 0
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i]
    const [x2, y2] = r[(i + 1) % r.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

export function meshToMassing(mesh: TriMeshLike): Massing | null {
  const P = mesh.positions
  const I = mesh.indices
  if (I.length < 3) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let zMin = Infinity
  for (let i = 0; i < P.length; i += 3) {
    x0 = Math.min(x0, P[i])
    x1 = Math.max(x1, P[i])
    y0 = Math.min(y0, P[i + 1])
    y1 = Math.max(y1, P[i + 1])
    zMin = Math.min(zMin, P[i + 2])
  }
  const size = Math.max(x1 - x0, y1 - y0)
  if (!(size > 0)) return null
  const cell = Math.min(1.5, Math.max(0.25, size / 600))
  // 가장자리 한 칸씩 비워 고리가 닫히게
  const gx0 = x0 - cell
  const gy0 = y0 - cell
  const nx = Math.ceil((x1 - x0) / cell) + 3
  const ny = Math.ceil((y1 - y0) / cell) + 3
  const top = new Float32Array(nx * ny).fill(-Infinity)

  // 위를 보든 아래를 보든 수평 성분이 있는 삼각형마다 칸 가운데 높이를 잼 (가장 높은 것)
  for (let t = 0; t < I.length; t += 3) {
    const ax = P[3 * I[t]]
    const ay = P[3 * I[t] + 1]
    const az = P[3 * I[t] + 2]
    const bx = P[3 * I[t + 1]]
    const by = P[3 * I[t + 1] + 1]
    const bz = P[3 * I[t + 1] + 2]
    const cx = P[3 * I[t + 2]]
    const cy = P[3 * I[t + 2] + 1]
    const cz = P[3 * I[t + 2] + 2]
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(det) < 1e-9) continue // 벽처럼 선 면
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - gx0) / cell - 0.5))
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - gx0) / cell - 0.5))
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - gy0) / cell - 0.5))
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - gy0) / cell - 0.5))
    for (let j = j0; j <= j1; j++) {
      const py = gy0 + (j + 0.5) * cell
      for (let i = i0; i <= i1; i++) {
        const px = gx0 + (i + 0.5) * cell
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det
        const l3 = 1 - l1 - l2
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue
        const z = l1 * az + l2 * bz + l3 * cz
        const k = j * nx + i
        if (z > top[k]) top[k] = z
      }
    }
  }

  // 1m 단위 높이 단계
  const level = new Int16Array(nx * ny)
  let maxH = 0
  let cells = 0
  const used = new Set<number>()
  for (let k = 0; k < top.length; k++) {
    if (top[k] === -Infinity) continue
    const h = top[k] - zMin
    const L = Math.round(h / STEP)
    if (L < 1) continue // 바닥에 붙은 판(마당·데크 등)은 건물로 보지 않음
    level[k] = L
    used.add(L)
    maxH = Math.max(maxH, h)
    cells++
  }
  if (!cells) return null

  const blocks: MassBlock[] = []
  // 비스듬한 변을 칸 모서리로 따라가면 계단 꼭짓점이 곧은 선에서 1.5칸쯤까지 벗어남 (2026-11-21 30° 돌린 상자로 잼: 1칸이면 남고 1.6칸이면 곧게)
  const tol = cell * 1.6
  const toLocal = (r: Pt2[]): Pt2[] => r.map(([i, j]) => [gx0 + i * cell, gy0 + j * cell])
  for (const L of [...used].sort((a, b) => a - b)) {
    const inSet = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && level[j * nx + i] === L
    const rings = traceCells(inSet, nx, ny).map(dropCollinear).filter((r) => r.length >= 3)
    const outers = rings.filter((r) => ringArea(r) > 0)
    const holes = rings.filter((r) => ringArea(r) < 0)
    for (const o of outers) {
      const mine = holes.filter((h) => insideRing(h[0], o))
      const polyRings = [o, ...mine].map((r) => {
        const lr = toLocal(r)
        return [...lr, lr[0]]
      })
      // 비스듬한 변의 칸 계단만 펴 줌 (곧은 변·직각 모서리는 이미 꼭짓점 두 개라 그대로)
      let clean = polyRings
      if (polyRings.some((r) => r.length > 9)) {
        try {
          const sp = simplify(feature({ type: 'Polygon', coordinates: polyRings } as Polygon), { tolerance: tol, highQuality: true })
          clean = sp.geometry.coordinates as Pt2[][]
        } catch {
          // 그대로
        }
      }
      const outer = clean[0]
      if (!outer || outer.length < 4) continue
      const area = Math.abs(ringArea(outer.slice(0, -1))) - clean.slice(1).reduce((n, h) => n + Math.abs(ringArea(h.slice(0, -1))), 0)
      if (area < cell * cell * 2) continue
      blocks.push({ rings: clean, height: L * STEP, area })
    }
  }
  return { blocks, baseZ: zMin, maxHeight: maxH, footprint: cells * cell * cell, cell }
}
