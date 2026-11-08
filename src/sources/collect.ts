// 대지 경계·반경을 기준으로 브이월드 레이어를 모아 오는 작업.
// 결과는 프로젝트에 넣기 전 단계의 원자료이며, 출처 기록과 사실 카드는 model/applyCollection.ts가 만든다.

import { centerOf, queryPolygonWkt, radiusCircle, type Areal } from '../lib/geo'
import { COLLECT_LAYERS, type CollectLayer } from './vworldLayers'
import { queryFeatures, reverseGeocode, VWorldError, type GeoFeature, type VWorldConfig } from './vworld'

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

export interface CollectOutcome {
  radiusM: number
  center: [number, number]
  address: { road?: string; parcel?: string } | null
  addressError: string | null
  addressAt: string
  layers: LayerOutcome[]
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

export async function collectSiteData(
  config: VWorldConfig,
  boundary: Areal,
  radiusM: number,
  onProgress: (p: CollectProgress[]) => void,
): Promise<CollectOutcome> {
  const center = centerOf(boundary)
  const siteWkt = queryPolygonWkt(boundary)
  const radiusWkt = queryPolygonWkt(radiusCircle(center, radiusM), 70)
  const pointWkt = `POINT(${center[0].toFixed(7)} ${center[1].toFixed(7)})`

  const progress: CollectProgress[] = COLLECT_LAYERS.map((l) => ({
    id: l.id,
    label: l.label,
    group: l.group,
    state: 'pending',
  }))
  const report = () => onProgress(progress.map((p) => ({ ...p })))
  report()

  const outcomes: LayerOutcome[] = []

  await runPool(COLLECT_LAYERS, 4, async (layer) => {
    const p = progress.find((x) => x.id === layer.id)!
    p.state = 'running'
    report()
    const geomFilter = layer.scope === 'center' ? pointWkt : layer.scope === 'site' ? siteWkt : radiusWkt
    const scopeLabel = layer.scope === 'center' ? '대지 중심점' : layer.scope === 'site' ? '대지 경계' : `반경 ${radiusM}m`
    const retrievedAt = new Date().toISOString()
    try {
      const r = await queryFeatures(config, {
        layerId: layer.id,
        geomFilter,
        geometry: layer.geometry,
        maxFeatures: layer.maxFeatures,
      })
      const state = r.features.length > 0 ? 'ok' : 'empty'
      outcomes.push({ layer, state, ...r, error: null, retrievedAt, scopeLabel })
      p.state = state
      p.count = r.features.length
      if (r.truncated) p.message = `전체 ${r.total}건 중 ${r.features.length}건까지만 받음`
    } catch (e) {
      outcomes.push({
        layer,
        state: 'error',
        features: [],
        total: 0,
        truncated: false,
        url: '',
        error: errorText(e),
        retrievedAt,
        scopeLabel,
      })
      p.state = 'error'
      p.message = errorText(e)
    }
    report()
  })

  let address: CollectOutcome['address'] = null
  let addressError: string | null = null
  const addressAt = new Date().toISOString()
  try {
    address = await reverseGeocode(config, center[0], center[1])
  } catch (e) {
    addressError = errorText(e)
  }

  // 목록 순서를 원래 레이어 순서로 맞춘다
  outcomes.sort((a, b) => COLLECT_LAYERS.indexOf(a.layer) - COLLECT_LAYERS.indexOf(b.layer))

  return { radiusM, center, address, addressError, addressAt, layers: outcomes, finishedAt: new Date().toISOString() }
}
