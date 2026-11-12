// 경위도 점 → 그 점이 놓인 필지(PNU). 15-D 지붕 구조 조회와 3D 모형이 함께 쓴다.

import type { Areal } from './geo'

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** 경위도 점이 면(구멍 제외) 안인지 */
export function inAreal(x: number, y: number, g: Areal): boolean {
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as number[][][][]
  return polys.some((p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h)))
}

function bboxOf(g: Areal): [number, number, number, number] {
  let a = Infinity
  let b = Infinity
  let c = -Infinity
  let d = -Infinity
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as number[][][][]
  for (const p of polys)
    for (const [x, y] of p[0]) {
      a = Math.min(a, x)
      b = Math.min(b, y)
      c = Math.max(c, x)
      d = Math.max(d, y)
    }
  return [a, b, c, d]
}

/** 필지 찾기: 경위도 점 → PNU (없으면 null) */
export function parcelFinder(parcels: { pnu: string; geom: Areal }[]): (lon: number, lat: number) => string | null {
  const idx = parcels.map((p) => ({ pnu: p.pnu, g: p.geom, b: bboxOf(p.geom) }))
  return (lon, lat) => {
    for (const e of idx) {
      const [a, b, c, d] = e.b
      if (lon < a || lon > c || lat < b || lat > d) continue
      if (inAreal(lon, lat, e.g)) return e.pnu
    }
    return null
  }
}
