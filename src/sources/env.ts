// 환경 계산 준비·실행 (화면 쪽): 수집이 끝난 프로젝트에서 건물·지형·태양 위치·바람·여름 오후 조건을 모아 Worker로 보낸다.
// 대지 안 기존 건물은 없다고 보고(새로 지을 땅) 계산한다.

import { bldHeight, buildDiagramData } from '../diagrams/data'
import type { EnvBuilding, SunStep } from '../lib/env/compute'
import type { EnvJob, EnvMessage, EnvOutput } from '../lib/env/env.worker'
import type { LocalTerrain } from '../lib/env/grid'
import { wgs84ToUtmk } from '../lib/proj'
import { sunAt, sunAtDate, SUN_DAYS } from '../lib/sun'
import { sampleAt, terrainAround, type TerrainGrid } from '../lib/terrain'
import { fineHalfFor, fineTerrainCached } from '../lib/terrainFine'
import { arealRings, localProj } from '../lib/xy'
import type { Project } from '../model/types'
import type { VWorldConfig } from './vworld'
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
  /** 건물 자료 (수치지도를 올렸으면 함께) */
  buildingSource?: string
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
async function localTerrain(lon: number, lat: number, halfM: number, fine: TerrainGrid | null = null): Promise<{ t: LocalTerrain; source: string } | null> {
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
  const zf = fine ? sampleAt(fine, fine.z, o[0], o[1]) : NaN
  const z0 = Number.isFinite(zf) ? zf : sampleAt(grid, grid.z, o[0], o[1])
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
  if (fine) {
    // 대지 주변 2m (수치지도) — 같은 1차식으로 지역 좌표에 다시 담는다
    const fc = 2
    const half = Math.min(halfM, (Math.min(fine.nx, fine.ny) * fine.cell) / 2)
    const m = Math.ceil((half * 2) / fc)
    const f: LocalTerrain = { x0: -(m * fc) / 2, y0: (m * fc) / 2, cell: fc, nx: m, ny: m, z: new Float32Array(m * m) }
    for (let r = 0; r < m; r++)
      for (let c = 0; c < m; c++) {
        const x = f.x0 + (c + 0.5) * fc
        const y = f.y0 - (r + 0.5) * fc
        const v = sampleAt(fine, fine.z, o[0] + ax * x + bx * y, o[1] + ay * x + by * y)
        f.z[r * m + c] = Number.isFinite(v) ? v - z0 : NaN
      }
    t.fine = f
    return { t, source: `국토지리정보원 수치지도${fine.version ? `(${fine.version}년)` : ''} 2m(대지 주변, 옹벽 단차 반영) + 10m 격자` }
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

/**
 * 바람 실험 도판 반경 — 대지 크기에 맞춤 (2026-11-12 사용자 요청: '대지의 크기를 판단하여 스케일을 정하도록').
 * 대지 가장 먼 꼭짓점 거리의 2배 또는 +150m 중 큰 것, 최소 250m·최대 800m.
 * 수집 반경 밖에는 건물 자료가 없으므로 수집 반경을 넘는 것은 대지가 커서 꼭 필요할 때만(대지 끝 + 80m까지).
 */
export const WIND_R_MIN = 250
export const WIND_R_MAX = 800
/** 바람 계산 영역은 도판보다 넓게: 반경 최소 300m (바람이 오는 쪽 건물까지 넣으려고) */
export const WIND_DOMAIN_MIN = 300

export function windRadius(R: number, siteFar: number): number {
  const want = Math.max(siteFar * 2, siteFar + 150)
  const cap = Math.max(R, siteFar + 80)
  return Math.min(WIND_R_MAX, Math.max(WIND_R_MIN, Math.ceil(Math.min(want, cap) / 10) * 10))
}

export async function computeEnv(project: Project, config: VWorldConfig, onProgress: (t: string) => void): Promise<EnvResult> {
  void config
  const d = buildDiagramData(project)
  if (!d) throw new Error('대지가 정해지지 않았습니다')
  if (!d.buildings.length) throw new Error("'주변 건물' 자료가 없어 계산할 수 없습니다")
  const [lon, lat] = d.center
  const p = localProj(lon, lat)
  const R = d.R
  // 대지 안 기존 건물과 지하만 있는 시설(지하상가·역)은 뺀다
  const buildings: EnvBuilding[] = d.buildings
    .filter((b) => !b.onSite && !b.underground)
    .map((b) => ({ rings: arealRings(p, b.geom), h: bldHeight(b) ?? UNKNOWN_H }))
  const unknownHeights = d.buildings.filter((b) => !b.onSite && !b.underground && bldHeight(b) === null).length
  onProgress('지형 받는 중')
  const fine = fineTerrainCached(d.ngii, d.center, fineHalfFor(R))
  const terr = await localTerrain(lon, lat, R + 2100, fine).catch(() => null)
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
  const site = arealRings(p, d.boundary)
  // 대지가 다 보이도록: 대지 꼭짓점 중 가장 먼 곳 + 60m (최소 200m, 최대 600m)
  const far = Math.max(0, ...site.flat().map(([x, y]) => Math.hypot(x, y)))
  const fineHalf = Math.min(600, Math.max(200, Math.ceil((far + 60) / 10) * 10))
  const job: EnvJob = {
    R,
    proj: p,
    site,
    buildings,
    terrain: terr?.t ?? null,
    sun: { summer: steps(lon, lat, 'summer'), equinox: steps(lon, lat, 'equinox'), winter: steps(lon, lat, 'winter') },
    thermal: hot ? { alt: ts.altitude, az: ts.azimuth, ta: hot.ta, rh: hot.rh, ws: hot.ws } : null,
    winds,
    fineHalf,
    windR: windRadius(R, far),
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
    buildingSource: d.ngii && d.ngii.pick.bldg !== 'vworld' ? `국토지리정보원 수치지도${d.ngii.bldgText ? ` ${d.ngii.bldgText}` : d.ngii.year ? `(${d.ngii.year}년)` : ''}·GIS건물통합정보` : 'GIS건물통합정보',
    thermal: hot
      ? { ta: hot.ta, rh: hot.rh, ws: hot.ws, days: hot.days, alt: ts.altitude, az: ts.azimuth, label: `${THERMAL_DAY.month}월 ${THERMAL_DAY.day}일 ${THERMAL_DAY.hour}시` }
      : null,
  }
}

export function windName(az: number): string {
  return DIR16[Math.round(az / 22.5) % 16]
}
