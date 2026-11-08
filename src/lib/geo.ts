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

export function isAreal(g: Geometry | null | undefined): g is Areal {
  return !!g && (g.type === 'Polygon' || g.type === 'MultiPolygon')
}

export function isLinear(g: Geometry | null | undefined): g is LineString | MultiLineString {
  return !!g && (g.type === 'LineString' || g.type === 'MultiLineString')
}

export function intersects(a: Geometry, b: Geometry): boolean {
  return booleanIntersects(feature(a), feature(b))
}
