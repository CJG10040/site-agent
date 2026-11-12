// 3D 모형(.3dm)·CAD 밑그림(DXF)에 쓸 대지 모형을 만든다.
// 좌표: 대지 중심 = 원점. EPSG:5179(UTM-K) 미터 좌표에서 원점 좌표를 뺀 값 (x 동쪽, y 북쪽 = 격자 북, 진북과 1° 안쪽 차이).
// 높이: 대지 중심 지면 = 0m (국토지리정보원 등고선으로 만든 10m 지형 격자). 건물 높이는 실측 높이 또는 층수 × 용도별 층고 (data.ts bldHeight).
// 사용자 결정(2026-11-11): 원점은 대지 중심, 파일에 원점의 실제 좌표를 적는다. 지형은 지금의 10m 격자로 먼저 만들고,
// 나중에 더 정밀한 지형(1·5m DEM, 현황측량)을 구하면 terrainAround 자리만 바꿔 끼운다.

import { featureCollection, intersect, polygon as turfPolygon, union } from '@turf/turf'
import { contours } from 'd3-contour'
import earcut from 'earcut'
import type { Position } from 'geojson'
import { bldHeight, inNgii, type DiagramData } from '../diagrams/data'
import type { Areal } from '../lib/geo'
import { wgs84To5186, wgs84ToUtmk } from '../lib/proj'
import { terrainAround, type TerrainGrid } from '../lib/terrain'
import { hatchStripes, markGlyph, roadDirs, zebraStripes } from './streetDetail'

export type XY = [number, number]

/** 고리는 닫는 점(처음 = 끝) 없이. 바깥 = 반시계, 구멍 = 시계 */
export interface Poly {
  outer: XY[]
  holes: XY[][]
}

export interface ModelBuilding {
  parts: Poly[]
  /** 바닥 높이: 발자국 아래 가장 낮은 지면 (조금 묻음) */
  base: number
  /** 지붕 높이: 발자국 평균 지면 + 건물 높이(실측 또는 층수 × 용도별 층고). 모르면 null (발자국만) */
  top: number | null
  floors: number | null
  name: string
  use: string
  onSite: boolean
}

export interface ModelArea {
  polys: Poly[]
  name: string
}

export interface ModelParcel extends ModelArea {
  jibun: string
  jimok: string
  onSite: boolean
}

export interface ModelContour {
  level: number
  major: boolean
  /** 닫힌 선이면 처음 점을 끝에 한 번 더 */
  pts: XY[]
}

export interface ModelTerrain {
  cols: number
  rows: number
  /** 첫 점(북서쪽) 좌표 — 점 간격 cell, 행은 남쪽으로 */
  x0: number
  y0: number
  cell: number
  /** 상대 높이 (대지 중심 지면 = 0), 자료 없음 = NaN */
  z: Float32Array
}

export interface SiteModel {
  origin: { lon: number; lat: number; x5179: number; y5179: number; x5186: number; y5186: number; elev: number | null; trueNorthDeg: number }
  /** 내보내는 정사각형의 반쪽 길이 (m) */
  half: number
  terrain: ModelTerrain | null
  terrainSource: TerrainGrid['source'] | null
  terrainVersion: string | null
  contourStep: number
  contours: ModelContour[]
  site: Poly[]
  buildings: ModelBuilding[]
  parcels: ModelParcel[]
  /** 도로 면: 수치지도 도로경계 면(올린 도엽 안)을 합친 것 + 그 밖은 도로중심선을 폭만큼 넓혀 합친 것 */
  roads: Poly[]
  roadSource: 'map' | 'centerline' | 'mixed'
  roadCenters: { pts: XY[]; width: number | null }[]
  parks: ModelArea[]
  rivers: ModelArea[]
  /** 아래는 수치지도를 올렸을 때만 (없으면 빈 배열) */
  walks: Poly[]
  /** 무벽건물(지붕만)·가건물 발자국 */
  minor: Poly[]
  walls: { pts: XY[]; kind: string; h: number | null; top: boolean }[]
  cutfill: { pts: XY[]; kind: string; top: boolean }[]
  /** 수치지도 등고선 원본 (z = 대지 중심 지면 기준 상대 높이, level = 해발) */
  mapContours: { pts: XY[]; z: number; level: number; major: boolean }[]
  /** 표고점·기준점 (z = 상대 높이, level = 해발) */
  spots: { x: number; y: number; z: number; level: number }[]
  mapYear: string | null
  /** 1:1,000 수치지도를 올렸을 때 (15-F) */
  map1000: boolean
  trees: { x: number; y: number; h: number | null; kind: string }[]
  /** along = 도로 방향, toRoad = 도로 쪽 (가까운 도로중심선으로, 모르면 동쪽·북쪽) */
  stops: { x: number; y: number; name: string; use: string; along: XY; toRoad: XY }[]
  lamps: { x: number; y: number; toRoad: XY | null }[]
  crosswalks: Poly[]
  /** 횡단보도 줄무늬 (45cm 칠·45cm 빔, 도로 방향) */
  zebra: Poly[]
  /** 안전지대 (1:1,000 A005): 교통섬 = 올라온 섬, 칠한 안전지대 = 노란 빗금, 어린이보호구역 = 적색 포장 */
  safety: { poly: Poly; kind: 'island' | 'painted' | 'school' }[]
  /** 칠한 안전지대 빗금 */
  hatch: Poly[]
  /** 정밀도로지도 신호등 (2026-11-13): h = 땅 위 높이, axis = 등 상자의 긴 방향(차량등은 팔 방향) */
  signals: { x: number; y: number; h: number; vehicle: boolean; axis: XY }[]
  /** 교통안전표지 판: cat 1 주의 · 2 규제 · 3 지시 · 4 보조, h = 판 아래 끝 높이, axis = 판의 가로 방향 */
  signs: { x: number; y: number; h: number; ph: number; pw: number; cat: number; axis: XY }[]
  /** 지주 (신호등·표지판이 달린 기둥): top = 기둥 높이, arms = 차량 신호등까지 뻗은 팔, kinds = 무엇이 달렸나 */
  poles: { x: number; y: number; top: number; arms: { to: XY; h: number }[]; kinds: ('signal' | 'sign')[] }[]
  /** 방호시설 (가드레일·중앙분리대 등): central = 중앙분리대 */
  barriers: { pts: XY[]; central: boolean }[]
  /** 과속방지턱 */
  bumps: Poly[]
  fences: { pts: XY[]; kind: string }[]
  /** 정밀도로지도를 올렸을 때 (15-F) */
  lanes: { pts: XY[]; color: 'yellow' | 'white' | 'blue'; dashed: boolean; double: boolean }[]
  marks: Poly[]
  /** 노면표시 실제 모양 (2026-11-13): 화살표·횡단보도예고·오르막경사면 (흰색), 정차금지지대 (노란 테두리·빗금) */
  arrows: Poly[]
  yellowMarks: Poly[]
  hdPaths: Poly[]
  curbs: XY[][]
  /** 지형 면 위의 높이 (메시와 같은 삼각형으로 보간, 자료 없으면 0) */
  zAt: (x: number, y: number) => number
}

// ───────────────────────── 도형 도우미 ─────────────────────────

export function ringArea(r: XY[]): number {
  let s = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]
  return s / 2
}

function cleanRing(r: XY[]): XY[] {
  const out: XY[] = []
  for (const p of r) {
    const q = out[out.length - 1]
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.02) out.push(p)
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 0.02) out.pop()
  return out
}

function orient(r: XY[], ccw: boolean): XY[] {
  return ringArea(r) > 0 === ccw ? r : [...r].reverse()
}

function toPoly(rings: XY[][]): Poly | null {
  const rs = rings.map(cleanRing).filter((r) => r.length >= 3 && Math.abs(ringArea(r)) > 0.05)
  if (!rs.length) return null
  return { outer: orient(rs[0], true), holes: rs.slice(1).map((h) => orient(h, false)) }
}

function polysOf(g: Areal, f: (p: Position) => XY): Poly[] {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  return polys.map((p) => toPoly(p.map((r) => r.map(f)))).filter((p): p is Poly => !!p)
}

function bboxOf(r: XY[]): [number, number, number, number] {
  let a = Infinity
  let b = Infinity
  let c = -Infinity
  let d = -Infinity
  for (const [x, y] of r) {
    if (x < a) a = x
    if (y < b) b = y
    if (x > c) c = x
    if (y > d) d = y
  }
  return [a, b, c, d]
}

/** 정사각형(±h)으로 자른다. 걸친 도형만 불리언 교차로 (오목한 도형도 바르게) */
function clipPolys(polys: Poly[], h: number): Poly[] {
  const out: Poly[] = []
  const close = (r: XY[]) => [...r, r[0]]
  for (const p of polys) {
    const [a, b, c, d] = bboxOf(p.outer)
    if (c < -h || a > h || d < -h || b > h) continue
    if (a >= -h && c <= h && b >= -h && d <= h) {
      out.push(p)
      continue
    }
    try {
      const res = intersect(
        featureCollection([
          turfPolygon([close(p.outer), ...p.holes.map(close)]),
          turfPolygon([
            [
              [-h, -h],
              [h, -h],
              [h, h],
              [-h, h],
              [-h, -h],
            ],
          ]),
        ]),
      )
      if (!res) continue
      const g = res.geometry
      const ps = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
      for (const q of ps) {
        const poly = toPoly(q.map((r) => r.map(([x, y]) => [x, y] as XY)))
        if (poly) out.push(poly)
      }
    } catch {
      // 자르기에 실패한 도형은 뺀다
    }
  }
  return out
}

/** 선을 정사각형(±h) 안 조각들로 (Liang–Barsky) */
function clipLine(pts: XY[], h: number): XY[][] {
  const out: XY[][] = []
  let cur: XY[] = []
  const flush = () => {
    if (cur.length > 1) out.push(cur)
    cur = []
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    const dx = x1 - x0
    const dy = y1 - y0
    let t0 = 0
    let t1 = 1
    let ok = true
    for (const [p, q] of [
      [-dx, x0 + h],
      [dx, h - x0],
      [-dy, y0 + h],
      [dy, h - y0],
    ]) {
      if (p === 0) {
        if (q < 0) ok = false
      } else {
        const t = q / p
        if (p < 0) t0 = Math.max(t0, t)
        else t1 = Math.min(t1, t)
      }
    }
    if (!ok || t0 > t1) {
      flush()
      continue
    }
    const a: XY = [x0 + dx * t0, y0 + dy * t0]
    const b: XY = [x0 + dx * t1, y0 + dy * t1]
    const last = cur[cur.length - 1]
    if (!last || Math.hypot(last[0] - a[0], last[1] - a[1]) > 1e-6) {
      flush()
      cur.push(a)
    }
    cur.push(b)
    if (t1 < 1) flush()
  }
  flush()
  return out
}

/** 더글러스–포커 단순화 (닫힌 고리는 처음 = 끝인 채로 넘김) */
function simplify(pts: XY[], tol: number): XY[] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = pts[a]
    const [bx, by] = pts[b]
    const len = Math.hypot(bx - ax, by - ay)
    let worst = -1
    let wi = -1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]
      const d = len < 1e-9 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len
      if (d > worst) {
        worst = d
        wi = i
      }
    }
    if (worst > tol && wi > 0) {
      keep[wi] = 1
      stack.push([a, wi], [wi, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** 변이 step보다 길면 사이에 점을 넣는다 */
export function densify(pts: XY[], step: number, closed: boolean): XY[] {
  const out: XY[] = []
  const n = pts.length
  const m = closed ? n : n - 1
  for (let i = 0; i < m; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    out.push(a)
    const k = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)
    for (let j = 1; j <= k; j++) {
      const t = j / (k + 1)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  if (!closed && n) out.push(pts[n - 1])
  return out
}

/**
 * 면을 삼각형으로 (지형에 얹기 좋게 maxEdge보다 긴 삼각형은 네 개로 나눔). 삼각형은 모두 반시계(위를 향함).
 * 반환: 점 목록과 삼각형 꼭짓점 번호
 */
export function triangulate(p: Poly, maxEdge: number): { pts: XY[]; tris: number[] } {
  // 경계를 미리 촘촘히 하면 earcut이 거의 납작한 삼각형을 만들어 끝없이 쪼개진다 → 그대로 넣고,
  // 긴 변은 양쪽 삼각형이 같은 가운데 점으로 나누므로 이음매가 맞는다
  const rings = [p.outer, ...p.holes]
  const flat: number[] = []
  const holes: number[] = []
  const pts: XY[] = []
  rings.forEach((r, i) => {
    if (i) holes.push(pts.length)
    for (const q of r) {
      pts.push(q)
      flat.push(q[0], q[1])
    }
  })
  const idx = earcut(flat, holes, 2)
  const tris: number[] = []
  const mid = new Map<string, number>()
  const midpoint = (a: number, b: number) => {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`
    let m = mid.get(k)
    if (m === undefined) {
      m = pts.length
      pts.push([(pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2])
      mid.set(k, m)
    }
    return m
  }
  const edge = (a: number, b: number) => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1])
  // 가장 긴 변만 반으로 (가늘고 긴 삼각형도 길이 방향으로만 늘어남)
  const area2 = (a: number, b: number, c: number) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[c][0] - pts[a][0]) * (pts[b][1] - pts[a][1])
  const push = (a: number, b: number, c: number, depth: number) => {
    if (Math.abs(area2(a, b, c)) < 1e-4) return
    const ab = edge(a, b)
    const bc = edge(b, c)
    const ca = edge(c, a)
    const longest = Math.max(ab, bc, ca)
    if (depth < 18 && longest > maxEdge) {
      if (longest === ab) {
        const m = midpoint(a, b)
        push(a, m, c, depth + 1)
        push(m, b, c, depth + 1)
      } else if (longest === bc) {
        const m = midpoint(b, c)
        push(a, b, m, depth + 1)
        push(a, m, c, depth + 1)
      } else {
        const m = midpoint(c, a)
        push(a, b, m, depth + 1)
        push(m, b, c, depth + 1)
      }
      return
    }
    const s = (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[c][0] - pts[a][0]) * (pts[b][1] - pts[a][1])
    if (Math.abs(s) < 1e-9) return
    if (s > 0) tris.push(a, b, c)
    else tris.push(a, c, b)
  }
  for (let i = 0; i < idx.length; i += 3) push(idx[i], idx[i + 1], idx[i + 2], 0)
  return { pts, tris }
}

// ───────────────────────── 지형 ─────────────────────────

/** 지형 격자 위 높이: 메시와 같은 대각선(북서–남동)으로 나눈 삼각형 안에서 보간 */
function makeZAt(g: TerrainGrid, X0: number, Y0: number, z0: number) {
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

function terrainSubset(g: TerrainGrid, X0: number, Y0: number, z0: number, half: number): ModelTerrain | null {
  const c0 = Math.max(0, Math.ceil((X0 - half - g.x0) / g.cell - 0.5))
  const c1 = Math.min(g.nx - 1, Math.floor((X0 + half - g.x0) / g.cell - 0.5))
  const r0 = Math.max(0, Math.ceil((g.y0 - (Y0 + half)) / g.cell - 0.5))
  const r1 = Math.min(g.ny - 1, Math.floor((g.y0 - (Y0 - half)) / g.cell - 0.5))
  const cols = c1 - c0 + 1
  const rows = r1 - r0 + 1
  if (cols < 2 || rows < 2) return null
  const z = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) z[r * cols + c] = g.z[(r0 + r) * g.nx + c0 + c] - z0
  return { cols, rows, x0: g.x0 + (c0 + 0.5) * g.cell - X0, y0: g.y0 - (r0 + 0.5) * g.cell - Y0, cell: g.cell, z }
}

/** 기복에 맞는 등고선 간격 (선 40개 안쪽) */
export function contourStepFor(relief: number): number {
  for (const s of [1, 2, 5, 10, 20, 25, 50]) if (relief / s <= 40) return s
  return 100
}

function contourLinesOf(t: ModelTerrain): { step: number; lines: ModelContour[] } {
  let lo = Infinity
  let hi = -Infinity
  for (const v of t.z) {
    if (Number.isNaN(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!Number.isFinite(lo) || hi - lo < 1) return { step: 1, lines: [] }
  const step = contourStepFor(hi - lo)
  const values = Array.from(t.z, (v) => (Number.isNaN(v) ? lo - step : v))
  const levels: number[] = []
  for (let l = Math.ceil(lo / step) * step; l <= hi; l += step) levels.push(Math.round(l * 1000) / 1000)
  // d3-contour: 값 i는 칸 [i, i+1]의 가운데(i + 0.5), 격자 테두리(0·n)를 따라 닫힘 → 테두리 점에서 끊는다
  const onEdge = ([gx, gy]: number[]) => gx <= 0 || gy <= 0 || gx >= t.cols || gy >= t.rows
  const toXY = ([gx, gy]: number[]): XY => [t.x0 + (gx - 0.5) * t.cell, t.y0 - (gy - 0.5) * t.cell]
  const lines: ModelContour[] = []
  for (const mp of contours().size([t.cols, t.rows]).thresholds(levels)(values)) {
    const major = Math.round(mp.value / step) % 5 === 0
    for (const poly of mp.coordinates)
      for (const ring of poly) {
        const open = ring.slice(0, -1)
        const k = open.findIndex(onEdge)
        if (k < 0) {
          lines.push({ level: mp.value, major, pts: simplify(ring.map(toXY), 0.05) })
          continue
        }
        // 테두리 점에서 시작하도록 돌려 놓고 테두리마다 끊는다
        const rot = [...open.slice(k), ...open.slice(0, k), open[k]]
        let cur: XY[] = []
        for (const p of rot) {
          if (onEdge(p)) {
            if (cur.length > 1) lines.push({ level: mp.value, major, pts: simplify(cur, 0.05) })
            cur = []
          } else cur.push(toXY(p))
        }
        if (cur.length > 1) lines.push({ level: mp.value, major, pts: simplify(cur, 0.05) })
      }
  }
  return { step, lines }
}

// ───────────────────────── 도로 면 ─────────────────────────

/** 도로중심선을 폭의 반만큼 넓힌 거리장(칸 1~2m)을 만들고 경계선(0)을 따서 합친 도로 면을 얻는다 */
function roadSurfaces(lines: { pts: XY[]; width: number | null }[], half: number): Poly[] {
  const res = half <= 700 ? 1 : 2
  const n = Math.ceil((2 * half) / res)
  const F = new Float32Array(n * n).fill(-3)
  for (const { pts, width } of lines) {
    const r = (width ?? 4) / 2
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i]
      const [bx, by] = pts[i + 1]
      const dx = bx - ax
      const dy = by - ay
      const L2 = dx * dx + dy * dy
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - 2 + half) / res))
      const i1 = Math.min(n - 1, Math.floor((Math.max(ax, bx) + r + 2 + half) / res))
      const j0 = Math.max(0, Math.floor((half - Math.max(ay, by) - r - 2) / res))
      const j1 = Math.min(n - 1, Math.floor((half - Math.min(ay, by) + r + 2) / res))
      for (let j = j0; j <= j1; j++) {
        const py = half - (j + 0.5) * res
        for (let ii = i0; ii <= i1; ii++) {
          const px = -half + (ii + 0.5) * res
          let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0
          t = t < 0 ? 0 : t > 1 ? 1 : t
          const v = r - Math.hypot(px - ax - t * dx, py - ay - t * dy)
          const k = j * n + ii
          if (v > F[k]) F[k] = v > 3 ? 3 : v
        }
      }
    }
  }
  const out: Poly[] = []
  const toXY = ([gx, gy]: number[]): XY => [-half + gx * res, half - gy * res]
  for (const mp of contours().size([n, n]).thresholds([0])(F as unknown as number[]))
    for (const poly of mp.coordinates) {
      const p = toPoly(poly.map((ring) => simplify(ring.map(toXY), 0.15)))
      if (p && ringArea(p.outer) > 4) out.push(p)
    }
  return out
}

// ───────────────────────── 모형 만들기 ─────────────────────────

/**
 * @param opts.grid 지형 격자를 직접 줄 때 (나중에 더 정밀한 DEM·현황측량을 올려 쓰는 자리). 주지 않으면 10m 지형 타일을 읽는다.
 */
export async function buildSiteModel(d: DiagramData, half: number, opts: { grid?: TerrainGrid | null } = {}): Promise<SiteModel> {
  const [lon, lat] = d.center
  const [X0, Y0] = wgs84ToUtmk(lon, lat)
  const [x5186, y5186] = wgs84To5186(lon, lat)
  const f = ([lo, la]: Position): XY => {
    const [x, y] = wgs84ToUtmk(lo, la)
    return [x - X0, y - Y0]
  }
  // 진북 방향 (모형 좌표에서 +y에서 시계 방향으로 몇 도)
  const [nx, ny] = f([lon, lat + 0.01])
  const trueNorthDeg = (Math.atan2(nx, ny) * 180) / Math.PI

  const grid = opts.grid !== undefined ? opts.grid : await terrainAround(lon, lat, d.R).catch(() => null)
  let z0 = 0
  let elev: number | null = null
  if (grid) {
    const raw = makeZAt(grid, X0, Y0, 0)(0, 0)
    if (raw !== 0) {
      z0 = raw
      elev = raw
    }
  }
  const zAt = grid ? makeZAt(grid, X0, Y0, z0) : () => 0
  const terrain = grid ? terrainSubset(grid, X0, Y0, z0, half) : null
  const { step, lines } = terrain ? contourLinesOf(terrain) : { step: 1, lines: [] }

  const inSquare = ([x, y]: XY) => Math.abs(x) <= half && Math.abs(y) <= half

  const buildings: ModelBuilding[] = []
  for (const b of d.buildings) {
    if (b.underground) continue
    const parts = polysOf(b.geom, f)
    if (!parts.length) continue
    const o = parts[0].outer
    const cx = o.reduce((s, p) => s + p[0], 0) / o.length
    const cy = o.reduce((s, p) => s + p[1], 0) / o.length
    if (!inSquare([cx, cy])) continue
    const zs = [...parts.flatMap((p) => p.outer.map(([x, y]) => zAt(x, y))), zAt(cx, cy)]
    const base = Math.min(...zs) - 0.2
    const mean = zs.reduce((s, z) => s + z, 0) / zs.length
    buildings.push({
      parts,
      base,
      top: bldHeight(b) !== null ? mean + (bldHeight(b) as number) : null,
      floors: b.floors,
      name: b.name,
      use: b.use,
      onSite: b.onSite,
    })
  }

  const parcels: ModelParcel[] = []
  for (const p of d.parcels) {
    const polys = clipPolys(polysOf(p.geom, f), half)
    if (polys.length) parcels.push({ polys, name: p.jibun, jibun: p.jibun, jimok: p.jimok, onSite: p.onSite })
  }
  const parks: ModelArea[] = []
  const rivers: ModelArea[] = []
  for (const a of d.parks) {
    const polys = clipPolys(polysOf(a.geom, f), half)
    if (polys.length) (a.extra.kind === 'river' ? rivers : parks).push({ polys, name: a.name })
  }

  const centers = d.roads.flatMap((r) => {
    const parts = r.geom.type === 'LineString' ? [r.geom.coordinates] : r.geom.coordinates
    return parts.map((c) => ({ pts: c.map(f), width: r.width }))
  })
  const roadCenters = centers.flatMap((c) => clipLine(c.pts, half).map((pts) => ({ pts, width: c.width })))

  // ── 수치지도: 도엽 안 도로는 측량한 도로경계 면을 합쳐 쓰고, 도엽 밖만 도로중심선으로
  const n = d.ngii
  const lonlatOf = ([x, y]: XY): [number, number] => {
    // 원점 주변 1차식 (범위 몇 km 안에서 충분)
    const kx = 111320 * Math.cos((lat * Math.PI) / 180)
    const t = (trueNorthDeg * Math.PI) / 180
    const ex = x * Math.cos(t) - y * Math.sin(t)
    const ny2 = x * Math.sin(t) + y * Math.cos(t)
    return [lon + ex / kx, lat + ny2 / 110574]
  }
  const covered = (p: XY) => {
    const [lo, la] = lonlatOf(p)
    return inNgii(n, lo, la)
  }
  let roads: Poly[]
  let roadSource: SiteModel['roadSource'] = 'centerline'
  if (n && n.roads.length) {
    const pieces = clipPolys(
      n.roads.flatMap((g) => polysOf(g, f)),
      half,
    )
    const close = (r: XY[]) => [...r, r[0]]
    let merged: Poly[] = pieces
    try {
      const u = pieces.length > 1 ? union(featureCollection(pieces.map((p) => turfPolygon([close(p.outer), ...p.holes.map(close)])))) : null
      if (u) {
        const g = u.geometry
        merged = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((q) => toPoly(q.map((r) => r.map(([x, y]) => [x, y] as XY)))).filter((p): p is Poly => !!p)
      }
    } catch {
      // 합치기에 실패하면 조각 그대로
    }
    const corners: XY[] = [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ]
    const full = corners.every(covered)
    const outside = full ? [] : centers.filter((c) => c.pts.length && !covered(c.pts[Math.floor(c.pts.length / 2)]))
    roads = [...merged, ...(outside.length ? roadSurfaces(outside, half) : [])]
    roadSource = outside.length ? 'mixed' : 'map'
  } else roads = roadSurfaces(centers, half)

  const linesOfGeom = (g: { type: string; coordinates: unknown }) =>
    (g.type === 'LineString' ? [g.coordinates as Position[]] : (g.coordinates as Position[][])).map((c) => c.map(f))
  const walks = n ? clipPolys(n.walks.flatMap((g) => polysOf(g, f)), half) : []
  const minor = n
    ? n.minor.flatMap((g) => polysOf(g, f)).filter((p) => {
        const o = p.outer
        return inSquare([o.reduce((s, q) => s + q[0], 0) / o.length, o.reduce((s, q) => s + q[1], 0) / o.length])
      })
    : []
  const walls = n ? n.walls.flatMap((w) => linesOfGeom(w.geom).flatMap((l) => clipLine(l, half)).map((pts) => ({ pts, kind: w.kind, h: w.h, top: w.top }))) : []
  const cutfill = n ? n.cutfill.flatMap((w) => linesOfGeom(w.geom).flatMap((l) => clipLine(l, half)).map((pts) => ({ pts, kind: w.kind, top: w.top }))) : []
  const mapContours = n
    ? n.contours.flatMap((c) => linesOfGeom(c.geom).flatMap((l) => clipLine(l, half)).map((pts) => ({ pts, z: c.z - z0, level: c.z, major: c.major })))
    : []
  // ── 1:1,000 수치지도·정밀도로지도 디테일 (15-F)
  const ptIn = (lo: number, la: number) => {
    const xy = f([lo, la])
    return inSquare(xy) ? xy : null
  }
  const trees = n
    ? n.trees.flatMap((t) => {
        const xy = ptIn(t.lon, t.lat)
        return xy ? [{ x: xy[0], y: xy[1], h: t.h, kind: t.kind }] : []
      })
    : []
  // 도로 방향: 도로중심선(브이월드 + 1:1,000 수치지도) — 횡단보도 줄 방향, 쉘터·가로등이 보는 쪽
  const dirLines = [...centers.map((c) => c.pts), ...(n ? n.centers.flatMap((c) => linesOfGeom(c.geom)) : [])].flatMap((l) => clipLine(l, half + 50))
  const dirs = roadDirs(dirLines)
  const towards = (x: number, y: number, maxD: number) => {
    const r = dirs.near(x, y, maxD)
    if (!r) return null
    const dx = r.foot[0] - x
    const dy = r.foot[1] - y
    const L = Math.hypot(dx, dy)
    // 중심선 바로 위면 방향의 법선 쪽으로
    const toRoad: XY = L > 0.3 ? [dx / L, dy / L] : [-r.dir[1], r.dir[0]]
    return { along: r.dir, toRoad }
  }
  const stops = n
    ? n.stops.flatMap((t) => {
        const xy = ptIn(t.lon, t.lat)
        if (!xy) return []
        const w = towards(xy[0], xy[1], 40)
        return [{ x: xy[0], y: xy[1], name: t.name, use: t.use, along: w?.along ?? ([1, 0] as XY), toRoad: w?.toRoad ?? ([0, 1] as XY) }]
      })
    : []
  const lamps = n
    ? n.lamps.flatMap((t) => {
        const xy = ptIn(t.lon, t.lat)
        return xy ? [{ x: xy[0], y: xy[1], toRoad: towards(xy[0], xy[1], 30)?.toRoad ?? null }] : []
      })
    : []
  const cw1000 = n ? clipPolys(n.crosswalks.flatMap((g) => polysOf(g, f)), half) : []
  // 정밀도로지도 횡단보도: 1:1,000 횡단보도와 겹치면 뺌 (같은 것을 두 번 그리지 않게)
  const inPoly = ([x, y]: XY, r: XY[]) => {
    let inside = false
    for (let i = 0, j = r.length - 1; i < r.length; j = i++)
      if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside
    return inside
  }
  const cwHd = d.hd
    ? clipPolys(d.hd.crosswalks.flatMap((g) => polysOf(g, f)), half).filter((p) => {
        const o = p.outer
        const c: XY = [o.reduce((s, q) => s + q[0], 0) / o.length, o.reduce((s, q) => s + q[1], 0) / o.length]
        return !cw1000.some((q) => inPoly(c, q.outer))
      })
    : []
  const crosswalks = [...cw1000, ...cwHd]
  const zebra = crosswalks.flatMap((cw) => {
    const o = cw.outer
    const c: XY = [o.reduce((s, p) => s + p[0], 0) / o.length, o.reduce((s, p) => s + p[1], 0) / o.length]
    return zebraStripes(cw, dirs.near(c[0], c[1], 30)?.dir ?? null)
  })
  const safety = n
    ? n.safety.flatMap((s) => {
        const kind: 'island' | 'painted' | 'school' = /교통섬/.test(s.kind) ? 'island' : /어린이/.test(s.kind) ? 'school' : 'painted'
        return clipPolys(polysOf(s.geom, f), half).map((poly) => ({ poly, kind }))
      })
    : []
  const hatch = safety.filter((s) => s.kind === 'painted').flatMap((s) => hatchStripes(s.poly))

  // ── 정밀도로지도 신호등·표지판·지주·방호시설·과속방지턱 (2026-11-13)
  const hdd = d.hd
  const across = (x: number, y: number): XY => {
    const r = dirs.near(x, y, 40)
    return r ? [-r.dir[1], r.dir[0]] : [1, 0]
  }
  const unitXY = (v: XY): XY => {
    const L = Math.hypot(v[0], v[1]) || 1
    return [v[0] / L, v[1] / L]
  }
  const postXY = new Map<string, XY>()
  if (hdd) for (const p of hdd.posts) postXY.set(p.pid, f([p.lon, p.lat]))
  /** 달린 지주 위치: 지주 자료 → 없으면 저장해 둔 떨어진 거리 */
  const postOf = (postid: string, xy: XY, px: number | null, py: number | null): XY | null =>
    (postid && postXY.get(postid)) || (px !== null && py !== null ? [xy[0] + px, xy[1] + py] : null)
  const poleMap = new Map<string, { x: number; y: number; top: number; arms: { to: XY; h: number }[]; kinds: Set<'signal' | 'sign'> }>()
  const pole = (key: string, at: XY) => {
    let p = poleMap.get(key)
    if (!p) {
      p = { x: at[0], y: at[1], top: 3.5, arms: [], kinds: new Set() }
      poleMap.set(key, p)
    }
    return p
  }
  const signals: SiteModel['signals'] = []
  const signs: SiteModel['signs'] = []
  if (hdd) {
    for (const l of hdd.lights) {
      const xy = f([l.lon, l.lat])
      if (!inSquare(xy)) continue
      const hh = l.h !== null && l.h > 1 && l.h < 15 ? l.h : l.vehicle ? 5.8 : 3
      const ps = postOf(l.postid, xy, l.px, l.py)
      const arm = ps ? Math.hypot(xy[0] - ps[0], xy[1] - ps[1]) : 0
      const axis = ps && arm > 1 ? unitXY([xy[0] - ps[0], xy[1] - ps[1]]) : across(xy[0], xy[1])
      signals.push({ x: xy[0], y: xy[1], h: hh, vehicle: l.vehicle, axis })
      const pl = pole(l.postid || `light@${xy[0].toFixed(1)},${xy[1].toFixed(1)}`, ps ?? xy)
      pl.kinds.add('signal')
      pl.top = Math.max(pl.top, hh + (l.vehicle ? 0.5 : 0.5))
      if (ps && arm > 1) pl.arms.push({ to: xy, h: hh + 0.25 })
    }
    for (const s of hdd.signs) {
      const xy = f([s.lon, s.lat])
      if (!inSquare(xy)) continue
      const ph = s.ph !== null && s.ph > 0.2 && s.ph < 3 ? s.ph : s.cat === 4 ? 0.5 : 0.9
      const pw = s.pw !== null && s.pw > 0.2 && s.pw < 6 ? s.pw : 0.9
      const hh = s.h !== null && s.h > 0.5 && s.h < 15 ? s.h : 2.8
      const axis: XY = s.az !== null ? [Math.sin((s.az * Math.PI) / 180), Math.cos((s.az * Math.PI) / 180)] : across(xy[0], xy[1])
      signs.push({ x: xy[0], y: xy[1], h: hh, ph, pw, cat: s.cat, axis })
      const ps = postOf(s.postid, xy, s.px, s.py)
      const pl = pole(s.postid || `sign@${xy[0].toFixed(1)},${xy[1].toFixed(1)}`, ps ?? xy)
      pl.kinds.add('sign')
      pl.top = Math.max(pl.top, hh + ph)
      const arm = ps ? Math.hypot(xy[0] - ps[0], xy[1] - ps[1]) : 0
      if (ps && arm > 1) pl.arms.push({ to: xy, h: hh + ph - 0.1 })
    }
    // 아무것도 안 달린 지주도 (어림 3.5m)
    for (const [pid, xy] of postXY) if (!poleMap.has(pid) && inSquare(xy)) pole(pid, xy)
  }
  const poles = [...poleMap.values()].filter((p) => inSquare([p.x, p.y])).map((p) => ({ ...p, kinds: [...p.kinds] }))
  const barriers = hdd ? hdd.barriers.flatMap((b) => linesOfGeom(b.geom).flatMap((q) => clipLine(q, half)).map((pts) => ({ pts, central: b.central }))) : []
  const bumps = hdd ? clipPolys(hdd.bumps.flatMap((g) => polysOf(g, f)), half) : []
  const fences = n ? n.fences.flatMap((w) => linesOfGeom(w.geom).flatMap((l) => clipLine(l, half)).map((pts) => ({ pts, kind: w.kind }))) : []
  if (n) for (const w of n.water) {
    const polys = clipPolys(polysOf(w, f), half)
    if (polys.length) rivers.push({ polys, name: '하천·호수 (1:1,000 수치지도)' })
  }
  const h = d.hd
  const lanes = h ? h.lanes.flatMap((l) => linesOfGeom(l.geom).flatMap((q) => clipLine(q, half)).map((pts) => ({ pts, color: l.color, dashed: l.dashed, double: l.double }))) : []
  const arrows: Poly[] = []
  const yellowMarks: Poly[] = []
  const plainMarks: Poly[] = []
  if (h)
    for (const g of h.glyphs)
      for (const p of clipPolys(polysOf(g.geom, f), half)) {
        const gl = markGlyph(p, g.kind, g.az)
        if (!gl) plainMarks.push(p)
        else {
          arrows.push(...gl.white)
          yellowMarks.push(...gl.yellow)
        }
      }
  const marks = h ? [...clipPolys(h.marks.flatMap((g) => polysOf(g, f)), half), ...plainMarks] : []
  const hdPaths = h ? clipPolys(h.paths.flatMap((g) => polysOf(g, f)), half) : []
  const curbs = h ? h.borders.flatMap((g) => linesOfGeom(g).flatMap((q) => clipLine(q, half))) : []

  const spots = n
    ? n.spots
        .map((s) => {
          const [x, y] = f([s.lon, s.lat])
          return { x, y, z: s.z - z0, level: s.z }
        })
        .filter((s) => inSquare([s.x, s.y]))
    : []

  return {
    origin: { lon, lat, x5179: X0, y5179: Y0, x5186, y5186, elev, trueNorthDeg },
    half,
    terrain,
    terrainSource: grid?.source ?? null,
    terrainVersion: grid?.version ?? null,
    contourStep: step,
    contours: lines,
    site: polysOf(d.boundary, f),
    buildings,
    parcels,
    roads,
    roadSource,
    roadCenters,
    parks,
    rivers,
    walks,
    minor,
    walls,
    cutfill,
    mapContours,
    spots,
    mapYear: n?.year ?? null,
    map1000: !!n?.sheets.some((sh) => sh.scale === 1000),
    trees,
    stops,
    lamps,
    crosswalks,
    zebra,
    safety,
    hatch,
    signals,
    signs,
    poles,
    barriers,
    bumps,
    fences,
    lanes,
    marks,
    arrows,
    yellowMarks,
    hdPaths,
    curbs,
    zAt,
  }
}

/** 원점·자료 설명 (3dm 문서 문자열·DXF 정보 글자에 함께 씀) */
export function modelNotes(m: SiteModel, meta: { title: string; address: string; collected: string }): [string, string][] {
  const f = (n: number, d = 2) => n.toFixed(d)
  return [
    ['프로젝트', meta.title],
    ['대지', meta.address],
    ['원점', '대지 중심 (x 동쪽, y 북쪽 = EPSG:5179 격자 북, 단위 m)'],
    ['원점 EPSG:5179 (UTM-K)', `X ${f(m.origin.x5179)} / Y ${f(m.origin.y5179)}`],
    ['원점 EPSG:5186 (중부원점)', `X ${f(m.origin.x5186)} / Y ${f(m.origin.y5186)}`],
    ['원점 경위도 (WGS84)', `${f(m.origin.lon, 7)}, ${f(m.origin.lat, 7)}`],
    ['진북', `모형 +y에서 ${m.origin.trueNorthDeg >= 0 ? '시계' : '반시계'} 방향으로 ${f(Math.abs(m.origin.trueNorthDeg), 2)}°`],
    ['높이 0', m.origin.elev !== null ? `대지 중심 지면 (해발 약 ${f(m.origin.elev, 1)}m, 지형 격자 추정)` : '대지 중심 지면 (지형 자료 없음)'],
    [
      '지형',
      m.terrainSource === 'map'
        ? `국토지리정보원 ${m.map1000 ? '1:1,000·1:5,000' : '1:5,000'} 수치지도${m.mapYear ? `(${m.mapYear}년)` : ''} 등고선·표고점 삼각망 2m + 옹벽·석축 높이 단차(대지 주변), 그 밖은 10m 격자. 이 파일의 지형 면은 ${m.terrain?.cell ?? '-'}m 칸. 등고선 사이 1m 안팎은 정확하지 않음`
        : m.terrainSource === 'ngii'
          ? `국토지리정보원 연속수치지형도 등고선·표고점 → 10m 격자${m.terrainVersion ? ` (${m.terrainVersion})` : ''}. 1m 안팎 높낮이는 정확하지 않음`
          : m.terrainSource === 'terrarium'
            ? 'AWS Terrarium 지형 타일(약 30m, 도심은 건물 높이가 섞임) — 정확도 낮음'
            : '없음 (평면)',
    ],
    ['등고선', `${m.contourStep}m 간격, 굵은 선(계곡선) ${m.contourStep * 5}m 간격 — 10m 격자에서 다시 그린 선`],
    [
      '건물',
      `${m.mapYear !== null || m.minor.length ? '국토지리정보원 수치지도(올린 도엽 안, 층수 포함) + ' : ''}브이월드 GIS건물통합정보 + 도로명주소 건물. 높이 = 실측 높이가 있으면 그 값, 없으면 층수 × 용도별 층고(주거 3m·비주거 4m·공장·창고 5m·용도 모름 3.3m, 발자국 평균 지면 기준), 층수 모르는 건물은 발자국만, 지하만 있는 시설은 뺌${m.minor.length ? ', 무벽건물·가건물은 따로' : ''}`,
    ],
    [
      '도로',
      m.roadSource === 'map'
        ? '국토지리정보원 수치지도 도로경계 면(인도 포함)을 합친 면, 인도는 따로'
        : m.roadSource === 'mixed'
          ? '올린 수치지도 도엽 안은 도로경계 면, 그 밖은 도로중심선을 폭만큼 넓혀 합친 면'
          : '국토지리정보원 도로중심선을 도로 폭(rvwd)만큼 넓혀 합친 면 (폭 없는 길은 4m로 봄)',
    ],
    ['필지·공원·하천', '연속지적도, 도시계획(공원·녹지·광장), 하천망 — 참고용이며 법적 효력 없음'],
    ...(m.map1000 || m.lanes.length
      ? ([
          [
            '디테일',
            `${m.map1000 ? `1:1,000 수치지도: 가로수 ${m.trees.length}·정류장 ${m.stops.length}·가로등 ${m.lamps.length}·횡단보도 ${m.crosswalks.length}(줄무늬 45cm 칠·45cm 빔, 도로 방향)·교통섬·안전지대 ${m.safety.length}·담장 등 ${m.fences.length} (나무 높이 모르면 7m, 쉘터 3.6×1.5×2.55m·가로등 8m·담장 높이·인도·교통섬 높이 15cm는 어림)` : ''}${m.map1000 && m.lanes.length ? ' / ' : ''}${m.lanes.length ? `정밀도로지도: 차선 ${m.lanes.length}·노면표시 ${m.marks.length}·보도 면 ${m.hdPaths.length}·연석 ${m.curbs.length} (차선 색·겹선·점선은 유형 코드로 해석, 점선은 3m 칠·5m 빔 어림)` : ''}`,
          ],
        ] as [string, string][])
      : []),
    ['범위', `원점 중심 가로·세로 ${Math.round(m.half * 2).toLocaleString('ko-KR')}m`],
    ['수집일', meta.collected],
  ]
}

// ───────────────────────── 차선 (3dm·미리보기 공통) ─────────────────────────

/** 선을 옆으로 d만큼 (겹선 차선) — 꼭짓점마다 앞뒤 방향의 평균 법선 */
export function offsetLine(pts: XY[], d: number): XY[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [p[0] - ((b[1] - a[1]) / L) * d, p[1] + ((b[0] - a[0]) / L) * d] as XY
  })
}

/** 점선 차선: 칠한 길이 on, 빈 길이 off (도로교통 규격 어림 3m·5m) */
export function dashesOf(pts: XY[], on = 3, off = 5): XY[][] {
  const out: XY[][] = []
  let cur: XY[] = []
  let pos = 0
  const period = on + off
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    const L = Math.hypot(x1 - x0, y1 - y0)
    let t = 0
    while (t < L) {
      const phase = pos % period
      const drawing = phase < on
      const step = Math.min(L - t, drawing ? on - phase : period - phase)
      const a: XY = [x0 + ((x1 - x0) * t) / L, y0 + ((y1 - y0) * t) / L]
      const b: XY = [x0 + ((x1 - x0) * (t + step)) / L, y0 + ((y1 - y0) * (t + step)) / L]
      if (drawing) {
        if (!cur.length) cur.push(a)
        cur.push(b)
      } else if (cur.length) {
        out.push(cur)
        cur = []
      }
      t += step
      pos += step
    }
  }
  if (cur.length > 1) out.push(cur)
  return out
}
