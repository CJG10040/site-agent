// 통계청 SGIS 오픈API (인구·가구·사업체·집계구).
// 2026-11-09 실제 키로 확인:
//  - API 주소가 sgisapi.kostat.go.kr → sgisapi.mods.go.kr 로 바뀜 (예전 주소는 응답하지 않음)
//  - CORS 허용(fetch 가능), 좌표는 UTM-K(EPSG:5179)
//  - 총조사 주요지표(population.json) 2015~2024년, 2025년은 아직 없음
//  - 행정동(8자리 adm_cd) + low_search=1 → 집계구(14자리) 통계
//  - 행정통합 이전 코드 체계(광주 24) 유지

import type { Feature, Geometry } from 'geojson'
import { geometryUtmkToWgs84, wgs84ToUtmk } from '../lib/proj'
import type { ApiKeys } from './keys'

const SGIS = 'https://sgisapi.mods.go.kr/OpenAPI3'

export class SgisError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'SgisError'
    this.code = code
  }
}

let tokenCache: { key: string; token: string; expires: number } | null = null

async function authenticate(keys: ApiKeys): Promise<string> {
  if (!keys.sgisKey.trim() || !keys.sgisSecret.trim()) {
    throw new SgisError('NO_KEY', 'SGIS 서비스ID·보안키가 입력되지 않았습니다. 설정에서 입력하세요.')
  }
  const cacheKey = keys.sgisKey.trim()
  if (tokenCache && tokenCache.key === cacheKey && tokenCache.expires > Date.now() + 60_000) return tokenCache.token
  const data = await rawGet('/auth/authentication.json', {
    consumer_key: keys.sgisKey.trim(),
    consumer_secret: keys.sgisSecret.trim(),
  })
  const token = (data.result as { accessToken?: string; accessTimeout?: string } | undefined)?.accessToken
  if (!token) throw new SgisError('AUTH', 'SGIS 인증에 실패했습니다. 서비스ID와 보안키를 확인하세요.')
  const timeout = Number((data.result as { accessTimeout?: string }).accessTimeout)
  tokenCache = { key: cacheKey, token, expires: Number.isFinite(timeout) ? timeout : Date.now() + 3_600_000 }
  return token
}

async function rawGet(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(`${SGIS}${path}?${new URLSearchParams(params)}`)
  } catch {
    throw new SgisError('NETWORK', 'SGIS 서버에 연결하지 못했습니다.')
  }
  if (!res.ok) throw new SgisError(String(res.status), `SGIS 서버 오류 (HTTP ${res.status})`)
  const data = (await res.json()) as Record<string, unknown>
  const errCd = data.errCd
  if (typeof errCd === 'number' && errCd !== 0 && errCd !== -100) {
    throw new SgisError(String(errCd), String(data.errMsg ?? 'SGIS 오류'))
  }
  return data
}

/** 인증 토큰을 붙여 호출. 토큰이 만료됐으면(-401) 한 번 다시 인증한다. 결과 없음(-100)은 빈 배열. */
async function sgisGet(keys: ApiKeys, path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await authenticate(keys)
    try {
      return await rawGet(path, { accessToken: token, ...params })
    } catch (e) {
      if (e instanceof SgisError && e.code === '-401' && attempt === 0) {
        tokenCache = null
        continue
      }
      throw e
    }
  }
  throw new SgisError('AUTH', 'SGIS 인증에 실패했습니다.')
}

function rows(data: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(data.result) ? (data.result as Record<string, unknown>[]) : []
}

/** "N/A" 같은 가려진 값은 null */
export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export const SGIS_PUBLIC_BASE = SGIS

// ───────────── 지역 찾기 ─────────────

export interface SgisRegion {
  admCd: string // 8자리 행정동 코드 (예: 24010510)
  name: string // 예: 광주광역시 동구 충장동
  dongName: string
}

export async function regionAt(keys: ApiKeys, lon: number, lat: number): Promise<SgisRegion> {
  const [x, y] = wgs84ToUtmk(lon, lat)
  const data = await sgisGet(keys, '/addr/rgeocode.json', { x_coor: String(x), y_coor: String(y), addr_type: '20' })
  const r = rows(data)[0]
  if (!r) throw new SgisError('-100', '대지 위치의 행정동을 찾지 못했습니다.')
  return {
    admCd: `${r.sido_cd}${r.sgg_cd}${r.emdong_cd}`,
    name: String(r.full_addr ?? ''),
    dongName: String(r.emdong_nm ?? ''),
  }
}

// ───────────── 총조사 주요지표 (연도별) ─────────────

export interface PopulationYear {
  year: number
  tot_ppltn: number | null
  avg_age: number | null
  ppltn_dnsty: number | null
  aged_child_idx: number | null
  oldage_suprt_per: number | null
  juv_suprt_per: number | null
  tot_family: number | null
  avg_fmember_cnt: number | null
  tot_house: number | null
  corp_cnt: number | null
  employee_cnt: number | null
}

function toPopulationYear(year: number, r: Record<string, unknown>): PopulationYear {
  return {
    year,
    tot_ppltn: num(r.tot_ppltn),
    avg_age: num(r.avg_age),
    ppltn_dnsty: num(r.ppltn_dnsty),
    aged_child_idx: num(r.aged_child_idx),
    oldage_suprt_per: num(r.oldage_suprt_per),
    juv_suprt_per: num(r.juv_suprt_per),
    tot_family: num(r.tot_family),
    avg_fmember_cnt: num(r.avg_fmember_cnt),
    tot_house: num(r.tot_house),
    corp_cnt: num(r.corp_cnt),
    employee_cnt: num(r.employee_cnt),
  }
}

/** 자료가 있는 가장 최근 연도 (올해부터 거꾸로 찾음) */
export async function latestYear(keys: ApiKeys, admCd: string): Promise<number> {
  const thisYear = new Date().getFullYear()
  for (let y = thisYear; y >= thisYear - 5; y--) {
    const data = await sgisGet(keys, '/stats/population.json', { year: String(y), adm_cd: admCd, low_search: '0' })
    const r = rows(data)[0]
    if (r && num(r.tot_ppltn) !== null) return y
  }
  throw new SgisError('-100', '최근 5년 안의 인구 통계를 찾지 못했습니다.')
}

export async function populationSeries(keys: ApiKeys, admCd: string, fromYear: number, toYear: number): Promise<PopulationYear[]> {
  const years: number[] = []
  for (let y = fromYear; y <= toYear; y++) years.push(y)
  const results = await Promise.all(
    years.map(async (y) => {
      const data = await sgisGet(keys, '/stats/population.json', { year: String(y), adm_cd: admCd, low_search: '0' })
      const r = rows(data)[0]
      return r ? toPopulationYear(y, r) : null
    }),
  )
  return results.filter((x): x is PopulationYear => !!x && x.tot_ppltn !== null)
}

// ───────────── 가구 (1인 가구) ─────────────

export interface HouseholdYear {
  year: number
  total: number | null
  onePerson: number | null
}

export async function households(keys: ApiKeys, admCd: string, year: number): Promise<HouseholdYear> {
  const [all, one] = await Promise.all([
    sgisGet(keys, '/stats/household.json', { year: String(year), adm_cd: admCd, low_search: '0' }),
    sgisGet(keys, '/stats/household.json', { year: String(year), adm_cd: admCd, low_search: '0', household_type: 'A0' }),
  ])
  return { year, total: num(rows(all)[0]?.household_cnt), onePerson: num(rows(one)[0]?.household_cnt) }
}

// ───────────── 사업체 (산업 대분류) ─────────────

export const INDUSTRY_SECTIONS: { code: string; name: string }[] = [
  { code: 'A', name: '농업, 임업 및 어업' },
  { code: 'B', name: '광업' },
  { code: 'C', name: '제조업' },
  { code: 'D', name: '전기·가스·증기 공급업' },
  { code: 'E', name: '수도·하수·폐기물 처리업' },
  { code: 'F', name: '건설업' },
  { code: 'G', name: '도매 및 소매업' },
  { code: 'H', name: '운수 및 창고업' },
  { code: 'I', name: '숙박 및 음식점업' },
  { code: 'J', name: '정보통신업' },
  { code: 'K', name: '금융 및 보험업' },
  { code: 'L', name: '부동산업' },
  { code: 'M', name: '전문·과학·기술 서비스업' },
  { code: 'N', name: '사업시설 관리·지원·임대 서비스업' },
  { code: 'O', name: '공공 행정' },
  { code: 'P', name: '교육 서비스업' },
  { code: 'Q', name: '보건업 및 사회복지 서비스업' },
  { code: 'R', name: '예술·스포츠·여가 서비스업' },
  { code: 'S', name: '협회·단체, 수리 및 기타 개인 서비스업' },
  { code: 'T', name: '가구 내 고용활동' },
  { code: 'U', name: '국제 및 외국기관' },
]

export interface IndustryRow {
  code: string
  name: string
  corp: number
  worker: number
}

export async function industries(keys: ApiKeys, admCd: string, year: number): Promise<IndustryRow[]> {
  const out: IndustryRow[] = []
  // 21개 대분류를 6개씩 나눠 요청
  for (let i = 0; i < INDUSTRY_SECTIONS.length; i += 6) {
    const batch = INDUSTRY_SECTIONS.slice(i, i + 6)
    const res = await Promise.all(
      batch.map((s) =>
        sgisGet(keys, '/stats/company.json', { year: String(year), adm_cd: admCd, low_search: '0', class_code: s.code }),
      ),
    )
    res.forEach((data, j) => {
      const r = rows(data)[0]
      const corp = num(r?.corp_cnt)
      if (corp && corp > 0) out.push({ code: batch[j].code, name: batch[j].name, corp, worker: num(r?.tot_worker) ?? 0 })
    })
  }
  return out
}

// ───────────── 집계구 (반경 안 분포) ─────────────

export interface StatsAreaFeature extends Feature<Geometry, Record<string, unknown>> {}

/** 반경을 감싸는 사각형 안의 집계구 경계 + 최신 연도 주요지표. 도형은 WGS84로 바꿔 돌려준다. */
export async function statsAreasAround(
  keys: ApiKeys,
  lon: number,
  lat: number,
  radiusM: number,
  year: number,
): Promise<{ features: StatsAreaFeature[]; dongCodes: string[] }> {
  const [x, y] = wgs84ToUtmk(lon, lat)
  const data = await sgisGet(keys, '/boundary/userarea.geojson', {
    minx: String(Math.round(x - radiusM)),
    miny: String(Math.round(y - radiusM)),
    maxx: String(Math.round(x + radiusM)),
    maxy: String(Math.round(y + radiusM)),
    cd: '4',
  })
  const raw = (Array.isArray(data.features) ? data.features : []) as StatsAreaFeature[]
  const dongCodes = [...new Set(raw.map((f) => String(f.properties?.adm_cd ?? '').slice(0, 8)).filter((c) => c.length === 8))]

  const stats = new Map<string, Record<string, unknown>>()
  await Promise.all(
    dongCodes.map(async (code) => {
      const d = await sgisGet(keys, '/stats/population.json', { year: String(year), adm_cd: code, low_search: '1' })
      for (const r of rows(d)) stats.set(String(r.adm_cd), r)
    }),
  )

  const features = raw
    .filter((f) => f.geometry)
    .map((f) => {
      const code = String(f.properties?.adm_cd ?? '')
      const s = stats.get(code) ?? {}
      return {
        type: 'Feature' as const,
        geometry: geometryUtmkToWgs84(f.geometry),
        properties: {
          adm_cd: code,
          adm_nm: s.adm_nm ?? '',
          year,
          tot_ppltn: num(s.tot_ppltn),
          ppltn_dnsty: num(s.ppltn_dnsty),
          avg_age: num(s.avg_age),
          aged_child_idx: num(s.aged_child_idx),
          tot_family: num(s.tot_family),
          avg_fmember_cnt: num(s.avg_fmember_cnt),
          tot_house: num(s.tot_house),
          corp_cnt: num(s.corp_cnt),
          employee_cnt: num(s.employee_cnt),
        },
      }
    })
  return { features, dongCodes }
}
