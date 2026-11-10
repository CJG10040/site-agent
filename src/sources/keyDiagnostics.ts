// 브이월드 외 키(SGIS·공공데이터포털 서비스별·카카오·국가교통정보센터)가 실제로 응답하는지 확인한다.
// 공공데이터포털은 키가 하나여도 서비스마다 활용신청 승인이 따로 필요하므로 서비스별로 본다.

import { registerForParcel } from './buildingRegister'
import { dataGoKrGet, standardItems } from './dataGoKr'
import { CLIMATE_SERVICE } from './climate'
import { itsProbe } from './its'
import { kakaoProbe } from './kakao'
import type { ApiKeys } from './keys'
import { regionAt } from './sgis'
import { STORES_SERVICE } from './stores'
import { TRANSIT_SERVICE } from './transit'
import type { CheckResult } from './vworld'
import { windProbe } from './wind'

/** 광주광역시청 일대 */
const PROBE = { lon: 126.8526, lat: 35.16 }

async function timed(id: string, label: string, run: () => Promise<string>, hint = ''): Promise<CheckResult> {
  const t0 = performance.now()
  try {
    const summary = await run()
    return { id, label, ok: true, summary, hint: '', ms: Math.round(performance.now() - t0) }
  } catch (e) {
    return { id, label, ok: false, summary: e instanceof Error ? e.message : String(e), hint, ms: Math.round(performance.now() - t0) }
  }
}

function skipped(id: string, label: string, what: string): CheckResult {
  return { id, label, ok: false, summary: `${what}가 입력되지 않아 건너뜀`, hint: '설정에서 키를 입력하세요.', ms: 0 }
}

function lastMonthDay(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}15`
}

export async function runKeyDiagnostics(keys: ApiKeys): Promise<CheckResult[]> {
  const hasData = !!keys.dataGoKr.trim()
  const approvalHint = '공공데이터포털 › 마이페이지 › 개발계정에서 이 서비스가 승인됐는지 확인하세요. 승인 직후에는 1~2시간 걸릴 수 있습니다.'
  const jobs: Promise<CheckResult>[] = [
    keys.sgisKey.trim() && keys.sgisSecret.trim()
      ? timed('sgis', 'SGIS (인구·가구·사업체)', async () => {
          const r = await regionAt(keys, PROBE.lon, PROBE.lat)
          return `응답 정상 · ${r.name}`
        }, 'SGIS 서비스ID·보안키가 맞는지 확인하세요.')
      : Promise.resolve(skipped('sgis', 'SGIS (인구·가구·사업체)', 'SGIS 키')),
  ]
  if (hasData) {
    jobs.push(
      timed('hub', '공공데이터포털 · 건축물대장', async () => {
        const r = await registerForParcel(keys, '1221010100100010000', '', 'site')
        if (r.error) throw new Error(r.error)
        return '응답 정상'
      }, approvalHint),
      timed('tago', `공공데이터포털 · 버스정류소`, async () => {
        const data = await dataGoKrGet(
          keys,
          'https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList',
          { gpsLati: String(PROBE.lat), gpsLong: String(PROBE.lon), numOfRows: '5', pageNo: '1', _type: 'json' },
          TRANSIT_SERVICE,
        )
        return `응답 정상 · 정류소 ${standardItems(data).items.length}곳`
      }, approvalHint),
      timed('asos', `공공데이터포털 · 기상 관측(ASOS)`, async () => {
        const day = lastMonthDay()
        const data = await dataGoKrGet(
          keys,
          'https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList',
          { pageNo: '1', numOfRows: '1', dataType: 'JSON', dataCd: 'ASOS', dateCd: 'DAY', startDt: day, endDt: day, stnIds: '156' },
          CLIMATE_SERVICE,
        )
        return `응답 정상 · ${standardItems(data).items.length}건`
      }, approvalHint),
      timed('asosHr', `공공데이터포털 · 기상 관측 시간자료(바람장미)`, async () => `응답 정상 · ${await windProbe(keys)}시간`, approvalHint),
      timed('sbiz', `공공데이터포털 · 상가(상권)정보`, async () => {
        const data = (await dataGoKrGet(
          keys,
          'https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius',
          { pageNo: '1', numOfRows: '1', radius: '200', cx: String(PROBE.lon), cy: String(PROBE.lat), type: 'json' },
          STORES_SERVICE,
        )) as { header?: { resultCode?: string; resultMsg?: string }; body?: { totalCount?: number } }
        const code = data.header?.resultCode
        if (code && code !== '00' && code !== '03') throw new Error(data.header?.resultMsg ?? code)
        return `응답 정상 · 반경 200m 상가 ${data.body?.totalCount ?? 0}곳`
      }, approvalHint),
    )
  } else {
    jobs.push(Promise.resolve(skipped('datagokr', '공공데이터포털 (건축물대장·버스·기상·상가)', '공공데이터포털 키')))
  }
  jobs.push(
    keys.kakaoRest.trim()
      ? timed('kakao', '카카오 (주변 생활 시설)', async () => `응답 정상 · 반경 500m 편의점 ${await kakaoProbe(keys, PROBE.lon, PROBE.lat)}곳`, "카카오 디벨로퍼스에서 REST API 키와 '카카오맵' 사용 설정을 확인하세요.")
      : Promise.resolve(skipped('kakao', '카카오 (주변 생활 시설)', '카카오 REST 키')),
    keys.itsKey.trim()
      ? timed(
          'its',
          '국가교통정보센터 (실시간 도로 속도)',
          async () => `응답 정상 · 광주시청 주변 ${await itsProbe(keys, PROBE.lon, PROBE.lat)}개 도로 구간`,
          "its.go.kr › 오픈데이터 › 교통소통정보에서 받은 인증키인지 확인하세요.",
        )
      : Promise.resolve(skipped('its', '국가교통정보센터 (실시간 도로 속도)', '국가교통정보센터 키')),
  )
  return Promise.all(jobs)
}
