// ④ 항목별 자료 고르기 (2026-11-13): 옛 수치지도(1:1,000, 예: 2020년)와 새 수치지도(1:5,000, 예: 2025년)가 겹치는 곳에서 '바뀐 곳'을 찾는다.
// 바뀐 곳 = ① 한쪽 해에만 있는 건물(30m² 이상, 지붕만 있는 구조물·가건물 빼고)의 바닥 + 둘레 5m
//          ② 두 해 모두 높이 자료(등고선 꼭짓점·표고점)가 가까이 있는데 땅 높이가 2m 넘게 다른 곳 (+ 둘레 5m)
// 바뀐 곳에서는 옛 자료를 빼고 새 자료로 바꿔 넣는다 (sourcePick.ts).
// 확인한 것(광주 2020 1:1,000 9장 ↔ 2025 1:5,000): 2020에만 있는 건물 약 220동·2025에만 약 100동, 정밀도로지도 노면 높이와의 차이 중앙값 2020 1.1m · 2025 0.5m.

import Delaunator from 'delaunator'
import type { Geometry, Position } from 'geojson'

export type Bounds = [number, number, number, number]

export interface ChangeSide {
  contours: { geom: Geometry; z: number }[]
  spots: { lon: number; lat: number; z: number }[]
  bldgs: { geom: Geometry; kind: string }[]
}

export interface ChangeAreas {
  lon0: number
  lat0: number
  /** 경위도 1도의 m (동서·남북) */
  kx: number
  ky: number
  /** 격자 남서 모서리 (대지 중심 기준 m) */
  x0: number
  y0: number
  cell: number
  nx: number
  ny: number
  /** 1 = 땅 높이가 바뀜, 2 = 건물이 바뀜 (둘레 포함) */
  mask: Uint8Array
  /** 새 − 옛 땅 높이 (m, 비교 못 하는 칸은 NaN) — 지도에 그리기용 */
  diff: Float32Array
  /** 옛 해에만 / 새 해에만 있는 건물 바닥 (경위도 고리) */
  gone: Position[][]
  added: Position[][]
  /** compared = 두 해 높이를 비교한 칸, bothCells = 두 축척이 겹치는 칸 (5m) */
  stats: { bothCells: number; compared: number; terrainCells: number; maskCells: number; gone: number; added: number; goneBig: number; addedBig: number }
}

export const CHANGE_CELL = 5
export const CHANGE_DZ = 2
const MIN_BLDG = 30
const OLD_SUPPORT = 25
const NEW_SUPPORT = 60
const MARGIN = 300
const MINOR = /무벽|가건물/

type XY = [number, number]

const linesOf = (g: Geometry): Position[][] => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [])
const outerOf = (g: Geometry): Position[] | null =>
  g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates.reduce((m, p) => (p[0].length > m.length ? p[0] : m), g.coordinates[0]?.[0] ?? []) : null

function ringArea(r: XY[]): number {
  let s = 0
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i]
    const [x2, y2] = r[(i + 1) % r.length]
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}

export function inRingXY(x: number, y: number, r: XY[] | Position[]): boolean {
  let o = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0]
    const yi = r[i][1]
    const xj = r[j][0]
    const yj = r[j][1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) o = !o
  }
  return o
}

/** 고리 안의 한 점 (무게중심이 밖이면 그 높이의 가장 넓은 안쪽 구간 가운데) */
export function interiorPoint(r: XY[]): XY {
  let cx = 0
  let cy = 0
  let a = 0
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i]
    const [x2, y2] = r[(i + 1) % r.length]
    const f = x1 * y2 - x2 * y1
    cx += (x1 + x2) * f
    cy += (y1 + y2) * f
    a += f
  }
  const c: XY = a ? [cx / (3 * a), cy / (3 * a)] : r[0]
  if (inRingXY(c[0], c[1], r)) return c
  const y = c[1]
  const xs: number[] = []
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]
    const [xj, yj] = r[j]
    if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi)
  }
  xs.sort((p, q) => p - q)
  let best: XY = c
  let w = -1
  for (let k = 0; k + 1 < xs.length; k += 2)
    if (xs[k + 1] - xs[k] > w) {
      w = xs[k + 1] - xs[k]
      best = [(xs[k] + xs[k + 1]) / 2, y]
    }
  return best
}

const inAny = (bs: Bounds[], lon: number, lat: number) => bs.some((b) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3])

/** 두 해의 지형·건물을 비교해 바뀐 곳을 찾는다. 겹치는 범위가 없으면 null */
export function findChanges(cover1000: Bounds[], cover5000: Bounds[], older: ChangeSide, newer: ChangeSide): ChangeAreas | null {
  if (!cover1000.length || !cover5000.length) return null
  const W = Math.min(...cover1000.map((b) => b[0]))
  const S = Math.min(...cover1000.map((b) => b[1]))
  const E = Math.max(...cover1000.map((b) => b[2]))
  const N = Math.max(...cover1000.map((b) => b[3]))
  const lon0 = (W + E) / 2
  const lat0 = (S + N) / 2
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const ky = 110574
  const P = (lon: number, lat: number): XY => [(lon - lon0) * kx, (lat - lat0) * ky]
  const cell = CHANGE_CELL
  const x0 = (W - lon0) * kx
  const y0 = (S - lat0) * ky
  const nx = Math.ceil(((E - lon0) * kx - x0) / cell)
  const ny = Math.ceil(((N - lat0) * ky - y0) / cell)
  if (nx <= 0 || ny <= 0 || nx * ny > 4_000_000) return null
  const near = (x: number, y: number) => x >= x0 - MARGIN && x <= x0 + nx * cell + MARGIN && y >= y0 - MARGIN && y <= y0 + ny * cell + MARGIN
  const cellOf = (x: number, y: number) => {
    const i = Math.floor((x - x0) / cell)
    const j = Math.floor((y - y0) / cell)
    return i >= 0 && j >= 0 && i < nx && j < ny ? j * nx + i : -1
  }

  // 두 축척이 모두 있는 칸
  const both = new Uint8Array(nx * ny)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const lon = lon0 + (x0 + (i + 0.5) * cell) / kx
      const lat = lat0 + (y0 + (j + 0.5) * cell) / ky
      if (inAny(cover1000, lon, lat) && inAny(cover5000, lon, lat)) both[j * nx + i] = 1
    }

  // ── 땅: 두 해 각각 삼각망 → 5m 칸, 자료가 가까이 있는 칸만 비교
  const surface = (side: ChangeSide, support: number) => {
    const xs: number[] = []
    const zs: number[] = []
    const has = new Uint8Array(nx * ny)
    const add = (x: number, y: number, z: number) => {
      if (!near(x, y) || !Number.isFinite(z)) return
      xs.push(x, y)
      zs.push(z)
      const k = cellOf(x, y)
      if (k >= 0) has[k] = 1
    }
    for (const c of side.contours)
      for (const line of linesOf(c.geom)) {
        const pts = line.map(([lo, la]) => P(lo, la))
        for (let i = 0; i < pts.length; i++) {
          const [x, y] = pts[i]
          add(x, y, c.z)
          if (i + 1 < pts.length) {
            const [bx, by] = pts[i + 1]
            const k = Math.floor(Math.hypot(bx - x, by - y) / 10)
            for (let s = 1; s <= k; s++) add(x + ((bx - x) * s) / (k + 1), y + ((by - y) * s) / (k + 1), c.z)
          }
        }
      }
    for (const s of side.spots) add(...P(s.lon, s.lat), s.z)
    const z = new Float32Array(nx * ny).fill(NaN)
    if (zs.length >= 3) {
      const tri = new Delaunator(Float64Array.from(xs)).triangles
      for (let t = 0; t < tri.length; t += 3) {
        const a = tri[t]
        const b = tri[t + 1]
        const c = tri[t + 2]
        const ax = xs[2 * a]
        const ay = xs[2 * a + 1]
        const bx = xs[2 * b]
        const by = xs[2 * b + 1]
        const qx = xs[2 * c]
        const qy = xs[2 * c + 1]
        const det = (by - qy) * (ax - qx) + (qx - bx) * (ay - qy)
        if (Math.abs(det) < 1e-9) continue
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx, qx) - x0) / cell))
        const i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, qx) - x0) / cell))
        const j0 = Math.max(0, Math.floor((Math.min(ay, by, qy) - y0) / cell))
        const j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, qy) - y0) / cell))
        for (let j = j0; j <= j1; j++) {
          const py = y0 + (j + 0.5) * cell
          for (let i = i0; i <= i1; i++) {
            const px = x0 + (i + 0.5) * cell
            const l1 = ((by - qy) * (px - qx) + (qx - bx) * (py - qy)) / det
            const l2 = ((qy - ay) * (px - qx) + (ax - qx) * (py - qy)) / det
            const l3 = 1 - l1 - l2
            if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue
            z[j * nx + i] = l1 * zs[a] + l2 * zs[b] + l3 * zs[c]
          }
        }
      }
    }
    return { z, sup: dilate(has, nx, ny, Math.round(support / cell)) }
  }
  const o = surface(older, OLD_SUPPORT)
  const n = surface(newer, NEW_SUPPORT)
  const diff = new Float32Array(nx * ny).fill(NaN)
  const tmask = new Uint8Array(nx * ny)
  let compared = 0
  for (let k = 0; k < nx * ny; k++) {
    if (!both[k] || !Number.isFinite(o.z[k]) || !Number.isFinite(n.z[k])) continue
    diff[k] = n.z[k] - o.z[k]
    if (!o.sup[k] || !n.sup[k]) continue
    compared++
    if (Math.abs(diff[k]) >= CHANGE_DZ) tmask[k] = 1
  }
  // 외톨이 칸은 버림 (3×3 안에 3칸 이상)
  const tclean = new Uint8Array(nx * ny)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (!tmask[j * nx + i]) continue
      let c = 0
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const a = i + di
          const b = j + dj
          if (a >= 0 && b >= 0 && a < nx && b < ny && tmask[b * nx + a]) c++
        }
      if (c >= 3) tclean[j * nx + i] = 1
    }
  let terrainCells = 0
  for (let k = 0; k < nx * ny; k++) if (tclean[k]) terrainCells++

  // ── 건물: 한쪽 해에만 있는 것 (안쪽 점이 다른 해 건물 안에 없음)
  type B = { ring: XY[]; ll: Position[]; p: XY; a: number; minor: boolean }
  const prep = (side: ChangeSide): B[] => {
    const out: B[] = []
    for (const b of side.bldgs) {
      const ll = outerOf(b.geom)
      if (!ll || ll.length < 3) continue
      const ring = ll.map(([lo, la]) => P(lo, la))
      const p = interiorPoint(ring)
      if (cellOf(p[0], p[1]) < 0) continue
      out.push({ ring, ll, p, a: Math.abs(ringArea(ring)), minor: MINOR.test(b.kind) })
    }
    return out
  }
  const index = (list: B[]) => {
    const m = new Map<string, B[]>()
    for (const b of list) {
      const xs = b.ring.map((q) => q[0])
      const ys = b.ring.map((q) => q[1])
      for (let i = Math.floor(Math.min(...xs) / 50); i <= Math.floor(Math.max(...xs) / 50); i++)
        for (let j = Math.floor(Math.min(...ys) / 50); j <= Math.floor(Math.max(...ys) / 50); j++) {
          const k = `${i},${j}`
          const arr = m.get(k)
          if (arr) arr.push(b)
          else m.set(k, [b])
        }
    }
    return (x: number, y: number) => (m.get(`${Math.floor(x / 50)},${Math.floor(y / 50)}`) ?? []).some((b) => inRingXY(x, y, b.ring))
  }
  const ob = prep(older)
  const nb = prep(newer)
  const inOld = index(ob)
  const inNew = index(nb)
  const changed = (b: B, other: (x: number, y: number) => boolean) => !b.minor && b.a >= MIN_BLDG && both[cellOf(b.p[0], b.p[1])] === 1 && !other(b.p[0], b.p[1])
  const gone = ob.filter((b) => changed(b, inNew))
  const added = nb.filter((b) => changed(b, inOld))
  const bmask = new Uint8Array(nx * ny)
  for (const b of [...gone, ...added]) {
    const xs = b.ring.map((q) => q[0])
    const ys = b.ring.map((q) => q[1])
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / cell))
    const i1 = Math.min(nx - 1, Math.floor((Math.max(...xs) - x0) / cell))
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - y0) / cell))
    const j1 = Math.min(ny - 1, Math.floor((Math.max(...ys) - y0) / cell))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) if (inRingXY(x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell, b.ring)) bmask[j * nx + i] = 1
    const k = cellOf(b.p[0], b.p[1])
    if (k >= 0) bmask[k] = 1
  }
  const tm = dilate(tclean, nx, ny, 1)
  const bm = dilate(bmask, nx, ny, 1)
  const mask = new Uint8Array(nx * ny)
  let maskCells = 0
  for (let k = 0; k < nx * ny; k++) {
    if (!both[k]) continue
    mask[k] = (tm[k] ? 1 : 0) | (bm[k] ? 2 : 0)
    if (mask[k]) maskCells++
  }
  return {
    lon0,
    lat0,
    kx,
    ky,
    x0,
    y0,
    cell,
    nx,
    ny,
    mask,
    diff,
    gone: gone.map((b) => b.ll),
    added: added.map((b) => b.ll),
    stats: {
      bothCells: both.reduce((s, v) => s + v, 0),
      compared,
      terrainCells,
      maskCells,
      gone: gone.length,
      added: added.length,
      goneBig: gone.filter((b) => b.a >= 200).length,
      addedBig: added.filter((b) => b.a >= 200).length,
    },
  }
}

/** 칸 r개만큼 넓힘 (정사각) */
function dilate(src: Uint8Array, nx: number, ny: number, r: number): Uint8Array {
  if (r <= 0) return src
  const row = new Uint8Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    let last = -Infinity
    for (let i = 0; i < nx; i++) {
      if (src[j * nx + i]) last = i
      if (i - last <= r) row[j * nx + i] = 1
    }
    last = Infinity
    for (let i = nx - 1; i >= 0; i--) {
      if (src[j * nx + i]) last = i
      if (last - i <= r) row[j * nx + i] = 1
    }
  }
  const out = new Uint8Array(nx * ny)
  for (let i = 0; i < nx; i++) {
    let last = -Infinity
    for (let j = 0; j < ny; j++) {
      if (row[j * nx + i]) last = j
      if (j - last <= r) out[j * nx + i] = 1
    }
    last = Infinity
    for (let j = ny - 1; j >= 0; j--) {
      if (row[j * nx + i]) last = j
      if (last - j <= r) out[j * nx + i] = 1
    }
  }
  return out
}

/** 경위도 점이 바뀐 곳인지 */
export function inChange(ca: ChangeAreas, lon: number, lat: number): boolean {
  const i = Math.floor(((lon - ca.lon0) * ca.kx - ca.x0) / ca.cell)
  const j = Math.floor(((lat - ca.lat0) * ca.ky - ca.y0) / ca.cell)
  return i >= 0 && j >= 0 && i < ca.nx && j < ca.ny && ca.mask[j * ca.nx + i] !== 0
}

/** 선을 바뀐 곳 안·밖 조각으로 나눈다 (5m마다 확인) */
export function splitByChange(ca: ChangeAreas, line: Position[]): { inside: Position[][]; outside: Position[][] } {
  const inside: Position[][] = []
  const outside: Position[][] = []
  let cur: Position[] = []
  let curIn: boolean | null = null
  const push = (p: Position) => {
    const v = inChange(ca, p[0], p[1])
    if (curIn === null) curIn = v
    if (v !== curIn) {
      cur.push(p)
      if (cur.length >= 2) (curIn ? inside : outside).push(cur)
      cur = [p]
      curIn = v
      return
    }
    cur.push(p)
  }
  for (let i = 0; i < line.length; i++) {
    const p = line[i]
    if (i > 0) {
      const q = line[i - 1]
      const L = Math.hypot((p[0] - q[0]) * ca.kx, (p[1] - q[1]) * ca.ky)
      const k = Math.floor(L / CHANGE_CELL)
      for (let s = 1; s <= k; s++) push([q[0] + ((p[0] - q[0]) * s) / (k + 1), q[1] + ((p[1] - q[1]) * s) / (k + 1)])
    }
    push(p)
  }
  if (cur.length >= 2 && curIn !== null) (curIn ? inside : outside).push(cur)
  // 한쪽에만 있으면 원래 선 그대로 (확인용 점을 넣지 않음)
  if (!inside.length) return { inside, outside: line.length >= 2 ? [line] : [] }
  if (!outside.length) return { inside: line.length >= 2 ? [line] : [], outside }
  return { inside, outside }
}
