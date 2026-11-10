// 공공데이터포털 — 기상청_지상(종관, ASOS) 일자료 조회서비스.
// 대지에서 가장 가까운 ASOS 관측소의 최근 3년 일자료를 받아 요약한다.
// 2026-11-10 실제 키로 확인: maxWd(최다풍향)·sumSsHr·ddMefs 등 필드 이름 일치.
// 관측소 위치는 기상청 지점 목록의 대략값(소수 셋째 자리)이며, 가까운 관측소를 고르는 데만 쓴다.

import { distanceM } from '../lib/geo'
import { dataGoKrGet, standardItems } from './dataGoKr'
import type { ApiKeys } from './keys'

const BASE = 'https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList'
export const CLIMATE_SERVICE = '기상청_지상(종관, ASOS) 일자료 조회서비스'
export const CLIMATE_PUBLIC_URL = BASE

export interface Station {
  id: string
  name: string
  lon: number
  lat: number
}

/** 광주·전남·전북 일대 ASOS 관측소 (우선 지원 지역) */
export const STATIONS: Station[] = [
  { id: '156', name: '광주', lat: 35.173, lon: 126.892 },
  { id: '165', name: '목포', lat: 34.817, lon: 126.381 },
  { id: '168', name: '여수', lat: 34.739, lon: 127.741 },
  { id: '169', name: '흑산도', lat: 34.687, lon: 125.451 },
  { id: '170', name: '완도', lat: 34.396, lon: 126.702 },
  { id: '174', name: '순천', lat: 35.02, lon: 127.369 },
  { id: '175', name: '진도(첨찰산)', lat: 34.471, lon: 126.324 },
  { id: '252', name: '영광군', lat: 35.283, lon: 126.478 },
  { id: '258', name: '보성군', lat: 34.763, lon: 127.212 },
  { id: '259', name: '강진군', lat: 34.627, lon: 126.764 },
  { id: '260', name: '장흥', lat: 34.689, lon: 126.92 },
  { id: '261', name: '해남', lat: 34.553, lon: 126.569 },
  { id: '262', name: '고흥', lat: 34.618, lon: 127.276 },
  { id: '266', name: '광양시', lat: 34.943, lon: 127.691 },
  { id: '268', name: '진도군', lat: 34.473, lon: 126.259 },
  { id: '140', name: '군산', lat: 36.005, lon: 126.761 },
  { id: '146', name: '전주', lat: 35.841, lon: 127.117 },
  { id: '172', name: '고창', lat: 35.348, lon: 126.599 },
  { id: '243', name: '부안', lat: 35.73, lon: 126.717 },
  { id: '244', name: '임실', lat: 35.612, lon: 127.286 },
  { id: '245', name: '정읍', lat: 35.563, lon: 126.866 },
  { id: '247', name: '남원', lat: 35.421, lon: 127.397 },
  { id: '248', name: '장수', lat: 35.657, lon: 127.52 },
  { id: '251', name: '고창군', lat: 35.427, lon: 126.697 },
  { id: '254', name: '순창군', lat: 35.371, lon: 127.129 },
]

/** 요약에 쓰는 일자료 항목만 남긴다 */
const KEEP = ['tm', 'avgTa', 'minTa', 'maxTa', 'sumRn', 'avgWs', 'maxWs', 'maxWsWd', 'maxWd', 'avgRhm', 'sumSsHr', 'ddMefs', 'ddMes'] as const
export type DailyRow = Partial<Record<(typeof KEEP)[number], string>>

export interface ClimateResult {
  station: Station
  distanceKm: number
  years: number[]
  rows: DailyRow[]
  /** 가까운 관측소에 자료가 없어 다음 관측소를 쓴 경우의 안내 */
  note: string | null
}

export function nearestStations(lon: number, lat: number): { station: Station; km: number }[] {
  return STATIONS.map((st) => ({ station: st, km: distanceM([lon, lat], [st.lon, st.lat]) / 1000 })).sort((a, b) => a.km - b.km)
}

async function yearRows(keys: ApiKeys, stnId: string, year: number): Promise<DailyRow[]> {
  const data = await dataGoKrGet(
    keys,
    BASE,
    {
      pageNo: '1',
      numOfRows: '366',
      dataType: 'JSON',
      dataCd: 'ASOS',
      dateCd: 'DAY',
      startDt: `${year}0101`,
      endDt: `${year}1231`,
      stnIds: stnId,
    },
    CLIMATE_SERVICE,
  )
  return standardItems(data).items.map((it) => {
    const row: DailyRow = {}
    for (const k of KEEP) if (it[k] !== undefined && it[k] !== null) row[k] = String(it[k]).trim()
    return row
  })
}

/** 가장 가까운 관측소부터 최대 3곳까지 자료가 있는 곳을 찾는다 */
export async function climateNear(keys: ApiKeys, lon: number, lat: number, now = new Date()): Promise<ClimateResult> {
  const last = now.getFullYear() - 1
  const years = [last - 2, last - 1, last]
  const candidates = nearestStations(lon, lat).slice(0, 3)
  let firstError: unknown = null
  for (const [i, c] of candidates.entries()) {
    try {
      const parts = await Promise.all(years.map((y) => yearRows(keys, c.station.id, y)))
      const rows = parts.flat()
      if (rows.length < 300) continue
      return {
        station: c.station,
        distanceKm: c.km,
        years,
        rows,
        note: i > 0 ? `가장 가까운 ${candidates[0].station.name} 관측소 자료가 부족해 ${c.station.name} 관측소를 썼다.` : null,
      }
    } catch (e) {
      // 인증 오류처럼 관측소와 무관한 오류는 바로 알린다
      firstError ??= e
      if (i === 0) throw e
    }
  }
  if (firstError) throw firstError
  throw new Error('가까운 관측소 3곳 모두 최근 3년 자료가 부족합니다.')
}
