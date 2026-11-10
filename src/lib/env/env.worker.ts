// 환경 계산 전체를 화면이 멈추지 않게 따로 돈다: 일조시간(대지 주변 2m·반경 4m) → 개방감 → 대지 하늘 → 가시권 → 수목 → 바람 실험 → 열쾌적 실험.

import type { XY } from '../network'
import { buildModel, shadowAt, skyDome, skyViewMap, sunHours, terrainHorizon, visibleHeight, type EnvBuilding, type SunStep } from './compute'
import { cellAt, cellXY, gridAround, packGrid, type GridSpec, type LocalTerrain, type PackedGrid } from './grid'
import { lbmWind } from './lbm'
import { utciAt } from './thermal'
import { detectTrees } from './trees'

export interface EnvJob {
  R: number
  proj: { lon0: number; lat0: number; kx: number; ky: number }
  site: XY[][]
  buildings: EnvBuilding[]
  terrain: LocalTerrain | null
  sun: { summer: SunStep[]; equinox: SunStep[]; winter: SunStep[] }
  thermal: { alt: number; az: number; ta: number; rh: number; ws: number } | null
  winds: { season: string; fromAz: number }[]
  tileUrl: string | null
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
  fine: SunSet
  coarse: SunSet & { svf: PackedGrid; view: PackedGrid; utci: PackedGrid | null; tmrt: PackedGrid | null }
  sky: { horizon: number[]; svf: number }
  trees: PackedGrid | null
  treeTiles: number
  treeFailed: number
  winds: WindOut[]
  terrainFlat: boolean
  ms: Record<string, number>
}

export type EnvMessage = { type: 'progress'; text: string } | { type: 'done'; out: EnvOutput } | { type: 'error'; message: string }

const post = (m: EnvMessage) => (self as unknown as Worker).postMessage(m)

function sunSet(job: EnvJob, g: GridSpec, label: string, hz: ReturnType<typeof terrainHorizon>): SunSet {
  const m = buildModel(g, job.buildings, job.terrain, job.site)
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
    const hz = terrainHorizon(job.terrain, job.R + 100)
    lap('horizon')

    const fineG = gridAround(200, 2)
    const fine = sunSet(job, fineG, '대지 주변', hz)
    lap('sunFine')
    const coarseG = gridAround(job.R, 4)
    const coarseSun = sunSet(job, coarseG, '반경 전체', hz)
    lap('sunCoarse')

    const cm = buildModel(coarseG, job.buildings, job.terrain, job.site)
    post({ type: 'progress', text: '개방감' })
    const svf = skyViewMap(cm, hz)
    lap('svf')
    const sky = skyDome(job.buildings, job.terrain, hz)
    lap('sky')
    post({ type: 'progress', text: '높이별 가시권' })
    const view = visibleHeight(cm)
    lap('view')

    // 수목
    let trees: { mask: Uint8Array; tiles: number; failed: number } | null = null
    const treeG = gridAround(job.R, 2)
    if (job.tileUrl) {
      post({ type: 'progress', text: '수목 (위성영상 받는 중)' })
      trees = await detectTrees({ tileUrl: job.tileUrl, ...job.proj, g: treeG }, job.buildings, (f) =>
        post({ type: 'progress', text: `수목 (위성영상 ${Math.round(f * 100)}%)` }),
      )
    }
    lap('trees')

    // 바람 실험
    const side = Math.min(job.R * 2, 800)
    const solidAt = (x: number, y: number) => {
      const k = cellAt(coarseG, x, y)
      return k >= 0 && cm.bld[k] > 0
    }
    const winds: WindOut[] = []
    const flows: ReturnType<typeof lbmWind>[] = []
    for (const w of job.winds) {
      post({ type: 'progress', text: `바람 흐름 실험 (${w.season})` })
      const f = lbmWind(solidAt, w.fromAz, side, {
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

    // 열쾌적 실험 (여름 바람 결과가 있으면 그 속도 비를 씀)
    let utciG: PackedGrid | null = null
    let tmrtG: PackedGrid | null = null
    if (job.thermal) {
      post({ type: 'progress', text: '열쾌적 실험' })
      const th = job.thermal
      const sh = shadowAt(cm, job.buildings, hz, new Int32Array(coarseG.nx * coarseG.ny).fill(-1), th)
      // 지형 그림자는 지평선 칸을 다시 찾아 확인
      const tanAlt = Math.tan((th.alt * Math.PI) / 180)
      const summer = flows[job.winds.findIndex((w) => w.season === '여름')] ?? flows[0]
      const N = coarseG.nx * coarseG.ny
      const u = new Float32Array(N).fill(NaN)
      const tm = new Float32Array(N).fill(NaN)
      for (let k = 0; k < N; k++) {
        if (cm.bld[k] > 0) continue
        const [x, y] = cellXY(coarseG, k)
        let lit = !sh[k]
        if (lit && !hz.flat) {
          const hk = cellAt(hz, x, y)
          if (hk >= 0) {
            const f = ((((th.az % 360) + 360) % 360) / 360) * 32
            const a0 = Math.floor(f) % 32
            const tt = hz.tan[hk * 32 + a0]
            if (tt > tanAlt) lit = false
          }
        }
        let tree = false
        if (trees) {
          let cnt = 0
          for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as XY[]) {
            const kk = cellAt(treeG, x + dx, y + dy)
            if (kk >= 0 && trees.mask[kk]) cnt++
          }
          tree = cnt >= 2
        }
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
        const r = utciAt({ ta: th.ta, rh: th.rh, alt: th.alt, ws: th.ws }, lit, Number.isFinite(svf[k]) ? svf[k] : 0.5, tree, ratio)
        u[k] = r.utci
        tm[k] = r.tmrt
      }
      utciG = packGrid(coarseG, u, 0.25)
      tmrtG = packGrid(coarseG, tm, 0.5)
    }
    lap('thermal')

    post({
      type: 'done',
      out: {
        fine,
        coarse: { ...coarseSun, svf: packGrid(coarseG, svf, 1 / 250), view: packGrid(coarseG, view, 1), utci: utciG, tmrt: tmrtG },
        sky,
        trees: trees ? packGrid(treeG, trees.mask, 1) : null,
        treeTiles: trees?.tiles ?? 0,
        treeFailed: trees?.failed ?? 0,
        winds,
        terrainFlat: hz.flat,
        ms,
      },
    })
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
