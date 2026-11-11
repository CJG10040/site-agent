// 올린 수치지도(등고선·표고점·옹벽)로 대지 주변 2m 지형 격자를 만든다 (EPSG:5179 정렬, TerrainGrid 형식 — 해발 높이).
// 방법: 10m 지형 타일과 같은 원자료라 같은 방식(들로네 삼각망 + 선형 보간)을 2m로 촘촘히 하고,
// 옹벽·석축·제방 '상단' 선을 단절선(브레이크라인)으로 넣는다 — 선 양옆 0.3m에 높이 차 h만큼 벌어진 점을 3m마다 더해 삼각망을 다시 만든다.
//  - 낮은 쪽: 선을 그린 방향의 오른쪽(수치지도 규칙, 상단–하단 짝 12쌍 중 11쌍으로 확인). 첫 삼각망이 반대로 0.5m 넘게 기울면 뒤집는다.
//  - 높이: 첫 삼각망의 선 위 높이를 가운데로 위·아래 h/2씩. 30m 안 같은 쪽에 표고점이 있으면 그 높이에 맞게 옮긴다(±h/2 안).
//  처음엔 선에서 멀어질수록 줄어드는 단차를 더했으나 옹벽 양옆에 도랑·둑 같은 굴곡이 생겨 이 방식으로 바꿈(2026-11-11).
// 등고선 사이 1m 안팎의 높낮이는 원자료에 없으므로 여전히 정확하지 않다.

import Delaunator from 'delaunator'
import type { NgiiData } from '../diagrams/data'
import { wgs84ToUtmk } from './proj'
import { sampleAt, type TerrainGrid } from './terrain'

export const FINE_CELL = 2
/** 삼각형 변이 이보다 길면 자료가 없는 곳을 잇는 것이라 뺀다 */
const MAX_EDGE = 300
const PAD = 250
const BREAK_OFFSET = 0.3
const BREAK_STEP = 3

type P = [number, number]

function linesOf(g: NgiiData['contours'][number]['geom']): number[][][] {
  return g.type === 'LineString' ? [g.coordinates] : g.coordinates
}

interface Spec {
  x0: number
  y0: number
  nx: number
  ny: number
  cell: number
}

/** 점들로 들로네 삼각망을 만들어 칸 가운데 높이를 선형 보간 (삼각망 밖·긴 변은 NaN) */
function tinGrid(xs: number[], zs: number[], g: Spec): Float32Array {
  const { x0, y0, nx, ny, cell } = g
  const z = new Float32Array(nx * ny).fill(NaN)
  const del = new Delaunator(Float64Array.from(xs))
  const tri = del.triangles
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
    if (Math.max(Math.hypot(bx - ax, by - ay), Math.hypot(qx - bx, qy - by), Math.hypot(ax - qx, ay - qy)) > MAX_EDGE) continue
    const det = (by - qy) * (ax - qx) + (qx - bx) * (ay - qy)
    if (Math.abs(det) < 1e-9) continue
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, qx) - x0) / cell))
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, qx) - x0) / cell))
    const j0 = Math.max(0, Math.floor((y0 - Math.max(ay, by, qy)) / cell))
    const j1 = Math.min(ny - 1, Math.ceil((y0 - Math.min(ay, by, qy)) / cell))
    for (let j = j0; j <= j1; j++) {
      const py = y0 - (j + 0.5) * cell
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
  return z
}

/** 점에서 꺾은선까지 가장 가까운 거리와 어느 쪽인지 (+ = 왼쪽) */
function nearestOnLine(pts: P[], px: number, py: number): { d: number; side: number; x: number; y: number } {
  let d = Infinity
  let side = 0
  let nx = px
  let ny = py
  for (let s = 0; s + 1 < pts.length; s++) {
    const [ax, ay] = pts[s]
    const [bx, by] = pts[s + 1]
    const dx = bx - ax
    const dy = by - ay
    const L2 = dx * dx + dy * dy
    const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0
    const dd = Math.hypot(ax + dx * t - px, ay + dy * t - py)
    if (dd < d) {
      d = dd
      side = dx * (py - ay) - dy * (px - ax)
      nx = ax + dx * t
      ny = ay + dy * t
    }
  }
  return { d, side, x: nx, y: ny }
}

/** 대지 중심 ±half 범위의 2m 격자. 수치지도가 없거나 점이 모자라면 null */
export function fineTerrain(n: NgiiData, center: [number, number], half: number): TerrainGrid | null {
  const [cx, cy] = wgs84ToUtmk(center[0], center[1])
  const cell = FINE_CELL
  const x0 = Math.floor((cx - half) / cell) * cell
  const y0 = Math.ceil((cy + half) / cell) * cell
  const nx = Math.ceil((cx + half - x0) / cell)
  const ny = Math.ceil((y0 - (cy - half)) / cell)
  const spec: Spec = { x0, y0, nx, ny, cell }
  const lim = half + PAD
  const near = (x: number, y: number) => Math.abs(x - cx) <= lim && Math.abs(y - cy) <= lim

  // ── 점: 등고선 꼭짓점(긴 변은 10m마다 채움) + 표고점·기준점, 0.5m 안 겹친 점은 하나만
  const xs: number[] = []
  const zs: number[] = []
  const seen = new Set<string>()
  const add = (x: number, y: number, z: number) => {
    if (!near(x, y) || !Number.isFinite(z)) return
    const k = `${Math.round(x * 2)}_${Math.round(y * 2)}`
    if (seen.has(k)) return
    seen.add(k)
    xs.push(x, y)
    zs.push(z)
  }
  for (const c of n.contours)
    for (const line of linesOf(c.geom)) {
      const pts = line.map(([lo, la]) => wgs84ToUtmk(lo, la))
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = pts[i]
        add(x, y, c.z)
        if (i + 1 < pts.length) {
          const [bx, by] = pts[i + 1]
          const k = Math.floor(Math.hypot(bx - x, by - y) / 10)
          for (let j = 1; j <= k; j++) add(x + ((bx - x) * j) / (k + 1), y + ((by - y) * j) / (k + 1), c.z)
        }
      }
    }
  const spots: { x: number; y: number; z: number }[] = []
  for (const s of n.spots) {
    const [x, y] = wgs84ToUtmk(s.lon, s.lat)
    add(x, y, s.z)
    if (near(x, y)) spots.push({ x, y, z: s.z })
  }
  if (zs.length < 10) return null

  // ── 1차 삼각망 (옹벽 없이)
  const z1 = tinGrid(xs, zs, spec)
  const g1: TerrainGrid = { ...spec, z: z1, source: 'map', version: n.year }

  // ── 옹벽·석축·제방을 단절선으로: 양옆 0.3m에 h만큼 벌어진 점
  const bx: number[] = [...xs]
  const bz: number[] = [...zs]
  let walls = 0
  for (const w of n.walls) {
    const h = w.h ?? 0
    if (!w.top || h < 0.2) continue
    for (const line of linesOf(w.geom)) {
      const pts = line.map(([lo, la]) => wgs84ToUtmk(lo, la)) as P[]
      if (pts.length < 2 || !pts.some(([x, y]) => near(x, y))) continue
      // 낮은 쪽: 기본은 오른쪽, 1차 삼각망이 반대로 0.5m 넘게 기울면 왼쪽
      let lowRight = true
      {
        let best = 0
        let bi = 0
        for (let i = 0; i + 1 < pts.length; i++) {
          const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
          if (L > best) {
            best = L
            bi = i
          }
        }
        if (best > 0) {
          const [ax, ay] = pts[bi]
          const [qx, qy] = pts[bi + 1]
          const mx = (ax + qx) / 2
          const my = (ay + qy) / 2
          const lx = -(qy - ay) / best
          const ly = (qx - ax) / best
          const zl = sampleAt(g1, z1, mx + lx * 5, my + ly * 5)
          const zr = sampleAt(g1, z1, mx - lx * 5, my - ly * 5)
          if (Number.isFinite(zl) && Number.isFinite(zr) && zl < zr - 0.5) lowRight = false
        }
      }
      const isLow = (side: number) => (lowRight ? side < 0 : side > 0)
      // 표고점으로 높이 맞추기: 30m 안 낮은 쪽(또는 높은 쪽) 표고점과 1차 삼각망 + h/2의 차이 평균
      let bias = 0
      {
        const diffs: number[] = []
        for (const s of spots) {
          const r = nearestOnLine(pts, s.x, s.y)
          if (r.d > 30 || r.side === 0) continue
          // 선 위(가장 가까운 점)의 1차 삼각망 높이를 가운데로 보고, 표고점이 있는 쪽 높이와 맞춘다 (표고점과 벽 사이는 평평하다고 봄)
          const zLine = sampleAt(g1, z1, r.x, r.y)
          if (!Number.isFinite(zLine)) continue
          diffs.push(isLow(r.side) ? s.z - (zLine - h / 2) : s.z - (zLine + h / 2))
        }
        if (diffs.length) bias = Math.max(-h / 2, Math.min(h / 2, diffs.reduce((a, b) => a + b, 0) / diffs.length))
      }
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay] = pts[i]
        const [qx, qy] = pts[i + 1]
        const L = Math.hypot(qx - ax, qy - ay)
        if (L < 1e-6) continue
        const lx = -(qy - ay) / L
        const ly = (qx - ax) / L
        const k = Math.max(1, Math.ceil(L / BREAK_STEP))
        for (let j = 0; j <= k; j++) {
          if (j === k && i + 2 < pts.length) continue // 다음 변이 넣음
          const px = ax + ((qx - ax) * j) / k
          const py = ay + ((qy - ay) * j) / k
          if (!near(px, py)) continue
          const zm = sampleAt(g1, z1, px, py)
          if (!Number.isFinite(zm)) continue
          const zTop = zm + h / 2 + bias
          const zBot = zm - h / 2 + bias
          // 왼쪽 점, 오른쪽 점
          const leftHigh = lowRight
          bx.push(px + lx * BREAK_OFFSET, py + ly * BREAK_OFFSET, px - lx * BREAK_OFFSET, py - ly * BREAK_OFFSET)
          bz.push(leftHigh ? zTop : zBot, leftHigh ? zBot : zTop)
        }
      }
      walls++
    }
  }
  const z = walls ? tinGrid(bx, bz, spec) : z1

  // ── 올린 도엽 밖은 비움 (경위도 사각형 → 5179에서 1차식으로 충분)
  const lonAt = (() => {
    const p0 = wgs84ToUtmk(center[0], center[1])
    const px = wgs84ToUtmk(center[0] + 0.01, center[1])
    const py = wgs84ToUtmk(center[0], center[1] + 0.01)
    const a = (px[0] - p0[0]) / 0.01
    const b = (py[0] - p0[0]) / 0.01
    const c = (px[1] - p0[1]) / 0.01
    const d = (py[1] - p0[1]) / 0.01
    const det = a * d - b * c
    return (x: number, y: number): P => {
      const dx = x - p0[0]
      const dy = y - p0[1]
      return [center[0] + (d * dx - b * dy) / det, center[1] + (-c * dx + a * dy) / det]
    }
  })()
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      if (Number.isNaN(z[k])) continue
      const [lo, la] = lonAt(x0 + (i + 0.5) * cell, y0 - (j + 0.5) * cell)
      if (!n.sheets.some(({ bounds: b }) => lo >= b[0] && lo <= b[2] && la >= b[1] && la <= b[3])) z[k] = NaN
    }
  return { ...spec, z, source: 'map', version: n.year }
}

const cache = new Map<string, TerrainGrid | null>()

/** 같은 수치지도·범위면 다시 만들지 않는다 */
export function fineTerrainCached(n: NgiiData | null, center: [number, number], half: number): TerrainGrid | null {
  if (!n) return null
  const key = `${n.sheets.map((s) => s.code).join(',')}|${n.contours.length}|${n.spots.length}|${n.walls.length}|${center[0].toFixed(6)},${center[1].toFixed(6)}|${half}`
  if (!cache.has(key)) {
    if (cache.size > 6) cache.clear()
    cache.set(key, fineTerrain(n, center, half))
  }
  return cache.get(key)!
}

/** 대지 주변 2m 지형의 범위(반쪽 길이): 수집 반경 + 100m, 최대 600m */
export function fineHalfFor(R: number): number {
  return Math.min(600, R + 100)
}

/** 세밀 지형(있으면)과 10m 지형을 섞어 원하는 칸 크기의 격자로 (해발 높이) */
export function compositeGrid(base: TerrainGrid | null, fine: TerrainGrid | null, center: [number, number], half: number, cell: number): TerrainGrid | null {
  if (!fine) return base
  const [cx, cy] = wgs84ToUtmk(center[0], center[1])
  const x0 = Math.floor((cx - half) / cell) * cell
  const y0 = Math.ceil((cy + half) / cell) * cell
  const nx = Math.ceil((cx + half - x0) / cell)
  const ny = Math.ceil((y0 - (cy - half)) / cell)
  const z = new Float32Array(nx * ny)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const X = x0 + (i + 0.5) * cell
      const Y = y0 - (j + 0.5) * cell
      let v = sampleAt(fine, fine.z, X, Y)
      if (!Number.isFinite(v) && base) v = sampleAt(base, base.z, X, Y)
      z[j * nx + i] = Number.isFinite(v) ? v : NaN
    }
  return { x0, y0, cell, nx, ny, z, source: 'map', version: fine.version }
}
