// 브이월드 부동산 개방데이터(NED) — 필지 단위 토지 자료.
// 2026-11-08 실제 키로 확인: JSONP 지원(유효한 키일 때), CORS 미지원.
// 행정통합(전남광주통합특별시) 이후 새 PNU로 조회되는 자료와 옛 PNU로만 조회되는 자료가 섞여 있어
// 결과가 없으면 옛 코드로 한 번 더 조회한다.
// 사용자 결정(2026-11-09): 토지 소유 정보는 다루지 않는다 → 소유 관련 필드는 저장 전에 지운다.

import { jsonp, JsonpError } from '../lib/jsonp'
import { effectiveDomain, publicUrl, VWorldError, type VWorldConfig } from './vworld'

const API = 'https://api.vworld.kr'

// 2026년 통합 이전 광주광역시·전라남도 시군구 코드 (이름 → 옛 5자리 코드)
const OLD_SIGUNGU_JEONNAM_GWANGJU: Record<string, string> = {
  동구: '29110',
  서구: '29140',
  남구: '29155',
  북구: '29170',
  광산구: '29200',
  목포시: '46110',
  여수시: '46130',
  순천시: '46150',
  나주시: '46170',
  광양시: '46230',
  담양군: '46710',
  곡성군: '46720',
  구례군: '46730',
  고흥군: '46770',
  보성군: '46780',
  화순군: '46790',
  장흥군: '46800',
  강진군: '46810',
  해남군: '46820',
  영암군: '46830',
  무안군: '46840',
  함평군: '46860',
  영광군: '46870',
  장성군: '46880',
  완도군: '46890',
  진도군: '46900',
  신안군: '46910',
}

/** 같은 필지를 가리킬 수 있는 다른 PNU 후보 (행정구역 개편 전 코드) */
export function alternatePnus(pnu: string, addr: string): string[] {
  const out: string[] = []
  const tokens = addr.trim().split(/\s+/)
  if (tokens[0]?.startsWith('전남광주') && tokens[1]) {
    const old = OLD_SIGUNGU_JEONNAM_GWANGJU[tokens[1]]
    if (old) out.push(old + pnu.slice(5))
  }
  // 전북특별자치도(2024): 시도 코드 52 ← 45
  if (pnu.startsWith('52')) out.push(`45${pnu.slice(2)}`)
  return out.filter((p) => p !== pnu)
}

const OWNERSHIP_FIELDS = /^(posesn|cnrsPsn|resdnc|ownship|nationInstt)/

function stripOwnership(item: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).filter(([k]) => !OWNERSHIP_FIELDS.test(k)))
}

export interface NedResult {
  items: Record<string, unknown>[]
  usedPnu: string
  url: string
}

async function nedOnce(config: VWorldConfig, path: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
  let data: Record<string, unknown>
  try {
    data = await jsonp<Record<string, unknown>>(`${API}${path}`, {
      ...params,
      key: config.key.trim(),
      domain: effectiveDomain(config),
      format: 'json',
    })
  } catch (e) {
    if (e instanceof JsonpError) throw new VWorldError(e.code, e.message)
    throw e
  }
  const firstKey = Object.keys(data ?? {})[0]
  const body = (firstKey ? data[firstKey] : null) as Record<string, unknown> | null
  if (!body) return []
  const code = String(body.resultCode ?? '')
  const list = body.field ?? body[firstKey]
  if (code && code !== 'OK' && code !== 'INFO-000' && !Array.isArray(list)) {
    throw new VWorldError(code, String(body.resultMsg ?? '오류'))
  }
  if (Array.isArray(list)) return list as Record<string, unknown>[]
  if (list && typeof list === 'object') return [list as Record<string, unknown>]
  return []
}

/** 필지 하나에 대해 NED API를 부르고, 결과가 없으면 옛 PNU로 다시 부른다. */
export async function nedForParcel(
  config: VWorldConfig,
  path: string,
  pnu: string,
  addr: string,
  extra: Record<string, string> = {},
): Promise<NedResult> {
  const params = { numOfRows: '100', pageNo: '1', ...extra }
  for (const candidate of [pnu, ...alternatePnus(pnu, addr)]) {
    const items = await nedOnce(config, path, { ...params, pnu: candidate })
    if (items.length > 0) {
      return {
        items: items.map(stripOwnership),
        usedPnu: candidate,
        url: publicUrl(path, { ...params, pnu: candidate, format: 'json' }),
      }
    }
  }
  return { items: [], usedPnu: pnu, url: publicUrl(path, { ...params, pnu, format: 'json' }) }
}

export interface LandDataset {
  id: string
  label: string
  path: string
  extra?: Record<string, string>
  limitations: string
}

export const LAND_DATASETS: LandDataset[] = [
  {
    id: 'ned:ladfrl',
    label: '토지임야목록 (공부상 면적·지목)',
    path: '/ned/data/ladfrlList',
    limitations: '토지(임야)대장 기준. 소유 관련 항목은 이 프로그램에서 다루지 않음.',
  },
  {
    id: 'ned:landUse',
    label: '토지이용계획 (지역·지구 등)',
    path: '/ned/data/getLandUseAttr',
    limitations: '토지이용계획확인원의 지역·지구 목록. 법적 판단은 토지이음·관할 기관에서 확인해야 함.',
  },
  {
    id: 'ned:landChar',
    label: '토지특성 (지형·형상·도로접면·이용상황)',
    path: '/ned/data/getLandCharacteristics',
    limitations: '개별공시지가 산정용 토지특성 조사 자료로, 조사 연도마다 값이 다를 수 있음.',
  },
  {
    id: 'ned:price',
    label: '개별공시지가 이력',
    path: '/ned/data/getIndvdLandPriceAttr',
    limitations: '공시지가는 과세·보상 기준가로 실제 거래가와 다름.',
  },
  {
    id: 'ned:landMove',
    label: '토지이동 이력 (분할·합병·지목변경)',
    path: '/ned/data/getLandMoveAttr',
    limitations: '토지대장에 기록된 이동 사유와 날짜. 오래된 기록은 누락되었을 수 있음.',
  },
]
