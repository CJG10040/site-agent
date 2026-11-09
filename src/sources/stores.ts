// 공공데이터포털 — 소상공인시장진흥공단_상가(상권)정보, 반경 내 상가업소 조회(storeListInRadius).
// 응답 형식: { header: { resultCode }, body: { items: [...], totalCount } }
// 응답 필드 이름은 실제 키로 다시 확인해야 한다 (Phase 6 확인 전).

import { dataGoKrGet, DataGoKrError } from './dataGoKr'
import type { ApiKeys } from './keys'

const BASE = 'https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius'
export const STORES_SERVICE = '소상공인시장진흥공단_상가(상권)정보'
export const STORES_PUBLIC_URL = BASE
export const STORES_MAX_RADIUS = 2000

const PAGE = 1000
const MAX_PAGES = 6

/** 사실 계산과 지도에 쓰는 항목만 남긴다 (전화번호 등은 받지 않음) */
export interface StoreRow {
  name: string
  lcls: string
  mcls: string
  scls: string
  floor: string
  bldNm: string
  lon: number
  lat: number
}

export interface StoresResult {
  radiusM: number
  total: number
  stores: StoreRow[]
  truncated: boolean
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())

function bodyOf(data: unknown): { items: Record<string, unknown>[]; total: number } {
  const d = data as { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: unknown; totalCount?: unknown } }
  const code = s(d?.header?.resultCode)
  if (code === '03') return { items: [], total: 0 }
  if (code && code !== '00') throw new DataGoKrError(code, s(d?.header?.resultMsg) || '오류')
  const raw = d?.body?.items
  const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { item?: unknown }).item) ? (raw as { item: unknown[] }).item : []
  return { items: items as Record<string, unknown>[], total: Number(d?.body?.totalCount ?? items.length) || items.length }
}

export async function storesAround(keys: ApiKeys, lon: number, lat: number, radiusM: number): Promise<StoresResult> {
  const radius = Math.min(radiusM, STORES_MAX_RADIUS)
  const stores: StoreRow[] = []
  let total = 0
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await dataGoKrGet(
      keys,
      BASE,
      { pageNo: String(page), numOfRows: String(PAGE), radius: String(radius), cx: lon.toFixed(7), cy: lat.toFixed(7), type: 'json' },
      STORES_SERVICE,
    )
    const { items, total: t } = bodyOf(data)
    total = t
    for (const it of items) {
      const x = Number(it.lon)
      const y = Number(it.lat)
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      stores.push({
        name: s(it.bizesNm),
        lcls: s(it.indsLclsNm),
        mcls: s(it.indsMclsNm),
        scls: s(it.indsSclsNm),
        floor: s(it.flrNo),
        bldNm: s(it.bldNm),
        lon: x,
        lat: y,
      })
    }
    if (items.length < PAGE || stores.length >= total) break
  }
  return { radiusM: radius, total, stores, truncated: stores.length < total }
}
