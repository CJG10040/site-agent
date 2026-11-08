// 필지(연속지적도) 조회 도우미

import { areaM2, isAreal, queryPolygonWkt, type Areal } from '../lib/geo'
import { jimokOf } from '../model/codes'
import type { ParcelRef } from '../model/types'
import { featuresAtPoint, PARCEL_LAYER, queryFeatures, type GeoFeature, type VWorldConfig } from './vworld'

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

export function toParcel(f: GeoFeature): ParcelRef | null {
  if (!isAreal(f.geometry)) return null
  const p = f.properties
  const jibun = str(p.jibun)
  const jiga = Number(p.jiga)
  const year = str(p.gosi_year)
  const month = str(p.gosi_month)
  return {
    pnu: str(p.pnu),
    addr: str(p.addr),
    jibun,
    jimok: jimokOf(jibun),
    jiga: Number.isFinite(jiga) && jiga > 0 ? jiga : null,
    gosiYM: year ? `${year}-${month.padStart(2, '0')}` : null,
    areaM2: areaM2(f.geometry),
    geometry: f.geometry,
  }
}

/** 한 지점의 필지 */
export async function parcelAt(config: VWorldConfig, lon: number, lat: number): Promise<ParcelRef | null> {
  const features = await featuresAtPoint(config, PARCEL_LAYER.id, lon, lat, true)
  for (const f of features) {
    const p = toParcel(f)
    if (p) return p
  }
  return null
}

/** 경계에 걸친 필지들 */
export async function parcelsIn(
  config: VWorldConfig,
  boundary: Areal,
): Promise<{ parcels: ParcelRef[]; truncated: boolean; total: number }> {
  const r = await queryFeatures(config, {
    layerId: PARCEL_LAYER.id,
    geomFilter: queryPolygonWkt(boundary),
    geometry: true,
    maxFeatures: 300,
  })
  const parcels = r.features.map(toParcel).filter((p): p is ParcelRef => !!p)
  return { parcels, truncated: r.truncated, total: r.total }
}
