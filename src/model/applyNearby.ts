// Phase 6 확장 수집 → 출처 기록 + 사실·미확인 카드 초안
//  - 브이월드: 재해·하천, 공공·문화·복지·교육(통학구역 포함), 상권·전통시장
//  - 공공데이터포털: 버스정류소(TAGO), 기후(기상청 ASOS), 상가업소(소상공인시장진흥공단)
//  - 카카오 로컬: 주변 생활 시설
// 원칙: 자료에 있는 것만 문장으로 쓰고, 계산한 값은 기준(대지 중심·직선거리 등)을 밝힌다.

import { centerOf, geometryToAreaDistanceM, pointToAreaDistanceM } from '../lib/geo'
import { rangeText } from '../lib/terrainSite'
import { CLIMATE_PUBLIC_URL, CLIMATE_SERVICE, type ClimateResult, type DailyRow } from '../sources/climate'
import type { ApiOutcome, LandAreaOutcome, LayerOutcome, TerrainSummary } from '../sources/collect'
import { KAKAO_PUBLIC_URL, KAKAO_SOURCE, POI_CATEGORIES, type PoiCategoryResult } from '../sources/kakao'
import { STORES_PUBLIC_URL, STORES_SERVICE, type StoresResult } from '../sources/stores'
import { TRANSIT_PUBLIC_URL, TRANSIT_SERVICE, type TransitResult } from '../sources/transit'
import type { FactContext } from './applyCollection'
import { mclsLabel, storeTime } from './storeClass'
import { cleanNames, countBy, fmt, josa, listText, pct, str } from './textUtil'
import type { Card, SourceRecord } from './types'

const DATA_GO_KR_LICENSE = '공공데이터포털 이용허락범위에 따름 (출처 표기 필요)'
const KAKAO_LICENSE = '카카오 API 이용약관에 따름 (출처 표기 필요, 상업적 재배포 불가)'

/** 거리를 "약 120m" / "약 1.2km"로 */
export function distText(m: number): string {
  if (m <= 0) return '대지 안'
  if (m < 1000) return `약 ${fmt(Math.max(10, Math.round(m / 10) * 10))}m`
  return `약 ${fmt(m / 1000, 1)}km`
}

export type SourceDraft = Omit<SourceRecord, 'source_id'>

export function apiSource(base: Partial<SourceDraft> & Pick<SourceDraft, 'source_name' | 'dataset_name' | 'dataset_id' | 'retrieved_at'>): SourceDraft {
  return {
    update_date: null,
    geometry: '대지 중심점',
    coordinate_system: 'EPSG:4326 (WGS84 경위도)',
    spatial_scale: '지점',
    time_range: null,
    raw_ref: null,
    normalized_value: null,
    unit: null,
    license: DATA_GO_KR_LICENSE,
    limitations: '',
    original_url: '',
    reliability: 'official',
    feature_count: null,
    status: 'ok',
    error: null,
    ...base,
  }
}

// ───────────────────────── 브이월드 레이어 ─────────────────────────

interface Named {
  name: string
  type: string
  details: string
  distance: number | null
}

/** 같은 이름(여러 조각)은 하나로 묶고 가장 가까운 거리를 쓴다 */
function namedFeatures(o: LayerOutcome, ctx: FactContext): Named[] {
  const byKey = new Map<string, Named>()
  for (const f of o.features) {
    const p = f.properties
    // 주요상권처럼 한 구역을 '이름_1', '이름_2'로 나눈 경우 하나로 묶는다
    const name = (str(p[o.layer.nameField]) || o.layer.label).replace(/_\d+$/, '')
    const rawType = o.layer.typeField ? str(p[o.layer.typeField]) : ''
    const type = /^(미분류|기타|-)$/.test(rawType) ? '' : rawType
    const details = (o.layer.detailFields ?? [])
      .map((d) => {
        const v = str(p[d.field])
        return v && v !== '0' ? `${d.label} ${v}${d.unit ?? ''}` : ''
      })
      .filter(Boolean)
      .join(', ')
    const distance = o.layer.geometry ? geometryToAreaDistanceM(f.geometry, ctx.boundary) : null
    const key = `${name.replace(/\s+/g, '')}|${type}`
    const prev = byKey.get(key)
    if (!prev) byKey.set(key, { name, type, details, distance })
    else if (distance !== null && (prev.distance === null || distance < prev.distance)) prev.distance = distance
  }
  return [...byKey.values()]
    .filter((x) => cleanNames([x.name]).length > 0)
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
}

function describe(x: Named, withType = true): string {
  const inside = [withType && x.type && x.type !== x.name ? x.type : '', x.details, x.distance !== null ? distText(x.distance) : '']
    .filter(Boolean)
    .join(', ')
  return inside ? `${x.name}(${inside})` : x.name
}

const TOPIC: Record<string, string> = {
  hazard: '재해·하천',
  river: '재해·하천',
  civic: '공공시설',
  school: '교육',
  commerce: '상권',
}

export function addNearbyLayerFacts(ctx: FactContext, layers: LayerOutcome[], layerSource: Record<string, string>): void {
  const { push, radiusM } = ctx
  const nearbyKinds = new Set(['hazard', 'river', 'civic', 'school', 'commerce'])
  const targets = layers.filter((o) => nearbyKinds.has(o.layer.kind))

  for (const o of targets.filter((x) => x.state === 'ok')) {
    const src = [layerSource[o.layer.id]]
    const topic = TOPIC[o.layer.kind]
    const items = namedFeatures(o, ctx)
    if (items.length === 0) continue

    if (o.layer.kind === 'school') {
      push({
        auto_key: `nearby:${o.layer.id}`,
        topic,
        text: `대지 중심은 ${o.layer.label} '${cleanNames(items.map((x) => x.name)).join("', '")}'에 속한다.`,
        sources: src,
      })
      continue
    }

    const inside = items.filter((x) => x.distance === 0 && o.layer.geometry && o.features.some((f) => f.geometry?.type.includes('Polygon')))
    const outside = items.filter((x) => !inside.includes(x))

    if (o.layer.kind === 'river') {
      const nearest = items[0]
      push({
        auto_key: `nearby:${o.layer.id}`,
        topic,
        text:
          nearest.distance === 0
            ? `대지가 하천 구역(${describe(nearest)})과 겹친다. 하천구역·홍수 관련 제한을 확인해야 한다.`
            : `대지에서 가장 가까운 하천은 ${describe(nearest)}이다 (대지 경계에서 하천 구역 경계까지 직선거리)${
                items.length > 1 ? `. 반경 ${radiusM}m 안의 다른 하천: ${listText(items.slice(1).map((x) => describe(x)), 4)}` : ''
              }.`,
        sources: src,
        confidence: 'medium',
        human_validation_required: nearest.distance === 0,
      })
      continue
    }

    if (inside.length > 0) {
      const hazard = o.layer.kind === 'hazard'
      push({
        auto_key: `nearby-in:${o.layer.id}`,
        topic,
        text: hazard
          ? `대지가 ${o.layer.label}(${cleanNames(inside.map((x) => (x.type ? `${x.name}·${x.type}` : x.name))).join(', ')})에 걸쳐 있다. 건축 제한과 대책을 확인해야 한다.`
          : `대지는 ${o.layer.label} '${cleanNames(inside.map((x) => x.name)).join("', '")}' 안에 있다.`,
        sources: src,
        human_validation_required: hazard,
      })
    }
    if (outside.length > 0) {
      push({
        auto_key: `nearby:${o.layer.id}`,
        topic,
        text: `반경 ${radiusM}m 안의 ${o.layer.label} ${outside.length}곳: ${listText(outside.map((x) => describe(x)), 6)} (대지 경계에서 직선거리).`,
        sources: src,
        confidence: o.layer.id.startsWith('LT_P_') ? 'medium' : 'high',
      })
    }
  }

  // 재해 관련 레이어가 모두 '해당 없음'이면 그것도 사실로 남긴다
  const hazardZones = targets.filter((o) => o.layer.kind === 'hazard' && o.layer.id !== 'LT_C_UPISUQ156')
  if (hazardZones.length > 0 && hazardZones.every((o) => o.state === 'empty')) {
    push({
      auto_key: 'nearby:hazard-none',
      topic: '재해·하천',
      text: `반경 ${radiusM}m 안에서 ${hazardZones.map((o) => o.layer.label).join('·')}이 조회되지 않았다 (브이월드 기준). 침수 이력은 이 자료로 알 수 없다.`,
      sources: hazardZones.map((o) => layerSource[o.layer.id]),
      confidence: 'medium',
    })
  }
  const river = targets.find((o) => o.layer.kind === 'river')
  if (river?.state === 'empty') {
    push({
      auto_key: `nearby:${river.layer.id}`,
      topic: '재해·하천',
      text: `반경 ${radiusM}m 안에 하천망 자료상 하천이 없다 (작은 도랑·복개천은 자료에 없을 수 있음).`,
      sources: [layerSource[river.layer.id]],
      confidence: 'medium',
    })
  }
}

// ───────────────────────── 버스정류소 ─────────────────────────

export function addTransitFacts(ctx: FactContext, o: ApiOutcome<TransitResult>): void {
  const { project, push } = ctx
  const r = o.result
  const src = ctx.newSource(
    apiSource({
      source_name: `공공데이터포털 — ${TRANSIT_SERVICE}`,
      dataset_name: '좌표 기반 근접 정류소 + 정류소별 경유 노선',
      dataset_id: 'tago:BusSttnInfoInqireService',
      retrieved_at: o.retrievedAt,
      spatial_scale: '대지 중심 주변 약 500m',
      raw_ref: r?.stops.length ? 'tago:stops' : null,
      limitations:
        '대지 중심 좌표 주변(약 500m)의 정류소만 제공됨. 거리는 대지 중심에서의 직선거리이며 실제 걷는 거리는 더 길다. 노선은 가까운 정류소 10곳까지만 조회.',
      original_url: TRANSIT_PUBLIC_URL,
      feature_count: r ? r.stops.length : null,
      status: o.error ? 'error' : r?.stops.length ? 'ok' : 'empty',
      error: o.error,
    }),
  )
  if (!r) {
    push({
      auto_key: 'transit-error',
      type: 'UNKNOWN',
      topic: '대중교통',
      text: `버스정류소 정보를 가져오지 못했다 (${o.error}). 지도 앱이나 현장에서 확인해야 한다.`,
      sources: [src],
      confidence: 'low',
      human_validation_required: true,
    })
    return
  }
  project.collected['tago:stops'] = {
    dataset_id: 'tago:stops',
    retrieved_at: o.retrievedAt,
    features: r.stops.map((s) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
      properties: {
        nodenm: s.nodenm,
        nodeno: s.nodeno,
        nodeid: s.nodeid,
        distance: Math.round(s.distance),
        routes: s.routes ? s.routes.map((x) => x.routeno).join(', ') : null,
      },
    })),
  }
  if (r.stops.length === 0) {
    push({
      auto_key: 'transit-stops',
      topic: '대중교통',
      text: '대지 중심 주변(약 500m)에서 버스정류소가 조회되지 않았다.',
      sources: [src],
      confidence: 'medium',
    })
    return
  }
  const nearest = r.stops[0]
  const within200 = r.stops.filter((s) => s.distance <= 200).length
  push({
    auto_key: 'transit-stops',
    topic: '대중교통',
    text: `대지 중심 주변에서 조회된 버스정류소는 ${r.stops.length}곳이며, 가장 가까운 곳은 '${nearest.nodenm}'(${distText(nearest.distance)})이다. 200m 안에는 ${within200}곳이 있다 (대지 중심에서 직선거리).`,
    sources: [src],
  })
  const checked = r.stops.filter((s) => s.routes)
  const routes = new Map<string, { no: string; tp: string }>()
  for (const s of checked) for (const rt of s.routes ?? []) routes.set(rt.routeid || rt.routeno, { no: rt.routeno, tp: rt.routetp })
  if (checked.length > 0) {
    const types = countBy([...routes.values()].map((x) => x.tp || '구분 없음'))
    const nos = cleanNames([...routes.values()].map((x) => x.no)).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }))
    push({
      auto_key: 'transit-routes',
      topic: '대중교통',
      text:
        routes.size > 0
          ? `가까운 정류소 ${checked.length}곳을 지나는 버스 노선은 모두 ${routes.size}개다 (${types.map(([t, n]) => `${t} ${n}`).join(', ')}). 노선 번호: ${listText(nos, 12, '개')}.`
          : `가까운 정류소 ${checked.length}곳을 지나는 버스 노선 정보가 비어 있다.`,
      sources: [src],
    })
  }
  const failed = r.stops.filter((s) => s.routeError)
  if (failed.length > 0 && checked.length === 0) {
    push({
      auto_key: 'transit-routes-error',
      type: 'UNKNOWN',
      topic: '대중교통',
      text: `정류소를 지나는 노선을 가져오지 못했다 (${failed[0].routeError}).`,
      sources: [src],
      confidence: 'low',
      human_validation_required: true,
    })
  }
}

// ───────────────────────── 기후 ─────────────────────────

const DIRS = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서']

function dirName(deg: number): string {
  return DIRS[Math.round(deg / 22.5) % 16]
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

const SEASONS: { name: string; months: number[] }[] = [
  { name: '봄', months: [3, 4, 5] },
  { name: '여름', months: [6, 7, 8] },
  { name: '가을', months: [9, 10, 11] },
  { name: '겨울', months: [12, 1, 2] },
]

function monthOf(r: DailyRow): number {
  return Number(str(r.tm).slice(5, 7))
}

function yearOf(r: DailyRow): number {
  return Number(str(r.tm).slice(0, 4))
}

export function addClimateFacts(ctx: FactContext, o: ApiOutcome<ClimateResult>): void {
  const { project, push } = ctx
  const r = o.result
  const src = ctx.newSource(
    apiSource({
      source_name: `공공데이터포털 — ${CLIMATE_SERVICE}`,
      dataset_name: r ? `${r.station.name} 관측소(지점 ${r.station.id}) 일자료` : 'ASOS 일자료',
      dataset_id: r ? `kma:asos:${r.station.id}` : 'kma:asos',
      retrieved_at: o.retrievedAt,
      geometry: r ? `${r.station.name} 관측소 (대지에서 약 ${r.distanceKm.toFixed(1)}km)` : '가까운 관측소',
      spatial_scale: '관측소 지점',
      time_range: r ? `${r.years[0]}~${r.years.at(-1)}년` : null,
      raw_ref: r ? 'kma:asos' : null,
      unit: '℃, mm, m/s, 시간',
      limitations:
        '대지가 아닌 가까운 기상관측소의 값이다. 3년 자료는 기후 평년값(30년)보다 해마다의 변동이 크다. 건물 사이 바람길·열섬 같은 대지의 미기후는 현장에서 확인해야 한다.' +
        (r?.note ? ` ${r.note}` : ''),
      original_url: CLIMATE_PUBLIC_URL,
      feature_count: r ? r.rows.length : null,
      status: o.error ? 'error' : 'ok',
      error: o.error,
    }),
  )
  if (!r) {
    push({
      auto_key: 'climate-error',
      type: 'UNKNOWN',
      topic: '기후·바람',
      text: `기상 자료를 가져오지 못했다 (${o.error}). 기상자료개방포털에서 가까운 관측소 자료를 확인해야 한다.`,
      sources: [src],
      confidence: 'low',
      human_validation_required: true,
    })
    return
  }
  project.collected['kma:asos'] = {
    dataset_id: 'kma:asos',
    retrieved_at: o.retrievedAt,
    features: r.rows.map((row) => ({ type: 'Feature' as const, geometry: null, properties: { ...row, stnId: r.station.id } })),
  }
  const rows = r.rows
  const where = `${r.station.name} 관측소(대지에서 약 ${r.distanceKm.toFixed(1)}km)의 ${r.years[0]}~${r.years.at(-1)}년`
  const nYears = r.years.length

  // 기온
  const avgTa = mean(rows.map((x) => num(x.avgTa)).filter((v): v is number => v !== null))
  const monthMean = (field: keyof DailyRow, m: number) =>
    mean(rows.filter((x) => monthOf(x) === m).map((x) => num(x[field])).filter((v): v is number => v !== null))
  const maxByMonth = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, v: monthMean('maxTa', i + 1) })).filter((x) => x.v !== null)
  const minByMonth = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, v: monthMean('minTa', i + 1) })).filter((x) => x.v !== null)
  if (avgTa !== null && maxByMonth.length && minByMonth.length) {
    const hot = maxByMonth.reduce((a, b) => ((b.v as number) > (a.v as number) ? b : a))
    const cold = minByMonth.reduce((a, b) => ((b.v as number) < (a.v as number) ? b : a))
    const hotDays = rows.filter((x) => (num(x.maxTa) ?? -99) >= 33).length / nYears
    const freezeDays = rows.filter((x) => (num(x.minTa) ?? 99) < 0).length / nYears
    push({
      auto_key: 'climate-temp',
      topic: '기후·바람',
      text: `${where} 평균기온은 ${fmt(avgTa, 1)}℃이다. 가장 더운 ${hot.m}월의 일 최고기온 평균은 ${fmt(hot.v as number, 1)}℃, 가장 추운 ${cold.m}월의 일 최저기온 평균은 ${fmt(cold.v as number, 1)}℃이며, 최고기온 33℃ 이상인 날은 연 평균 ${fmt(hotDays, 0)}일, 최저기온 영하인 날은 ${fmt(freezeDays, 0)}일이다.`,
      sources: [src],
    })
  }

  // 강수
  const rain = rows.map((x) => ({ y: yearOf(x), m: monthOf(x), v: num(x.sumRn) ?? 0 }))
  const total = rain.reduce((a, b) => a + b.v, 0)
  if (rows.some((x) => x.sumRn !== undefined)) {
    const rainyDays = rain.filter((x) => x.v >= 0.1).length / nYears
    const summer = rain.filter((x) => x.m >= 6 && x.m <= 9).reduce((a, b) => a + b.v, 0)
    const yearly = r.years.map((y) => rain.filter((x) => x.y === y).reduce((a, b) => a + b.v, 0))
    push({
      auto_key: 'climate-rain',
      topic: '기후·바람',
      text: `${where} 연 강수량은 평균 ${fmt(total / nYears)}mm(해마다 ${fmt(Math.min(...yearly))}~${fmt(Math.max(...yearly))}mm)이고, 비가 온 날(0.1mm 이상)은 연 평균 ${fmt(rainyDays)}일이다. 강수의 ${pct(summer, total)}%가 6~9월에 내렸다.`,
      sources: [src],
    })
  }

  // 바람
  const windField: keyof DailyRow = rows.some((x) => num(x.maxWd)) ? 'maxWd' : 'maxWsWd'
  const seasonText = SEASONS.map((s) => {
    const dirs = rows
      .filter((x) => s.months.includes(monthOf(x)))
      .map((x) => num(x[windField]))
      .filter((v): v is number => v !== null && v > 0)
      .map(dirName)
    const top = countBy(dirs)[0]
    return top ? `${s.name} ${top[0]}풍(${pct(top[1], dirs.length)}%)` : ''
  }).filter(Boolean)
  const avgWs = mean(rows.map((x) => num(x.avgWs)).filter((v): v is number => v !== null))
  if (seasonText.length > 0) {
    push({
      auto_key: 'climate-wind',
      topic: '기후·바람',
      text: `${where} 계절별로 가장 자주 분 바람은 ${seasonText.join(', ')}이다 (${windField === 'maxWd' ? '일별 최다풍향' : '일별 최대풍속의 풍향'} 기준, 괄호는 그 계절 날 중 비율)${avgWs !== null ? `. 평균 풍속은 ${fmt(avgWs, 1)}m/s` : ''}.`,
      sources: [src],
      confidence: 'medium',
    })
  }

  // 일조·눈
  const sun = rows.map((x) => num(x.sumSsHr)).filter((v): v is number => v !== null)
  const snowDays = rows.filter((x) => (num(x.ddMefs) ?? 0) > 0).length / nYears
  if (sun.length > 0) {
    const winterSun = mean(rows.filter((x) => [12, 1, 2].includes(monthOf(x))).map((x) => num(x.sumSsHr)).filter((v): v is number => v !== null))
    push({
      auto_key: 'climate-sun',
      topic: '기후·바람',
      text: `${where} 연 일조시간은 평균 ${fmt(sun.reduce((a, b) => a + b, 0) / nYears)}시간이고, 겨울(12~2월) 하루 평균 일조시간은 ${fmt(winterSun ?? 0, 1)}시간이다. 눈이 새로 쌓인 날은 연 평균 ${fmt(snowDays)}일이다.`,
      sources: [src],
    })
  }

  push({
    auto_key: 'climate-microclimate',
    type: 'UNKNOWN',
    topic: '기후·바람',
    text: '관측소 바람은 넓은 지역의 바람이다. 대지 주변 건물·지형 때문에 실제로 바람이 어디로 흐르고 어디가 막히는지는 현장 관찰로 확인해야 한다.',
    sources: [src],
    confidence: 'low',
    human_validation_required: true,
  })
}

// ───────────────────────── 상가업소 ─────────────────────────

/** 상권업종 중분류 중 이름만으로 뜻이 잘 안 보이는 것 (2023년 개편 분류) */
const MCLS_GLOSS: Record<string, string> = {
  비알코올: '비알코올 음료점(카페 등)',
  '기타 간이': '기타 간이음식(분식·빵·패스트푸드 등)',
  주점: '주점',
}

function mclsName(v: string): string {
  return MCLS_GLOSS[v] ?? v
}

function floorClass(v: string): 'ground' | 'upper' | 'basement' | null {
  const t = v.replace(/\s+/g, '')
  if (!t) return null
  if (/^(B|b|지하|지|-)/.test(t)) return 'basement'
  const n = Number(t.replace(/층$/, ''))
  if (!Number.isFinite(n)) return null
  if (n <= 0) return 'basement'
  return n === 1 ? 'ground' : 'upper'
}

export function addStoreFacts(ctx: FactContext, o: ApiOutcome<StoresResult>): void {
  const { project, push } = ctx
  const r = o.result
  const src = ctx.newSource(
    apiSource({
      source_name: `공공데이터포털 — ${STORES_SERVICE}`,
      dataset_name: '반경 내 상가업소',
      dataset_id: 'sbiz:storeListInRadius',
      retrieved_at: o.retrievedAt,
      update_date: r?.stdrYm ? `${r.stdrYm.slice(0, 4)}년 ${Number(r.stdrYm.slice(4, 6))}월 기준` : null,
      spatial_scale: r ? `대지 중심 반경 ${r.radiusM}m` : '대지 중심 반경',
      raw_ref: r?.stores.length ? 'sbiz:stores' : null,
      limitations:
        '사업자 등록 등을 바탕으로 분기마다 갱신되는 자료로, 최근 개·폐업이 반영되지 않았을 수 있음. 노점·무등록 영업은 없음. 층 정보는 비어 있는 경우가 많음.' +
        (r?.truncated ? ` 이번 조회는 전체 ${r.total}곳 중 ${r.stores.length}곳만 받음.` : ''),
      original_url: STORES_PUBLIC_URL,
      feature_count: r ? r.stores.length : null,
      status: o.error ? 'error' : r?.stores.length ? 'ok' : 'empty',
      error: o.error,
    }),
  )
  if (!r) {
    push({
      auto_key: 'stores-error',
      type: 'UNKNOWN',
      topic: '상권',
      text: `상가업소 정보를 가져오지 못했다 (${o.error}). 소상공인 상권정보 사이트나 현장에서 확인해야 한다.`,
      sources: [src],
      confidence: 'low',
      human_validation_required: true,
    })
    return
  }
  project.collected['sbiz:stores'] = {
    dataset_id: 'sbiz:stores',
    retrieved_at: o.retrievedAt,
    features: r.stores.map((s) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
      properties: { name: s.name, lcls: s.lcls, mcls: s.mcls, scls: s.scls, floor: s.floor },
    })),
  }
  const n = r.stores.length
  if (n === 0) {
    push({ auto_key: 'stores-count', topic: '상권', text: `대지 중심 반경 ${r.radiusM}m 안에 등록된 상가업소가 없다.`, sources: [src], confidence: 'medium' })
    return
  }
  const lcls = countBy(r.stores.map((s) => s.lcls || '분류 없음'))
  push({
    auto_key: 'stores-count',
    topic: '상권',
    text: `대지 중심 반경 ${r.radiusM}m 안에 상가업소 ${fmt(r.total)}곳이 등록돼 있다${r.stdrYm ? ` (${r.stdrYm.slice(0, 4)}년 ${Number(r.stdrYm.slice(4, 6))}월 기준)` : ''}. 업종 대분류는 ${lcls
      .slice(0, 5)
      .map(([k, c]) => `${k} ${pct(c, n)}%`)
      .join(', ')} 순이다.`,
    sources: [src],
  })
  const mcls = countBy(r.stores.map((s) => mclsName(s.mcls)).filter(Boolean))
  if (mcls.length > 0) {
    push({
      auto_key: 'stores-mcls',
      topic: '상권',
      text: `많은 업종(중분류)은 ${mcls
        .slice(0, 6)
        .map(([k, c]) => `${k} ${fmt(c)}곳`)
        .join(', ')}이다.`,
      sources: [src],
    })
  }
  const floors = r.stores.map((s) => floorClass(s.floor)).filter((v): v is NonNullable<typeof v> => v !== null)
  if (floors.length >= 10) {
    const c = (k: string) => floors.filter((f) => f === k).length
    push({
      auto_key: 'stores-floor',
      topic: '상권',
      text: `층 정보가 있는 ${fmt(floors.length)}곳 중 1층 ${pct(c('ground'), floors.length)}%, 2층 이상 ${pct(c('upper'), floors.length)}%, 지하 ${pct(c('basement'), floors.length)}%이다 (전체의 ${pct(n - floors.length, n)}%는 층 정보 없음).`,
      sources: [src],
      confidence: 'medium',
    })
  }
  const near = r.stores.filter((s) => pointToAreaDistanceM([s.lon, s.lat], ctx.boundary) <= 50)
  const nearTypes = countBy(near.map((s) => mclsName(s.mcls) || s.lcls).filter(Boolean))
  push({
    auto_key: 'stores-near',
    topic: '상권',
    text: near.length
      ? `대지 경계 50m 안에 상가업소 ${near.length}곳이 있다 (${nearTypes
          .slice(0, 5)
          .map(([k, c]) => `${k} ${c}`)
          .join(', ')}).`
      : '대지 경계 50m 안에 등록된 상가업소가 없다.',
    sources: [src],
    confidence: 'medium',
  })

  // 낮·밤 성격, 대지 주변 100m vs 반경 전체 (업종으로 어림)
  const near100 = r.stores.filter((s) => pointToAreaDistanceM([s.lon, s.lat], ctx.boundary) <= 100)
  const shares = (list: typeof r.stores) => {
    const c = { day: 0, allday: 0, night: 0 }
    for (const s of list) c[storeTime(s.lcls, s.mcls, s.scls)]++
    return c
  }
  const sa = shares(r.stores)
  const sn = shares(near100)
  const sText = (c: { day: number; allday: number; night: number }, total: number) => `낮 업종 ${pct(c.day, total)}%·종일(음식·카페·편의점) ${pct(c.allday, total)}%·밤 업종(주점·노래방·PC방·숙박) ${pct(c.night, total)}%`
  push({
    auto_key: 'stores-time',
    topic: '상권',
    text: `업종으로 어림한 시간 성격은 반경 안 상가 ${fmt(n)}곳이 ${sText(sa, n)}이고, 대지 경계 100m 안 ${fmt(near100.length)}곳은 ${near100.length ? sText(sn, near100.length) : '없음'}이다 (실제 영업시간이 아니라 업종 기준).`,
    sources: [src],
    confidence: 'medium',
  })
  if (near100.length >= 10) {
    const key = (s: (typeof r.stores)[number]) => mclsLabel(s.mcls || s.lcls || '분류 없음')
    const all = new Map<string, number>()
    const nr = new Map<string, number>()
    for (const s of r.stores) all.set(key(s), (all.get(key(s)) ?? 0) + 1)
    for (const s of near100) nr.set(key(s), (nr.get(key(s)) ?? 0) + 1)
    const lq = [...nr.entries()]
      .filter(([, c]) => c >= 2)
      .map(([k, c]) => ({ k, q: c / near100.length / ((all.get(k) ?? 1) / n) }))
      .filter((x) => x.q >= 1.5)
      .sort((a, b) => b.q - a.q)
    const missing = [...all.entries()].filter(([k, c]) => c / n >= 0.03 && !nr.get(k)).map(([k]) => k)
    push({
      auto_key: 'stores-special',
      topic: '상권',
      text: `대지 경계 100m 안 업종 구성을 반경 전체와 비교하면 ${lq.length ? `${lq.slice(0, 4).map((x) => `${x.k}(${fmt(x.q, 1)}배)`).join(', ')}이 동네보다 많고` : '동네보다 눈에 띄게 많은 업종은 없고'}${missing.length ? `, 동네에 흔한 ${missing.slice(0, 3).join('·')}은 대지 주변에 없다` : ''}.`,
      sources: [src],
      confidence: 'medium',
    })
  }
}

// ───────────────────────── 카카오 주변 시설 ─────────────────────────

const POI_TOPIC: Record<string, string> = { SW8: '대중교통', SC4: '교육', PS3: '교육', AC5: '교육' }

export function addPoiFacts(ctx: FactContext, o: ApiOutcome<PoiCategoryResult[]>): void {
  const { project, push, radiusM } = ctx
  const r = o.result
  const ok = r?.filter((c) => !c.error) ?? []
  const src = ctx.newSource(
    apiSource({
      source_name: KAKAO_SOURCE,
      dataset_name: '카테고리별 주변 장소',
      dataset_id: 'kakao:local:category',
      retrieved_at: o.retrievedAt,
      spatial_scale: `대지 중심 반경 ${radiusM}m`,
      raw_ref: ok.some((c) => c.places.length) ? 'kakao:poi' : null,
      license: KAKAO_LICENSE,
      reliability: 'secondary',
      limitations:
        '카카오맵에 등록된 장소 기준이며 폐업·미등록 장소가 섞여 있을 수 있음. 분류마다 가까운 15곳까지만 받음(개수는 카카오 집계). 거리는 대지 중심에서의 직선거리.',
      original_url: KAKAO_PUBLIC_URL,
      feature_count: r ? ok.reduce((n, c) => n + c.total, 0) : null,
      status: o.error ? 'error' : ok.length ? 'ok' : 'error',
      error: o.error ?? (r && ok.length === 0 ? r[0]?.error ?? null : null),
    }),
  )
  if (!r || ok.length === 0) {
    push({
      auto_key: 'poi-error',
      type: 'UNKNOWN',
      topic: '생활 시설',
      text: `주변 생활 시설 정보를 가져오지 못했다 (${o.error ?? r?.[0]?.error}). 지도 앱에서 확인해야 한다.`,
      sources: [src],
      confidence: 'low',
      human_validation_required: true,
    })
    return
  }
  project.collected['kakao:poi'] = {
    dataset_id: 'kakao:poi',
    retrieved_at: o.retrievedAt,
    features: ok.flatMap((c) =>
      [...c.places, ...(c.nearestBeyond ? [c.nearestBeyond] : [])].map((p) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
        properties: { name: p.name, code: c.code, label: c.label, category: p.category, distance: p.distance },
      })),
    ),
  }

  const counted = ok.filter((c) => !POI_CATEGORIES.find((x) => x.code === c.code)?.widenTo || c.total > 0)
  push({
    auto_key: 'poi-counts',
    topic: '생활 시설',
    text: `카카오맵 기준 대지 중심 반경 ${radiusM}m 안의 장소 수: ${counted.map((c) => `${c.label} ${fmt(c.total)}곳`).join(', ')}.`,
    sources: [src],
    confidence: 'medium',
  })

  for (const c of ok) {
    const def = POI_CATEGORIES.find((x) => x.code === c.code)
    if (!def?.widenTo && c.code !== 'AT4') continue
    const topic = POI_TOPIC[c.code] ?? '생활 시설'
    const names = c.places.slice(0, 4).map((p) => `${p.name}(${distText(p.distance)})`)
    let text = ''
    if (c.places.length > 0)
      text = `대지 중심에서 가까운 ${c.label}: ${names.join(', ')}${c.total > 4 ? ` 등 반경 ${radiusM}m 안에 ${fmt(c.total)}곳` : ''} (대지 중심에서 직선거리).`
    else if (c.nearestBeyond)
      text = `반경 ${radiusM}m 안에 ${josa(c.label, '이', '가')} 없고, 가장 가까운 곳은 ${c.nearestBeyond.name}(대지 중심에서 직선 ${distText(c.nearestBeyond.distance)})이다.`
    else if (def?.widenTo) text = `대지 중심 ${fmt(def.widenTo / 1000, 1)}km 안에 카카오맵에 등록된 ${josa(c.label, '이', '가')} 없다.`
    if (!text) continue
    push({ auto_key: `poi:${c.code}`, topic, text, sources: [src], confidence: 'medium' })
  }
}

// ───────────────────────── 반경 안 필지의 토지특성 ─────────────────────────

export function addLandAreaFacts(ctx: FactContext, o: LandAreaOutcome): void {
  const { project, push, radiusM } = ctx
  const rows = Object.entries(o.byPnu)
  const years = rows.map(([, r]) => r.year).filter(Boolean).sort()
  const src = ctx.newSource(
    apiSource({
      source_name: '브이월드 부동산 개방데이터 (국토교통부)',
      dataset_name: '토지특성 — 반경 안 필지 전체 (법정동 단위 조회)',
      dataset_id: 'ned:landCharArea',
      retrieved_at: o.retrievedAt,
      geometry: `반경 ${radiusM}m 안 필지`,
      spatial_scale: '필지',
      time_range: years.length ? `${years[0]}~${years.at(-1)}년` : null,
      raw_ref: rows.length ? 'ned:landCharArea' : null,
      license: '브이월드 오픈API 이용약관에 따름 (출처 표기 필요)',
      limitations: '개별공시지가 산정을 위한 토지특성 조사 자료. 지형높이는 주변과 비교한 등급(저지·평지·완경사·급경사·고지)이라 실제 경사도(°)가 아님.',
      original_url: o.url,
      feature_count: rows.length,
      status: o.error ? 'error' : rows.length ? 'ok' : 'empty',
      error: o.error,
    }),
  )
  project.collected['ned:landCharArea'] = {
    dataset_id: 'ned:landCharArea',
    retrieved_at: o.retrievedAt,
    features: rows.map(([pnu, r]) => ({ type: 'Feature' as const, geometry: null, properties: { pnu, ...r } })),
  }
  if (rows.length < 10) return
  const hg = countBy(rows.map(([, r]) => r.hg).filter(Boolean))
  const n = hg.reduce((a, [, c]) => a + c, 0)
  if (n > 0) {
    push({
      auto_key: 'landarea-height',
      topic: '지형',
      text: `반경 ${radiusM}m 안 필지 ${fmt(n)}곳의 지형높이(토지특성 조사 등급)는 ${hg
        .slice(0, 5)
        .map(([k, c]) => `${k} ${pct(c, n)}%`)
        .join(', ')}이다.`,
      sources: [src],
      confidence: 'medium',
    })
  }
  const roads = rows.map(([, r]) => r.road).filter(Boolean)
  const landlocked = roads.filter((r) => r.startsWith('맹지')).length
  if (roads.length > 0) {
    push({
      auto_key: 'landarea-road',
      topic: '도로',
      text: `반경 안 필지 중 도로에 접하지 않은 맹지는 ${fmt(landlocked)}곳(${pct(landlocked, roads.length)}%)이다 (토지특성의 도로접면 기준, ${fmt(roads.length)}필지).`,
      sources: [src],
      confidence: 'medium',
    })
  }
}

// ───────────────────────── 지형 (대지 중심 = 0m 상대 높이) ─────────────────────────

const DIR8_NAMES = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
const dirName8 = (b: number) => DIR8_NAMES[Math.round(b / 45) % 8]

function bearingFrom(center: [number, number], lon: number, lat: number): { d: number; b: number } {
  const kx = 111320 * Math.cos((center[1] * Math.PI) / 180)
  const dx = (lon - center[0]) * kx
  const dy = (lat - center[1]) * 110574
  return { d: Math.hypot(dx, dy), b: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 }
}

function slopeWord(deg: number): string {
  if (deg < 3) return '거의 평지'
  if (deg < 8) return '완만한 경사'
  if (deg < 15) return '경사지'
  return '급경사지'
}

export function addTerrainFacts(ctx: FactContext, o: ApiOutcome<TerrainSummary>): void {
  const { project, push, radiusM } = ctx
  const r = o.result
  const ngii = r?.source === 'ngii'
  const src = ctx.newSource(
    apiSource({
      source_name: ngii ? '국토지리정보원 연속수치지형도 (대지해석 에이전트가 10m 격자로 가공)' : 'AWS Terrain Tiles (대체 자료)',
      dataset_name: ngii ? `등고선·표고점 → 10m 격자 ${r?.version ?? ''}` : '전 세계 지형 타일 (Terrarium)',
      dataset_id: 'terrain:grid',
      retrieved_at: o.retrievedAt,
      geometry: `대지 중심 반경 ${radiusM}m`,
      spatial_scale: '10m 격자',
      raw_ref: r ? 'terrain:summary' : null,
      unit: 'm (대지 중심 = 0m 상대 높이), °',
      license: ngii ? 'CC BY (출처: 국토지리정보원)' : 'Mapzen/AWS Terrain Tiles 이용 조건에 따름',
      limitations: ngii
        ? '5m 등고선과 표고점으로 보간한 10m 격자라 옹벽·계단·작은 둔덕은 나타나지 않음. 경사도·비탈 방향은 50m로 평활한 값. 참고용이며 측량·인허가 근거가 아님.'
        : '광주·전남·전북 밖이라 전 세계 지형 타일로 대신함. 도심에서는 건물 높이가 섞여 10m 넘게 틀릴 수 있음.',
      original_url: ngii ? 'https://cjg10040.github.io/site-agent-terrain/' : 'https://registry.opendata.aws/terrain-tiles/',
      reliability: ngii ? 'computed' : 'secondary',
      feature_count: null,
      status: o.error ? 'error' : 'ok',
      error: o.error,
    }),
  )
  if (!r) {
    push({
      auto_key: 'terrain-error',
      type: 'UNKNOWN',
      topic: '지형',
      text: `지형 자료를 가져오지 못했다 (${o.error}). 지형도나 현장에서 높낮이를 확인해야 한다.`,
      sources: [src],
      confidence: 'low',
      human_validation_required: true,
    })
    return
  }
  project.collected['terrain:summary'] = {
    dataset_id: 'terrain:summary',
    retrieved_at: o.retrievedAt,
    features: [{ type: 'Feature' as const, geometry: null, properties: { ...r, high: r.high ? { ...r.high } : null, low: r.low ? { ...r.low } : null } as unknown as Record<string, unknown> }],
  }
  const conf: Card['confidence'] = ngii ? 'medium' : 'low'
  const s = r.site
  push({
    auto_key: 'terrain-site',
    topic: '지형',
    text: `대지 안 높낮이 차는 ${rangeText(s.range)}이고, 평균 경사는 약 ${fmt(s.meanSlope, 1)}°(${slopeWord(s.meanSlope)})이다${
      s.aspect === null ? '. 비탈 방향은 뚜렷하지 않다' : `. 대지는 ${dirName8(s.aspect)}쪽으로 낮아지는 비탈에 있다`
    } (50m 평활).`,
    sources: [src],
    confidence: conf,
  })
  if (r.high && r.low) {
    const hi = bearingFrom(centerOfBoundary(ctx), r.high.lon, r.high.lat)
    const lo = bearingFrom(centerOfBoundary(ctx), r.low.lon, r.low.lat)
    push({
      auto_key: 'terrain-relief',
      topic: '지형',
      text: `대지 중심을 0m로 하면 반경 ${radiusM}m 안의 높이는 ${fmt(r.low.rel, 0)}m ~ +${fmt(r.high.rel, 0)}m이다. 가장 높은 곳은 ${dirName8(hi.b)}쪽 약 ${fmt(Math.round(hi.d / 10) * 10)}m, 가장 낮은 곳은 ${dirName8(lo.b)}쪽 약 ${fmt(Math.round(lo.d / 10) * 10)}m에 있다.`,
      sources: [src],
      confidence: conf,
    })
  }
  const labels = ['5° 미만', '5~10°', '10~15°', '15~20°', '20° 이상']
  push({
    auto_key: 'terrain-slope',
    topic: '지형',
    text: `반경 안 땅의 경사도는 ${labels
      .map((l, i) => [l, Math.round(r.slopeShare[i] * 100)] as const)
      .filter(([, p]) => p > 0)
      .map(([l, p]) => `${l} ${p}%`)
      .join(', ')}이다 (50m 평활).`,
    sources: [src],
    confidence: conf,
  })
  if (!ngii) {
    push({
      auto_key: 'terrain-fallback',
      type: 'UNKNOWN',
      topic: '지형',
      text: '이 대지는 국토지리정보원 지형 격자(광주·전남·전북) 밖이라 오차가 큰 대체 자료를 썼다. 도심의 높낮이는 지형도나 현장에서 다시 확인해야 한다.',
      sources: [src],
      confidence: 'low',
      human_validation_required: true,
    })
  }
}

function centerOfBoundary(ctx: FactContext): [number, number] {
  return centerOf(ctx.boundary)
}
