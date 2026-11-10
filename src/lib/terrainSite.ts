// 대지 기준 지형 분석: 상대 높이(대지 중심 = 0m), 50m 평활 경사도·경사 방향, 등고선.

import { contours } from 'd3-contour'
import type { Position } from 'geojson'
import type { Areal } from './geo'
import { utmkToWgs84, wgs84ToUtmk } from './proj'
import { sampleAt, slopeAspect, smooth, terrainAround, type TerrainGrid } from './terrain'

export const SLOPE_BINS = [5, 10, 15, 20] // 경계(°): 0–5, 5–10, 10–15, 15–20, 20 이상
export const FLAT_DEG = 3 // 이보다 완만하면 경사 방향을 칠하지 않음
const DIR8 = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']

export function dir8(bearing: number): string {
  return DIR8[Math.round(bearing / 45) % 8]
}

export interface TerrainAnalysis {
  grid: TerrainGrid
  /** 대지 중심의 해발(m) — 화면에는 쓰지 않고 상대 높이 계산에만 */
  z0: number
  /** 상대 높이 (10m 평활) */
  rel: Float32Array
  /** 50m 평활 경사도(°)·경사 방향(°) */
  slope: Float32Array
  aspect: Float32Array
  center: [number, number]
  radiusM: number
  /** 반경 안 가장 높은·낮은 곳 (상대 높이, 경위도) */
  high: { rel: number; lon: number; lat: number } | null
  low: { rel: number; lon: number; lat: number } | null
  /** 대지 안 높낮이 차(m), 평균 경사도(°), 비탈이 향하는 방향 */
  site: { range: number; meanSlope: number; aspect: number | null; cells: number }
  /** 반경 안 경사도 구간별 비율 (0–5, 5–10, 10–15, 15–20, 20+) */
  slopeShare: number[]
  /** 반경 안 자료가 있는 칸 비율 */
  coverage: number
}

function insideRing(x: number, y: number, ring: Position[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function polygons5179(b: Areal): Position[][][] {
  const polys = b.type === 'Polygon' ? [b.coordinates] : b.coordinates
  return polys.map((p) => p.map((ring) => ring.map(([lon, lat]) => wgs84ToUtmk(lon, lat))))
}

const cache = new Map<string, Promise<TerrainAnalysis | null>>()

export function analyzeTerrain(center: [number, number], boundary: Areal, radiusM: number): Promise<TerrainAnalysis | null> {
  const key = `${center[0].toFixed(6)},${center[1].toFixed(6)},${radiusM},${JSON.stringify(boundary).length}`
  let p = cache.get(key)
  if (!p) {
    p = (async () => {
      const grid = await terrainAround(center[0], center[1], radiusM)
      if (!grid) return null
      const s10 = smooth(grid, 10)
      const s50 = smooth(grid, 25) // 표준편차 25m ≈ 폭 50m 평활
      const { slope, aspect } = slopeAspect(grid, s50)
      const [cx, cy] = wgs84ToUtmk(center[0], center[1])
      const z0 = sampleAt(grid, s10, cx, cy)
      if (!Number.isFinite(z0)) return null
      const rel = new Float32Array(s10.length)
      for (let i = 0; i < s10.length; i++) rel[i] = s10[i] - z0
      const polys = polygons5179(boundary)
      let high: TerrainAnalysis['high'] = null
      let low: TerrainAnalysis['low'] = null
      let siteMin = Infinity
      let siteMax = -Infinity
      let slopeSum = 0
      let ex = 0
      let ey = 0
      let siteCells = 0
      let inRadius = 0
      let valid = 0
      const share = [0, 0, 0, 0, 0]
      for (let r = 0; r < grid.ny; r++)
        for (let c = 0; c < grid.nx; c++) {
          const x = grid.x0 + (c + 0.5) * grid.cell
          const y = grid.y0 - (r + 0.5) * grid.cell
          if (Math.hypot(x - cx, y - cy) > radiusM) continue
          inRadius++
          const k = r * grid.nx + c
          const v = rel[k]
          if (Number.isNaN(v)) continue
          valid++
          if (!high || v > high.rel) high = { rel: v, lon: x, lat: y }
          if (!low || v < low.rel) low = { rel: v, lon: x, lat: y }
          const sl = slope[k]
          if (!Number.isNaN(sl)) share[SLOPE_BINS.filter((b) => sl >= b).length]++
          const inSite = polys.some((poly) => insideRing(x, y, poly[0]) && !poly.slice(1).some((h) => insideRing(x, y, h)))
          if (inSite) {
            siteCells++
            siteMin = Math.min(siteMin, grid.z[k])
            siteMax = Math.max(siteMax, grid.z[k])
            if (!Number.isNaN(sl)) {
              slopeSum += sl
              const a = (aspect[k] * Math.PI) / 180
              ex += Math.sin(a) * sl
              ey += Math.cos(a) * sl
            }
          }
        }
      // 대지가 너무 작아 칸이 없으면 중심 칸으로
      if (siteCells === 0) {
        const k = Math.round((grid.y0 - cy) / grid.cell - 0.5) * grid.nx + Math.round((cx - grid.x0) / grid.cell - 0.5)
        siteCells = 1
        siteMin = siteMax = grid.z[k]
        slopeSum = slope[k] || 0
        const a = ((aspect[k] || 0) * Math.PI) / 180
        ex = Math.sin(a) * (slope[k] || 0)
        ey = Math.cos(a) * (slope[k] || 0)
      }
      const toLonLat = (o: { rel: number; lon: number; lat: number } | null) => {
        if (!o) return null
        const [lon, lat] = utmkToWgs84(o.lon, o.lat)
        return { rel: o.rel, lon, lat }
      }
      const meanSlope = slopeSum / siteCells
      const totalShare = share.reduce((a, b) => a + b, 0)
      return {
        grid,
        z0,
        rel,
        slope,
        aspect,
        center,
        radiusM,
        high: toLonLat(high),
        low: toLonLat(low),
        site: {
          range: Number.isFinite(siteMax - siteMin) ? siteMax - siteMin : 0,
          meanSlope,
          aspect: meanSlope >= FLAT_DEG ? ((Math.atan2(ex, ey) * 180) / Math.PI + 360) % 360 : null,
          cells: siteCells,
        },
        slopeShare: share.map((n) => (totalShare ? n / totalShare : 0)),
        coverage: inRadius ? valid / inRadius : 0,
      }
    })()
    cache.set(key, p)
  }
  return p
}

/** 기복에 맞는 등고선 간격 (선 10~20개 정도) */
export function contourInterval(relief: number): number {
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100]) if (relief / s <= 20) return s
  return 200
}

export interface ContourLine {
  level: number
  /** 주곡선의 5배 간격이면 계곡선(굵게) */
  major: boolean
  /** EPSG:5179 좌표의 고리들 */
  rings: Position[][]
}

/** 상대 높이 격자에서 등고선 (기복 3m 미만이면 빈 배열) */
export function contourLines(t: TerrainAnalysis, interval?: number): ContourLine[] {
  const g = t.grid
  let lo = Infinity
  let hi = -Infinity
  for (const v of t.rel) {
    if (Number.isNaN(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!Number.isFinite(lo) || hi - lo < 3) return []
  const step = interval ?? contourInterval(hi - lo)
  const values = Array.from(t.rel, (v) => (Number.isNaN(v) ? lo - step : v))
  const levels: number[] = []
  for (let l = Math.ceil(lo / step) * step; l <= hi; l += step) levels.push(l)
  const polys = contours().size([g.nx, g.ny]).thresholds(levels)(values)
  return polys.map((mp) => ({
    level: mp.value,
    major: Math.round(mp.value / step) % 5 === 0,
    rings: mp.coordinates.flatMap((poly) => poly.map((ring) => ring.map(([gx, gy]) => [g.x0 + gx * g.cell, g.y0 - gy * g.cell] as Position))),
  }))
}

/** 등고선을 지도용 경위도 선으로 (격자 테두리에 붙은 선분은 뺀다) */
export function contourLonLatLines(t: TerrainAnalysis, interval?: number): { level: number; major: boolean; coords: Position[] }[] {
  const g = t.grid
  const xMin = g.x0 + g.cell
  const xMax = g.x0 + (g.nx - 1) * g.cell
  const yMax = g.y0 - g.cell
  const yMin = g.y0 - (g.ny - 1) * g.cell
  const onEdge = ([x, y]: Position) => x <= xMin || x >= xMax || y >= yMax || y <= yMin
  const out: { level: number; major: boolean; coords: Position[] }[] = []
  for (const line of contourLines(t, interval)) {
    for (const ring of line.rings) {
      let cur: Position[] = []
      for (const p of ring) {
        if (onEdge(p)) {
          if (cur.length > 1) out.push({ level: line.level, major: line.major, coords: cur })
          cur = []
        } else cur.push(utmkToWgs84(p[0], p[1]))
      }
      if (cur.length > 1) out.push({ level: line.level, major: line.major, coords: cur })
    }
  }
  return out
}
