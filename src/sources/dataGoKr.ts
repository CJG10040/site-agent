// 공공데이터포털(apis.data.go.kr) 공통 요청 도우미.
// 서비스마다 '활용신청'이 따로 필요하며, 신청하지 않은 서비스는 인증 오류(XML)로 응답한다.
// 응답의 item은 1건이면 객체, 여러 건이면 배열, 없으면 빈 문자열/배열로 오는 경우가 많다.

import { normalizeDataGoKrKey, type ApiKeys } from './keys'

export class DataGoKrError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'DataGoKrError'
    this.code = code
  }
}

function xmlError(text: string): string {
  const m = text.match(/<(returnAuthMsg|errMsg|resultMsg)>([^<]+)</)
  return m ? m[2] : text.replace(/\s+/g, ' ').slice(0, 120)
}

/**
 * serviceKey를 붙여 GET 요청하고 JSON으로 해석한다.
 * @param serviceName 오류 안내에 쓸 서비스 이름 (예: '버스정류소정보')
 */
export async function dataGoKrGet(keys: ApiKeys, base: string, params: Record<string, string>, serviceName: string): Promise<unknown> {
  const key = normalizeDataGoKrKey(keys.dataGoKr)
  if (!key) throw new DataGoKrError('NO_KEY', '공공데이터포털 인증키가 입력되지 않았습니다. 설정에서 입력하세요.')
  const url = `${base}?${new URLSearchParams({ serviceKey: key, ...params })}`
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new DataGoKrError('NETWORK', `공공데이터포털(${serviceName}) 서버에 연결하지 못했습니다. 활용신청 직후라면 1~2시간 뒤 다시 해 보세요.`)
  }
  const text = await res.text()
  const trimmed = text.trim()
  if (!res.ok || trimmed.startsWith('<') || /^(Unauthorized|Forbidden|API not found)/i.test(trimmed)) {
    const msg = trimmed.startsWith('<') ? xmlError(trimmed) : trimmed.slice(0, 120) || `HTTP ${res.status}`
    const authLike = /SERVICE_KEY|SERVICE KEY|등록되지|not registered|Unauthorized|Forbidden|인증/i.test(msg) || res.status === 401 || res.status === 403
    throw new DataGoKrError(
      String(res.status),
      `${msg}${authLike ? ` — 공공데이터포털에서 '${serviceName}' 활용신청이 승인됐는지 확인하세요. 승인 직후에는 1~2시간 걸릴 수 있습니다.` : ''}`,
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new DataGoKrError('PARSE', `${serviceName} 응답을 해석하지 못했습니다.`)
  }
}

/** 표준 형식 { response: { header: { resultCode }, body: { items: { item }, totalCount } } } 에서 항목 꺼내기 */
export function standardItems(data: unknown): { items: Record<string, unknown>[]; total: number } {
  const r = (data as { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: unknown; totalCount?: unknown } } })
    ?.response
  const code = r?.header?.resultCode
  // 03 = NODATA_ERROR (자료 없음)
  if (code === '03') return { items: [], total: 0 }
  if (code && code !== '00' && code !== '0') throw new DataGoKrError(code, r?.header?.resultMsg ?? '오류')
  const items = r?.body?.items
  const item = typeof items === 'object' && items ? (items as { item?: unknown }).item : undefined
  const list = Array.isArray(item) ? item : item && typeof item === 'object' ? [item] : []
  return { items: list as Record<string, unknown>[], total: Number(r?.body?.totalCount ?? list.length) || list.length }
}
