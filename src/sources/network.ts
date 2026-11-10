// 길의 연결 수집: 브이월드 도로중심선(골목 포함)을 수집 반경보다 넓게 받아(가장자리 효과를 줄이고 15분 도보권까지)
// Web Worker에서 선택도를 계산한다. 결과(나뉜 길 + 길마다 정규화 선택도)는 프로젝트에 저장해 다시 계산하지 않는다.

import type { Geometry, Position } from 'geojson'
import { queryPolygonWkt, radiusCircle } from '../lib/geo'
import type { XY } from '../lib/network'
import type { NetworkJob, NetworkMessage } from '../lib/network.worker'
import { localProj, toXY } from '../lib/xy'
import { queryFeatures, type VWorldConfig } from './vworld'

export const NETWORK_LAYER = 'LT_L_N3A0020000'
export const WALK_R = 800
export const WIDE_BUFFER = 300
export const WALK_SPEED = 80 // m/분
export const WALK_BANDS = [5, 10, 15] // 분
const MAX_ORIGINS = 6000

/** 받는 반경: 15분 도보권(1,200m) + 여유, 걷는 규모 선택도(수집 반경 + 800m) 중 큰 쪽 */
export function networkRadius(displayR: number): number {
  return Math.max(1500, displayR + WALK_R)
}

export function linesOf(g: Geometry | null): Position[][] {
  if (!g) return []
  if (g.type === 'LineString') return [g.coordinates]
  if (g.type === 'MultiLineString') return g.coordinates
  return []
}

// ───────────────────────── 결과 ─────────────────────────

export interface NetworkResult {
  center: [number, number]
  /** 받은 반경 */
  fetchR: number
  /** 수집 반경 */
  displayR: number
  walkR: number
  wideBuffer: number
  /** 받은 도로중심선 수 / 전체 수 */
  features: number
  total: number
  truncated: boolean
  url: string
  /** 교차점에서 나눈 길 (대지 중심 기준 미터, 0.1m) */
  edges: XY[][]
  /** 길마다 정규화 선택도 (걷는 규모 800m / 넓은 규모 = 수집 반경 + 여유) */
  nachWalk: (number | null)[]
  nachWide: (number | null)[]
  originsWalk: number
  originsWide: number
  wideEdges: number
}

function runWorker(job: NetworkJob, onProgress?: (text: string) => void): Promise<Extract<NetworkMessage, { type: 'done' }>> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../lib/network.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (ev: MessageEvent<NetworkMessage>) => {
      const m = ev.data
      if (m.type === 'progress') {
        onProgress?.(`${m.stage === 'walk' ? '걷는 규모' : '넓은 규모'} 선택도 ${Math.round((m.done / m.total) * 100)}%`)
      } else if (m.type === 'done') {
        w.terminate()
        resolve(m)
      } else {
        w.terminate()
        reject(new Error(m.message))
      }
    }
    w.onerror = (e) => {
      w.terminate()
      reject(new Error(e.message || '계산 중 오류'))
    }
    w.postMessage(job)
  })
}

export async function networkAround(
  config: VWorldConfig,
  center: [number, number],
  displayR: number,
  onProgress?: (text: string) => void,
): Promise<NetworkResult> {
  const fetchR = networkRadius(displayR)
  onProgress?.(`반경 ${(fetchR / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}km 도로중심선 받는 중`)
  const r = await queryFeatures(config, {
    layerId: NETWORK_LAYER,
    geomFilter: queryPolygonWkt(radiusCircle(center, fetchR), 90),
    geometry: true,
    attribute: false,
    maxFeatures: 40000,
  })
  const proj = localProj(center[0], center[1])
  const lines: XY[][] = []
  for (const f of r.features) for (const l of linesOf(f.geometry as Geometry | null)) if (l.length >= 2) lines.push(l.map((p) => toXY(proj, p)))
  if (lines.length < 10) throw new Error('도로중심선이 너무 적어 길의 연결을 계산할 수 없습니다')
  onProgress?.(`도로중심선 ${lines.length.toLocaleString('ko-KR')}개로 계산 중`)
  const done = await runWorker({ lines, displayR, walkR: WALK_R, wideBuffer: WIDE_BUFFER, maxOrigins: MAX_ORIGINS }, onProgress)
  return {
    center,
    fetchR,
    displayR,
    walkR: WALK_R,
    wideBuffer: WIDE_BUFFER,
    features: r.features.length,
    total: r.total,
    truncated: r.truncated,
    url: r.url,
    edges: done.edges,
    nachWalk: done.nachWalk,
    nachWide: done.nachWide,
    originsWalk: done.originsWalk,
    originsWide: done.originsWide,
    wideEdges: done.wideEdges,
  }
}
