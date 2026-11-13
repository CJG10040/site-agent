// 15-E 나무 (사용자 결정 2026-11-13): 나무를 네 곳에서 모은다 —
//   ① 1:1,000 수치지도 가로수·정원수(D003, ④ 항목별 자료·바뀐 곳 반영) ② 넓은 길 규칙 가로수(1:1,000 가로수가 없는 길만)
//   ③ 공원·녹지 안 격자 ④ 학생이 ⑩ 항공사진 지도에서 찍은 나무·줄로 심은 나무 (지운 자리는 모든 나무에서 뺌)
// 공개 자료(광주·전남·전북에 나무 위치 자료는 없음)는 수종 비율에만: 전남광주통합특별시_가로수(공공데이터포털 15086882, 2026-01-01 기준)
// 자치구별 수종 그루 수로 길마다 한 수종을 골라 모양(원뿔형·넓은형·둥근형)과 높이를 정한다. 1:1,000 가로수도 수종·높이가 비어 있어 같은 방법.
// 같은 자리 겹침은 간격의 0.6배 안이면 먼저 넣은 것만 (① → ④ → ② → ③ 순).

import type { Position } from 'geojson'
import type { DiagramData } from '../diagrams/data'
import type { TreeEdits, TreeSettings } from '../model/types'

type XY = [number, number]

export type TreeShape = 'cone' | 'broad' | 'round'
export type TreeSrc = 'map' | 'street' | 'park' | 'user'

export interface ModelTree {
  x: number
  y: number
  lon: number
  lat: number
  /** 높이 (m, 수종 보통 높이 어림) */
  h: number
  shape: TreeShape
  species: string
  src: TreeSrc
}

export const DEFAULT_TREES: TreeSettings = { street: true, minWidth: 15, spacing: 8, park: true, parkSpacing: 10 }
export const treeSettingsOf = (s: TreeSettings | undefined): TreeSettings => ({ ...DEFAULT_TREES, ...(s ?? {}) })

/** 수종 → 모양·보통 높이 (가로수로 흔한 크기 어림) */
export const SPECIES: Record<string, { shape: TreeShape; h: number }> = {
  은행나무: { shape: 'cone', h: 10 },
  메타세쿼이아: { shape: 'cone', h: 15 },
  느티나무: { shape: 'broad', h: 10 },
  왕벚나무: { shape: 'broad', h: 8 },
  플라타너스: { shape: 'broad', h: 12 },
  이팝나무: { shape: 'round', h: 7 },
  중국단풍: { shape: 'round', h: 7 },
  기타: { shape: 'round', h: 7 },
  정원수: { shape: 'round', h: 4.5 },
}
export const SPECIES_ORDER = ['은행나무', '느티나무', '이팝나무', '메타세쿼이아', '왕벚나무', '중국단풍', '플라타너스', '기타'] as const
export const SHAPE_LABEL: Record<TreeShape, string> = { cone: '원뿔형', broad: '넓은형', round: '둥근형' }
export const SRC_LABEL: Record<TreeSrc, string> = { map: '1:1,000 수치지도', street: '넓은 길 규칙', park: '공원·녹지 규칙', user: '직접 심음' }

/** 전남광주통합특별시_가로수_20260101 (공공데이터포털 15086882): 구분·연장(m)·수종별 그루 수 */
const GWANGJU: Record<string, { name: string; len: number; n: number[] }> = {
  // 은행나무, 느티나무, 이팝나무, 메타세쿼이아, 왕벚나무, 중국단풍, 플라타너스, 기타
  '29110': { name: '동구', len: 52721, n: [4521, 571, 1002, 476, 1474, 0, 0, 1099] },
  '29140': { name: '서구', len: 166521, n: [6388, 11365, 3771, 1147, 5017, 956, 758, 4709] },
  '29155': { name: '남구', len: 101230, n: [5541, 3020, 3188, 235, 654, 31, 280, 3175] },
  '29170': { name: '북구', len: 227171, n: [11566, 7539, 6616, 2987, 2161, 626, 193, 7691] },
  '29200': { name: '광산구', len: 334707, n: [16298, 15525, 13431, 5057, 6549, 3229, 2353, 3950] },
}
export const MIX_SOURCE = '전남광주통합특별시_가로수 (공공데이터포털, 2026-01-01 기준)'

export interface SpeciesMix {
  /** '서구' · '광주 전체(대지가 광주 밖이라 광주 평균으로)' */
  name: string
  local: boolean
  list: { species: string; w: number }[]
  /** 그 지역 실제 평균 간격 (길 한쪽, m) = 연장 × 2 / 그루 수 */
  spacing: number
}

export function speciesMix(district: string | null): SpeciesMix {
  const row = district ? GWANGJU[district] : undefined
  const all = Object.values(GWANGJU)
  const n = row ? row.n : SPECIES_ORDER.map((_, i) => all.reduce((s, r) => s + r.n[i], 0))
  const len = row ? row.len : all.reduce((s, r) => s + r.len, 0)
  const total = n.reduce((a, b) => a + b, 0)
  return {
    name: row ? row.name : '광주 전체',
    local: !!row,
    list: SPECIES_ORDER.map((species, i) => ({ species, w: n[i] / total })).filter((x) => x.w > 0),
    spacing: (len * 2) / total,
  }
}

/** 0~1 사이 고정된 난수 (같은 입력이면 같은 값) */
function hash(a: number, b = 0): number {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return s - Math.floor(s)
}
const pick = (mix: SpeciesMix, u: number): string => {
  let acc = 0
  for (const x of mix.list) {
    acc += x.w
    if (u < acc) return x.species
  }
  return mix.list[mix.list.length - 1]?.species ?? '기타'
}
const make = (x: number, y: number, ll: Position, species: string, src: TreeSrc, jitter: number): ModelTree => {
  const sp = SPECIES[species] ?? SPECIES['기타']
  return { x, y, lon: ll[0], lat: ll[1], h: Math.round(sp.h * (0.88 + 0.24 * jitter) * 10) / 10, shape: sp.shape, species, src }
}

// ───────────────────────── 도형 도우미 (모형 좌표 m) ─────────────────────────

interface Ring {
  pts: XY[]
  b: [number, number, number, number]
}
const ringOf = (pts: XY[]): Ring => {
  let a = Infinity
  let b = Infinity
  let c = -Infinity
  let d = -Infinity
  for (const [x, y] of pts) {
    a = Math.min(a, x)
    b = Math.min(b, y)
    c = Math.max(c, x)
    d = Math.max(d, y)
  }
  return { pts, b: [a, b, c, d] }
}
const inRing = (x: number, y: number, r: XY[]) => {
  let o = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]
    const [xj, yj] = r[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) o = !o
  }
  return o
}

/** 면(구멍 포함)을 50m 칸에 넣어 점이 안에 있는지 빨리 */
class PolyIndex {
  private cells = new Map<string, { outer: Ring; holes: XY[][] }[]>()
  add(outer: XY[], holes: XY[][] = []) {
    if (outer.length < 3) return
    const r = ringOf(outer)
    for (let i = Math.floor(r.b[0] / 50); i <= Math.floor(r.b[2] / 50); i++)
      for (let j = Math.floor(r.b[1] / 50); j <= Math.floor(r.b[3] / 50); j++) {
        const k = `${i},${j}`
        const a = this.cells.get(k)
        const item = { outer: r, holes }
        if (a) a.push(item)
        else this.cells.set(k, [item])
      }
  }
  has(x: number, y: number, pad = 0): boolean {
    for (const p of this.cells.get(`${Math.floor(x / 50)},${Math.floor(y / 50)}`) ?? []) {
      const b = p.outer.b
      if (x < b[0] - pad || x > b[2] + pad || y < b[1] - pad || y > b[3] + pad) continue
      if (inRing(x, y, p.outer.pts) && !p.holes.some((h) => inRing(x, y, h))) return true
      if (pad > 0 && nearRing(x, y, p.outer.pts, pad)) return true
    }
    return false
  }
  any(x: number, y: number, r: number): boolean {
    for (let i = Math.floor((x - r) / 50); i <= Math.floor((x + r) / 50); i++)
      for (let j = Math.floor((y - r) / 50); j <= Math.floor((y + r) / 50); j++)
        for (const p of this.cells.get(`${i},${j}`) ?? []) {
          const b = p.outer.b
          if (x >= b[0] - r && x <= b[2] + r && y >= b[1] - r && y <= b[3] + r) return true
        }
    return false
  }
}
function segDist(x: number, y: number, a: XY, b: XY): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const L2 = dx * dx + dy * dy
  const t = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)
}
const nearRing = (x: number, y: number, r: XY[], d: number) => r.some((p, i) => segDist(x, y, p, r[(i + 1) % r.length]) <= d)

/** 선분(폭 r) 색인 */
class SegIndex {
  private cells = new Map<string, { a: XY; b: XY; r: number; id: number; ux: number; uy: number }[]>()
  add(pts: XY[], r: number, id: number) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 0.01) continue
      const s = { a, b, r, id, ux: (b[0] - a[0]) / L, uy: (b[1] - a[1]) / L }
      const pad = r + 2
      for (let ci = Math.floor((Math.min(a[0], b[0]) - pad) / 25); ci <= Math.floor((Math.max(a[0], b[0]) + pad) / 25); ci++)
        for (let cj = Math.floor((Math.min(a[1], b[1]) - pad) / 25); cj <= Math.floor((Math.max(a[1], b[1]) + pad) / 25); cj++) {
          const k = `${ci},${cj}`
          const arr = this.cells.get(k)
          if (arr) arr.push(s)
          else this.cells.set(k, [s])
        }
    }
  }
  /** 가장 가까운 선분 (거리 maxD 안, 칸 25m라 30m까지): id와 쪽(1 왼쪽, 2 오른쪽) */
  nearest(x: number, y: number, maxD: number): { id: number; side: number } | null {
    let best = maxD
    let out: { id: number; side: number } | null = null
    const ci = Math.floor(x / 25)
    const cj = Math.floor(y / 25)
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++)
        for (const s of this.cells.get(`${i},${j}`) ?? []) {
          const dd = segDist(x, y, s.a, s.b)
          if (dd < best) {
            best = dd
            out = { id: s.id, side: (s.b[0] - s.a[0]) * (y - s.a[1]) - (s.b[1] - s.a[1]) * (x - s.a[0]) > 0 ? 1 : 2 }
          }
        }
    return out
  }
  /** 점이 어떤 선분의 폭(+extra) 안에 있는지. skip(seg)가 참이면 건너뜀 */
  hit(x: number, y: number, extra: number, skip?: (s: { id: number; ux: number; uy: number }) => boolean): boolean {
    for (const s of this.cells.get(`${Math.floor(x / 25)},${Math.floor(y / 25)}`) ?? []) {
      if (skip && skip(s)) continue
      if (segDist(x, y, s.a, s.b) <= s.r + extra) return true
    }
    return false
  }
}

/** 이미 넣은 나무와 거리 */
class PointGrid {
  private cells = new Map<string, XY[]>()
  add(x: number, y: number) {
    const k = `${Math.floor(x / 10)},${Math.floor(y / 10)}`
    const a = this.cells.get(k)
    if (a) a.push([x, y])
    else this.cells.set(k, [[x, y]])
  }
  near(x: number, y: number, d: number): boolean {
    const r = Math.ceil(d / 10)
    const ci = Math.floor(x / 10)
    const cj = Math.floor(y / 10)
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (const p of this.cells.get(`${i},${j}`) ?? []) if (Math.hypot(p[0] - x, p[1] - y) < d) return true
    return false
  }
}

const ringsOf = (g: { type: string; coordinates: unknown }): Position[][][] =>
  g.type === 'Polygon' ? [g.coordinates as Position[][]] : g.type === 'MultiPolygon' ? (g.coordinates as Position[][][]) : []
const linesOf = (g: { type: string; coordinates: unknown }): Position[][] =>
  g.type === 'LineString' ? [g.coordinates as Position[]] : g.type === 'MultiLineString' ? (g.coordinates as Position[][]) : []

export interface TreeResult {
  trees: ModelTree[]
  mix: SpeciesMix
  counts: Record<TreeSrc, number>
  /** 너무 많아 뺀 수 */
  capped: number
}

const CAP = 20000

/**
 * 나무를 만든다. f: 경위도 → 모형 좌표(m), inv: 반대. half: 정사각 반쪽(m) 밖은 뺌.
 */
export function buildTrees(d: DiagramData, f: (p: Position) => XY, inv: (p: XY) => Position, half: number): TreeResult {
  const plan = d.treePlan
  const st = treeSettingsOf(plan?.settings)
  const edits: TreeEdits = plan?.edits ?? { add: [], remove: [], rows: [] }
  const mix = speciesMix(plan?.district ?? null)
  const n = d.ngii
  const inSq = (x: number, y: number, pad = 0) => Math.abs(x) <= half + pad && Math.abs(y) <= half + pad
  const PAD = 60

  // ── 막힌 곳: 건물·대지·하천, 피할 곳: 횡단보도·정류장
  const blocked = new PolyIndex()
  for (const b of d.buildings) {
    if (b.underground) continue
    for (const poly of ringsOf(b.geom)) {
      const o = poly[0].map(f)
      if (o.some(([x, y]) => inSq(x, y, PAD))) blocked.add(o)
    }
  }
  for (const poly of ringsOf(d.boundary)) blocked.add(poly[0].map(f), poly.slice(1).map((r) => r.map(f)))
  for (const a of d.parks) if (a.extra.kind === 'river') for (const poly of ringsOf(a.geom)) blocked.add(poly[0].map(f), poly.slice(1).map((r) => r.map(f)))
  const cross = new PolyIndex()
  for (const g of [...(n?.crosswalks ?? []), ...(d.hd?.crosswalks ?? [])]) for (const poly of ringsOf(g)) cross.add(poly[0].map(f))
  const stopPts: XY[] = [...d.stops.map((s) => f([s.lon, s.lat])), ...(n?.stops ?? []).map((s) => f([s.lon, s.lat]))]
  const nearStop = (x: number, y: number) => stopPts.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < 6)

  // ── 보도: 면(수치지도·정밀도로지도) + 보도 중심선(폭)
  const walks = new PolyIndex()
  for (const g of [...(n?.walks ?? []), ...(d.hd?.paths ?? [])]) for (const poly of ringsOf(g)) walks.add(poly[0].map(f), poly.slice(1).map((r) => r.map(f)))
  const walkLines = new SegIndex()
  for (const w of n?.walkLines ?? []) for (const l of linesOf(w.geom)) walkLines.add(l.map(f), Math.max(0.5, (w.width && w.width < 15 ? w.width : 2) / 2), 0)
  const inWalk = (x: number, y: number) => walks.has(x, y) || walkLines.hit(x, y, 0)
  const walkNear = (x: number, y: number) => walks.any(x, y, 15) || walkLines.hit(x, y, 15)

  // ── 도로중심선 (브이월드 + 수치지도): 폭 = 자료 폭, 없으면 차로 수 × 3.25m
  const roads: { pts: XY[]; w: number | null }[] = []
  for (const r of d.roads) for (const l of linesOf(r.geom)) roads.push({ pts: l.map(f), w: r.width ?? (r.lanes ? r.lanes * 3.25 : null) })
  for (const c of n?.centers ?? []) for (const l of linesOf(c.geom)) roads.push({ pts: l.map(f), w: c.width ?? (c.lanes ? c.lanes * 3.25 : null) })
  const roadSegs = new SegIndex()
  roads.forEach((r, i) => {
    // 폭이 아주 큰 선(1:5,000 일부 80m)은 교차로 판단을 덮지 않게 반폭 15m까지
    if (r.pts.some(([x, y]) => inSq(x, y, PAD))) roadSegs.add(r.pts, Math.min(15, Math.max(2, (r.w ?? 6) / 2)), i)
  })

  const out: ModelTree[] = []
  const placed = new PointGrid()
  const push = (t: ModelTree) => {
    out.push(t)
    placed.add(t.x, t.y)
  }

  // 길마다(+쪽) 수종 하나: 가까운 도로중심선의 번호와 쪽
  const roadSpecies = (x: number, y: number): string | null => {
    const r = roadSegs.nearest(x, y, 30)
    return r ? pick(mix, hash(r.id * 3 + r.side, 7.7)) : null
  }

  // ── ① 1:1,000 수치지도 (④에서 고른 대로)
  const mapPts: XY[] = []
  for (const t of n?.trees ?? []) {
    const [x, y] = f([t.lon, t.lat])
    if (!inSq(x, y)) continue
    mapPts.push([x, y])
    const garden = t.kind === '정원수'
    const species = garden ? '정원수' : (roadSpecies(x, y) ?? pick(mix, hash(x, y)))
    const tr = make(x, y, [t.lon, t.lat], species, 'map', hash(y, x))
    if (t.h && t.h > 1) tr.h = t.h
    push(tr)
  }
  const mapGrid = new PointGrid()
  for (const [x, y] of mapPts) mapGrid.add(x, y)

  // ── ④ 직접 심은 나무·줄
  for (const a of edits.add) {
    const [x, y] = f([a.lon, a.lat])
    if (!inSq(x, y)) continue
    push(make(x, y, [a.lon, a.lat], a.sp && SPECIES[a.sp] ? a.sp : pick(mix, hash(x, y)), 'user', hash(y, x)))
  }
  edits.rows.forEach((row, ri) => {
    const pts = row.line.map((p) => f(p))
    const sp = row.sp && SPECIES[row.sp] ? row.sp : pick(mix, hash(ri, 3.3))
    const step = Math.max(2, row.spacing || st.spacing)
    let carry = 0
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i]
      const [bx, by] = pts[i + 1]
      const L = Math.hypot(bx - ax, by - ay)
      for (let s = carry; s <= L; s += step) {
        const x = ax + ((bx - ax) * s) / L
        const y = ay + ((by - ay) * s) / L
        if (inSq(x, y)) push(make(x, y, inv([x, y]), sp, 'user', hash(x, y)))
      }
      carry = (((step - ((L - carry) % step)) % step) + step) % step
    }
  })

  // ── ② 넓은 길 규칙 가로수: 1:1,000 가로수가 있는 길(그쪽 후보의 30% 이상 곁에 1:1,000 나무)은 그쪽 전체를 비우고,
  //    없는 길만 양쪽 보도의 차도 쪽에 (보도가 있으면 중심선에서 훑어 처음 만나는 보도 + 0.8m, 보도 자료가 아예 없으면 폭/2 + 1m)
  let capped = 0
  if (st.street) {
    const sp = Math.max(4, st.spacing)
    roads.forEach((r, ri) => {
      if (r.w === null || r.w < st.minWidth || r.pts.length < 2) return
      if (!r.pts.some(([x, y]) => inSq(x, y, PAD))) return
      const w = Math.min(r.w, 50)
      for (const side of [1, -1] as const) {
        const species = pick(mix, hash(ri * 3 + (side > 0 ? 1 : 2), 7.7))
        const cand: XY[] = []
        let nearMap = 0
        let total = 0
        let carry = sp / 2
        for (let i = 0; i + 1 < r.pts.length; i++) {
          const [ax, ay] = r.pts[i]
          const [bx, by] = r.pts[i + 1]
          const L = Math.hypot(bx - ax, by - ay)
          if (L < 0.01) continue
          const ux = (bx - ax) / L
          const uy = (by - ay) / L
          const nx = -uy * side
          const ny = ux * side
          for (let s2 = carry; s2 <= L; s2 += sp) {
            const cx = ax + ux * s2
            const cy = ay + uy * s2
            if (!inSq(cx, cy, 20)) continue
            let off: number | null = null
            for (let o = 2; o <= w / 2 + 10; o += 0.5)
              if (inWalk(cx + nx * o, cy + ny * o)) {
                off = inWalk(cx + nx * (o + 0.8), cy + ny * (o + 0.8)) ? o + 0.8 : o
                break
              }
            if (off === null) {
              if (walkNear(cx, cy) || walks.any(cx, cy, w / 2 + 10)) continue // 보도 자료는 있는데 이쪽엔 보도가 없음
              off = Math.min(w / 2, 25) + 1
            }
            const x = cx + nx * off
            const y = cy + ny * off
            if (!inSq(x, y)) continue
            total++
            if (mapGrid.near(x, y, 12)) {
              nearMap++
              continue
            }
            if (blocked.has(x, y, 0.8) || cross.has(x, y, 3) || nearStop(x, y)) continue
            // 교차로: 나란하지 않은 다른 도로의 차도 안·2m 안이면 뺌
            if (roadSegs.hit(x, y, 2, (q) => q.id === ri || Math.abs(q.ux * ux + q.uy * uy) > 0.85)) continue
            cand.push([x, y])
          }
          carry = (((sp - ((L - carry) % sp)) % sp) + sp) % sp
        }
        if (total && nearMap / total >= 0.3) continue
        for (const [x, y] of cand) {
          if (placed.near(x, y, sp * 0.6)) continue
          if (out.length >= CAP) {
            capped++
            continue
          }
          push(make(x, y, inv([x, y]), species, 'street', hash(x, y)))
        }
      }
    })
  }

  // ── ③ 공원·녹지 안 격자 (광장·유원지·공지는 빼고)
  if (st.park) {
    const g = Math.max(4, st.parkSpacing)
    for (const a of d.parks) {
      if (a.extra.kind !== 'park' || !/공원|녹지/.test(a.name) || /광장/.test(a.name)) continue
      for (const poly of ringsOf(a.geom)) {
        const outer = poly[0].map(f)
        const holes = poly.slice(1).map((r) => r.map(f))
        const rb = ringOf(outer).b
        if (rb[2] < -half || rb[0] > half || rb[3] < -half || rb[1] > half) continue
        for (let x = Math.ceil(Math.max(rb[0], -half) / g) * g; x <= Math.min(rb[2], half); x += g)
          for (let y = Math.ceil(Math.max(rb[1], -half) / g) * g; y <= Math.min(rb[3], half); y += g) {
            // 격자를 조금 흔들어 덜 기계적으로 (±15%)
            const px = x + (hash(x, y) - 0.5) * g * 0.3
            const py = y + (hash(y, x) - 0.5) * g * 0.3
            if (!inRing(px, py, outer) || holes.some((h) => inRing(px, py, h))) continue
            if (nearRing(px, py, outer, 1.5)) continue
            if (blocked.has(px, py, 1) || roadSegs.hit(px, py, 0.5) || placed.near(px, py, g * 0.6)) continue
            if (out.length >= CAP) {
              capped++
              continue
            }
            push(make(px, py, inv([px, py]), pick(mix, hash(px * 1.7, py * 0.3)), 'park', hash(px, py)))
          }
      }
    }
  }

  // ── 지운 자리 (모든 나무에서)
  const removes = edits.remove.map((p) => f([p.lon, p.lat]))
  const trees = removes.length ? out.filter((t) => !removes.some(([x, y]) => Math.hypot(t.x - x, t.y - y) <= 2.5)) : out
  const counts: Record<TreeSrc, number> = { map: 0, street: 0, park: 0, user: 0 }
  for (const t of trees) counts[t.src]++
  return { trees, mix, counts, capped }
}

// ───────────────────────── 모양 (블록 하나 = 높이 10m 나무, 놓을 때 h/10 배) ─────────────────────────

/** 정이십면체 한 번 나눔 (42점·80면) — 반지름 1 */
function icosphere(): { v: number[][]; f: number[][] } {
  const t = (1 + Math.sqrt(5)) / 2
  let v = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map((p) => {
    const L = Math.hypot(p[0], p[1], p[2])
    return [p[0] / L, p[1] / L, p[2] / L]
  })
  let f = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ]
  const mid = new Map<string, number>()
  const m = (a: number, b: number) => {
    const k = a < b ? `${a},${b}` : `${b},${a}`
    const got = mid.get(k)
    if (got !== undefined) return got
    const p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]
    const L = Math.hypot(p[0], p[1], p[2])
    v = [...v, [p[0] / L, p[1] / L, p[2] / L]]
    mid.set(k, v.length - 1)
    return v.length - 1
  }
  const nf: number[][] = []
  for (const [a, b, c] of f) {
    const ab = m(a, b)
    const bc = m(b, c)
    const ca = m(c, a)
    nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
  }
  f = nf
  return { v, f }
}
const ICO = icosphere()

/** 모양별 수관 (높이 10m 나무): 가운데 높이·가로 반지름·세로 반지름, 줄기 위 끝 */
export const SHAPE_DIMS: Record<TreeShape, { cz: number; rx: number; rz: number; trunkTop: number; trunkR: number }> = {
  cone: { cz: 6.0, rx: 2.0, rz: 3.9, trunkTop: 3.0, trunkR: 0.16 },
  broad: { cz: 6.6, rx: 4.4, rz: 2.9, trunkTop: 4.4, trunkR: 0.2 },
  round: { cz: 6.6, rx: 3.0, rz: 3.0, trunkTop: 4.2, trunkR: 0.17 },
}

/** 높이 10m 나무의 수관·줄기 삼각형 (x, y, z 아홉 개씩). cone은 위로 갈수록 좁게 */
export function treeShapeTris(shape: TreeShape): { crown: number[]; trunk: number[] } {
  const d = SHAPE_DIMS[shape]
  const crown: number[] = []
  const P = (p: number[]) => {
    let r = d.rx
    if (shape === 'cone') r = d.rx * (1 - 0.55 * Math.max(0, p[2])) // 위쪽 반은 좁아짐
    return [p[0] * r, p[1] * r, d.cz + p[2] * d.rz]
  }
  for (const [a, b, c] of ICO.f) crown.push(...P(ICO.v[a]), ...P(ICO.v[b]), ...P(ICO.v[c]))
  const trunk: number[] = []
  const k = 6
  const top = d.cz - d.rz * 0.3
  for (let i = 0; i < k; i++) {
    const a0 = (i / k) * Math.PI * 2
    const a1 = ((i + 1) / k) * Math.PI * 2
    const p0 = [Math.cos(a0) * d.trunkR, Math.sin(a0) * d.trunkR]
    const p1 = [Math.cos(a1) * d.trunkR, Math.sin(a1) * d.trunkR]
    trunk.push(p0[0], p0[1], 0, p1[0], p1[1], 0, p1[0] * 0.8, p1[1] * 0.8, top, p0[0], p0[1], 0, p1[0] * 0.8, p1[1] * 0.8, top, p0[0] * 0.8, p0[1] * 0.8, top)
  }
  return { crown, trunk }
}

/** DXF·평면 기호용 수관 반지름 */
export const crownRadius = (t: Pick<ModelTree, 'shape' | 'h'>) => (SHAPE_DIMS[t.shape].rx * t.h) / 10
