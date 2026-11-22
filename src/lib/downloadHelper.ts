// 자료 받기 도우미 (2026-11-22 묶음 H3, 사용자: '하나하나 다운로드가 귀찮으면 안 쓰게 됨 — 다운로드와 정리도 자동화').
// 로그인이 필요한 사이트라 앱이 직접 받지는 못함 → 대지에 필요한 파일을 계산해 바로 가는 링크를 준다(받기·정리는 학생이 직접 — 2026-11-22 사용자 결정).
// 확인(2026-11-22): 브이월드 '수치지형도v2.0(1:5000) 시군구 묶음' dsId=30205 — 파일 이름 2MAP5000_SHP_<시도>_<시군구>.zip
// (2026-03-04판, 전국 254개, 39~245MB), 목록은 로그인 없이 searchKeyword2로 거를 수 있음, 받기는 로그인 필요.

import { sheets1000Around, sheetsAround } from './mapSheet'

const SIDO: [RegExp, string][] = [
  [/^서울/, '서울'],
  [/^부산/, '부산'],
  [/^대구/, '대구'],
  [/^인천/, '인천'],
  [/^광주광역시/, '광주'],
  [/^대전/, '대전'],
  [/^울산/, '울산'],
  [/^세종/, '세종'],
  [/^경기/, '경기'],
  [/^강원/, '강원'],
  [/^충청북도|^충북/, '충북'],
  [/^충청남도|^충남/, '충남'],
  [/^전라북도|^전북/, '전북'],
  [/^전라남도|^전남(?!광주)/, '전남'],
  [/^경상북도|^경북/, '경북'],
  [/^경상남도|^경남/, '경남'],
  [/^제주/, '제주'],
]
/** 광주의 자치구 (2026 '전남광주통합특별시' 주소에서 광주·전남을 가르는 데 씀) */
const GWANGJU_GU = new Set(['동구', '서구', '남구', '북구', '광산구'])

/** 주소 → 시군구 묶음 파일 이름 (모르면 null) */
export function bundleNameOf(address: string): { sido: string; sgg: string; file: string } | null {
  const parts = address.trim().split(/\s+/)
  if (parts.length < 2) return null
  let sido = SIDO.find(([re]) => re.test(parts[0]))?.[1] ?? null
  const rest = parts.slice(1)
  if (/^전남광주/.test(parts[0])) sido = GWANGJU_GU.has(parts[1]) ? '광주' : '전남'
  if (!sido) return null
  // 시 아래 구가 있는 곳(청주시 상당구 등)은 '시_구'
  const sgg = rest[0] && /시$/.test(rest[0]) && rest[1] && /구$/.test(rest[1]) ? `${rest[0]}_${rest[1]}` : rest[0]
  if (!sgg || !/(시|군|구)$/.test(sgg.split('_').pop()!)) return null
  return { sido, sgg, file: `2MAP5000_SHP_${sido}_${sgg}.zip` }
}

export const VWORLD_BUNDLE_LIST = (keyword: string) =>
  `https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?svcCde=MK&dsId=30205&pageIndex=1&pageUnit=100&searchKeyword2=${encodeURIComponent(keyword)}`
export const NGII_PLATFORM = 'https://map.ngii.go.kr/ms/map/NlipMap.do'

export interface DownloadNeeds {
  bundle: { sido: string; sgg: string; file: string } | null
  sheets5: string[]
  sheets1: string[]
}

export function downloadNeeds(address: string, center: [number, number], radiusM: number): DownloadNeeds {
  return { bundle: bundleNameOf(address), sheets5: sheetsAround(center[0], center[1], radiusM), sheets1: sheets1000Around(center[0], center[1], radiusM) }
}
