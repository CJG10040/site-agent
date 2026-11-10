// 도판 좌표: 대지 중심을 원점으로 한 평면(m)을 도판 픽셀로 옮긴다.
// 반경 1km 안에서는 경위도를 위도에 맞춘 비율로 늘이는 것만으로 오차가 0.5% 미만이다.

import { bboxClip, feature } from '@turf/turf'
import type { Geometry, LineString, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson'
import type { FrameShape } from '../model/types'

/** 도판 그림 영역 (SVG 사용자 단위 = PNG 1배 픽셀) */
export const SHEET_W = 1000
export const MAP_CX = 500
export const MAP_CY = 500
export const MAP_R = 460

export interface Frame {
  lon0: number
  lat0: number
  /** 반경(m) */
  R: number
  /** 픽셀/m */
  s: number
  shape: FrameShape
  x: (lon: number) => number
  y: (lat: number) => number
  /** 경위도 → 도판 픽셀 */
  pt: (lon: number, lat: number) => [number, number]
  /** 도판 픽셀 → 경위도 */
  inv: (x: number, y: number) => [number, number]
  /** 대지 중심에서의 평면 거리(m)와 나침반 방위(°) */
  polar: (lon: number, lat: number) => { d: number; bearing: number }
  /** 도형 → SVG path d (도판 밖으로 많이 나가는 도형은 잘라서) */
  path: (g: Geometry | null | undefined, clip?: boolean) => string
  /** 경위도 경계 상자 (조금 넉넉하게) */
  bbox: [number, number, number, number]
  /** 점이 도판 안에 있는지 */
  inside: (lon: number, lat: number) => boolean
}

const R_EARTH_LAT = 110574

export function makeFrame(lon0: number, lat0: number, R: number, shape: FrameShape): Frame {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const ky = R_EARTH_LAT
  const s = MAP_R / R
  const x = (lon: number) => MAP_CX + (lon - lon0) * kx * s
  const y = (lat: number) => MAP_CY - (lat - lat0) * ky * s
  const margin = 1.08
  const bbox: [number, number, number, number] = [lon0 - (R * margin) / kx, lat0 - (R * margin) / ky, lon0 + (R * margin) / kx, lat0 + (R * margin) / ky]

  const ring = (coords: Position[], close: boolean): string => {
    let out = ''
    let px = NaN
    let py = NaN
    for (let i = 0; i < coords.length; i++) {
      const X = x(coords[i][0])
      const Y = y(coords[i][1])
      // 0.4px보다 가까운 점은 건너뛴다 (파일 크기 줄이기)
      if (i > 0 && i < coords.length - 1 && Math.abs(X - px) < 0.4 && Math.abs(Y - py) < 0.4) continue
      out += `${i === 0 ? 'M' : 'L'}${X.toFixed(1)} ${Y.toFixed(1)}`
      px = X
      py = Y
    }
    return close ? `${out}Z` : out
  }

  const raw = (g: Geometry): string => {
    switch (g.type) {
      case 'Polygon':
        return g.coordinates.map((r) => ring(r, true)).join('')
      case 'MultiPolygon':
        return g.coordinates.map((p) => p.map((r) => ring(r, true)).join('')).join('')
      case 'LineString':
        return ring(g.coordinates, false)
      case 'MultiLineString':
        return g.coordinates.map((l) => ring(l, false)).join('')
      case 'GeometryCollection':
        return g.geometries.map(raw).join('')
      default:
        return ''
    }
  }

  const exceeds = (g: Geometry): boolean => {
    const check = (c: Position) => c[0] < bbox[0] || c[0] > bbox[2] || c[1] < bbox[1] || c[1] > bbox[3]
    const any = (coords: Position[]) => coords.some(check)
    switch (g.type) {
      case 'Polygon':
        return g.coordinates.some(any)
      case 'MultiPolygon':
        return g.coordinates.some((p) => p.some(any))
      case 'LineString':
        return any(g.coordinates)
      case 'MultiLineString':
        return g.coordinates.some(any)
      default:
        return false
    }
  }

  const path = (g: Geometry | null | undefined, clip = true): string => {
    if (!g) return ''
    if (clip && (g.type === 'Polygon' || g.type === 'MultiPolygon' || g.type === 'LineString' || g.type === 'MultiLineString') && exceeds(g)) {
      try {
        const c = bboxClip(feature(g as Polygon | MultiPolygon | LineString | MultiLineString), bbox).geometry
        return raw(c)
      } catch {
        return raw(g)
      }
    }
    return raw(g)
  }

  return {
    lon0,
    lat0,
    R,
    s,
    shape,
    x,
    y,
    pt: (lon, lat) => [x(lon), y(lat)],
    inv: (X, Y) => [lon0 + (X - MAP_CX) / s / kx, lat0 - (Y - MAP_CY) / s / ky],
    polar: (lon, lat) => {
      const dx = (lon - lon0) * kx
      const dy = (lat - lat0) * ky
      return { d: Math.hypot(dx, dy), bearing: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 }
    },
    path,
    bbox,
    inside: (lon, lat) => {
      const dx = (lon - lon0) * kx
      const dy = (lat - lat0) * ky
      return shape === 'circle' ? Math.hypot(dx, dy) <= R : Math.abs(dx) <= R && Math.abs(dy) <= R
    },
  }
}

const DIR8 = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']

export function dir8(bearing: number): string {
  return DIR8[Math.round(bearing / 45) % 8]
}

/** 도형 대표점 (외곽 고리 꼭짓점 평균 — 건물·필지 정도의 작은 도형에 충분) */
export function centroidOf(g: Geometry | null | undefined): [number, number] | null {
  if (!g) return null
  let ring: Position[] | null = null
  if (g.type === 'Polygon') ring = g.coordinates[0]
  else if (g.type === 'MultiPolygon') ring = g.coordinates[0]?.[0] ?? null
  else if (g.type === 'Point') return [g.coordinates[0], g.coordinates[1]]
  else if (g.type === 'LineString') ring = g.coordinates
  else if (g.type === 'MultiLineString') ring = g.coordinates[0] ?? null
  if (!ring || ring.length === 0) return null
  let sx = 0
  let sy = 0
  const n = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.length - 1 : ring.length
  for (let i = 0; i < n; i++) {
    sx += ring[i][0]
    sy += ring[i][1]
  }
  return [sx / n, sy / n]
}

/** 보기 좋은 축척 막대 길이(m) */
export function niceLength(maxM: number): number {
  const candidates = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000]
  let best = candidates[0]
  for (const c of candidates) if (c <= maxM) best = c
  return best
}
