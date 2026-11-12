// 15-F 정밀도로지도를 올렸을 때: 원자료 보관(겹치는 id는 한 번만), 출처 기록. 다시 수집해도(같은 대지면) 남긴다.

import { HD_KEYS, hdLayer, type HdSet } from '../sources/hdMap'
import { apiSource } from './applyNearby'
import { nextNumber, nowIso, siteKey } from './project'
import type { Project } from './types'

const HD_SOURCE_ID = 'hd:map'

export function hasHd(project: Project): boolean {
  return (project.collected[hdLayer('files')]?.features.length ?? 0) > 0
}

export function applyHdSets(project: Project, sets: HdSet[], radiusM: number): void {
  const t = nowIso()
  const next = { ...project.collected }
  for (const k of HD_KEYS) {
    const id = hdLayer(k)
    const prev = next[id]?.features ?? []
    const have = new Set(prev.map((f) => String(f.properties.id)))
    const add = sets.flatMap((s) => s.features[k] ?? []).filter((f) => !have.has(String(f.properties.id)))
    if (prev.length + add.length) next[id] = { dataset_id: id, retrieved_at: t, features: [...prev, ...add] }
  }
  const fid = hdLayer('files')
  const files = (next[fid]?.features ?? []).filter((f) => !sets.some((s) => s.file === f.properties.file))
  next[fid] = {
    dataset_id: fid,
    retrieved_at: t,
    features: [...files, ...sets.map((s) => ({ type: 'Feature' as const, geometry: null, properties: { file: s.file, sections: s.sections, counts: s.counts, radiusM, uploadedAt: t, siteKey: siteKey(project.site) } }))],
  }
  project.collected = next
  const all = next[fid].features.map((f) => f.properties)
  const sections = [...new Set(all.flatMap((p) => (p.sections as string[]) ?? []))].sort()
  const src = apiSource({
    source_name: '국토지리정보원 (국토정보플랫폼, 사용자가 올린 파일)',
    dataset_name: `정밀도로지도 — 구간 ${sections.join(', ')}`,
    dataset_id: HD_SOURCE_ID,
    retrieved_at: t,
    geometry: `대지 중심 반경 ${radiusM}m + 80m`,
    coordinate_system: 'EPSG:5179(UTM-K) → EPSG:4326',
    spatial_scale: '정밀도로지도 (cm급)',
    license: '국토지리정보원 공간정보 (출처 표기)',
    limitations: '자율주행용으로 측량한 도로 구간만 있어 범위가 띄엄띄엄이다. 측량 시점 이후 바뀐 차선은 반영되지 않는다. 차선 색·점선은 차선 유형 코드로 해석했다.',
    original_url: 'https://map.ngii.go.kr/',
    reliability: 'official',
    feature_count: HD_KEYS.reduce((n, k) => n + (next[hdLayer(k)]?.features.length ?? 0), 0),
  })
  const prev = project.sources.find((s) => s.dataset_id === HD_SOURCE_ID)
  if (prev) Object.assign(prev, { ...src, source_id: prev.source_id })
  else project.sources.push({ ...src, source_id: nextNumber(project, 'S') })
}

export function removeHd(project: Project): void {
  const next = { ...project.collected }
  for (const k of [...HD_KEYS, 'files'] as const) delete next[hdLayer(k)]
  project.collected = next
  project.sources = project.sources.filter((s) => s.dataset_id !== HD_SOURCE_ID || project.cards.some((c) => c.related_source_ids.includes(s.source_id)))
}
