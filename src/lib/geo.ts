// 공간 계산 도우미 (Turf.js). 좌표는 모두 WGS84 경위도 [경도, 위도].

import {
  area,
  bbox,
  bboxPolygon,
  booleanIntersects,
  centroid,
  circle,
  convex,
  feature,
  featureCollection,
  intersect,
  lineString,
  point,
  pointToLineDistance,
  simplify,
  union,
} from '@turf/turf'
import type { Geometry, LineString, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson'
import type { Site } from '../model/types'

export type Areal = Polygon | MultiPolygon

export function areaM2(g: Areal): number {
  return area(feature(g))
}

/** 대지 경계: 필지 합집합 또는 직접 그린 다각형 */
export function siteBoundary(site: Site): Areal | null {
  if (site.boundaryMode === 'drawn') return site.drawn
  if (site.parcels.length === 0) return null
  if (site.parcels.length === 1) return site.parcels[0].geometry
  const merged = union(featureCollection(site.parcels.map((p) => feature(p.geometry))))
  return merged ? (merged.geometry as Areal) : null
}

export function centerOf(g: Areal): [number, number] {
  const c = centroid(feature(g)).geometry.coordinates
  return [c[0], c[1]]
}

export function radiusCircle(center: [number, number], radiusM: number): Polygon {
  return circle(center, radiusM, { units: 'meters', steps: 64 }).geometry
}

/**
 * 브이월드 geomFilter용 POLYGON WKT.
 * 꼭짓점이 많으면 주소가 너무 길어지므로 단순화하고, 여러 조각이면 볼록 껍질로 감싼다.
 * (조회 범위가 실제보다 약간 넓어질 수 있으며, 필요하면 받은 뒤 다시 거른다.)
 */
export function queryPolygonWkt(g: Areal, maxVertices = 80): string {
  let poly: Polygon
  if (g.type === 'MultiPolygon') {
    const hull = convex(feature(g))
    poly = hull ? hull.geometry : bboxPolygon(bbox(g)).geometry
  } else {
    poly = { type: 'Polygon', coordinates: [g.coordinates[0]] }
  }
  let ring = poly.coordinates[0]
  let tolerance = 0.000005
  while (ring.length > maxVertices && tolerance < 0.01) {
    const s = simplify(feature(poly), { tolerance, highQuality: false })
    ring = (s.geometry as Polygon).coordinates[0]
    tolerance *= 2
  }
  if (ring.length > maxVertices) ring = bboxPolygon(bbox(poly)).geometry.coordinates[0]
  return `POLYGON((${ring.map(([x, y]) => `${x.toFixed(7)} ${y.toFixed(7)}`).join(',')}))`
}

function ringsOf(g: Areal): Position[][] {
  return g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()
}

function linesOf(g: LineString | MultiLineString): Position[][] {
  return g.type === 'LineString' ? [g.coordinates] : g.coordinates
}

/** 선(도로 중심선 등)과 대지 경계 사이의 최소 거리(m). 겹치면 0 */
export function lineToAreaDistanceM(line: LineString | MultiLineString, area_: Areal): number {
  if (booleanIntersects(feature(line), feature(area_))) return 0
  let min = Infinity
  for (const a of linesOf(line)) {
    if (a.length < 2) continue
    const aLine = lineString(a)
    for (const ring of ringsOf(area_)) {
      if (ring.length < 2) continue
      const rLine = lineString(ring)
      for (const p of a) min = Math.min(min, pointToLineDistance(point(p), rLine, { units: 'meters' }))
      for (const p of ring) min = Math.min(min, pointToLineDistance(point(p), aLine, { units: 'meters' }))
    }
  }
  return min
}

/** 두 면 사이의 최소 거리(m). 겹치면 0 */
export function areaToAreaDistanceM(a: Areal, b: Areal): number {
  if (booleanIntersects(feature(a), feature(b))) return 0
  let min = Infinity
  for (const ra of ringsOf(a)) {
    if (ra.length < 2) continue
    const la = lineString(ra)
    for (const rb of ringsOf(b)) {
      if (rb.length < 2) continue
      const lb = lineString(rb)
      for (const p of ra) min = Math.min(min, pointToLineDistance(point(p), lb, { units: 'meters' }))
      for (const p of rb) min = Math.min(min, pointToLineDistance(point(p), la, { units: 'meters' }))
    }
  }
  return min
}

/** 도형을 감싸는 사각형을 margin(도)만큼 넓힌 브이월드 BOX 필터 */
export function expandedBoxFilter(g: Geometry, marginDeg: number): string {
  const [minx, miny, maxx, maxy] = bbox(feature(g))
  return `BOX(${(minx - marginDeg).toFixed(7)},${(miny - marginDeg).toFixed(7)},${(maxx + marginDeg).toFixed(7)},${(maxy + marginDeg).toFixed(7)})`
}

export function isAreal(g: Geometry | null | undefined): g is Areal {
  return !!g && (g.type === 'Polygon' || g.type === 'MultiPolygon')
}

export function isLinear(g: Geometry | null | undefined): g is LineString | MultiLineString {
  return !!g && (g.type === 'LineString' || g.type === 'MultiLineString')
}

export function intersects(a: Geometry, b: Geometry): boolean {
  return booleanIntersects(feature(a), feature(b))
}

/** 점과 대지 경계 사이의 최소 거리(m). 대지 안이면 0 */
export function pointToAreaDistanceM(p: Position, area_: Areal): number {
  const pt = point(p)
  if (booleanIntersects(pt, feature(area_))) return 0
  let min = Infinity
  for (const ring of ringsOf(area_)) {
    if (ring.length < 2) continue
    min = Math.min(min, pointToLineDistance(pt, lineString(ring), { units: 'meters' }))
  }
  return min
}

/** 점·선·면 어느 도형이든 대지 경계까지의 최소 거리(m). 계산할 수 없으면 null */
export function geometryToAreaDistanceM(g: Geometry | null | undefined, area_: Areal): number | null {
  if (!g) return null
  try {
    if (g.type === 'Point') return pointToAreaDistanceM(g.coordinates, area_)
    if (g.type === 'MultiPoint') return Math.min(...g.coordinates.map((c) => pointToAreaDistanceM(c, area_)))
    if (isLinear(g)) return lineToAreaDistanceM(g, area_)
    if (isAreal(g)) return areaToAreaDistanceM(g, area_)
  } catch {
    return null
  }
  return null
}

/** 두 경위도 사이의 거리(m, 구면 근사) */
export function distanceM(a: [number, number], b: [number, number]): number {
  const R = 6371008.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLon = toRad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * 면 도형이 대지와 실제로 겹치는지 (경계선만 맞닿은 경우는 제외).
 * 용도지역처럼 도로 중심에서 나뉘는 구역이 대지에 '닿기만' 한 것을 걸친 것으로 세지 않기 위함.
 */
export function overlapsSite(g: Areal, site: Areal): boolean {
  if (!booleanIntersects(feature(g), feature(site))) return false
  try {
    const inter = intersect(featureCollection([feature(g), feature(site)]))
    if (!inter) return false
    const a = area(inter)
    // 1㎡ 이상 또는 대지 면적의 0.5% 이상 겹치면 걸친 것으로 본다
    return a >= 1 || a >= areaM2(site) * 0.005
  } catch {
    return true
  }
}
