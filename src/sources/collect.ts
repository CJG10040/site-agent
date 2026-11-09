// 대지 경계·반경을 기준으로 공공데이터를 모아 오는 작업.
// 결과는 프로젝트에 넣기 전 단계의 원자료이며, 출처 기록과 사실 카드는 model/applyCollection.ts가 만든다.

import { areaToAreaDistanceM, centerOf, expandedBoxFilter, queryPolygonWkt, radiusCircle, intersects, type Areal } from '../lib/geo'
import type { ParcelRef } from '../model/types'
import { registerForParcel, type RegisterParcel } from './buildingRegister'
import type { DataCategory } from './categories'
import type { ApiKeys } from './keys'
import { toParcel } from './parcels'
import {
  households,
  industries,
  latestYear,
  populationSeries,
  regionAt,
  statsAreasAround,
  type HouseholdYear,
  type IndustryRow,
  type PopulationYear,
  type SgisRegion,
  type StatsAreaFeature,
} from './sgis'
import { climateNear, type ClimateResult } from './climate'
import { poisAround, type PoiCategoryResult } from './kakao'
import { storesAround, type StoresResult } from './stores'
import { busStopsAround, type TransitResult } from './transit'
import { ALL_LAYERS, layerCategory, type CollectLayer } from './vworldLayers'
import { LAND_DATASETS, nedForParcel } from './vworldLand'
import { PARCEL_LAYER, queryFeatures, reverseGeocode, VWorldError, type GeoFeature, type VWorldConfig } from './vworld'

export type CollectState = 'pending' | 'running' | 'ok' | 'empty' | 'error'

export interface CollectProgress {
  id: string
  label: string
  group: string
  state: CollectState
  count?: number
  message?: string
}

export interface LayerOutcome {
  layer: CollectLayer
  state: 'ok' | 'empty' | 'error'
  features: GeoFeature[]
  total: number
  truncated: boolean
  url: string
  error: string | null
  retrievedAt: string
  scopeLabel: string
}

export interface LandParcelResult {
  pnu: string
  addr: string
  jibun: string
  items: Record<string, unknown>[]
  usedPnu: string
  error: string | null
}

export interface LandOutcome {
  retrievedAt: string
  datasets: Record<string, { url: string; parcels: LandParcelResult[] }>
}

export interface RegisterOutcome {
  retrievedAt: string
  parcels: RegisterParcel[]
  adjacentError: string | null
}

export interface SgisOutcome {
  retrievedAt: string
  wants: { population: boolean; business: boolean }
  region: SgisRegion | null
  latestYear: number | null
  series: PopulationYear[]
  householdsLatest: HouseholdYear | null
  householdsFirst: HouseholdYear | null
  industriesLatest: IndustryRow[]
  industriesBase: IndustryRow[]
  baseYear: number | null
  statsAreas: StatsAreaFeature[]
  errors: { part: 'population' | 'statsArea' | 'business'; message: string }[]
}

/** 공공데이터포털·카카오 수집 결과 (실패하면 error에 사유) */
export interface ApiOutcome<T> {
  retrievedAt: string
  result: T | null
  error: string | null
}

export interface CollectOutcome {
  radiusM: number
  center: [number, number]
  address: { road?: string; parcel?: string } | null
  addressError: string | null
  addressAt: string
  layers: LayerOutcome[]
  land?: LandOutcome
  register?: RegisterOutcome
  sgis?: SgisOutcome
  transit?: ApiOutcome<TransitResult>
  climate?: ApiOutcome<ClimateResult>
  stores?: ApiOutcome<StoresResult>
  poi?: ApiOutcome<PoiCategoryResult[]>
  selection: DataCategory[]
  finishedAt: string
}

function errorText(e: unknown): string {
  if (e instanceof VWorldError) return `${e.code} — ${e.message}`
  return e instanceof Error ? e.message : String(e)
}

/** 동시에 너무 많이 요청하지 않도록 몇 개씩 나눠 실행 */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await worker(item)
    }
  })
  await Promise.all(runners)
}

const MAX_LAND_PARCELS = 40
const MAX_SITE_REGISTER = 20
const MAX_ADJACENT = 30

interface CollectInput {
  config: VWorldConfig
  keys: ApiKeys
  boundary: Areal
  parcels: ParcelRef[]
  radiusM: number
  selection: DataCategory[]
}

export async function collectSiteData(input: CollectInput, onProgress: (p: CollectProgress[]) => void): Promise<CollectOutcome> {
  const { config, keys, boundary, parcels, radiusM, selection } = input
  const want = (c: DataCategory) => selection.includes(c)
  const center = centerOf(boundary)
  const siteWkt = queryPolygonWkt(boundary)
  const radiusWkt = queryPolygonWkt(radiusCircle(center, radiusM), 70)
  const pointWkt = `POINT(${center[0].toFixed(7)} ${center[1].toFixed(7)})`

  const layers = ALL_LAYERS.filter((l) => {
    const c = layerCategory(l)
    return c === null || want(c)
  })

  const progress: CollectProgress[] = layers.map((l) => ({ id: l.id, label: l.label, group: l.group, state: 'pending' }))
  if (want('land')) for (const d of LAND_DATASETS) progress.push({ id: d.id, label: d.label, group: '토지', state: 'pending' })
  if (want('register')) progress.push({ id: 'hub:register', label: '건축물대장 (대지 + 맞닿은 필지)', group: '건물', state: 'pending' })
  if (want('population')) {
    progress.push({ id: 'sgis:population', label: '행정동 인구·가구 추이', group: '인구·사업체', state: 'pending' })
    progress.push({ id: 'sgis:statsarea', label: '반경 안 집계구 분포', group: '인구·사업체', state: 'pending' })
  }
  if (want('business')) progress.push({ id: 'sgis:business', label: '사업체·산업 구조', group: '인구·사업체', state: 'pending' })
  if (want('transit')) progress.push({ id: 'tago:stops', label: '버스정류소·경유 노선', group: '대중교통·기후', state: 'pending' })
  if (want('climate')) progress.push({ id: 'kma:asos', label: '가까운 관측소 기후 (최근 3년)', group: '대중교통·기후', state: 'pending' })
  if (want('stores')) progress.push({ id: 'sbiz:stores', label: '상가업소 업종', group: '상권', state: 'pending' })
  if (want('poi')) progress.push({ id: 'kakao:poi', label: '주변 생활 시설 (카카오)', group: '주변 시설', state: 'pending' })

  const report = () => onProgress(progress.map((p) => ({ ...p })))
  const set = (id: string, patch: Partial<CollectProgress>) => {
    const p = progress.find((x) => x.id === id)
    if (p) Object.assign(p, patch)
    report()
  }
  report()

  // ── 브이월드 레이어
  const layerOutcomes: LayerOutcome[] = []
  const layerTask = runPool(layers, 4, async (layer) => {
    set(layer.id, { state: 'running' })
    const geomFilter = layer.scope === 'center' ? pointWkt : layer.scope === 'site' ? siteWkt : radiusWkt
    const scopeLabel = layer.scope === 'center' ? '대지 중심점' : layer.scope === 'site' ? '대지 경계' : `반경 ${radiusM}m`
    const retrievedAt = new Date().toISOString()
    try {
      const r = await queryFeatures(config, { layerId: layer.id, geomFilter, geometry: layer.geometry, maxFeatures: layer.maxFeatures })
      const state = r.features.length > 0 ? 'ok' : 'empty'
      layerOutcomes.push({ layer, state, ...r, error: null, retrievedAt, scopeLabel })
      set(layer.id, {
        state,
        count: r.features.length,
        message: r.truncated ? `전체 ${r.total}건 중 ${r.features.length}건까지만 받음` : undefined,
      })
    } catch (e) {
      layerOutcomes.push({ layer, state: 'error', features: [], total: 0, truncated: false, url: '', error: errorText(e), retrievedAt, scopeLabel })
      set(layer.id, { state: 'error', message: errorText(e) })
    }
  })

  // ── 토지 (필지별)
  const landTask = (async (): Promise<LandOutcome | undefined> => {
    if (!want('land')) return undefined
    const targets = parcels.slice(0, MAX_LAND_PARCELS)
    const out: LandOutcome = { retrievedAt: new Date().toISOString(), datasets: {} }
    for (const d of LAND_DATASETS) {
      set(d.id, { state: 'running' })
      const results: LandParcelResult[] = []
      let url = ''
      await runPool(targets, 4, async (p) => {
        try {
          const r = await nedForParcel(config, d.path, p.pnu, p.addr, d.extra)
          url = url || r.url
          results.push({ pnu: p.pnu, addr: p.addr, jibun: p.jibun, items: r.items, usedPnu: r.usedPnu, error: null })
        } catch (e) {
          results.push({ pnu: p.pnu, addr: p.addr, jibun: p.jibun, items: [], usedPnu: p.pnu, error: errorText(e) })
        }
      })
      out.datasets[d.id] = { url, parcels: results }
      const withData = results.filter((r) => r.items.length > 0).length
      const failed = results.filter((r) => r.error).length
      set(d.id, {
        state: failed === results.length && results.length > 0 ? 'error' : withData > 0 ? 'ok' : 'empty',
        count: withData,
        message: [
          parcels.length > MAX_LAND_PARCELS ? `필지 ${MAX_LAND_PARCELS}개까지만 조회` : '',
          failed ? `${failed}필지 오류: ${results.find((r) => r.error)?.error}` : '',
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      })
    }
    return out
  })()

  // ── 건축물대장 (대지 + 맞닿은 필지)
  const registerTask = (async (): Promise<RegisterOutcome | undefined> => {
    if (!want('register')) return undefined
    set('hub:register', { state: 'running' })
    const out: RegisterOutcome = { retrievedAt: new Date().toISOString(), parcels: [], adjacentError: null }
    const sitePnus = new Set(parcels.map((p) => p.pnu))
    const targets: { pnu: string; addr: string; role: 'site' | 'adjacent' }[] = parcels
      .slice(0, MAX_SITE_REGISTER)
      .map((p) => ({ pnu: p.pnu, addr: p.addr, role: 'site' }))
    try {
      const r = await queryFeatures(config, {
        layerId: PARCEL_LAYER.id,
        geomFilter: expandedBoxFilter(boundary, 0.0001),
        geometry: true,
        maxFeatures: 400,
      })
      const adjacent = r.features
        .map((f) => toParcel(f))
        .filter((p): p is ParcelRef => !!p && !sitePnus.has(p.pnu))
        .map((p) => ({ p, d: areaToAreaDistanceM(p.geometry, boundary) }))
        .filter((x) => x.d <= 1.5)
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_ADJACENT)
      for (const { p } of adjacent) targets.push({ pnu: p.pnu, addr: p.addr, role: 'adjacent' })
    } catch (e) {
      out.adjacentError = errorText(e)
    }
    await runPool(targets, 4, async (t) => {
      out.parcels.push(await registerForParcel(keys, t.pnu, t.addr, t.role))
    })
    const errors = out.parcels.filter((p) => p.error)
    const buildings = out.parcels.reduce((n, p) => n + p.titles.length, 0)
    set('hub:register', {
      state: errors.length === out.parcels.length && out.parcels.length > 0 ? 'error' : buildings > 0 ? 'ok' : 'empty',
      count: buildings,
      message:
        [
          `대지 ${targets.filter((t) => t.role === 'site').length}필지 · 맞닿은 ${targets.filter((t) => t.role === 'adjacent').length}필지`,
          errors.length ? `오류 ${errors.length}건: ${errors[0].error}` : '',
          out.adjacentError ? `맞닿은 필지 찾기 실패: ${out.adjacentError}` : '',
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
    })
    return out
  })()

  // ── SGIS
  const sgisTask = (async (): Promise<SgisOutcome | undefined> => {
    if (!want('population') && !want('business')) return undefined
    const out: SgisOutcome = {
      retrievedAt: new Date().toISOString(),
      wants: { population: want('population'), business: want('business') },
      region: null,
      latestYear: null,
      series: [],
      householdsLatest: null,
      householdsFirst: null,
      industriesLatest: [],
      industriesBase: [],
      baseYear: null,
      statsAreas: [],
      errors: [],
    }
    const ids = [want('population') && 'sgis:population', want('population') && 'sgis:statsarea', want('business') && 'sgis:business'].filter(
      Boolean,
    ) as string[]
    for (const id of ids) set(id, { state: 'running' })
    try {
      out.region = await regionAt(keys, center[0], center[1])
      out.latestYear = await latestYear(keys, out.region.admCd)
    } catch (e) {
      const msg = errorText(e)
      for (const id of ids) set(id, { state: 'error', message: msg })
      out.errors.push({ part: 'population', message: msg })
      return out
    }
    const region = out.region
    const latest = out.latestYear
    const firstYear = 2015

    const jobs: Promise<void>[] = []
    if (want('population') || want('business')) {
      jobs.push(
        (async () => {
          try {
            out.series = await populationSeries(keys, region.admCd, firstYear, latest)
            if (want('population')) {
              out.householdsLatest = await households(keys, region.admCd, latest)
              out.householdsFirst = await households(keys, region.admCd, firstYear).catch(() => null)
              set('sgis:population', { state: out.series.length ? 'ok' : 'empty', count: out.series.length, message: `${region.name} · ${out.series[0]?.year ?? '-'}~${latest}년` })
            }
          } catch (e) {
            out.errors.push({ part: 'population', message: errorText(e) })
            set('sgis:population', { state: 'error', message: errorText(e) })
          }
        })(),
      )
    }
    if (want('population')) {
      jobs.push(
        (async () => {
          try {
            const r = await statsAreasAround(keys, center[0], center[1], radiusM, latest)
            const circle = radiusCircle(center, radiusM)
            out.statsAreas = r.features.filter((f) => f.geometry && intersects(f.geometry, circle))
            set('sgis:statsarea', { state: out.statsAreas.length ? 'ok' : 'empty', count: out.statsAreas.length, message: `${latest}년 · 행정동 ${r.dongCodes.length}곳에 걸침` })
          } catch (e) {
            out.errors.push({ part: 'statsArea', message: errorText(e) })
            set('sgis:statsarea', { state: 'error', message: errorText(e) })
          }
        })(),
      )
    }
    if (want('business')) {
      jobs.push(
        (async () => {
          try {
            out.industriesLatest = await industries(keys, region.admCd, latest)
            out.baseYear = latest - 5
            out.industriesBase = await industries(keys, region.admCd, latest - 5).catch(() => [])
            set('sgis:business', { state: out.industriesLatest.length ? 'ok' : 'empty', count: out.industriesLatest.length, message: `${region.name} · ${out.baseYear}·${latest}년` })
          } catch (e) {
            out.errors.push({ part: 'business', message: errorText(e) })
            set('sgis:business', { state: 'error', message: errorText(e) })
          }
        })(),
      )
    }
    await Promise.all(jobs)
    return out
  })()

  // ── 공공데이터포털·카카오 (서로 독립)
  async function apiTask<T>(
    on: boolean,
    id: string,
    fetcher: () => Promise<T>,
    summarize: (r: T) => Pick<CollectProgress, 'state' | 'count' | 'message'>,
  ): Promise<ApiOutcome<T> | undefined> {
    if (!on) return undefined
    set(id, { state: 'running' })
    const retrievedAt = new Date().toISOString()
    try {
      const result = await fetcher()
      set(id, summarize(result))
      return { retrievedAt, result, error: null }
    } catch (e) {
      set(id, { state: 'error', message: errorText(e) })
      return { retrievedAt, result: null, error: errorText(e) }
    }
  }
  const [lon, lat] = center
  const transitTask = apiTask(want('transit'), 'tago:stops', () => busStopsAround(keys, lon, lat), (r) => ({
    state: r.stops.length ? 'ok' : 'empty',
    count: r.stops.length,
    message: r.stops.length ? `가장 가까운 ${r.stops[0].nodenm} 약 ${Math.round(r.stops[0].distance)}m` : undefined,
  }))
  const climateTask = apiTask(want('climate'), 'kma:asos', () => climateNear(keys, lon, lat), (r) => ({
    state: 'ok',
    count: r.rows.length,
    message: `${r.station.name} 관측소 (약 ${r.distanceKm.toFixed(1)}km) · ${r.years[0]}~${r.years.at(-1)}년`,
  }))
  const storesTask = apiTask(want('stores'), 'sbiz:stores', () => storesAround(keys, lon, lat, radiusM), (r) => ({
    state: r.stores.length ? 'ok' : 'empty',
    count: r.stores.length,
    message: [r.radiusM < radiusM ? `반경 ${r.radiusM}m까지만 조회` : '', r.truncated ? `전체 ${r.total}곳 중 ${r.stores.length}곳` : '']
      .filter(Boolean)
      .join(' · ') || undefined,
  }))
  const poiTask = apiTask(want('poi'), 'kakao:poi', () => poisAround(keys, lon, lat, radiusM), (r) => {
    const failed = r.filter((c) => c.error)
    const total = r.reduce((n, c) => n + c.total, 0)
    return {
      state: failed.length === r.length ? 'error' : total > 0 ? 'ok' : 'empty',
      count: total,
      message: failed.length ? `${failed.length}개 분류 오류: ${failed[0].error}` : `${r.length}개 분류`,
    }
  })

  const [, land, register, sgis, transit, climate, stores, poi] = await Promise.all([
    layerTask,
    landTask,
    registerTask,
    sgisTask,
    transitTask,
    climateTask,
    storesTask,
    poiTask,
  ])

  let address: CollectOutcome['address'] = null
  let addressError: string | null = null
  const addressAt = new Date().toISOString()
  try {
    address = await reverseGeocode(config, center[0], center[1])
  } catch (e) {
    addressError = errorText(e)
  }

  layerOutcomes.sort((a, b) => ALL_LAYERS.indexOf(a.layer) - ALL_LAYERS.indexOf(b.layer))

  return {
    radiusM,
    center,
    address,
    addressError,
    addressAt,
    layers: layerOutcomes,
    land,
    register,
    sgis,
    transit,
    climate,
    stores,
    poi,
    selection,
    finishedAt: new Date().toISOString(),
  }
}
