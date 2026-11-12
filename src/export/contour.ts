// 15-B 콘타 모형 (2026-11-12 인터뷰, docs Phase 15): 축척·판 두께 → 등고 간격, 층마다 닫힌 판(계단형),
// 새김(위 판 자리·건물 자리·대지 경계·도로), 도로 처리 3가지(새김 / 따로 자른 조각 / 파내기), 판 번호, 재료 판 위 배치.
// 이 파일은 작업자 스레드(contour.worker.ts)에서 돈다 — 화면 코드·siteModel은 타입만 가져온다.
//
// 좌표: 대지 중심 = 원점(m, x 동쪽·y 북쪽), 높이 = 대지 중심 지면 기준(m). 재료 판 위 좌표는 mm.
// 판 p(1부터, 맨 아래 = 1)는 땅 높이 ≥ 판 p의 높이(level)인 곳 전부를 덮는 닫힌 판. 판 1 = 모형 전체 정사각형.

import { difference, featureCollection, intersect, multiPolygon } from '@turf/turf'
import { contours } from 'd3-contour'
import type { Geometry } from 'geojson'
import type { ContourRoadMode } from '../model/types'
import type { Poly, XY } from './siteModel'

/** 따로 자른 도로 조각 재료 두께 (mm) */
export const ROAD_T = 1
/** 재료 판 가장자리 여백·조각 사이 (mm) */
export const SHEET_MARGIN = 5
export const PIECE_GAP = 3
/** 이보다 작은 섬·구멍(변 길이 mm의 정사각 넓이)은 빼거나 메움 — 자르기·붙이기 어려움 */
const MIN_PIECE_MM = 6
/** 선 단순화 허용 오차 (모형 위 mm) */
const SIMPLIFY_MM = 0.12
/** 새김선을 판마다 나눌 때 검사 간격 (모형 위 mm) */
const STEP_MM = 1
/** 판 수 상한 (넘으면 위를 자름) */
const MAX_PLATES = 150

export interface ContourInput {
  /** 모형 범위 정사각형의 반쪽 (m) */
  half: number
  /** 한 변의 표본 수 (n × n, 0행 = 북쪽 끝 y = +half, 0열 = 서쪽 끝 x = −half) */
  n: number
  z: Float32Array
  /** 도로 면 (m, 범위로 자른 것) */
  roads: Poly[]
  /** 건물 발자국 고리 (바깥·구멍 모두) */
  buildings: XY[][]
  /** 대지 경계 고리 */
  site: XY[][]
  scale: number
  /** 판 두께 (mm) */
  thickness: number
  sheetW: number
  sheetH: number
  roadMode: ContourRoadMode
}

export type EngraveKind = 'align' | 'bldg' | 'site' | 'road'

export interface ContourPiece {
  /** 판 번호 '3', 같은 판에 여러 조각이면 '3-2', 도로 조각은 'R3-1' */
  id: string
  plate: number
  kind: 'plate' | 'road'
  /** 모형 좌표 (m) */
  poly: Poly
  /** 넓이 (m², 구멍 뺌) */
  area: number
  /** 새김선 (m, 열린 선) */
  engrave: { kind: EngraveKind; pts: XY[] }[]
  /** 번호 새길 자리 (m), 글자 높이 (mm), 위 판에 가려지는지 */
  label: { at: XY; size: number; hidden: boolean }
}

export interface Placed {
  piece: number
  sheet: number
  /** 시계 반대 90° 돌림 */
  rot: 0 | 90
  /** 재료 판 왼쪽 아래 기준 옮김 (mm, 돌린 뒤) */
  ox: number
  oy: number
}

export interface SheetGroup {
  material: 'plate' | 'road'
  /** 재료 두께 (mm) */
  thickness: number
  sheets: { w: number; h: number; oversize: boolean }[]
  placed: Placed[]
  /** 조각 넓이 합 ÷ 재료 판 넓이 합 */
  use: number
}

export interface ContourPlan {
  half: number
  scale: number
  thickness: number
  sheetW: number
  sheetH: number
  roadMode: ContourRoadMode
  /** 등고 간격 (m) = 두께 × 축척 */
  interval: number
  /** 판마다 윗면 높이 (m, 대지 중심 지면 기준) — levels[p - 1] */
  levels: number[]
  plates: number
  /** 땅 높이 범위 (m) */
  lo: number
  hi: number
  pieces: ContourPiece[]
  groups: SheetGroup[]
  /** 너무 작아 뺀 섬·메운 구멍 수 */
  removed: number
  /** 모형 크기 (mm): 한 변, 판을 다 쌓은 높이 */
  side: number
  height: number
  warnings: string[]
  ms: number
}

// ───────────────────────── 도형 도우미 ─────────────────────────

const ringArea = (r: XY[]) => {
  let s = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]
  return s / 2
}
export const polyArea = (p: Poly) => Math.abs(ringArea(p.outer)) - p.holes.reduce((s, h) => s + Math.abs(ringArea(h)), 0)
const close = (r: XY[]): XY[] => [...r, r[0]]

/** 더글러스–포이커 (열린 선, 처음·끝 남김) */
function simplifyLine(pts: XY[], tol: number): XY[] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = pts[a]
    const [bx, by] = pts[b]
    const dx = bx - ax
    const dy = by - ay
    const L2 = dx * dx + dy * dy
    let far = -1
    let fd = tol
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]
      let d: number
      if (L2 === 0) d = Math.hypot(px - ax, py - ay)
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
        d = Math.hypot(px - ax - t * dx, py - ay - t * dy)
      }
      if (d > fd) {
        fd = d
        far = i
      }
    }
    if (far >= 0) {
      keep[far] = 1
      stack.push([a, far], [far, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** 닫힌 고리 단순화 (처음 = 끝 점이 있어도 없어도, 결과는 닫는 점 없이) */
function simplifyRing(r: XY[], tol: number): XY[] {
  const open = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r
  if (open.length < 4) return open
  // 가장 먼 두 점에서 나눠 단순화 (시작점이 모서리가 아니어도 모양이 남게)
  let k = 0
  let best = -1
  for (let i = 1; i < open.length; i++) {
    const d = (open[i][0] - open[0][0]) ** 2 + (open[i][1] - open[0][1]) ** 2
    if (d > best) {
      best = d
      k = i
    }
  }
  const a = simplifyLine(open.slice(0, k + 1), tol)
  const b = simplifyLine([...open.slice(k), open[0]], tol)
  return [...a.slice(0, -1), ...b.slice(0, -1)]
}

function cleanRing(r: XY[], eps: number): XY[] {
  const out: XY[] = []
  for (const p of r) {
    const q = out[out.length - 1]
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p)
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop()
  return out
}

function toPoly(rings: XY[][], eps: number): Poly | null {
  const rs = rings.map((r) => cleanRing(r, eps)).filter((r) => r.length >= 3 && Math.abs(ringArea(r)) > eps * eps)
  if (!rs.length) return null
  const orient = (r: XY[], ccw: boolean) => (ringArea(r) > 0 === ccw ? r : [...r].reverse())
  return { outer: orient(rs[0], true), holes: rs.slice(1).map((h) => orient(h, false)) }
}

function polysOfGeom(g: Geometry, eps: number): Poly[] {
  const ps = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
  const out: Poly[] = []
  for (const q of ps) {
    const p = toPoly(
      q.map((r) => r.map(([x, y]) => [x, y] as XY)),
      eps,
    )
    if (p) out.push(p)
  }
  return out
}

const featOf = (ps: Poly[]) => multiPolygon(ps.map((p) => [close(p.outer), ...p.holes.map(close)]))

/** 불리언 (실패하면 null) */
function boolOp(op: 'intersect' | 'difference', a: Poly[], b: Poly[], eps: number): Poly[] | null {
  if (!a.length) return []
  if (!b.length) return op === 'intersect' ? [] : a
  try {
    const fc = featureCollection([featOf(a), featOf(b)])
    const r = op === 'intersect' ? intersect(fc) : difference(fc)
    return r ? polysOfGeom(r.geometry, eps) : []
  } catch {
    return null
  }
}

/** 정사각형(±h) 밖 점을 테두리로 (불리언이 실패했을 때만) */
function clampPolys(ps: Poly[], h: number, eps: number): Poly[] {
  const cl = (r: XY[]) => r.map(([x, y]) => [Math.max(-h, Math.min(h, x)), Math.max(-h, Math.min(h, y))] as XY)
  return ps.map((p) => toPoly([cl(p.outer), ...p.holes.map(cl)], eps)).filter((p): p is Poly => !!p)
}

function densify(pts: XY[], step: number, closed: boolean): XY[] {
  const src = closed ? close(pts) : pts
  const out: XY[] = []
  for (let i = 0; i + 1 < src.length; i++) {
    const [ax, ay] = src[i]
    const [bx, by] = src[i + 1]
    const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let j = 0; j < k; j++) out.push([ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k])
  }
  if (src.length) out.push(src[src.length - 1])
  return out
}

const lenOf = (pts: XY[]) => pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0)

interface Ringed {
  bbox: [number, number, number, number]
  rings: Float64Array[]
}

function ringed(p: Poly): Ringed {
  let a = Infinity
  let b = Infinity
  let c = -Infinity
  let d = -Infinity
  for (const [x, y] of p.outer) {
    if (x < a) a = x
    if (y < b) b = y
    if (x > c) c = x
    if (y > d) d = y
  }
  return { bbox: [a, b, c, d], rings: [p.outer, ...p.holes].map((r) => Float64Array.from(r.flat())) }
}

function inRinged(e: Ringed, x: number, y: number): boolean {
  const [a, b, c, d] = e.bbox
  if (x < a || x > c || y < b || y > d) return false
  let inside = false
  for (const r of e.rings) {
    const n = r.length / 2
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[2 * i]
      const yi = r[2 * i + 1]
      const xj = r[2 * j]
      const yj = r[2 * j + 1]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

/** 경계까지 가장 짧은 거리 (stop보다 작아지면 바로 멈춤) */
function distRinged(e: Ringed, x: number, y: number, stop = 0): number {
  let best = Infinity
  for (const r of e.rings) {
    const n = r.length / 2
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = r[2 * j]
      const ay = r[2 * j + 1]
      const dx = r[2 * i] - ax
      const dy = r[2 * i + 1] - ay
      const L2 = dx * dx + dy * dy
      const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0
      const d = Math.hypot(x - ax - t * dx, y - ay - t * dy)
      if (d < best) {
        best = d
        if (best < stop) return best
      }
    }
  }
  return best
}

// ───────────────────────── 번호 글자 (한 획 새김용) ─────────────────────────

/** 가로 2 × 세로 4 칸 위 꺾은선 (레이저가 한 번 지나가는 선 글자) */
const GLYPH: Record<string, number[][][]> = {
  '0': [
    [
      [0, 0],
      [2, 0],
      [2, 4],
      [0, 4],
      [0, 0],
    ],
  ],
  '1': [
    [
      [0.4, 3.3],
      [1.1, 4],
      [1.1, 0],
    ],
  ],
  '2': [
    [
      [0, 4],
      [2, 4],
      [2, 2],
      [0, 2],
      [0, 0],
      [2, 0],
    ],
  ],
  '3': [
    [
      [0, 4],
      [2, 4],
      [2, 0],
      [0, 0],
    ],
    [
      [0.5, 2],
      [2, 2],
    ],
  ],
  '4': [
    [
      [0, 4],
      [0, 2],
      [2, 2],
    ],
    [
      [2, 4],
      [2, 0],
    ],
  ],
  '5': [
    [
      [2, 4],
      [0, 4],
      [0, 2],
      [2, 2],
      [2, 0],
      [0, 0],
    ],
  ],
  '6': [
    [
      [2, 4],
      [0, 4],
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ],
  ],
  '7': [
    [
      [0, 4],
      [2, 4],
      [2, 0],
    ],
  ],
  '8': [
    [
      [0, 0],
      [2, 0],
      [2, 4],
      [0, 4],
      [0, 0],
    ],
    [
      [0, 2],
      [2, 2],
    ],
  ],
  '9': [
    [
      [2, 2],
      [0, 2],
      [0, 4],
      [2, 4],
      [2, 0],
      [0, 0],
    ],
  ],
  '-': [
    [
      [0.3, 2],
      [1.7, 2],
    ],
  ],
  R: [
    [
      [0, 0],
      [0, 4],
      [2, 4],
      [2, 2],
      [0, 2],
    ],
    [
      [0.8, 2],
      [2, 0],
    ],
  ],
}

/** 글자 너비 (글자 높이 h와 같은 단위) */
export const textWidth = (s: string, h: number) => ((s.length * 3 - 1) * h) / 4

/** 가운데 (cx, cy)에 높이 h인 선 글자 */
export function strokeText(s: string, cx: number, cy: number, h: number): XY[][] {
  const u = h / 4
  const x0 = cx - textWidth(s, h) / 2
  const y0 = cy - h / 2
  const out: XY[][] = []
  ;[...s].forEach((ch, i) => {
    for (const st of GLYPH[ch] ?? []) out.push(st.map(([a, b]) => [x0 + (i * 3 + a) * u, y0 + b * u] as XY))
  })
  return out
}

// ───────────────────────── 재료 판 배치 (선반 채우기) ─────────────────────────

interface LayoutItem {
  piece: number
  /** 돌리기 전 경계 상자 (mm) */
  minx: number
  miny: number
  w: number
  h: number
  area: number
}

function layoutGroup(items: LayoutItem[], W: number, H: number, material: 'plate' | 'road', thickness: number): SheetGroup {
  const uw = W - 2 * SHEET_MARGIN
  const uh = H - 2 * SHEET_MARGIN
  const sheets: SheetGroup['sheets'] = []
  const placed: Placed[] = []
  const shelves: { sheet: number; y: number; h: number; x: number }[] = []
  const yTop: number[] = []
  // 돌림 고르기: 둘 다 들어가면 낮게 눕힘
  const fitted = items.map((it) => {
    const f0 = it.w <= uw && it.h <= uh
    const f90 = it.h <= uw && it.w <= uh
    const rot: 0 | 90 | null = f0 && f90 ? (it.w >= it.h ? 0 : 90) : f0 ? 0 : f90 ? 90 : null
    return { it, rot, w: rot === 90 ? it.h : it.w, h: rot === 90 ? it.w : it.h }
  })
  const put = (f: (typeof fitted)[number], sheet: number, x: number, y: number) => {
    const it = f.it
    // 돌린 뒤 경계 상자의 왼쪽 아래가 (x, y)에 오게
    const rot = f.rot ?? 0
    const minRx = rot === 90 ? -(it.miny + it.h) : it.minx
    const minRy = rot === 90 ? it.minx : it.miny
    placed.push({ piece: it.piece, sheet, rot, ox: x - minRx, oy: y - minRy })
  }
  for (const f of fitted.filter((f) => f.rot !== null).sort((a, b) => b.h - a.h || b.w - a.w)) {
    let done = false
    for (const s of shelves)
      if (f.h <= s.h && s.x + f.w <= uw) {
        put(f, s.sheet, SHEET_MARGIN + s.x, SHEET_MARGIN + s.y)
        s.x += f.w + PIECE_GAP
        done = true
        break
      }
    if (done) continue
    let sheet = yTop.findIndex((y, i) => !sheets[i].oversize && y + f.h <= uh)
    if (sheet < 0) {
      sheet = sheets.length
      sheets.push({ w: W, h: H, oversize: false })
      yTop.push(0)
    }
    shelves.push({ sheet, y: yTop[sheet], h: f.h, x: f.w + PIECE_GAP })
    put(f, sheet, SHEET_MARGIN, SHEET_MARGIN + yTop[sheet])
    yTop[sheet] += f.h + PIECE_GAP
  }
  // 재료 판보다 큰 조각: 따로 큰 판 하나씩 (경고)
  for (const f of fitted.filter((f) => f.rot === null)) {
    const sheet = sheets.length
    sheets.push({ w: f.w + 2 * SHEET_MARGIN, h: f.h + 2 * SHEET_MARGIN, oversize: true })
    yTop.push(Infinity)
    put(f, sheet, SHEET_MARGIN, SHEET_MARGIN)
  }
  const pieceArea = items.reduce((s, it) => s + it.area, 0)
  const sheetArea = sheets.reduce((s, sh) => s + sh.w * sh.h, 0)
  return { material, thickness, sheets, placed, use: sheetArea ? pieceArea / sheetArea : 0 }
}

/** 재료 판 위(mm) 조각 모양: 바깥·구멍·새김·번호 */
export function placedShapes(plan: Pick<ContourPlan, 'scale'>, piece: ContourPiece, pl: Placed) {
  const k = 1000 / plan.scale
  const tf = ([x, y]: XY): XY => {
    const u = x * k
    const v = y * k
    return pl.rot === 90 ? [-v + pl.ox, u + pl.oy] : [u + pl.ox, v + pl.oy]
  }
  const [lx, ly] = tf(piece.label.at)
  return {
    outer: piece.poly.outer.map(tf),
    holes: piece.poly.holes.map((h) => h.map(tf)),
    engrave: piece.engrave.map((e) => ({ kind: e.kind, pts: e.pts.map(tf) })),
    text: strokeText(piece.id, lx, ly, piece.label.size),
  }
}

// ───────────────────────── 계획 ─────────────────────────

export function planContour(inp: ContourInput, onProgress?: (s: string) => void): ContourPlan {
  const t0 = Date.now()
  const { half, n, scale, thickness, z: Z } = inp
  const k = 1000 / scale // m → mm
  const mm = (v: number) => v / k // 모형 위 mm → 실제 m
  const res = (2 * half) / (n - 1)
  const eps = mm(0.02)
  const tol = mm(SIMPLIFY_MM)
  const minArea = mm(MIN_PIECE_MM) ** 2
  const warnings: string[] = []

  let lo = Infinity
  let hi = -Infinity
  for (const v of Z) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!Number.isFinite(lo)) {
    lo = 0
    hi = 0
  }
  const dz = (thickness * scale) / 1000
  const base = Math.floor(lo / dz + 1e-9) * dz
  let K = Math.floor((hi - base) / dz + 1e-9) + 1
  if (K > MAX_PLATES) {
    warnings.push(`판이 ${K}장이라 위쪽 ${K - MAX_PLATES}장은 뺐습니다 — 판 두께를 키우거나 축척을 줄이세요`)
    K = MAX_PLATES
  }
  const level = (p: number) => Math.round((base + (p - 1) * dz) * 1000) / 1000

  // 표본 격자 위 높이 (격자 칸 안 쌍선형 — d3-contour가 칸 변에서 하는 선형 보간과 맞음)
  const zAt = (x: number, y: number) => {
    const fc = Math.min(n - 1.000001, Math.max(0, (x + half) / res))
    const fr = Math.min(n - 1.000001, Math.max(0, (half - y) / res))
    const c = Math.floor(fc)
    const r = Math.floor(fr)
    const u = fc - c
    const v = fr - r
    const i = r * n + c
    return (Z[i] * (1 - u) + Z[i + 1] * u) * (1 - v) + (Z[i + n] * (1 - u) + Z[i + n + 1] * u) * v
  }

  const square: Poly = {
    outer: [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ],
    holes: [],
  }
  let removed = 0
  /** 작은 섬은 빼고 작은 구멍은 메움 */
  const cleanSmall = (ps: Poly[], count = true): Poly[] => {
    const out: Poly[] = []
    for (const p of ps) {
      const holes = p.holes.filter((h) => {
        const big = Math.abs(ringArea(h)) >= minArea
        if (!big && count) removed++
        return big
      })
      const q = { outer: p.outer, holes }
      if (polyArea(q) >= minArea) out.push(q)
      else if (count) removed++
    }
    return out
  }

  // ── 판 영역: 높이 ≥ 판 높이인 곳 (d3-contour, 칸 값 i는 칸 [i, i+1]의 가운데)
  onProgress?.('판 모양 계산 중')
  const values = Array.from(Z)
  const gen = contours().size([n, n]).smooth(true)
  const toXY = ([gx, gy]: number[]): XY => [-half + (gx - 0.5) * res, half - (gy - 0.5) * res]
  const regions: Poly[][] = [[square]]
  for (let p = 2; p <= K; p++) {
    const mp = gen.contour(values, level(p))
    const raw: Poly[] = []
    for (const poly of mp.coordinates) {
      const q = toPoly(
        poly.map((ring) => simplifyRing(ring.map(toXY), tol)),
        eps,
      )
      if (q) raw.push(q)
    }
    const clipped = boolOp('intersect', raw, [square], eps) ?? clampPolys(raw, half, eps)
    regions.push(cleanSmall(clipped))
    if (p % 5 === 0) onProgress?.(`판 모양 계산 중 (${p}/${K})`)
  }
  while (K > 1 && !regions[K - 1].length) {
    regions.pop()
    K--
  }
  if (K === 1 && hi - lo > 0.01) warnings.push(`땅 높이 차가 ${(hi - lo).toFixed(1)}m로 등고 간격 ${dz}m보다 작아 판이 한 장입니다 — 판 두께를 줄이거나 축척을 키우세요`)
  if (K > 60) warnings.push(`판이 ${K}장으로 많습니다 — 판 두께를 키우거나 축척을 줄이면 자르고 붙이기 쉬워집니다`)

  // ── 도로: 판마다 드러나는 부분 (도로 ∩ 판 p − 판 p+1)
  const roads = inp.roads.map((p) => toPoly([simplifyRing(p.outer, tol), ...p.holes.map((h) => simplifyRing(h, tol))], eps)).filter((p): p is Poly => !!p)
  const bands: Poly[][] = []
  if (inp.roadMode !== 'engrave' && roads.length) {
    onProgress?.('도로 나누는 중')
    for (let p = 1; p <= K; p++) {
      const a = p === 1 ? roads : (boolOp('intersect', roads, regions[p - 1], eps) ?? [])
      const b = p < K ? (boolOp('difference', a, regions[p], eps) ?? a) : a
      bands.push(cleanSmall(b, false))
    }
  }

  // ── 판 조각 (파내기면 판 2부터 드러난 도로를 도려냄)
  const finals: Poly[][] = regions.map((reg, i) => {
    const p = i + 1
    if (inp.roadMode !== 'cutout' || p === 1 || !bands[i]?.length) return reg
    return cleanSmall(boolOp('difference', reg, bands[i], eps) ?? reg)
  })
  const pieces: ContourPiece[] = []
  const byPlate: { piece: number; e: Ringed }[][] = []
  finals.forEach((ps, i) => {
    const p = i + 1
    const sorted = ps.map((poly) => ({ poly, area: polyArea(poly) })).sort((a, b) => b.area - a.area)
    byPlate.push(
      sorted.map(({ poly, area }, j) => {
        pieces.push({ id: sorted.length > 1 ? `${p}-${j + 1}` : `${p}`, plate: p, kind: 'plate', poly, area, engrave: [], label: { at: [0, 0], size: 4, hidden: false } })
        return { piece: pieces.length - 1, e: ringed(poly) }
      }),
    )
  })
  const findPiece = (p: number, x: number, y: number) => {
    for (const { piece, e } of byPlate[p - 1] ?? []) if (inRinged(e, x, y)) return piece
    return -1
  }
  const plateOfZ = (z: number) => Math.max(1, Math.min(K, Math.floor((z - base) / dz + 1e-9) + 1))
  /** 위에서 보이는 판 조각 (높이로 어림한 뒤 실제 조각 모양으로 확인) */
  const topPiece = (x: number, y: number) => {
    let p = plateOfZ(zAt(x, y))
    while (p < K && findPiece(p + 1, x, y) >= 0) p++
    for (; p >= 1; p--) {
      const i = findPiece(p, x, y)
      if (i >= 0) return i
    }
    return -1
  }

  // ── 새김선: 선을 따라가며 어느 조각 위에 놓이는지 나누고, 모형 테두리 위 부분은 뺌
  const step = mm(STEP_MM)
  const be = Math.max(1e-3, half * 1e-6)
  const onBorder = (a: XY, b: XY) =>
    (Math.abs(a[0] - half) < be && Math.abs(b[0] - half) < be) ||
    (Math.abs(a[0] + half) < be && Math.abs(b[0] + half) < be) ||
    (Math.abs(a[1] - half) < be && Math.abs(b[1] - half) < be) ||
    (Math.abs(a[1] + half) < be && Math.abs(b[1] + half) < be)
  const minRun = mm(0.3)
  const addEngrave = (ring: XY[], closed: boolean, kind: EngraveKind, finder: (x: number, y: number) => number) => {
    const pts = densify(ring, step, closed)
    if (pts.length < 2) return
    const push = (piece: number, run: XY[]) => {
      if (piece < 0 || run.length < 2) return
      let cur: XY[] = [run[0]]
      const flush = () => {
        if (cur.length > 1 && lenOf(cur) >= minRun) pieces[piece].engrave.push({ kind, pts: simplifyLine(cur, tol) })
      }
      for (let i = 1; i < run.length; i++) {
        if (onBorder(run[i - 1], run[i])) {
          flush()
          cur = [run[i]]
        } else cur.push(run[i])
      }
      flush()
    }
    let prev = finder(pts[0][0], pts[0][1])
    let run: XY[] = [pts[0]]
    for (let i = 1; i < pts.length; i++) {
      const q = pts[i]
      const pq = finder(q[0], q[1])
      if (pq === prev) {
        run.push(q)
        continue
      }
      // 조각이 바뀌는 곳을 반으로 나눠 찾기
      let a = pts[i - 1]
      let b = q
      for (let it = 0; it < 7; it++) {
        const m: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        if (finder(m[0], m[1]) === prev) a = m
        else b = m
      }
      const cut: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      run.push(cut)
      push(prev, run)
      run = [cut, q]
      prev = pq
    }
    push(prev, run)
  }

  onProgress?.('새김선 나누는 중')
  // 맞춤 표시: 위 판(p) 조각의 윤곽을 아래 판(p − 1)에
  for (let p = 2; p <= K; p++)
    for (const { piece } of byPlate[p - 1]) {
      const poly = pieces[piece].poly
      for (const r of [poly.outer, ...poly.holes]) addEngrave(r, true, 'align', (x, y) => findPiece(p - 1, x, y))
    }
  // 도로
  const roadPieces: { plate: number; poly: Poly; area: number }[] = []
  if (inp.roadMode === 'engrave' || !bands.length) {
    for (const poly of roads) for (const r of [poly.outer, ...poly.holes]) addEngrave(r, true, 'road', topPiece)
  } else {
    bands.forEach((ps, i) => {
      const p = i + 1
      for (const poly of ps) {
        // 파내기: 판 1은 뚫을 수 없으니 새김. 따로 자른 조각: 붙일 자리를 새김
        if (inp.roadMode === 'pieces' || p === 1) for (const r of [poly.outer, ...poly.holes]) addEngrave(r, true, 'road', (x, y) => findPiece(p, x, y))
        if (inp.roadMode === 'pieces') roadPieces.push({ plate: p, poly, area: polyArea(poly) })
      }
    })
  }
  for (const r of inp.buildings) addEngrave(r, true, 'bldg', topPiece)
  for (const r of inp.site) addEngrave(r, true, 'site', topPiece)

  // 도로 조각 (따로 자른 조각)
  const byPlateRoad = new Map<number, typeof roadPieces>()
  for (const rp of roadPieces) byPlateRoad.set(rp.plate, [...(byPlateRoad.get(rp.plate) ?? []), rp])
  const roadIdx: { piece: number; e: Ringed }[] = []
  for (const [p, list] of [...byPlateRoad].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => b.area - a.area)
    list.forEach((rp, j) => {
      pieces.push({ id: list.length > 1 ? `R${p}-${j + 1}` : `R${p}`, plate: p, kind: 'road', poly: rp.poly, area: rp.area, engrave: [], label: { at: [0, 0], size: 3, hidden: false } })
      roadIdx.push({ piece: pieces.length - 1, e: ringed(rp.poly) })
    })
  }

  // ── 번호 자리: 위 판에 가려지는 곳(붙이면 안 보임)을 먼저, 글자가 조각 안에 들어가게
  onProgress?.('판 번호 자리 찾는 중')
  const placeLabel = (piece: ContourPiece, e: Ringed, cover: { e: Ringed }[]) => {
    const [a, b, c, d] = e.bbox
    const N = 16
    const cands: { at: XY; d: number; dn: number }[] = []
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const x = a + ((i + 0.5) / N) * (c - a)
        const y = b + ((j + 0.5) / N) * (d - b)
        if (!inRinged(e, x, y)) continue
        const dd = distRinged(e, x, y)
        let dn = -1
        for (const q of cover)
          if (inRinged(q.e, x, y)) {
            dn = distRinged(q.e, x, y)
            break
          }
        cands.push({ at: [x, y], d: dd, dn })
      }
    if (!cands.length) {
      // 아주 가는 조각: 바깥 고리 꼭짓점 평균(안에 없으면 첫 변 가운데)
      const o = piece.poly.outer
      const m: XY = [o.reduce((s, p) => s + p[0], 0) / o.length, o.reduce((s, p) => s + p[1], 0) / o.length]
      piece.label = { at: inRinged(e, m[0], m[1]) ? m : [(o[0][0] + o[1][0]) / 2, (o[0][1] + o[1][1]) / 2], size: 2, hidden: false }
      return
    }
    for (const size of piece.kind === 'road' ? [3, 2] : [4, 3, 2]) {
      const r = mm(Math.hypot(textWidth(piece.id, size) / 2, size / 2) + 0.8)
      const hid = cands.filter((q) => q.d >= r && q.dn >= r)
      if (hid.length) {
        const best = hid.reduce((s, q) => (Math.min(q.d, q.dn) > Math.min(s.d, s.dn) ? q : s))
        piece.label = { at: best.at, size, hidden: true }
        return
      }
      const vis = cands.filter((q) => q.d >= r)
      if (vis.length) {
        piece.label = { at: vis.reduce((s, q) => (q.d > s.d ? q : s)).at, size, hidden: false }
        return
      }
    }
    piece.label = { at: cands.reduce((s, q) => (q.d > s.d ? q : s)).at, size: 2, hidden: false }
  }
  byPlate.forEach((list, i) => {
    for (const { piece, e } of list) placeLabel(pieces[piece], e, byPlate[i + 1] ?? [])
  })
  for (const { piece, e } of roadIdx) placeLabel(pieces[piece], e, [])

  // ── 재료 판 위 배치
  onProgress?.('재료 판에 배치하는 중')
  const itemOf = (i: number): LayoutItem => {
    const o = pieces[i].poly.outer
    let a = Infinity
    let b = Infinity
    let c = -Infinity
    let d = -Infinity
    for (const [x, y] of o) {
      a = Math.min(a, x * k)
      b = Math.min(b, y * k)
      c = Math.max(c, x * k)
      d = Math.max(d, y * k)
    }
    return { piece: i, minx: a, miny: b, w: c - a, h: d - b, area: pieces[i].area * k * k }
  }
  const groups: SheetGroup[] = []
  const plateItems = pieces.flatMap((p, i) => (p.kind === 'plate' ? [itemOf(i)] : []))
  groups.push(layoutGroup(plateItems, inp.sheetW, inp.sheetH, 'plate', thickness))
  const roadItems = pieces.flatMap((p, i) => (p.kind === 'road' ? [itemOf(i)] : []))
  if (roadItems.length) groups.push(layoutGroup(roadItems, inp.sheetW, inp.sheetH, 'road', ROAD_T))
  const over = groups.flatMap((g) => g.sheets.filter((s) => s.oversize))
  if (over.length) {
    const big = over.reduce((s, q) => (q.w * q.h > s.w * s.h ? q : s))
    warnings.push(
      `재료 판(${inp.sheetW}×${inp.sheetH}mm)보다 큰 조각이 ${over.length}개 있습니다 (가장 큰 것 약 ${Math.round(big.w - 2 * SHEET_MARGIN)}×${Math.round(big.h - 2 * SHEET_MARGIN)}mm) — 모형 크기를 줄이거나 재료 판을 키우세요. 파일에는 따로 큰 판으로 둡니다`,
    )
  }

  return {
    half,
    scale,
    thickness,
    sheetW: inp.sheetW,
    sheetH: inp.sheetH,
    roadMode: inp.roadMode,
    interval: dz,
    levels: Array.from({ length: K }, (_, i) => level(i + 1)),
    plates: K,
    lo,
    hi,
    pieces,
    groups,
    removed,
    side: 2 * half * k,
    height: K * thickness,
    warnings,
    ms: Date.now() - t0,
  }
}
