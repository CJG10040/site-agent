// 도판 화면과 리포트가 함께 쓰는 그리기 훅.
// 같은 자료·설정으로 그린 도판은 모듈 안에 잠시 보관해 단계를 오갈 때 다시 그리지 않는다.

import { pickSig } from '../model/sourcePick'
import { useEffect, useMemo, useState } from 'react'
import { fineHalfFor, fineTerrainCached } from '../lib/terrainFine'
import { analyzeTerrain, type TerrainAnalysis } from '../lib/terrainSite'
import { observationsOf } from '../model/observations'
import { siteKey } from '../model/project'
import type { DiagramSettings, Project } from '../model/types'
import { designKey, envKeyOf, ENV_KEY, scenarioSig } from '../model/designs'
import { COMPARE_3D, COMPARE_IDS, COMPARE_SUN, compareIds } from './panelsCompare'
import { addsSig, lastEditAt } from '../model/edits'
import { buildDiagramData, type DiagramData } from './data'
import { synthCtxOf } from './synth'
import { svgBlob } from './export'
import { paletteKey } from './palette'
import { isOverlayId, overlaySpec } from './overlay'
import { EXPLODED_ID, explodedAz, explodedLayers, SITE_LAYER } from './exploded'
import { ORDERED_PANELS } from './panels'
import { collectedDate, renderPanel, settingsOf, type RenderedPanel } from './render'
import { panelRulesKey, rulesFor } from './panelRules'
import { fontStyleBlob, svgBlobWithFont } from '../lib/fonts'
import { lawCtxOf } from '../law/envelopeData'
import { ENVELOPE_ID } from './panelsEnvelope'

export interface CachedPanel extends RenderedPanel {
  url: string
  key: string
}

const cache = new Map<string, CachedPanel>()

/** 짧은 열쇠 (문자열 해시) */
function hashOf(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36) + s.length.toString(36)
}
const TERRAIN_IDS = new Set(['terrain', 'slopeWater', 'sectionA', 'sectionB'])
const MAX_CACHE = 80

function cachePut(p: CachedPanel) {
  cache.set(p.key, p)
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value as string
    const old = cache.get(oldest)
    if (old) URL.revokeObjectURL(old.url)
    cache.delete(oldest)
  }
}

/** 도판마다 영향을 주는 설정만 골라 열쇠로 (3D면 보는 방향도). 도판 화면이 '바뀐 도판'을 셀 때도 씀 */
export function settingsKey(id: string, s: DiagramSettings): string {
  const c = s.view3d?.includes(id) ? s.cam3d ?? {} : null
  return flatKey(id, s) + (c ? `|3d:${c.az ?? ''},${c.tilt ?? ''},${c.vex ?? ''}` : '')
}

function flatKey(id: string, s: DiagramSettings): string {
  const common = `${s.frame}|${paletteKey(s, id)}|${s.background}|${s.siteMark}`
  if (id === 'high') return `${common}|${s.highFloors}`
  if (id === 'low') return `${common}|${s.lowFloors}`
  if (id === 'sun') return `${common}|${s.sunDay}|${s.sunHour}`
  if (id === 'wind') return `${common}|${s.windSeason}`
  if (id === 'speed' || id === 'speedLocal') return `${common}|${s.speedSnap}`
  if (id === 'sunSite' || id === 'sunWide') return `${common}|${s.sunDay}|${s.fieldStyle}`
  if (id === 'viewshed') return `${common}|${s.planFloors}|${s.fieldStyle}`
  if (id === 'heat') return `${common}|${s.fieldStyle}`
  if (id === 'windSummer' || id === 'windWinter') return `${common}|${s.fieldStyle}|${s.windStyle}`
  if (id === 'terrain' || id === 'slopeWater') return `${common}|${s.fieldStyle}|${s.terrainShade}`
  if (id === 'svfMap' || id === 'noise') return `${common}|${s.fieldStyle}`
  if (id === EXPLODED_ID) {
    const ls = explodedLayers(s)
    return `${common}|${ls.join('>')}|${explodedAz(s)}|${ls.filter((x) => x !== SITE_LAYER).map((x) => settingsKey(x, s)).join('|')}`
  }
  if (isOverlayId(id)) {
    const o = overlaySpec(s, id)
    return o ? `${common}|${o.base}>${o.top}|${o.opacity}|${o.mode}|${settingsKey(o.base, s)}|${settingsKey(o.top, s)}` : common
  }
  if (id === 'synth') return `${common}|${s.fieldStyle}|${s.windStyle}|${s.terrainShade}`
  if (id === COMPARE_SUN) return `${common}|${(s.compare ?? []).join(',')}|${s.sunDay}|${s.fieldStyle}`
  if (id === ENVELOPE_ID) return `${common}|${s.cam3d?.az ?? ''},${s.cam3d?.tilt ?? ''},${s.cam3d?.vex ?? ''}`
  if (id === COMPARE_3D) return `${common}|${(s.compare ?? []).join(',')}|${s.cam3d?.az ?? ''},${s.cam3d?.tilt ?? ''},${s.cam3d?.vex ?? ''}`
  if (id === 'sectionA' || id === 'sectionB') return `${common}|${s.sectionAngle}|${s.sectionVex}|${s.sectionRange}`
  return common
}

export function useDiagrams(project: Project, vworldKey: string, only?: string[], opts: { panel?: boolean; fontsSig?: string } = {}) {
  const settings = settingsOf(project)
  // 패널 모드 (2026-11-21 묶음 D2): ⑥ 화면에서만 켬 — 보드·리포트는 늘 보통 도판
  const panel = !!opts.panel
  // 올린 글꼴이 바뀌면 그 글꼴을 쓰는 패널 도판만 다시 (묶음 D3)
  const fSig = panel ? (opts.fontsSig ?? '') : ''
  const obsSig = observationsOf(project)
    .map((o) => {
      const d = o.observation!
      return `${o.id}:${d.location ? `${d.location.lon.toFixed(6)},${d.location.lat.toFixed(6)}` : ''}:${d.discovery ? 1 : 0}:${d.links.some((l) => l.relation === 'differ') ? 1 : 0}`
    })
    .join('|')
  // 환경 계산은 수집 뒤에 따로 끝나므로 그 시각도 넣는다
  const envSig = project.collected[envKeyOf(project)]?.retrieved_at ?? ''
  // 수치지도는 수집과 따로 올리므로 그 시각도
  const ngiiSig = `${project.collected['ngii:sheets']?.retrieved_at ?? ''}${project.collected['hd:files']?.retrieved_at ?? ''}`
  // 학생이 뺀 자료가 바뀌면 자료부터 다시
  const hideSig = (project.edits?.hides ?? []).map((h) => h.id).join(',')
  // ④ 항목별 자료를 바꾸면 자료부터 다시
  const srcSig = pickSig(project)
  // 정성 조사 카드를 확인·제외·고치면 '스케일별 주요 이슈' 도판을 다시
  const researchSig = project.cards
    .filter((c) => c.auto_key?.startsWith('research:') && c.status === 'confirmed')
    .map((c) => `${c.id}:${c.updated_at}`)
    .join(',')
  // 보는 안(설계안)을 바꾸거나 안을 다시 올리면 자료부터 다시
  const designSig = `${scenarioSig(project)}|${hashOf(addsSig(project))}`
  const dataSig = `${project.collectedAt ?? ''}|${envSig}|${ngiiSig}|${siteKey(project.site)}|${project.collectedRadiusM ?? project.site.radiusM}|${obsSig}|${hashOf(hideSig)}|${srcSig}|${hashOf(researchSig)}|${designSig}`
  const labelEdits = project.edits?.labels ?? []
  const labelSig = labelEdits.map((l) => `${l.panelId}:${l.key}:${l.dx.toFixed(1)},${l.dy.toFixed(1)}:${l.hidden ? 1 : 0}`).join('|')
  // 결론을 고칠 때마다 프로젝트 객체가 바뀌므로, 자료가 실제로 바뀐 때만 다시 만든다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data: DiagramData | null = useMemo(() => buildDiagramData(project), [dataSig, project.collected])
  const date = collectedDate(project)
  const ids = (only ?? ORDERED_PANELS.map((p) => p.id)).join(',')
  const allKey = ORDERED_PANELS.map((p) => settingsKey(p.id, settings) + (panel ? `|p:${panelRulesKey(settings, p.id)}` : '')).join(';')
  // 종합 다이어그램: 그림·카드가 바뀌면 그 도판만 다시
  const synthSig = JSON.stringify([project.synth ?? null, project.cards.filter((c) => ['TENSION', 'OPPORTUNITY', 'HYPOTHESIS'].includes(c.type)).map((c) => [c.id, c.status, c.text, c.fields?.['제목'], c.fields?.['방향'], c.fields?.['근거'], c.related_card_ids])])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const synth = useMemo(() => synthCtxOf(project), [synthSig])
  // 설계안 비교 도판: 고른 안마다 자료 (그릴 때만 만듦)
  const designs = project.designs ?? []
  const cmpIds = compareIds(designs.map((d) => d.id), settings.compare)
  const compareSig = cmpIds
    .map((id) => {
      const d = designs.find((x) => x.id === id)
      const envKey = d ? `${ENV_KEY}@${designKey(d)}` : ENV_KEY
      return `${d ? designKey(d) : 'now'}@${project.collected[envKey]?.retrieved_at ?? ''}`
    })
    .join('|')
  const compareScenarios = () =>
    designs.length
      ? cmpIds.map((id) => ({ id, name: designs.find((x) => x.id === id)?.name ?? '현황', d: buildDiagramData({ ...project, scenario: id || null })!, editedAt: lastEditAt(project) })).filter((s) => !!s.d)
      : []
  // 건축 가능 영역 도판 (2026-11-21 묶음 E6): ⑪ 입력·주용도·주소(조례 지역)·필지 면적이 바뀌면 그 도판만 다시
  const lawSig = JSON.stringify(lawCtxOf(project))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const law = useMemo(() => lawCtxOf(project), [lawSig])
  const [panels, setPanels] = useState<Record<string, CachedPanel>>({})
  const [busy, setBusy] = useState(false)
  /** 그리는 중: 새로 그릴 도판 수 중 몇 장째, 지금 그리는 도판 이름 (저장해 둔 도판은 세지 않음) */
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null)
  const [terrain, setTerrain] = useState<TerrainAnalysis | null>(null)

  useEffect(() => {
    if (!data) {
      setPanels({})
      setProgress(null)
      return
    }
    let alive = true
    const wanted = ORDERED_PANELS.filter((p) => ids.split(',').includes(p.id))
    void (async () => {
      setBusy(true)
      // 겹쳐 보기가 쓰는 도판 (지형·속도 열쇠에)
      const uses = (id: string): string[] => {
        if (id === EXPLODED_ID) return explodedLayers(settings)
        const o = isOverlayId(id) ? overlaySpec(settings, id) : null
        return o ? [o.base, o.top] : [id]
      }
      const needsTerrain = wanted.some((p) => uses(p.id).some((x) => TERRAIN_IDS.has(x)) || (p.id === 'synth' && TERRAIN_IDS.has(synth.state.base)))
      if (needsTerrain) setProgress({ done: 0, total: 0, label: '지형 분석' })
      const fine = needsTerrain ? fineTerrainCached(data.ngii, data.center, fineHalfFor(data.R)) : null
      const t = needsTerrain ? await analyzeTerrain(data.center, data.boundary, data.R, fine).catch(() => null) : null
      if (!alive) return
      setTerrain(t)
      const jobs = wanted.map((def) => {
        const used = uses(def.id)
        const tKey = used.some((x) => TERRAIN_IDS.has(x)) || def.id === 'synth' ? `|${t ? `${t.grid.source}${t.grid.version ?? ''}` : 'no-terrain'}` : ''
        // 속도 장면은 수집 뒤에도 늘어나므로 장면 수를 열쇠에 넣는다
        const sKey = used.some((x) => x === 'speed' || x === 'speedLocal') ? `|snaps:${data.speedSnaps.length}` : ''
        const yKey = def.id === 'synth' ? `|synth:${hashOf(synthSig)}` : ''
        const labels = labelEdits.filter((l) => l.panelId === def.id)
        const lKey = labels.length ? `|labels:${hashOf(labels.map((l) => `${l.key}:${l.dx.toFixed(1)},${l.dy.toFixed(1)}:${l.hidden ? 1 : 0}`).join('|'))}` : ''
        // 설계안 비교: 고른 안들의 서명(안·위치·환경 계산 시각)
        const cKey = COMPARE_IDS.includes(def.id) ? `|cmp:${hashOf(compareSig)}` : ''
        const wKey = def.id === ENVELOPE_ID ? `|law:${hashOf(lawSig)}` : ''
        const pKey = panel ? `|panel:${hashOf(panelRulesKey(settings, def.id))}${rulesFor(settings, def.id).font ? `|f:${hashOf(fSig)}` : ''}` : ''
        const key = `${dataSig}|${def.id}|${settingsKey(def.id, settings)}|${vworldKey ? 'k' : '-'}${tKey}${sKey}${yKey}${lKey}${cKey}${wKey}${pKey}`
        return { def, key, labels }
      })
      const total = jobs.filter((j) => !cache.has(j.key)).length
      let drawn = 0
      for (const { def, key, labels } of jobs) {
        let hit = cache.get(key)
        if (!hit) {
          setProgress({ done: drawn, total, label: def.title })
          // 진행도를 먼저 그리게 한 번 쉼
          await new Promise((r) => setTimeout(r, 0))
          if (!alive) return
          const pr = panel ? rulesFor(settings, def.id) : null
          const r = await renderPanel(def, data, settings, vworldKey, date, t, def.id === 'synth' ? { synth, labels, panel: pr } : COMPARE_IDS.includes(def.id) ? { labels, scenarios: compareScenarios(), panel: pr } : { labels, panel: pr, law })
          // 패널 모드의 올린 글꼴은 그림 안에 넣어 화면에 보이게 (받는 SVG 글에는 이름만)
          const fontCss = pr?.font ? await fontStyleBlob(pr.font) : null
          hit = { ...r, url: URL.createObjectURL(fontCss ? svgBlobWithFont(r.svg, fontCss) : svgBlob(r.svg)), key }
          cachePut(hit)
          drawn++
        }
        if (!alive) return
        const done = hit
        setPanels((cur) => (cur[def.id]?.key === done.key ? cur : { ...cur, [def.id]: done }))
        await new Promise((r) => setTimeout(r, 0))
      }
      if (alive) {
        setBusy(false)
        setProgress(null)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, allKey, vworldKey, ids, date, synthSig, labelSig, panel, fSig, lawSig])

  return { data, settings, panels, busy, terrain, progress }
}
