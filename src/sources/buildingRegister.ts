// 공공데이터포털 — 국토교통부 건축HUB 건축물대장정보 서비스.
// 2026-11-09 실제 키로 확인: CORS 허용(fetch 가능), 행정통합 이후의 새 시군구 코드(예: 12210)로 조회됨.
// 응답의 item은 1건이면 객체, 여러 건이면 배열, 없으면 빈 문자열/배열로 온다.

import { normalizeDataGoKrKey, type ApiKeys } from './keys'

const BASE = 'https://apis.data.go.kr/1613000/BldRgstHubService'

export class HubError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'HubError'
    this.code = code
  }
}

export interface ParcelAddressParams {
  sigunguCd: string
  bjdongCd: string
  platGbCd: string
  bun: string
  ji: string
}

/** PNU(19자리) → 건축물대장 조회 조건. PNU 11번째 자리: 1 일반, 2 산 */
export function pnuToParams(pnu: string): ParcelAddressParams {
  return {
    sigunguCd: pnu.slice(0, 5),
    bjdongCd: pnu.slice(5, 10),
    platGbCd: pnu.charAt(10) === '2' ? '1' : '0',
    bun: pnu.slice(11, 15),
    ji: pnu.slice(15, 19),
  }
}

function xmlError(text: string): string {
  const m = text.match(/<(returnAuthMsg|errMsg|resultMsg)>([^<]+)</)
  return m ? m[2] : text.slice(0, 120)
}

async function hubGet(keys: ApiKeys, op: string, params: ParcelAddressParams): Promise<Record<string, unknown>[]> {
  const key = normalizeDataGoKrKey(keys.dataGoKr)
  if (!key) throw new HubError('NO_KEY', '공공데이터포털 인증키가 입력되지 않았습니다. 설정에서 입력하세요.')
  const url = `${BASE}/${op}?${new URLSearchParams({ serviceKey: key, _type: 'json', numOfRows: '100', pageNo: '1', ...params })}`
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new HubError('NETWORK', '공공데이터포털 서버에 연결하지 못했습니다.')
  }
  const text = await res.text()
  if (!res.ok || text.trim().startsWith('<')) {
    const msg = xmlError(text)
    const hint = /SERVICE_KEY|등록되지|not registered/i.test(msg)
      ? ' — 인증키가 맞는지, 건축물대장 서비스 활용신청이 승인됐는지 확인하세요.'
      : ''
    throw new HubError(String(res.status), `${msg}${hint}`)
  }
  let data: { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: { item?: unknown } | string } } }
  try {
    data = JSON.parse(text)
  } catch {
    throw new HubError('PARSE', '응답을 해석하지 못했습니다.')
  }
  const code = data.response?.header?.resultCode
  if (code && code !== '00') throw new HubError(code, data.response?.header?.resultMsg ?? '오류')
  const items = data.response?.body?.items
  const item = typeof items === 'object' && items ? items.item : undefined
  if (Array.isArray(item)) return item as Record<string, unknown>[]
  if (item && typeof item === 'object') return [item as Record<string, unknown>]
  return []
}

export function publicHubUrl(op: string, params: ParcelAddressParams): string {
  return `${BASE}/${op}?${new URLSearchParams({ _type: 'json', ...params })}`
}

export interface RegisterParcel {
  pnu: string
  addr: string
  role: 'site' | 'adjacent'
  titles: Record<string, unknown>[] // 표제부
  floors: Record<string, unknown>[] // 층별개요
  error: string | null
}

const TITLE_FIELDS = [
  'mgmBldrgstPk',
  'platPlc',
  'newPlatPlc',
  'bldNm',
  'dongNm',
  'mainAtchGbCdNm',
  'regstrKindCdNm',
  'mainPurpsCdNm',
  'etcPurps',
  'strctCdNm',
  'roofCdNm',
  'grndFlrCnt',
  'ugrndFlrCnt',
  'heit',
  'platArea',
  'archArea',
  'totArea',
  'bcRat',
  'vlRat',
  'hhldCnt',
  'fmlyCnt',
  'hoCnt',
  'useAprDay',
  'pmsDay',
  'stcnsDay',
]

const FLOOR_FIELDS = ['mgmBldrgstPk', 'dongNm', 'flrGbCdNm', 'flrNo', 'flrNoNm', 'mainPurpsCdNm', 'etcPurps', 'strctCdNm', 'area']

function pick(item: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) if (item[f] !== undefined) out[f] = typeof item[f] === 'string' ? (item[f] as string).trim() : item[f]
  return out
}

export async function registerForParcel(keys: ApiKeys, pnu: string, addr: string, role: RegisterParcel['role']): Promise<RegisterParcel> {
  const params = pnuToParams(pnu)
  try {
    const [titles, floors] = await Promise.all([hubGet(keys, 'getBrTitleInfo', params), hubGet(keys, 'getBrFlrOulnInfo', params)])
    return {
      pnu,
      addr,
      role,
      titles: titles.map((t) => pick(t, TITLE_FIELDS)),
      floors: floors.map((f) => pick(f, FLOOR_FIELDS)),
      error: null,
    }
  } catch (e) {
    return { pnu, addr, role, titles: [], floors: [], error: e instanceof Error ? e.message : String(e) }
  }
}
