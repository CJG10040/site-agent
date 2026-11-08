// 브이월드(국토교통부 공간정보 오픈플랫폼) 데이터 소스.
// - 지도 타일(WMTS): 이미지로 불러오므로 CORS와 무관
// - 검색·주소·2D 데이터 API: CORS 미지원 → JSONP로 호출 (2026-11-08 확인)
// 인증키는 코드에 넣지 않고 사용자가 설정 화면에서 입력하며, 이 브라우저에만 저장한다.

import type { Geometry } from 'geojson'
import { jsonp, JsonpError } from '../lib/jsonp'
import { readSetting, writeSetting } from '../lib/storage'

const API = 'https://api.vworld.kr'
const KEY_STORAGE = 'site-agent:vworld-key'
const DOMAIN_STORAGE = 'site-agent:vworld-domain'

export const SOURCE_NAME = '브이월드 (국토교통부 공간정보 오픈플랫폼)'

export interface VWorldConfig {
  key: string
  /** 비워 두면 현재 접속 주소(origin)를 사용 */
  domain: string
}

export function loadConfig(): VWorldConfig {
  return {
    key: readSetting(KEY_STORAGE) ?? '',
    domain: readSetting(DOMAIN_STORAGE) ?? '',
  }
}

export function saveConfig(config: VWorldConfig): boolean {
  const a = writeSetting(KEY_STORAGE, config.key.trim())
  const b = writeSetting(DOMAIN_STORAGE, config.domain.trim())
  return a && b
}

export function effectiveDomain(config: VWorldConfig): string {
  return config.domain.trim() || window.location.origin
}

export class VWorldError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'VWorldError'
    this.code = code
  }
}

/** 오류 코드별 해결 힌트 (브이월드 공식 문서의 코드 의미에 근거하되, 원인은 '가능성'으로 안내) */
export function errorHint(code: string): string {
  switch (code) {
    case 'NO_KEY':
      return '오른쪽 위 [설정]에서 브이월드 인증키를 입력하세요.'
    case 'INVALID_KEY':
      return '등록되지 않은 키입니다. 키를 복사할 때 앞뒤 공백이나 글자가 빠지지 않았는지 확인하세요.'
    case 'INCORRECT_KEY':
      return '키 정보가 맞지 않습니다. 브이월드에 등록한 서비스 URL이 현재 접속 주소와 다를 가능성이 있습니다.'
    case 'UNAVAILABLE_KEY':
      return '키를 일시적으로 사용할 수 없는 상태입니다. 브이월드 마이페이지에서 키 상태(승인·기간)를 확인하세요.'
    case 'OVER_REQUEST_LIMIT':
      return '일일 요청 한도를 넘었을 수 있습니다. 내일 다시 시도하거나 한도를 확인하세요.'
    case 'TIMEOUT':
    case 'SCRIPT_ERROR':
      return '네트워크 상태를 확인하세요. 브이월드 서버 점검 중일 수도 있습니다.'
    case 'NO_CALLBACK':
      return '이 API는 브라우저에서 직접 부를 수 없어 중계 서버가 필요할 수 있습니다.'
    default:
      return ''
  }
}

interface Envelope<R> {
  response?: {
    status?: string
    error?: { level?: string; code?: string; text?: string }
    result?: R
    record?: { total?: string; current?: string }
  }
}

interface CallResult<R> {
  found: boolean
  result?: R
  total?: number
}

async function call<R>(path: string, config: VWorldConfig, params: Record<string, string>): Promise<CallResult<R>> {
  if (!config.key.trim()) {
    throw new VWorldError('NO_KEY', '브이월드 인증키가 입력되지 않았습니다.')
  }
  let data: Envelope<R>
  try {
    data = await jsonp<Envelope<R>>(`${API}${path}`, {
      ...params,
      key: config.key.trim(),
      domain: effectiveDomain(config),
      format: 'json',
      errorformat: 'json',
    })
  } catch (e) {
    if (e instanceof JsonpError) throw new VWorldError(e.code, e.message)
    throw e
  }
  const res = data?.response
  if (!res || !res.status) throw new VWorldError('BAD_RESPONSE', '응답 형식을 해석할 수 없습니다.')
  if (res.status === 'ERROR') {
    throw new VWorldError(res.error?.code ?? 'ERROR', res.error?.text ?? '알 수 없는 오류가 발생했습니다.')
  }
  if (res.status === 'NOT_FOUND') return { found: false }
  return {
    found: true,
    result: res.result,
    total: res.record?.total ? Number(res.record.total) : undefined,
  }
}

// ───────────────────────── 지도 타일 ─────────────────────────

export type BaseMap = 'Base' | 'Satellite' | 'white' | 'midnight'

export const BASE_MAPS: { id: BaseMap; label: string }[] = [
  { id: 'Base', label: '일반' },
  { id: 'Satellite', label: '항공사진' },
  { id: 'white', label: '회색' },
  { id: 'midnight', label: '야간' },
]

export function tileUrl(key: string, layer: BaseMap | 'Hybrid'): string {
  const ext = layer === 'Satellite' ? 'jpeg' : 'png'
  return `${API}/req/wmts/1.0.0/${encodeURIComponent(key.trim())}/${layer}/{z}/{y}/{x}.${ext}`
}

// ───────────────────────── 지도 위 주제도 (WMS 이미지) ─────────────────────────
// 2026-11-08 실제 키로 EPSG:3857 GetMap 응답 확인

export const WMS_URL = `${API}/req/wms`

export const WMS_LAYERS: { id: string; label: string }[] = [
  { id: 'lp_pa_cbnd_bubun', label: '지적도' },
  { id: 'lt_c_uq111', label: '용도지역' },
  { id: 'lt_c_uq121', label: '경관지구' },
  { id: 'lt_c_uq141', label: '지구단위계획' },
  { id: 'lt_c_bldginfo', label: '건물' },
  { id: 'lt_l_moctlink', label: '도로망' },
]

/** 출처 기록용 요청 주소. 인증키·도메인·콜백은 빼고 저장한다. */
export function publicUrl(path: string, params: Record<string, string>): string {
  const q = new URLSearchParams(params)
  return `${API}${path}?${q.toString()}`
}

// ───────────────────────── 검색 ─────────────────────────

export type SearchKind = 'road' | 'parcel' | 'place' | 'coord'

export const SEARCH_KIND_LABEL: Record<SearchKind, string> = {
  road: '도로명 주소',
  parcel: '지번 주소',
  place: '장소',
  coord: '좌표',
}

/**
 * "35.148, 126.917" 또는 "126.917 35.148" 같은 입력을 좌표로 해석한다.
 * 한국 범위(위도 33~39, 경도 124~132)로 위도·경도 순서를 판단한다.
 */
export function parseCoordinate(text: string): { lon: number; lat: number } | null {
  const m = text.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  const isLat = (v: number) => v >= 33 && v <= 39
  const isLon = (v: number) => v >= 124 && v <= 132
  if (isLat(a) && isLon(b)) return { lat: a, lon: b }
  if (isLon(a) && isLat(b)) return { lat: b, lon: a }
  return null
}

export interface SearchHit {
  id: string
  kind: SearchKind
  title: string
  subtitle: string
  lon: number
  lat: number
}

interface SearchItem {
  id?: string
  title?: string
  category?: string
  address?: { road?: string; parcel?: string; bldnm?: string }
  point?: { x?: string; y?: string }
}

export async function search(config: VWorldConfig, query: string, kind: SearchKind): Promise<SearchHit[]> {
  const params: Record<string, string> = {
    service: 'search',
    request: 'search',
    version: '2.0',
    crs: 'EPSG:4326',
    size: '10',
    page: '1',
    query,
    type: kind === 'place' ? 'place' : 'address',
  }
  if (kind !== 'place') params.category = kind
  const r = await call<{ items?: SearchItem[] }>('/req/search', config, params)
  const items = r.result?.items ?? []
  return items
    .filter((it) => it.point?.x && it.point?.y)
    .map((it, i) => {
      const road = it.address?.road ?? ''
      const parcel = it.address?.parcel ?? ''
      const bld = it.address?.bldnm ? ` (${it.address.bldnm})` : ''
      let title: string
      let subtitle: string
      if (kind === 'place') {
        title = it.title ?? road ?? parcel
        subtitle = [it.category, road || parcel].filter(Boolean).join(' · ')
      } else if (kind === 'road') {
        title = road + bld
        subtitle = parcel
      } else {
        title = parcel
        subtitle = road
      }
      return {
        id: `${kind}-${it.id ?? i}`,
        kind,
        title: title || '(이름 없음)',
        subtitle,
        lon: Number(it.point!.x),
        lat: Number(it.point!.y),
      }
    })
}

// ───────────────────────── 주소 ↔ 좌표 ─────────────────────────

export async function reverseGeocode(
  config: VWorldConfig,
  lon: number,
  lat: number,
): Promise<{ road?: string; parcel?: string }> {
  const r = await call<{ type?: string; text?: string }[]>('/req/address', config, {
    service: 'address',
    request: 'getAddress',
    version: '2.0',
    crs: 'EPSG:4326',
    point: `${lon},${lat}`,
    type: 'both',
  })
  const out: { road?: string; parcel?: string } = {}
  for (const item of r.result ?? []) {
    if (item.type === 'road' && item.text) out.road = item.text
    if (item.type === 'parcel' && item.text) out.parcel = item.text
  }
  return out
}

export async function geocode(
  config: VWorldConfig,
  address: string,
  type: 'road' | 'parcel',
): Promise<{ lon: number; lat: number } | null> {
  const r = await call<{ point?: { x?: string; y?: string } }>('/req/address', config, {
    service: 'address',
    request: 'getcoord',
    version: '2.0',
    crs: 'EPSG:4326',
    address,
    type,
    refine: 'true',
    simple: 'false',
  })
  const p = r.result?.point
  if (!p?.x || !p?.y) return null
  return { lon: Number(p.x), lat: Number(p.y) }
}

// ───────────────────────── 2D 데이터 (WFS 대체 GetFeature) ─────────────────────────

export interface GeoFeature {
  type: 'Feature'
  geometry: Geometry | null
  properties: Record<string, unknown>
}

export interface DataLayer {
  id: string
  label: string
}

export const PARCEL_LAYER: DataLayer = { id: 'LP_PA_CBND_BUBUN', label: '연속지적도' }

/** 용도지역: 대지가 어느 지역에 있는지 모르므로 네 가지를 모두 조회 */
export const ZONING_LAYERS: DataLayer[] = [
  { id: 'LT_C_UQ111', label: '용도지역(도시지역)' },
  { id: 'LT_C_UQ112', label: '용도지역(관리지역)' },
  { id: 'LT_C_UQ113', label: '용도지역(농림지역)' },
  { id: 'LT_C_UQ114', label: '용도지역(자연환경보전지역)' },
]

export async function featuresAtPoint(
  config: VWorldConfig,
  layerId: string,
  lon: number,
  lat: number,
  withGeometry = true,
): Promise<GeoFeature[]> {
  const r = await call<{ featureCollection?: { features?: GeoFeature[] } }>('/req/data', config, {
    service: 'data',
    request: 'GetFeature',
    version: '2.0',
    data: layerId,
    geomFilter: `POINT(${lon} ${lat})`,
    crs: 'EPSG:4326',
    size: '10',
    page: '1',
    geometry: String(withGeometry),
    attribute: 'true',
  })
  return r.result?.featureCollection?.features ?? []
}

export interface FeatureQuery {
  layerId: string
  /** 브이월드 geomFilter: POINT(x y) / BOX(minx,miny,maxx,maxy) / POLYGON((…)) */
  geomFilter: string
  geometry: boolean
  maxFeatures?: number
}

export interface FeatureQueryResult {
  features: GeoFeature[]
  total: number
  truncated: boolean
  url: string
}

/** 범위 안의 피처를 페이지를 넘겨 가며 모두 받는다 (한 번에 최대 1000건). */
export async function queryFeatures(config: VWorldConfig, q: FeatureQuery): Promise<FeatureQueryResult> {
  const max = q.maxFeatures ?? 3000
  const size = 1000
  const base: Record<string, string> = {
    service: 'data',
    request: 'GetFeature',
    version: '2.0',
    data: q.layerId,
    geomFilter: q.geomFilter,
    crs: 'EPSG:4326',
    size: String(size),
    geometry: String(q.geometry),
    attribute: 'true',
  }
  const features: GeoFeature[] = []
  let total = 0
  for (let page = 1; page <= Math.ceil(max / size); page++) {
    const r = await call<{ featureCollection?: { features?: GeoFeature[] } }>('/req/data', config, {
      ...base,
      page: String(page),
    })
    if (!r.found) break
    const batch = r.result?.featureCollection?.features ?? []
    total = r.total ?? batch.length
    features.push(...batch)
    if (features.length >= total || batch.length < size) break
  }
  return {
    features: features.slice(0, max),
    total,
    truncated: total > max,
    url: publicUrl('/req/data', { ...base, page: '1', format: 'json' }),
  }
}

// ───────────────────────── 연결 진단 ─────────────────────────

export interface CheckResult {
  id: string
  label: string
  ok: boolean
  summary: string
  hint: string
  ms: number
}

/** 광주광역시청 일대 (진단용 기준점) */
const PROBE = { lon: 126.8526, lat: 35.16, tile: { z: 7, x: 109, y: 50 } }

function loadImage(url: string, timeoutMs = 12000): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const timer = window.setTimeout(() => reject(new Error('응답 시간이 초과되었습니다.')), timeoutMs)
    img.onload = () => {
      window.clearTimeout(timer)
      resolve()
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error('타일 이미지를 받지 못했습니다. 인증키 또는 등록된 서비스 URL을 확인하세요.'))
    }
    img.src = url
  })
}

async function timed(id: string, label: string, run: () => Promise<string>): Promise<CheckResult> {
  const t0 = performance.now()
  try {
    const summary = await run()
    return { id, label, ok: true, summary, hint: '', ms: Math.round(performance.now() - t0) }
  } catch (e) {
    const code = e instanceof VWorldError ? e.code : ''
    const message = e instanceof Error ? e.message : String(e)
    return {
      id,
      label,
      ok: false,
      summary: code ? `${code} — ${message}` : message,
      hint: errorHint(code),
      ms: Math.round(performance.now() - t0),
    }
  }
}

export async function runDiagnostics(config: VWorldConfig): Promise<CheckResult[]> {
  if (!config.key.trim()) {
    return [
      {
        id: 'key',
        label: '인증키',
        ok: false,
        summary: '인증키가 입력되지 않았습니다.',
        hint: errorHint('NO_KEY'),
        ms: 0,
      },
    ]
  }
  const { z, x, y } = PROBE.tile
  const tile = tileUrl(config.key, 'Base').replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x))

  return Promise.all([
    timed('tile', '지도 타일 (WMTS)', async () => {
      await loadImage(`${tile}?t=${Date.now()}`)
      return '기본지도 타일을 받았습니다.'
    }),
    timed('search', '장소 검색 API', async () => {
      const hits = await search(config, '광주광역시청', 'place')
      return `응답 정상 · 결과 ${hits.length}건`
    }),
    timed('address', '주소 → 좌표 API', async () => {
      const p = await geocode(config, '광주광역시 서구 내방로 111', 'road')
      return p ? `응답 정상 · (${p.lon.toFixed(5)}, ${p.lat.toFixed(5)})` : '응답 정상 · 결과 없음'
    }),
    timed('data', '2D 데이터 API (연속지적도)', async () => {
      const f = await featuresAtPoint(config, PARCEL_LAYER.id, PROBE.lon, PROBE.lat, false)
      return `응답 정상 · 필지 ${f.length}건`
    }),
  ])
}
