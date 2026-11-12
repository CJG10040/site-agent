// 수치지도(국토지리정보원 1:5,000 수치지도 2.0)를 올렸을 때: 원자료 보관, 출처 기록, 사실 카드.
// 올린 도엽은 다시 수집해도(같은 대지면) 남긴다 — DataStep이 수집 뒤 refreshNgiiFacts를 다시 부른다.

import { buildDiagramData, inNgii } from '../diagrams/data'
import { centroidOf } from '../diagrams/frame'
import { sheetBounds } from '../lib/mapSheet'
import { arealRings, localProj, lineToRingsDist, pointInRings, pointToRingsDist, toXY } from '../lib/xy'
import { NGII_KEYS, ngiiLayer, type NgiiSheet } from '../sources/ngiiMap'
import { upsertDrafts, type DraftFact } from './applyCollection'
import { apiSource } from './applyNearby'
import { nextNumber, nowIso, siteKey } from './project'
import { fmt } from './textUtil'
import type { Project } from './types'

export const NGII_FACT_KEYS = ['ngii-bldg', 'ngii-wall', 'ngii-spot']
const NGII_SOURCE_ID = 'ngii:map'

export function hasNgii(project: Project): boolean {
  return (project.collected[ngiiLayer('sheets')]?.features.length ?? 0) > 0
}

/** 올린 도엽들을 프로젝트에 넣는다 (같은 도엽은 바꿔 끼움) */
export function applyNgiiSheets(project: Project, sheets: NgiiSheet[], radiusM: number): void {
  const codes = new Set(sheets.map((s) => s.code))
  const t = nowIso()
  const next = { ...project.collected }
  for (const k of NGII_KEYS) {
    const id = ngiiLayer(k)
    const prev = (next[id]?.features ?? []).filter((f) => !codes.has(String(f.properties.sheet)))
    const add = sheets.flatMap((s) => s.features[k] ?? [])
    if (prev.length + add.length) next[id] = { dataset_id: id, retrieved_at: t, features: [...prev, ...add] }
    else delete next[id]
  }
  const sid = ngiiLayer('sheets')
  const prevSheets = (next[sid]?.features ?? []).filter((f) => !codes.has(String(f.properties.code)))
  next[sid] = {
    dataset_id: sid,
    retrieved_at: t,
    features: [
      ...prevSheets,
      ...sheets.map((s) => {
        // 1:1,000은 파일 머리의 범위, 1:5,000은 도엽 번호로
        const b = s.boundsLL ?? sheetBounds(s.code)
        return {
          type: 'Feature' as const,
          geometry: b
            ? {
                type: 'Polygon' as const,
                coordinates: [
                  [
                    [b[0], b[1]],
                    [b[2], b[1]],
                    [b[2], b[3]],
                    [b[0], b[3]],
                    [b[0], b[1]],
                  ],
                ],
              }
            : null,
          properties: { code: s.code, year: s.year, file: s.file, epsg: s.epsg, scale: s.scale ?? 5000, counts: s.counts, radiusM, uploadedAt: t, bounds: b, siteKey: siteKey(project.site) },
        }
      }),
    ],
  }
  project.collected = next
  refreshNgiiFacts(project)
}

export function removeNgii(project: Project): void {
  const next = { ...project.collected }
  for (const k of [...NGII_KEYS, 'sheets'] as const) delete next[ngiiLayer(k)]
  project.collected = next
  project.cards = project.cards.filter((c) => !(c.auto_key && NGII_FACT_KEYS.includes(c.auto_key) && c.origin === 'data' && !c.edited && !c.user_note.trim()))
  project.sources = project.sources.filter((s) => s.dataset_id !== NGII_SOURCE_ID || project.cards.some((c) => c.related_source_ids.includes(s.source_id)))
}

/** 출처 기록과 사실 카드를 지금 올린 도엽에 맞춘다 */
export function refreshNgiiFacts(project: Project): void {
  if (!hasNgii(project)) return
  const sheets = project.collected[ngiiLayer('sheets')].features.map((f) => f.properties)
  const codes = sheets.map((p) => String(p.code)).sort()
  const years = [...new Set(sheets.map((p) => String(p.year ?? '')).filter(Boolean))].sort()
  const scales = [...new Set(sheets.map((p) => Number(p.scale) || 5000))].sort((a, b) => b - a)
  const scaleText = scales.map((s) => `1:${s.toLocaleString('ko-KR')}`).join('·')
  const R = project.collectedRadiusM ?? project.site.radiusM
  const src = apiSource({
    source_name: '국토지리정보원 (국토정보플랫폼, 사용자가 올린 파일)',
    dataset_name: `${scaleText} 수치지도 2.0 — 도엽 ${codes.join(', ')}${years.length ? ` (${years.join('·')}년)` : ''}`,
    dataset_id: NGII_SOURCE_ID,
    retrieved_at: String(sheets[sheets.length - 1].uploadedAt ?? nowIso()),
    geometry: `대지 중심 반경 ${R}m (지형 자료는 +300m)`,
    coordinate_system: 'EPSG:5186(중부원점) → EPSG:4326',
    spatial_scale: scaleText,
    license: '국토지리정보원 공간정보 (출처 표기)',
    limitations:
      '사진측량 수치지도로 도엽 제작 시점의 현황이며 이후 바뀐 것은 반영되지 않는다. 무벽건물(지붕만)·가건물은 건물 통계·계산에서 뺐다. 사용승인연도·세부 용도는 겹치는 브이월드 건물에서 가져왔다. 옹벽·석축의 낮은 쪽은 선을 그린 방향(오른쪽이 낮음)으로 판단했다.',
    original_url: 'https://map.ngii.go.kr/',
    reliability: 'official',
    feature_count: NGII_KEYS.reduce((n, k) => n + (project.collected[ngiiLayer(k)]?.features.length ?? 0), 0),
  })
  const prev = project.sources.find((s) => s.dataset_id === NGII_SOURCE_ID)
  let srcId: string
  if (prev) {
    Object.assign(prev, { ...src, source_id: prev.source_id })
    srcId = prev.source_id
  } else {
    srcId = nextNumber(project, 'S')
    project.sources.push({ ...src, source_id: srcId })
  }
  upsertDrafts(project, ngiiDrafts(project, srcId, R))
}

function ngiiDrafts(project: Project, srcId: string, R: number): DraftFact[] {
  const d = buildDiagramData(project)
  if (!d?.ngii) return []
  const n = d.ngii
  const p = localProj(d.center[0], d.center[1])
  const site = arealRings(p, d.boundary)
  const inR = (lon: number, lat: number) => Math.hypot(...toXY(p, [lon, lat])) <= R
  const F = (auto_key: string, topic: string, text: string): DraftFact => ({
    auto_key,
    type: 'FACT',
    topic,
    text,
    sources: [srcId],
    confidence: 'high',
    human_validation_required: false,
  })
  const out: DraftFact[] = []

  // 건물: 도엽 안·반경 안에서 수치지도와 브이월드 건물 수 비교
  const ngiiIn = d.buildings.filter((b) => {
    if (b.src !== 'ngii') return false
    const c = centroidOf(b.geom)
    return !!c && inR(c[0], c[1])
  })
  const vworldIn = (project.collected['LT_C_BLDGINFO']?.features ?? []).filter((f) => {
    const c = centroidOf(f.geometry)
    return !!c && inNgii(n, c[0], c[1]) && inR(c[0], c[1])
  }).length
  const minorIn = n.minor.filter((g) => {
    const c = centroidOf(g)
    return !!c && inR(c[0], c[1])
  }).length
  if (ngiiIn.length) {
    const diff = ngiiIn.length - vworldIn
    const cmp = vworldIn ? ` 같은 범위의 브이월드 건물통합정보(${fmt(vworldIn)}동)보다 ${fmt(Math.abs(diff))}동 ${diff >= 0 ? '많은데' : '적은데'}, 신축·멸실이나 건물을 나누는 방식 차이일 수 있다.` : ''
    out.push(
      F(
        'ngii-bldg',
        '주변 건물',
        `수치지도(${n.year ?? '제작 연도 미상'}) 기준 반경 ${R}m 안 건물은 ${fmt(ngiiIn.length)}동이다(지붕만 있는 구조물·가건물 ${fmt(minorIn)}동 제외, 올린 도엽 안).${cmp}`,
      ),
    )
  }

  // 옹벽·석축·제방: 대지 경계 50m 안
  const near = n.walls
    .filter((w) => w.top)
    .map((w) => {
      const parts = w.geom.type === 'LineString' ? [w.geom.coordinates] : w.geom.coordinates
      const xy = parts.map((pts) => pts.map((c) => toXY(p, c)))
      const dist = Math.min(...xy.map((l) => lineToRingsDist(l, site)))
      const len = xy.reduce((s, l) => s + l.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - l[i][0], q[1] - l[i][1]), 0), 0)
      const insideSite = xy.some((l) => l.some((q) => pointInRings(q, site)))
      return { ...w, dist, len, insideSite }
    })
    .filter((w) => w.dist <= 50)
  if (near.length) {
    const hs = near.map((w) => w.h).filter((h): h is number => h !== null && h > 0)
    const kinds = [...new Set(near.map((w) => w.kind))].join('·')
    const inside = near.filter((w) => w.insideSite).length
    out.push(
      F(
        'ngii-wall',
        '지형',
        `대지 경계 50m 안에 ${kinds} ${fmt(near.length)}곳(길이 합 약 ${fmt(Math.round(near.reduce((s, w) => s + w.len, 0) / 5) * 5)}m${hs.length ? `, 높이 ${Math.min(...hs) === Math.max(...hs) ? fmt(hs[0], 1) : `${fmt(Math.min(...hs), 1)}~${fmt(Math.max(...hs), 1)}`}m` : ''})이 있다${inside ? `. 그중 ${fmt(inside)}곳은 대지 안을 지난다` : ''}.`,
      ),
    )
  } else {
    out.push(F('ngii-wall', '지형', '수치지도에는 대지 경계 50m 안에 옹벽·석축·제방이 없다.'))
  }

  // 표고점: 대지 100m 안
  const spots = n.spots.filter((s) => pointToRingsDist(toXY(p, [s.lon, s.lat]), site) <= 100)
  if (spots.length >= 2) {
    const zs = spots.map((s) => s.z)
    const lo = Math.min(...zs)
    const hi = Math.max(...zs)
    const inside = spots.filter((s) => pointInRings(toXY(p, [s.lon, s.lat]), site)).length
    out.push(
      F(
        'ngii-spot',
        '지형',
        `대지 경계 100m 안 표고점 ${fmt(spots.length)}개(대지 안 ${fmt(inside)}개)의 해발은 ${fmt(lo, 1)}~${fmt(hi, 1)}m로 ${fmt(hi - lo, 1)}m 차이가 난다.`,
      ),
    )
  }
  return out
}
