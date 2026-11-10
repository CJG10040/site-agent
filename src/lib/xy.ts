// 대지 중심 기준 미터 좌표(동쪽 x, 북쪽 y)와 간단한 도형 계산. 반경 2km 안에서는 오차가 0.1%보다 작다.

import type { Position } from 'geojson'
import type { Areal } from './geo'
import type { XY } from './network'

export interface LocalProj {
  lon0: number
  lat0: number
  kx: number
  ky: number
}

export function localProj(lon0: number, lat0: number): LocalProj {
  return { lon0, lat0, kx: 111320 * Math.cos((lat0 * Math.PI) / 180), ky: 110574 }
}

export function toXY(p: LocalProj, [lon, lat]: Position): XY {
  return [(lon - p.lon0) * p.kx, (lat - p.lat0) * p.ky]
}

export function toLonLat(p: LocalProj, [x, y]: XY): [number, number] {
  return [p.lon0 + x / p.kx, p.lat0 + y / p.ky]
}

export function arealRings(p: LocalProj, g: Areal): XY[][] {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  return polys.flatMap((poly) => poly.map((ring) => ring.map((c) => toXY(p, c))))
}

/** 짝홀 규칙 (구멍 포함) */
export function pointInRings(pt: XY, rings: XY[][]): boolean {
  let inside = false
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
    }
  return inside
}

export function segPointDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const L2 = dx * dx + dy * dy
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1])
}

export function pointToRingsDist(p: XY, rings: XY[][]): number {
  if (pointInRings(p, rings)) return 0
  let min = Infinity
  for (const ring of rings) for (let i = 1; i < ring.length; i++) min = Math.min(min, segPointDist(p, ring[i - 1], ring[i]))
  return min
}

/** 선과 면 사이 거리 (선 위 5m 간격 점 + 꼭짓점으로 어림) */
export function lineToRingsDist(line: XY[], rings: XY[][]): number {
  let min = Infinity
  for (let k = 0; k < line.length; k++) {
    min = Math.min(min, pointToRingsDist(line[k], rings))
    if (k === 0) continue
    const a = line[k - 1]
    const b = line[k]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    for (let s = 5; s < L; s += 5) min = Math.min(min, pointToRingsDist([a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L], rings))
    if (min === 0) return 0
  }
  return min
}

export function ringArea(ring: XY[]): number {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

export function ringCentroid(ring: XY[]): XY {
  let x = 0
  let y = 0
  for (const p of ring) {
    x += p[0]
    y += p[1]
  }
  return [x / ring.length, y / ring.length]
}

export function bearingOf([x, y]: XY): number {
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
}
