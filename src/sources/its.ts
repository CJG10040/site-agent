// 국가교통정보센터(its.go.kr) 교통소통정보 Open API — 표준노드링크 링크별 실시간 통행 속도.
// 2026-11-10 확인: openapi.its.go.kr:9443 이 요청 출처(Origin)를 그대로 허용(CORS)해 브라우저에서 바로 부를 수 있음.
// 실시간 자료만 주므로(약 5분 갱신) 받은 시각의 '한 장면'으로 저장하고, 여러 번 받아 시간대별로 쌓는다.

import type { ApiKeys } from './keys'

const BASE = 'https://openapi.its.go.kr:9443/trafficInfo'
export const ITS_PUBLIC_URL = BASE

export interface LinkSpeed {
  linkId: string
  roadName: string
  /** 통행 속도 km/h */
  speed: number
  /** 통행 시간 초 */
  travelTime: number
  /** 생성 일시 YYYYMMDDHH24MISS */
  createdDate: string
}

export interface SpeedSnapshot {
  /** 받은 시각 (ISO) */
  at: string
  /** 자료 생성 시각 중 가장 늦은 값 (YYYYMMDDHHMMSS) */
  created: string
  /** 링크 ID → 통행 속도(km/h) */
  speeds: Record<string, number>
  /** 링크 ID → 도로명 (비어 있으면 생략) */
  names: Record<string, string>
}

const MESSAGES: Record<string, string> = {
  '4001': '사용량 제한을 넘었습니다',
  '4002': '요청 값이 잘못되었습니다',
  '4004': '페이지 오류',
  '4005': '인증키가 맞지 않습니다',
  '4009': '국가교통정보센터 시스템 오류',
}

type Raw = Record<string, unknown>

function itemsOf(data: unknown): Raw[] {
  const root = (data as { response?: unknown })?.response ?? data
  const body = (root as { body?: unknown })?.body
  const items = (body as { items?: unknown })?.items ?? (root as { items?: unknown })?.items
  if (Array.isArray(items)) return items as Raw[]
  const item = (items as { item?: unknown })?.item
  if (Array.isArray(item)) return item as Raw[]
  return item ? [item as Raw] : []
}

function headerOf(data: unknown): { code: string; msg: string } {
  const root = (data as { response?: unknown })?.response ?? data
  const h = ((root as { header?: unknown })?.header ?? root) as { resultCode?: unknown; resultMsg?: unknown }
  return { code: String(h?.resultCode ?? ''), msg: String(h?.resultMsg ?? '') }
}

/** 경위도 사각형 안 모든 도로(고속도로·국도·지자체 도로)의 실시간 속도 */
export async function trafficInBox(keys: ApiKeys, box: [number, number, number, number]): Promise<LinkSpeed[]> {
  const key = keys.itsKey.trim()
  if (!key) throw new Error('국가교통정보센터 인증키가 없습니다')
  const [minX, minY, maxX, maxY] = box
  const qs = new URLSearchParams({
    apiKey: key,
    type: 'all',
    drcType: 'all',
    minX: minX.toFixed(6),
    maxX: maxX.toFixed(6),
    minY: minY.toFixed(6),
    maxY: maxY.toFixed(6),
    getType: 'json',
  })
  let res: Response
  try {
    res = await fetch(`${BASE}?${qs}`)
  } catch {
    throw new Error('국가교통정보센터에 연결하지 못했습니다 (네트워크)')
  }
  const text = await res.text()
  if (!res.ok) throw new Error(`국가교통정보센터 응답 오류 (HTTP ${res.status})`)
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    // 오류는 XML로 오는 경우가 있다
    const code = /<resultCode>\s*([^<]+?)\s*<\/resultCode>/.exec(text)?.[1] ?? ''
    const msg = /<resultMsg>\s*([^<]+?)\s*<\/resultMsg>/.exec(text)?.[1] ?? ''
    throw new Error(MESSAGES[msg] ?? MESSAGES[code] ?? `국가교통정보센터 응답을 읽지 못했습니다 ${msg || code}`.trim())
  }
  const { code, msg } = headerOf(data)
  if (code && code !== '0' && code !== '00') throw new Error(MESSAGES[msg] ?? MESSAGES[code] ?? (msg || `오류 ${code}`))
  if (MESSAGES[msg]) throw new Error(MESSAGES[msg])
  return itemsOf(data)
    .map((it) => ({
      linkId: String(it.linkId ?? '').trim(),
      roadName: String(it.roadName ?? '').trim(),
      speed: Number(it.speed),
      travelTime: Number(it.travelTime),
      createdDate: String(it.createdDate ?? '').trim(),
    }))
    .filter((l) => l.linkId && Number.isFinite(l.speed))
}

export function toSnapshot(links: LinkSpeed[], at = new Date()): SpeedSnapshot {
  const speeds: Record<string, number> = {}
  const names: Record<string, string> = {}
  let created = ''
  for (const l of links) {
    speeds[l.linkId] = l.speed
    if (l.roadName) names[l.linkId] = l.roadName
    if (l.createdDate > created) created = l.createdDate
  }
  return { at: at.toISOString(), created, speeds, names }
}

/** 생성 시각(YYYYMMDDHHMMSS) → "11월 10일(화) 08:15" */
export function snapshotLabel(s: SpeedSnapshot): string {
  const src = s.created && s.created.length >= 12 ? s.created : ''
  const d = src
    ? new Date(+src.slice(0, 4), +src.slice(4, 6) - 1, +src.slice(6, 8), +src.slice(8, 10), +src.slice(10, 12))
    : new Date(s.at)
  const wd = '일월화수목금토'[d.getDay()]
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${wd}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 시간대 이름 (출근·낮·퇴근·저녁·밤) */
export function timeBand(s: SpeedSnapshot): string {
  const src = s.created && s.created.length >= 12 ? s.created : ''
  const h = src ? +src.slice(8, 10) : new Date(s.at).getHours()
  if (h >= 7 && h < 10) return '출근 시간'
  if (h >= 10 && h < 17) return '낮'
  if (h >= 17 && h < 20) return '퇴근 시간'
  if (h >= 20 && h < 23) return '저녁'
  return '밤'
}

export async function itsProbe(keys: ApiKeys, lon: number, lat: number): Promise<number> {
  const d = 0.004
  const links = await trafficInBox(keys, [lon - d, lat - d, lon + d, lat + d])
  return links.length
}
