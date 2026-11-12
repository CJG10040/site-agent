// 15-B 콘타 모형: 화면 쪽 도우미 — 설정 기본값·모형 크기 후보, 대지 모형에서 계산 입력 만들기, 작업자 스레드 돌리기.

import type { ContourSettings } from '../model/types'
import { SHEET_MARGIN, type ContourInput, type ContourPlan } from './contour'
import type { ContourMessage } from './contour.worker'
import type { SiteModel, XY } from './siteModel'

export const DEFAULT_CONTOUR: ContourSettings = { scale: 500, thickness: 3, sheetW: 600, sheetH: 900, sizeMm: 0, roads: 'engrave' }
export const SCALE_OPTIONS = [200, 300, 500, 1000, 2000]
export const THICK_OPTIONS = [1, 2, 3, 5]
/** 모형 한 변 후보 (mm) */
const SIZE_MM = [200, 300, 400, 450, 500, 600, 750, 900]

export const ROAD_MODE_LABEL: Record<ContourSettings['roads'], string> = {
  engrave: '새김선',
  pieces: '따로 자른 조각',
  cutout: '파내기',
}
export const ROAD_MODE_NOTE: Record<ContourSettings['roads'], string> = {
  engrave: '도로 가장자리를 판 위에 새김선(파랑)으로',
  pieces: '판마다 드러난 도로를 얇은 재료(1mm 안팎)로 따로 잘라 붙임 — 붙일 자리는 새김',
  cutout: '판마다 드러난 도로를 도려내 한 판 아래로 내려앉힘 (맨 아래 판은 새김)',
}

export function contourSettingsOf(s: Partial<ContourSettings> | undefined): ContourSettings {
  return { ...DEFAULT_CONTOUR, ...(s ?? {}) }
}

/** 실제 반쪽 길이 (m) ← 모형 한 변 (mm) */
export const halfOfSize = (sizeMm: number, scale: number) => (sizeMm / 2) * (scale / 1000)

/** 고를 수 있는 모형 크기: 대지가 다 들어가고 수집 반경 안 */
export function sizeOptions(scale: number, siteFar: number, R: number): number[] {
  return SIZE_MM.filter((s) => {
    const h = halfOfSize(s, scale)
    return h <= R && h >= siteFar + 5
  })
}

/** 재료 판(여백 뺀 짧은 변)에 들어가는 가장 큰 크기, 없으면 가장 작은 것 */
export function defaultSize(opts: number[], s: Pick<ContourSettings, 'sheetW' | 'sheetH'>): number | null {
  const fit = Math.min(s.sheetW, s.sheetH) - 2 * SHEET_MARGIN
  return [...opts].reverse().find((o) => o <= fit) ?? opts[0] ?? null
}

/** 저장된 크기가 지금 고를 수 있는 것이면 그대로 (직접 입력한 값은 범위 안이면 그대로) */
export function effectiveSize(s: ContourSettings, opts: number[], siteFar: number, R: number): number | null {
  if (s.sizeMm > 0) {
    const h = halfOfSize(s.sizeMm, s.scale)
    if (h <= R && h >= siteFar + 5) return s.sizeMm
  }
  return defaultSize(opts, s)
}

/** 대지 모형(같은 범위로 만든 것)에서 계산 입력. 표본 간격은 한 변 450칸 안팎, 지형 칸보다 촘촘하게 */
export function contourInputOf(m: SiteModel, s: ContourSettings): ContourInput {
  const half = m.half
  const side = 2 * half
  const cell = m.terrain?.cell ?? 10
  const res = Math.min(cell, Math.max(0.25, side / 450))
  const n = Math.min(801, Math.round(side / res) + 1)
  const step = side / (n - 1)
  const z = new Float32Array(n * n)
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) z[r * n + c] = m.zAt(-half + c * step, half - r * step)
  const buildings: XY[][] = []
  for (const b of m.buildings) for (const p of b.parts) buildings.push(p.outer, ...p.holes)
  return {
    half,
    n,
    z,
    roads: m.roads,
    buildings,
    site: m.site.flatMap((p) => [p.outer, ...p.holes]),
    scale: s.scale,
    thickness: s.thickness,
    sheetW: s.sheetW,
    sheetH: s.sheetH,
    roadMode: s.roads,
  }
}

/** 작업자 스레드에서 계산. cancel()이면 멈추고 결과를 버림 */
export function runContour(inp: ContourInput, onProgress?: (text: string) => void): { promise: Promise<ContourPlan>; cancel: () => void } {
  const w = new Worker(new URL('./contour.worker.ts', import.meta.url), { type: 'module' })
  let cancel = () => {}
  const promise = new Promise<ContourPlan>((resolve, reject) => {
    cancel = () => {
      w.terminate()
      reject(new Error('cancelled'))
    }
    w.onmessage = (ev: MessageEvent<ContourMessage>) => {
      const m = ev.data
      if (m.type === 'progress') onProgress?.(m.text)
      else if (m.type === 'done') {
        w.terminate()
        resolve(m.plan)
      } else {
        w.terminate()
        reject(new Error(m.message))
      }
    }
    w.onerror = (e) => {
      w.terminate()
      reject(new Error(e.message || '계산 중 오류'))
    }
    w.postMessage(inp, [inp.z.buffer])
  })
  return { promise, cancel }
}
