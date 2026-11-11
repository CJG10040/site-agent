// 환경 계산 전체를 화면이 멈추지 않게 따로 돈다:
// 일조시간(대지 주변 세밀·반경 4m) → 개방감 → 대지 하늘 → 가시권 → 바람 실험(보행 높이) → 열쾌적 실험(대지 주변 세밀).

import type { XY } from '../network'
import { buildModel, shadowAt, skyDome, skyViewMap, sunHours, terrainHorizon, visibleHeight, type EnvBuilding, type Model, type SunStep } from './compute'
import { cellAt, cellXY, gridAround, packGrid, type GridSpec, type LocalTerrain, type PackedGrid } from './grid'
import { lbmWind } from './lbm'
import { utciAt } from './thermal'

export interface EnvJob {
  R: number
  proj: { lon0: number; lat0: number; kx: number; ky: number }
  site: XY[][]
  buildings: EnvBuilding[]
  terrain: LocalTerrain | null
  sun: { summer: SunStep[]; equinox: SunStep[]; winter: SunStep[] }
  thermal: { alt: number; az: number; ta: number; rh: number; ws: number } | null
  winds: { season: string; fromAz: number }[]
  /** 대지 주변 세밀 칸의 반 폭(m) — 대지가 다 보이게 */
  fineHalf: number
  /** 바람 실험 도판 반경(m) */
  windR: number
}

export interface SunSet {
  summer: PackedGrid
  equinox: PackedGrid
  winter: PackedGrid
  /** 동지 09~15시 최장 연속 일조 분, 08~16시 합계 분 */
  cont: PackedGrid
  total: PackedGrid
}

export interface WindOut {
  season: string
  fromAz: number
  stable: boolean
  d: XY
  l: XY
  /** 격자 좌표: x = 흐름 방향, y = 왼쪽 */
  ratio: PackedGrid
}

export interface EnvOutput {
  fine: SunSet & { utci?: PackedGrid | null }
  coarse: SunSet & { svf: PackedGrid; view: PackedGrid; utci: PackedGrid | null; tmrt: PackedGrid | null }
  sky: { horizon: number[]; svf: number }
  /** (Phase 10 첫판의 위성영상 수목 — 지금은 계산하지 않음) */
  trees: PackedGrid | null
  treeTiles: number
  treeFailed: number
  winds: WindOut[]
  /** 바람 실험 도판 반경 */
  windR?: number
  terrainFlat: boolean
  ms: Record<string, number>
}

export type EnvMessage = { type: 'progress'; text: string } | { type: 'done'; out: EnvOutput } | { type: 'error'; message: string }

const post = (m: EnvMessage) => (self as unknown as Worker).postMessage(m)

function sunSet(job: EnvJob, m: Model, label: string, hz: ReturnType<typeof terrainHorizon>): SunSet {
  const g = m.g
  post({ type: 'progress', text: `일조시간 (${label}) 동지` })
  const w = sunHours(m, job.buildings, hz, job.sun.winter, true)
  post({ type: 'progress', text: `일조시간 (${label}) 춘·추분` })
  const e = sunHours(m, job.buildings, hz, job.sun.equinox, false)
  post({ type: 'progress', text: `일조시간 (${label}) 하지` })
  const s = sunHours(m, job.buildings, hz, job.sun.summer, false)
  return {
    winter: packGrid(g, w.minutes, 10),
    equinox: packGrid(g, e.minutes, 10),
    summer: packGrid(g, s.minutes, 10),
    cont: packGrid(g, w.cont0915!, 10),
    total: packGrid(g, w.total0816!, 10),
  }
}

self.onmessage = async (ev: MessageEvent<EnvJob>) => {
  const job = ev.data
  const ms: Record<string, number> = {}
  let t0 = performance.now()
  const lap = (k: string) => {
    const t = performance.now()
    ms[k] = Math.round(t - t0)
    t0 = t
  }
  try {
    post({ type: 'progress', text: '지형 지평선' })
    const hz = terrainHorizon(job.terrain, Math.max(job.R, job.fineHalf) + 100)
    lap('horizon')

    // 대지 주변 세밀 칸: 2m (넓은 대지는 칸 수가 300×300을 넘지 않게 키움)
    const fineCell = Math.max(2, Math.ceil(((job.fineHalf * 2) / 300) * 2) / 2)
    const fineG = gridAround(job.fineHalf, fineCell)
    const fm = buildModel(fineG, job.buildings, job.terrain, job.site)
    const fine = sunSet(job, fm, '대지 주변', hz)
    lap('sunFine')
    const coarseG = gridAround(job.R, 4)
    const cm = buildModel(coarseG, job.buildings, job.terrain, job.site)
    const coarseSun = sunSet(job, cm, '반경 전체', hz)
    lap('sunCoarse')

    post({ type: 'progress', text: '개방감' })
    const svf = skyViewMap(cm, hz)
    lap('svf')
    const sky = skyDome(job.buildings, job.terrain, hz)
    lap('sky')
    post({ type: 'progress', text: '높이별 가시권' })
    const view = visibleHeight(cm)
    lap('view')

    // 바람 실험: 도판 원(windR)을 어느 방향에서도 다 덮게 정사각 영역 + 들어오고 나가는 여유.
    // 작은 대지는 도판을 가까이 잡아도 계산은 반경 300m 이상으로 (바람이 오는 쪽 건물까지)
    const side = Math.max(job.windR, 300) * 2 + 120
    const heightAt = (x: number, y: number) => {
      const k = cellAt(coarseG, x, y)
      return k >= 0 ? cm.bld[k] : 0
    }
    const winds: WindOut[] = []
    const flows: ReturnType<typeof lbmWind>[] = []
    for (const w of job.winds) {
      post({ type: 'progress', text: `바람 흐름 실험 (${w.season})` })
      const f = lbmWind(heightAt, w.fromAz, side, {
        n: Math.max(140, Math.min(300, Math.round(side / 3.5))),
        steps: 2600,
        avg: 900,
        onProgress: (p) => post({ type: 'progress', text: `바람 흐름 실험 (${w.season}) ${Math.round(p * 100)}%` }),
      })
      flows.push(f)
      const spec: GridSpec = { x0: -side / 2, y0: side / 2, cell: f.cell, nx: f.n, ny: f.n }
      // 격자 행 j = 왼쪽 방향 → 저장은 위쪽(y0)부터라 행을 뒤집는다
      const flipped = new Float32Array(f.n * f.n)
      for (let j = 0; j < f.n; j++) for (let i = 0; i < f.n; i++) flipped[(f.n - 1 - j) * f.n + i] = f.ratio[j * f.n + i]
      winds.push({ season: w.season, fromAz: w.fromAz, stable: f.stable, d: f.d, l: f.l, ratio: packGrid(spec, flipped, 0.02) })
    }
    lap('wind')

    // 열쾌적 실험: 대지 주변 세밀 칸 (여름 바람 실험의 속도 비를 씀)
    let utciFine: PackedGrid | null = null
    if (job.thermal) {
      post({ type: 'progress', text: '열쾌적 실험 (개방감 계산)' })
      const th = job.thermal
      const fsvf = skyViewMap(fm, hz)
      post({ type: 'progress', text: '열쾌적 실험' })
      const hidx = new Int32Array(fineG.nx * fineG.ny)
      for (let k = 0; k < hidx.length; k++) {
        const [x, y] = cellXY(fineG, k)
        hidx[k] = cellAt(hz, x, y)
      }
      const sh = shadowAt(fm, job.buildings, hz, hidx, th)
      const summer = flows[job.winds.findIndex((w) => w.season === '여름')] ?? flows[0]
      const N = fineG.nx * fineG.ny
      const u = new Float32Array(N).fill(NaN)
      for (let k = 0; k < N; k++) {
        if (fm.bld[k] > 0) continue
        const [x, y] = cellXY(fineG, k)
        let ratio = 1
        if (summer) {
          const s = x * summer.d[0] + y * summer.d[1]
          const tt = x * summer.l[0] + y * summer.l[1]
          const i = Math.floor(s / summer.cell + summer.n / 2)
          const j = Math.floor(tt / summer.cell + summer.n / 2)
          if (i >= 0 && j >= 0 && i < summer.n && j < summer.n) {
            const v = summer.ratio[j * summer.n + i]
            if (Number.isFinite(v)) ratio = Math.min(1.5, Math.max(0.2, v))
          }
        }
        u[k] = utciAt({ ta: th.ta, rh: th.rh, alt: th.alt, ws: th.ws }, !sh[k], Number.isFinite(fsvf[k]) ? fsvf[k] : 0.5, false, ratio).utci
      }
      utciFine = packGrid(fineG, u, 0.25)
    }
    lap('thermal')

    post({
      type: 'done',
      out: {
        fine: { ...fine, utci: utciFine },
        coarse: { ...coarseSun, svf: packGrid(coarseG, svf, 1 / 250), view: packGrid(coarseG, view, 1), utci: null, tmrt: null },
        sky,
        trees: null,
        treeTiles: 0,
        treeFailed: 0,
        winds,
        windR: job.windR,
        terrainFlat: hz.flat,
        ms,
      },
    })
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
