// 환경 계산 준비·실행 (화면 쪽): 수집이 끝난 프로젝트에서 건물·지형·태양 위치·바람·여름 오후 조건을 모아 Worker로 보낸다.
// 대지 안 기존 건물은 없다고 보고(새로 지을 땅) 계산한다.

import { buildDiagramData } from '../diagrams/data'
import type { EnvBuilding, SunStep } from '../lib/env/compute'
import type { EnvJob, EnvMessage, EnvOutput } from '../lib/env/env.worker'
import type { LocalTerrain } from '../lib/env/grid'
import { wgs84ToUtmk } from '../lib/proj'
import { sunAt, sunAtDate, SUN_DAYS } from '../lib/sun'
import { sampleAt, terrainAround } from '../lib/terrain'
import { arealRings, localProj } from '../lib/xy'
import type { Project } from '../model/types'
import { tileUrl, type VWorldConfig } from './vworld'
import { DIR16, prevailing } from './wind'

export const FLOOR_M = 3
/** 층수를 모르는 건물 높이 */
export const UNKNOWN_H = 3
/** 열쾌적 실험 시각 */
export const THERMAL_DAY = { month: 7, day: 25, hour: 15 }

export interface EnvResult extends EnvOutput {
  version: 1
  center: [number, number]
  R: number
  computedAt: string
  buildings: number
  unknownHeights: number
  terrainSource: string | null
  thermal: { ta: number; rh: number; ws: number; days: number; alt: number; az: number; label: string } | null
}

function steps(lon: number, lat: number, day: (typeof SUN_DAYS)[number]['key']): SunStep[] {
  const out: SunStep[] = []
  for (let m = 5; m < 24 * 60; m += 10) {
    const s = sunAt(lon, lat, day, m / 60)
    if (s.altitude > 0.5) out.push({ minute: m, alt: s.altitude, az: s.azimuth })
  }
  return out
}

/** 지형을 대지 중심 기준 미터 10m 칸으로 다시 담는다 (5179 ↔ 지역 좌표는 이 범위에서 1차식으로 충분) */
async function localTerrain(lon: number, lat: number, halfM: number): Promise<{ t: LocalTerrain; source: string } | null> {
  const grid = await terrainAround(lon, lat, halfM)
  if (!grid) return null
  const p = localProj(lon, lat)
  const P = (x: number, y: number) => wgs84ToUtmk(p.lon0 + x / p.kx, p.lat0 + y / p.ky)
  const o = P(0, 0)
  const ex = P(1000, 0)
  const ny = P(0, 1000)
  const ax = (ex[0] - o[0]) / 1000
  const ay = (ex[1] - o[1]) / 1000
  const bx = (ny[0] - o[0]) / 1000
  const by = (ny[1] - o[1]) / 1000
  const z0 = sampleAt(grid, grid.z, o[0], o[1])
  if (!Number.isFinite(z0)) return null
  const cell = 10
  const n = Math.ceil((halfM * 2) / cell)
  const t: LocalTerrain = { x0: -(n * cell) / 2, y0: (n * cell) / 2, cell, nx: n, ny: n, z: new Float32Array(n * n) }
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const x = t.x0 + (c + 0.5) * cell
      const y = t.y0 - (r + 0.5) * cell
      const v = sampleAt(grid, grid.z, o[0] + ax * x + bx * y, o[1] + ay * x + by * y)
      t.z[r * n + c] = Number.isFinite(v) ? v - z0 : NaN
    }
  return { t, source: grid.source === 'ngii' ? `국토지리정보원 10m ${grid.version ?? ''}`.trim() : '대체 자료(AWS Terrain Tiles)' }
}

function run(job: EnvJob, onProgress: (t: string) => void): Promise<EnvOutput> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../lib/env/env.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (ev: MessageEvent<EnvMessage>) => {
      const m = ev.data
      if (m.type === 'progress') onProgress(m.text)
      else if (m.type === 'done') {
        w.terminate()
        resolve(m.out)
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

export async function computeEnv(project: Project, config: VWorldConfig, onProgress: (t: string) => void): Promise<EnvResult> {
  const d = buildDiagramData(project)
  if (!d) throw new Error('대지가 정해지지 않았습니다')
  if (!d.buildings.length) throw new Error("'주변 건물' 자료가 없어 계산할 수 없습니다")
  const [lon, lat] = d.center
  const p = localProj(lon, lat)
  const R = d.R
  const buildings: EnvBuilding[] = d.buildings
    .filter((b) => !b.onSite)
    .map((b) => ({ rings: arealRings(p, b.geom), h: b.floors && b.floors > 0 ? b.floors * FLOOR_M : UNKNOWN_H }))
  const unknownHeights = d.buildings.filter((b) => !b.onSite && !(b.floors && b.floors > 0)).length
  onProgress('지형 받는 중')
  const terr = await localTerrain(lon, lat, R + 2100).catch(() => null)
  const wind = d.wind
  const winds: EnvJob['winds'] = []
  if (wind) {
    for (const [season, i] of [
      ['여름', 2],
      ['겨울', 4],
    ] as const) {
      const t = wind.tables[i]
      if (t?.hours) winds.push({ season, fromAz: prevailing(t).dir * 22.5 })
    }
  }
  const hot = wind?.hot ?? null
  const ts = sunAtDate(lon, lat, THERMAL_DAY.month, THERMAL_DAY.day, THERMAL_DAY.hour)
  const job: EnvJob = {
    R,
    proj: p,
    site: arealRings(p, d.boundary),
    buildings,
    terrain: terr?.t ?? null,
    sun: { summer: steps(lon, lat, 'summer'), equinox: steps(lon, lat, 'equinox'), winter: steps(lon, lat, 'winter') },
    thermal: hot ? { alt: ts.altitude, az: ts.azimuth, ta: hot.ta, rh: hot.rh, ws: hot.ws } : null,
    winds,
    tileUrl: config.key.trim() ? tileUrl(config.key, 'Satellite') : null,
  }
  const out = await run(job, onProgress)
  return {
    ...out,
    version: 1,
    center: d.center,
    R,
    computedAt: new Date().toISOString(),
    buildings: buildings.length,
    unknownHeights,
    terrainSource: terr?.source ?? null,
    thermal: hot
      ? { ta: hot.ta, rh: hot.rh, ws: hot.ws, days: hot.days, alt: ts.altitude, az: ts.azimuth, label: `${THERMAL_DAY.month}월 ${THERMAL_DAY.day}일 ${THERMAL_DAY.hour}시` }
      : null,
  }
}

export function windName(az: number): string {
  return DIR16[Math.round(az / 22.5) % 16]
}
