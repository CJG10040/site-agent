// 좌표계 변환. SGIS는 UTM-K(EPSG:5179) 좌표를 쓴다.

import proj4 from 'proj4'
import type { Geometry, Position } from 'geojson'

proj4.defs(
  'EPSG:5179',
  '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
)

// 중부원점(GRS80) — 국내 측량·수치지형도에서 흔히 쓰는 좌표계. 3D·DXF 파일에 원점 좌표를 함께 적는 데만 쓴다.
proj4.defs('EPSG:5186', '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs')

const toUtmk = proj4('EPSG:4326', 'EPSG:5179')
const to5186 = proj4('EPSG:4326', 'EPSG:5186')

export function wgs84To5186(lon: number, lat: number): [number, number] {
  const [x, y] = to5186.forward([lon, lat])
  return [x, y]
}

export function wgs84ToUtmk(lon: number, lat: number): [number, number] {
  const [x, y] = toUtmk.forward([lon, lat])
  return [x, y]
}

export function utmkToWgs84(x: number, y: number): [number, number] {
  const [lon, lat] = toUtmk.inverse([x, y])
  return [lon, lat]
}

function mapPositions(coords: unknown, fn: (p: Position) => Position): unknown {
  if (Array.isArray(coords) && typeof coords[0] === 'number') return fn(coords as Position)
  return (coords as unknown[]).map((c) => mapPositions(c, fn))
}

/** UTM-K 도형 → WGS84 경위도 도형 */
export function geometryUtmkToWgs84<G extends Geometry>(g: G): G {
  if (g.type === 'GeometryCollection') {
    return { ...g, geometries: g.geometries.map((x) => geometryUtmkToWgs84(x)) }
  }
  return {
    ...g,
    coordinates: mapPositions((g as Exclude<Geometry, { type: 'GeometryCollection' }>).coordinates, ([x, y]) =>
      utmkToWgs84(x, y),
    ),
  } as G
}
