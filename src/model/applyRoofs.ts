// 15-D 지붕 구조 조회 (2026-11-12 인터뷰: 건축물대장 지붕 구조로 어림, 조회 범위는 학생이 정함, 한 번 받으면 저장해 다시 쓰기).
// 건물 → 그 건물이 놓인 필지(연속지적도 PNU) → 건축HUB 표제부(getBrTitleInfo)의 지붕 구조(roofCdNm).
// 반경 밖·대장에 없는 건물은 규칙(1~2층 단독주택 박공, 그 밖 평지붕 + 파라펫)으로 — siteModel이 정함.

import type { DiagramData } from '../diagrams/data'
import { centroidOf } from '../diagrams/frame'
import { parcelFinder } from '../lib/parcelFind'
import { pnuToParams, publicHubUrl, roofTitlesForParcel, type RoofTitle } from '../sources/buildingRegister'
import type { ApiKeys } from '../sources/keys'
import { apiSource } from './applyNearby'
import { nextNumber, nowIso, siteKey } from './project'
import type { Project } from './types'

export const ROOF_LAYER = 'hub:roofs'
export const ROOF_RADII = [50, 100, 200, 300]
export const DEFAULT_ROOF_R = 100

/** 반경 안 건물이 놓인 필지들 (건물 수 많은 순) */
export function roofParcels(data: Pick<DiagramData, 'center' | 'buildings' | 'parcels'>, radiusM: number): { pnu: string; buildings: number }[] {
  const [lon0, lat0] = data.center
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const ky = 110574
  const find = parcelFinder(data.parcels)
  const count = new Map<string, number>()
  for (const b of data.buildings) {
    if (b.underground) continue
    const c = centroidOf(b.geom)
    if (!c) continue
    if (Math.hypot((c[0] - lon0) * kx, (c[1] - lat0) * ky) > radiusM) continue
    const pnu = find(c[0], c[1])
    if (pnu && /^\d{19}$/.test(pnu)) count.set(pnu, (count.get(pnu) ?? 0) + 1)
  }
  return [...count].map(([pnu, buildings]) => ({ pnu, buildings })).sort((a, b) => b.buildings - a.buildings)
}

/** 저장해 둔 필지별 표제부 (조회했지만 대장이 없는 필지는 빈 배열) */
export function roofData(project: Project): Record<string, RoofTitle[]> {
  const out: Record<string, RoofTitle[]> = {}
  for (const f of project.collected[ROOF_LAYER]?.features ?? []) out[String(f.properties.pnu)] = (f.properties.titles as RoofTitle[]) ?? []
  return out
}

/** 필지들을 차례로 조회 (동시에 4개씩). cancelled()가 true면 멈춤 */
export async function fetchRoofs(
  keys: ApiKeys,
  pnus: string[],
  onProgress: (done: number, total: number) => void,
  cancelled: () => boolean = () => false,
): Promise<{ pnu: string; titles: RoofTitle[]; error: string | null }[]> {
  const out: { pnu: string; titles: RoofTitle[]; error: string | null }[] = []
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < pnus.length && !cancelled()) {
      const pnu = pnus[next++]
      out.push(await roofTitlesForParcel(keys, pnu))
      done++
      onProgress(done, pnus.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, pnus.length) }, worker))
  return out
}

/** 조회 결과를 프로젝트에 저장 (같은 필지는 새 결과로, 오류 난 필지는 저장하지 않아 다음에 다시 조회) */
export function applyRoofs(project: Project, results: { pnu: string; titles: RoofTitle[]; error: string | null }[], radiusM: number): void {
  const t = nowIso()
  const sk = siteKey(project.site)
  const ok = results.filter((r) => !r.error)
  const prev = (project.collected[ROOF_LAYER]?.features ?? []).filter((f) => !ok.some((r) => r.pnu === f.properties.pnu))
  project.collected = {
    ...project.collected,
    [ROOF_LAYER]: {
      dataset_id: ROOF_LAYER,
      retrieved_at: t,
      features: [...prev, ...ok.map((r) => ({ type: 'Feature' as const, geometry: null, properties: { pnu: r.pnu, titles: r.titles, siteKey: sk, at: t } }))],
    },
  }
  project.roofRadiusM = radiusM
  const all = project.collected[ROOF_LAYER].features
  const sample = all[0]?.properties.pnu as string | undefined
  const src = apiSource({
    source_name: '국토교통부 건축HUB 건축물대장정보 (공공데이터포털)',
    dataset_name: '건축물대장 표제부 — 지붕 구조 (3D 모형 지붕 모양)',
    dataset_id: ROOF_LAYER,
    retrieved_at: t,
    geometry: `대지 중심 반경 ${radiusM}m 안 건물이 놓인 필지`,
    spatial_scale: '건물',
    limitations: '건축물대장의 지붕 구조(roofCdNm)로 박공·평지붕을 어림한다. 필지에 건물이 여럿이면 층수가 가까운 동으로 맞춘다. 대장에 없거나 반경 밖 건물은 규칙(1~2층 단독주택 박공, 그 밖 평지붕 + 파라펫).',
    original_url: sample ? publicHubUrl('getBrTitleInfo', pnuToParams(sample)) : '',
    feature_count: all.length,
    status: results.length && !ok.length ? 'error' : 'ok',
    error: results.find((r) => r.error)?.error ?? null,
  })
  const had = project.sources.find((s) => s.dataset_id === ROOF_LAYER)
  if (had) Object.assign(had, { ...src, source_id: had.source_id })
  else project.sources.push({ ...src, source_id: nextNumber(project, 'S') })
}
