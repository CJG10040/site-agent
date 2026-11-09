// 카카오 로컬 API — 카테고리로 장소 검색.
// 브라우저에서 바로 호출 가능(CORS 허용). 인증: Authorization: KakaoAK {REST API 키}
// 카카오 디벨로퍼스 앱에서 '카카오맵' 사용 설정을 켜야 응답한다.

import type { ApiKeys } from './keys'

const BASE = 'https://dapi.kakao.com/v2/local/search/category.json'
export const KAKAO_SOURCE = '카카오 로컬 API (카테고리 장소 검색)'
export const KAKAO_PUBLIC_URL = BASE

export class KakaoError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'KakaoError'
    this.code = code
  }
}

export interface PoiCategory {
  code: string
  label: string
  /** 반경 안에 없을 때 더 넓게 찾아 가장 가까운 곳을 알려 줄 거리(m) */
  widenTo?: number
}

export const POI_CATEGORIES: PoiCategory[] = [
  { code: 'SW8', label: '지하철역', widenTo: 5000 },
  { code: 'SC4', label: '학교', widenTo: 2000 },
  { code: 'PS3', label: '어린이집·유치원' },
  { code: 'AC5', label: '학원' },
  { code: 'HP8', label: '병원', widenTo: 2000 },
  { code: 'PM9', label: '약국' },
  { code: 'PO3', label: '공공기관', widenTo: 2000 },
  { code: 'CT1', label: '문화시설', widenTo: 3000 },
  { code: 'AT4', label: '관광명소' },
  { code: 'MT1', label: '대형마트', widenTo: 3000 },
  { code: 'CS2', label: '편의점' },
  { code: 'CE7', label: '카페' },
  { code: 'FD6', label: '음식점' },
  { code: 'PK6', label: '주차장' },
]

export interface Poi {
  id: string
  name: string
  code: string
  group: string
  category: string
  lon: number
  lat: number
  /** 대지 중심에서의 직선거리(m) */
  distance: number
}

export interface PoiCategoryResult {
  code: string
  label: string
  /** 반경 안 전체 개수 (카카오 집계) */
  total: number
  /** 가까운 순 최대 15곳 */
  places: Poi[]
  /** 반경 안에 없어 넓혀 찾은 가장 가까운 곳 */
  nearestBeyond: Poi | null
  error: string | null
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())

async function search(keys: ApiKeys, code: string, lon: number, lat: number, radius: number, size: number) {
  const key = keys.kakaoRest.trim()
  if (!key) throw new KakaoError('NO_KEY', '카카오 REST API 키가 입력되지 않았습니다. 설정에서 입력하세요.')
  const url = `${BASE}?${new URLSearchParams({
    category_group_code: code,
    x: lon.toFixed(7),
    y: lat.toFixed(7),
    radius: String(Math.round(Math.min(radius, 20000))),
    sort: 'distance',
    page: '1',
    size: String(size),
  })}`
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } })
  } catch {
    throw new KakaoError('NETWORK', '카카오 서버에 연결하지 못했습니다.')
  }
  const body = (await res.json().catch(() => null)) as {
    documents?: Record<string, unknown>[]
    meta?: { total_count?: number }
    errorType?: string
    message?: string
    msg?: string
  } | null
  if (!res.ok || !body) {
    const msg = s(body?.message ?? body?.msg) || `HTTP ${res.status}`
    const hint =
      res.status === 401
        ? ' — REST API 키가 맞는지 확인하세요.'
        : res.status === 403
          ? " — 카카오 디벨로퍼스의 앱 설정에서 '카카오맵' 사용 설정을 켜야 합니다."
          : ''
    throw new KakaoError(String(res.status), `${msg}${hint}`)
  }
  const places: Poi[] = (body.documents ?? []).map((d) => ({
    id: s(d.id),
    name: s(d.place_name),
    code,
    group: s(d.category_group_name),
    category: s(d.category_name),
    lon: Number(d.x),
    lat: Number(d.y),
    distance: Number(d.distance),
  }))
  return { total: Number(body.meta?.total_count ?? places.length), places: places.filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat)) }
}

export async function poisAround(keys: ApiKeys, lon: number, lat: number, radiusM: number): Promise<PoiCategoryResult[]> {
  const out: PoiCategoryResult[] = []
  // 카테고리 14개 × 최대 2회: 4개씩 나눠 요청
  const queue = [...POI_CATEGORIES]
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      try {
        const r = await search(keys, c.code, lon, lat, radiusM, 15)
        let nearestBeyond: Poi | null = null
        if (r.total === 0 && c.widenTo && c.widenTo > radiusM) {
          const wide = await search(keys, c.code, lon, lat, c.widenTo, 1)
          nearestBeyond = wide.places[0] ?? null
        }
        out.push({ code: c.code, label: c.label, total: r.total, places: r.places, nearestBeyond, error: null })
      } catch (e) {
        // 키·권한 오류는 모든 카테고리에 같으므로 전체를 멈춘다
        if (e instanceof KakaoError && ['NO_KEY', '401', '403', 'NETWORK'].includes(e.code)) throw e
        out.push({ code: c.code, label: c.label, total: 0, places: [], nearestBeyond: null, error: e instanceof Error ? e.message : String(e) })
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  out.sort((a, b) => POI_CATEGORIES.findIndex((c) => c.code === a.code) - POI_CATEGORIES.findIndex((c) => c.code === b.code))
  return out
}

/** 연결 진단용: 한 분류만 가볍게 조회 */
export async function kakaoProbe(keys: ApiKeys, lon: number, lat: number): Promise<number> {
  return (await search(keys, 'CS2', lon, lat, 500, 1)).total
}
