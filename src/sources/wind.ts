// 공공데이터포털 — 기상청_지상(종관, ASOS) 시간자료 조회서비스 → 바람장미.
// 관측소 하나의 최근 3년 시간자료(약 2만 6천 시간)를 달 단위로 받아, 저장은 집계표(계절 × 16방위 × 풍속 구간)만 한다.
// 풍향 wd는 16방위 각도(0·20·50·70·90 …, 360 = 북), 풍속 ws는 m/s. 0.5m/s 미만은 '바람 거의 없음(정온)'.

import { dataGoKrGet, standardItems } from './dataGoKr'
import type { ApiKeys } from './keys'
import { nearestStations, type Station } from './climate'

const BASE = 'https://apis.data.go.kr/1360000/AsosHourlyInfoService/getWthrDataList'
export const WIND_SERVICE = '기상청_지상(종관, ASOS) 시간자료 조회서비스'
export const WIND_PUBLIC_URL = BASE

export const DIR16 = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서']
/** 풍속 구간 경계(m/s): 0.5–2, 2–4, 4–6, 6 이상 */
export const WIND_BINS = [0.5, 2, 4, 6]
export const CALM_MS = 0.5
export const SEASONS = ['연중', '봄', '여름', '가을', '겨울'] as const
export type SeasonName = (typeof SEASONS)[number]

export interface RoseTable {
  /** 전체 유효 시간 수 */
  hours: number
  /** 정온(0.5m/s 미만) 시간 수 */
  calm: number
  /** [16방위][풍속 구간 4] 시간 수 */
  counts: number[][]
  /** 평균 풍속 (m/s, 정온 포함) */
  meanSpeed: number
}

/** 여름 오후(7~8월 14~16시) 조건 — 열쾌적 실험용 */
export interface HotAfternoon {
  /** 더운 쪽 10% 날 평균 */
  ta: number
  rh: number
  ws: number
  days: number
  /** 모든 날 평균 */
  all: { ta: number; rh: number; ws: number; days: number }
}

export interface WindResult {
  station: Station
  distanceKm: number
  years: number[]
  /** SEASONS 순서 */
  tables: RoseTable[]
  /** 받은 달 수 / 자료가 있었던 달 수 */
  months: number
  note: string | null
  /** 여름 오후 조건 (Phase 10, 이전 수집에는 없음) */
  hot?: HotAfternoon | null
}

interface HotRow {
  day: string
  ta: number
  rh: number
  ws: number
}

function emptyTable(): RoseTable {
  return { hours: 0, calm: 0, counts: Array.from({ length: 16 }, () => [0, 0, 0, 0]), meanSpeed: 0 }
}

function seasonOf(month: number): number {
  if (month >= 3 && month <= 5) return 1
  if (month >= 6 && month <= 8) return 2
  if (month >= 9 && month <= 11) return 3
  return 4
}

const pad = (n: number) => String(n).padStart(2, '0')

async function monthRows(keys: ApiKeys, stnId: string, year: number, month: number): Promise<{ rows: { m: number; ws: number; wd: number }[]; hot: HotRow[] }> {
  const last = new Date(year, month, 0).getDate()
  const data = await dataGoKrGet(
    keys,
    BASE,
    {
      pageNo: '1',
      numOfRows: '800',
      dataType: 'JSON',
      dataCd: 'ASOS',
      dateCd: 'HR',
      startDt: `${year}${pad(month)}01`,
      startHh: '00',
      endDt: `${year}${pad(month)}${pad(last)}`,
      endHh: '23',
      stnIds: stnId,
    },
    WIND_SERVICE,
  )
  const out: { m: number; ws: number; wd: number }[] = []
  const hot: HotRow[] = []
  for (const it of standardItems(data).items) {
    const ws = Number(String(it.ws ?? '').trim())
    const wdRaw = String(it.wd ?? '').trim()
    if (!Number.isFinite(ws) || wdRaw === '') continue
    out.push({ m: month, ws, wd: Number(wdRaw) })
    if (month === 7 || month === 8) {
      const tm = String(it.tm ?? '')
      const h = Number(tm.slice(11, 13))
      const ta = Number(String(it.ta ?? '').trim())
      const rh = Number(String(it.hm ?? '').trim())
      if (h >= 14 && h <= 16 && Number.isFinite(ta) && Number.isFinite(rh) && String(it.ta ?? '').trim() !== '' && String(it.hm ?? '').trim() !== '')
        hot.push({ day: tm.slice(0, 10), ta, rh, ws })
    }
  }
  return { rows: out, hot }
}

/** 날마다 14~16시 평균 → 더운 쪽 10% 날과 전체 평균 */
export function hotAfternoon(rows: HotRow[]): HotAfternoon | null {
  const byDay = new Map<string, HotRow[]>()
  for (const r of rows) {
    const l = byDay.get(r.day)
    if (l) l.push(r)
    else byDay.set(r.day, [r])
  }
  const days = [...byDay.values()].map((l) => ({
    ta: l.reduce((a, b) => a + b.ta, 0) / l.length,
    rh: l.reduce((a, b) => a + b.rh, 0) / l.length,
    ws: l.reduce((a, b) => a + b.ws, 0) / l.length,
  }))
  if (days.length < 20) return null
  const mean = (l: typeof days) => ({
    ta: l.reduce((a, b) => a + b.ta, 0) / l.length,
    rh: l.reduce((a, b) => a + b.rh, 0) / l.length,
    ws: l.reduce((a, b) => a + b.ws, 0) / l.length,
    days: l.length,
  })
  const sorted = [...days].sort((a, b) => b.ta - a.ta)
  const top = sorted.slice(0, Math.max(3, Math.round(days.length * 0.1)))
  return { ...mean(top), all: mean(days) }
}

/** 동시에 n개씩 */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

export function buildTables(rows: { m: number; ws: number; wd: number }[]): RoseTable[] {
  const tables = SEASONS.map(emptyTable)
  const sums = SEASONS.map(() => 0)
  for (const r of rows) {
    for (const s of [0, seasonOf(r.m)]) {
      const t = tables[s]
      t.hours++
      sums[s] += r.ws
      // 풍향 0은 정온으로 기록됨
      if (r.ws < CALM_MS || !(r.wd > 0)) {
        t.calm++
        continue
      }
      const dir = Math.round(r.wd / 22.5) % 16
      const bin = WIND_BINS.filter((b) => r.ws >= b).length - 1
      t.counts[dir][Math.max(0, bin)]++
    }
  }
  tables.forEach((t, i) => (t.meanSpeed = t.hours ? sums[i] / t.hours : 0))
  return tables
}

/** 기후 일자료와 같은 관측소(가까운 순 최대 3곳)에서 최근 3년 시간자료 */
export async function windNear(keys: ApiKeys, lon: number, lat: number, now = new Date()): Promise<WindResult> {
  const last = now.getFullYear() - 1
  const years = [last - 2, last - 1, last]
  const months = years.flatMap((y) => Array.from({ length: 12 }, (_, i) => [y, i + 1] as const))
  const candidates = nearestStations(lon, lat).slice(0, 3)
  for (const [i, c] of candidates.entries()) {
    try {
      const parts = await pool(months, 3, ([y, m]) => monthRows(keys, c.station.id, y, m))
      const rows = parts.flatMap((p) => p.rows)
      const filled = parts.filter((p) => p.rows.length > 0).length
      if (rows.length < 24 * 300) continue
      return {
        station: c.station,
        distanceKm: c.km,
        years,
        tables: buildTables(rows),
        months: filled,
        hot: hotAfternoon(parts.flatMap((p) => p.hot)),
        note: i > 0 ? `가장 가까운 ${candidates[0].station.name} 관측소 시간자료가 부족해 ${c.station.name} 관측소를 썼다.` : null,
      }
    } catch (e) {
      if (i === 0) throw e
    }
  }
  throw new Error('가까운 관측소 3곳 모두 최근 3년 시간자료가 부족합니다.')
}

/** 가장 잦은 방위와 비율 */
export function prevailing(t: RoseTable): { dir: number; share: number; second: number; secondShare: number } {
  const totals = t.counts.map((c) => c.reduce((a, b) => a + b, 0))
  const order = totals.map((n, i) => [n, i] as const).sort((a, b) => b[0] - a[0])
  return {
    dir: order[0][1],
    share: t.hours ? order[0][0] / t.hours : 0,
    second: order[1][1],
    secondShare: t.hours ? order[1][0] / t.hours : 0,
  }
}

export async function windProbe(keys: ApiKeys): Promise<number> {
  const d = new Date()
  d.setDate(d.getDate() - 2)
  const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const data = await dataGoKrGet(
    keys,
    BASE,
    { pageNo: '1', numOfRows: '3', dataType: 'JSON', dataCd: 'ASOS', dateCd: 'HR', startDt: day, startHh: '00', endDt: day, endHh: '02', stnIds: '156' },
    WIND_SERVICE,
  )
  return standardItems(data).items.length
}
