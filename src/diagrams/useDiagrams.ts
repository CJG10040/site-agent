// 도판 화면과 리포트가 함께 쓰는 그리기 훅.
// 2026-11-22 사용자 결정: 화면에 들어가기만 해도 50장 넘게 그려 버벅임 → **알아서 그리지 않음**.
// 들어가면 지금 자료·설정의 열쇠만 계산하고, 그려 둔 그림(이 세션 메모리 → 브라우저 저장소)을 보여 준다.
// 열쇠가 다르면 '바뀜'으로 두고 예전 그림을 그대로 보여 주며, generate()를 불러야 그린다.
// 예외는 opts.auto — 크게 보기에서 고치는 그 한 장·종합 다이어그램 편집기처럼 바로 보여야 하는 도판만 바로 그림.

import { pickSig } from '../model/sourcePick'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { isOverlayId, OVERLAY_IDS, overlaySpec } from './overlay'
import { EXPLODED_ID, explodedAz, explodedLayers, SITE_LAYER } from './exploded'
import { ORDERED_PANELS } from './panels'
import { collectedDate, renderPanel, settingsOf, type RenderedPanel } from './render'
import { panelRulesKey, rulesFor } from './panelRules'
import { fontStyleBlob, svgBlobWithFont } from '../lib/fonts'
import { lawCtxOf } from '../law/envelopeData'
import { listPanelImages, putPanelImage } from '../model/db'
import { nowIso } from '../model/project'
import { ENVELOPE_ID } from './panelsEnvelope'

export interface CachedPanel extends RenderedPanel {
  url: string
  key: string
  /** n = 보통 도판, p = 패널 모드 */
  mode: 'n' | 'p'
}

/**
 * 도판을 그리는 코드를 바꿔 브라우저에 저장해 둔 그림이 달라져야 하면 하나 올림
 * (올리면 저장해 둔 도판이 모두 '바뀜'으로 보이고, 생성을 눌러야 새로 그림)
 */
const DRAW_REV = 2 // 2026-11-22: 브이월드 하천망(옛 물길)을 뺌

/** 열쇠 → 그린 도판 (이 세션 메모리, 설정을 오갈 때 다시 그리지 않게) */
const cache = new Map<string, CachedPanel>()
/** `${프로젝트}|${보기}|${도판}` → 마지막으로 그린(또는 저장소에서 꺼낸) 한 장 — 열쇠가 달라도 '바뀜'으로 보여 줄 그림 */
const latest = new Map<string, CachedPanel>()
/** 저장소에서 이미 꺼낸 `${프로젝트}|${보기}` */
const loaded = new Set<string>()

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
/** 화면에 걸려 있지 않은(latest가 아닌) 그림을 이만큼만 메모리에 둠 */
const MAX_LOOSE = 60

function cachePut(p: CachedPanel) {
  cache.delete(p.key)
  cache.set(p.key, p)
  const pinned = new Set([...latest.values()].map((x) => x.key))
  let loose = [...cache.keys()].filter((k) => !pinned.has(k)).length
  for (const [k, old] of cache) {
    if (loose <= MAX_LOOSE) break
    if (pinned.has(k)) continue
    URL.revokeObjectURL(old.url)
    cache.delete(k)
    loose--
  }
}

/** 겹쳐 보기·분해도가 쓰는 도판 (지형·속도 열쇠에) */
function usesOf(id: string, s: DiagramSettings): string[] {
  if (id === EXPLODED_ID) return explodedLayers(s)
  const o = isOverlayId(id) ? overlaySpec(s, id) : null
  return o ? [o.base, o.top] : [id]
}

function terrainOf(data: DiagramData): Promise<TerrainAnalysis | null> {
  const fine = fineTerrainCached(data.ngii, data.center, fineHalfFor(data.R))
  return analyzeTerrain(data.center, data.boundary, data.R, fine).catch(() => null)
}

/**
 * 화면에 보이는 도판: 겹쳐 보기는 고른 칸(과 다음 빈 칸 하나)만, 설계안 비교는 설계안을 올렸을 때만.
 * 숨은 도판은 그려도 빈 도판이라 생성·'그려야 함' 개수에서 뺀다 (⑥ 화면·리포트 같이)
 */
export function visiblePanelIds(project: Project, s: DiagramSettings): string[] {
  const hasDesigns = (project.designs ?? []).length > 0
  return ORDERED_PANELS.filter((p) => {
    if (COMPARE_IDS.includes(p.id) && !hasDesigns) return false
    const i = OVERLAY_IDS.indexOf(p.id)
    return i <= 0 || !!s.overlays?.[i - 1] || !!s.overlays?.[i]
  }).map((p) => p.id)
}

/** 그리기 요청: all = 이 훅이 맡은 도판 전부, ids = 그 도판만 */
interface DrawRequest {
  all: boolean
  ids: string[]
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

export function useDiagrams(project: Project, vworldKey: string, only?: string[], opts: { panel?: boolean; fontsSig?: string; auto?: string[] } = {}) {
  const settings = settingsOf(project)
  // 패널 모드 (2026-11-21 묶음 D2): ⑥ 화면에서만 켬 — 보드·리포트는 늘 보통 도판
  const panel = !!opts.panel
  const mode: 'n' | 'p' = panel ? 'p' : 'n'
  const pid = project.id
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
  const wantedIds = only ?? ORDERED_PANELS.map((p) => p.id)
  const ids = wantedIds.join(',')
  const autoIds = (opts.auto ?? []).filter((id) => wantedIds.includes(id))
  const autoSig = autoIds.join(',')
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

  // 도판마다 지금 자료·설정의 열쇠 (계산만 — 그리지 않음)
  const jobs = useMemo(() => {
    if (!data) return []
    const dKey = hashOf(dataSig)
    return ORDERED_PANELS.filter((p) => wantedIds.includes(p.id)).map((def) => {
      const used = usesOf(def.id, settings)
      // 지형 자료(수치지도)가 바뀌는 것은 dataSig에 들어 있음
      // 속도 장면은 수집 뒤에도 늘어나므로 장면 수를 열쇠에 넣는다
      const sKey = used.some((x) => x === 'speed' || x === 'speedLocal') ? `|snaps:${data.speedSnaps.length}` : ''
      const yKey = def.id === 'synth' ? `|synth:${hashOf(synthSig)}` : ''
      const labels = labelEdits.filter((l) => l.panelId === def.id)
      const lKey = labels.length ? `|labels:${hashOf(labels.map((l) => `${l.key}:${l.dx.toFixed(1)},${l.dy.toFixed(1)}:${l.hidden ? 1 : 0}`).join('|'))}` : ''
      // 설계안 비교: 고른 안들의 서명(안·위치·환경 계산 시각)
      const cKey = COMPARE_IDS.includes(def.id) ? `|cmp:${hashOf(compareSig)}` : ''
      const wKey = def.id === ENVELOPE_ID ? `|law:${hashOf(lawSig)}` : ''
      const pKey = panel ? `|panel:${hashOf(panelRulesKey(settings, def.id))}${rulesFor(settings, def.id).font ? `|f:${hashOf(fSig)}` : ''}` : ''
      const key = `r${DRAW_REV}|${dKey}|${def.id}|${settingsKey(def.id, settings)}|${vworldKey ? 'k' : '-'}${sKey}${yKey}${lKey}${cKey}${wKey}${pKey}`
      return { def, key, labels }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dataSig, allKey, vworldKey, ids, synthSig, labelSig, panel, fSig, lawSig, compareSig])
  const jobsSig = jobs.map((j) => j.key).join('\n')
  const slotOf = (id: string) => `${pid}|${mode}|${id}`

  const [panels, setPanels] = useState<Record<string, CachedPanel>>({})
  const [busy, setBusy] = useState(false)
  /** 그리는 중: 새로 그릴 도판 수 중 몇 장째, 지금 그리는 도판 이름 (저장해 둔 도판은 세지 않음) */
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null)
  /** 이번에 그릴 차례를 기다리는 도판 */
  const [queue, setQueue] = useState<string[]>([])
  const [terrain, setTerrain] = useState<TerrainAnalysis | null>(null)
  const [req, setReq] = useState<DrawRequest | null>(null)
  /** 저장소에서 그림을 꺼낸 뒤 다시 맞추기 */
  const [tick, setTick] = useState(0)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // 그려 둔 그림 보여 주기: 지금 열쇠로 그린 것(메모리) → 없으면 그 도판의 마지막 그림('바뀜')
  useEffect(() => {
    setPanels((cur) => {
      const next: Record<string, CachedPanel> = {}
      let changed = Object.keys(cur).length !== jobs.length
      for (const j of jobs) {
        const id = j.def.id
        const fresh = cache.get(j.key)
        if (fresh && latest.get(slotOf(id)) !== fresh) {
          latest.set(slotOf(id), fresh)
          void savePanel(pid, fresh)
        }
        const show = fresh ?? latest.get(slotOf(id))
        if (show) next[id] = show
        if (next[id] !== cur[id]) changed = true
      }
      return changed ? next : cur
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsSig, pid, mode, tick])

  // 대지 개요·보드의 '대지 높이' 줄: 지형 분석 하나만 (도판은 그리지 않음) — 화면이 먼저 뜨도록 조금 뒤에
  useEffect(() => {
    if (!data) return
    let alive = true
    const h = window.setTimeout(() => {
      void terrainOf(data).then((t) => alive && t && setTerrain(t))
    }, 800)
    return () => {
      alive = false
      window.clearTimeout(h)
    }
  }, [data])

  // 새로고침 뒤 처음: 브라우저 저장소에 둔 그림을 꺼냄 (그리지 않음)
  useEffect(() => {
    const tag = `${pid}|${mode}`
    if (loaded.has(tag)) return
    let alive = true
    void (async () => {
      const recs = await listPanelImages(pid, mode).catch(() => [])
      loaded.add(tag)
      for (const r of recs) {
        const slot = `${pid}|${mode}|${r.panelId}`
        if (latest.has(slot)) continue
        const known = cache.get(r.key)
        if (known) {
          latest.set(slot, known)
          continue
        }
        const font = mode === 'p' ? rulesFor(settingsRef.current, r.panelId).font : undefined
        const fontCss = font ? await fontStyleBlob(font).catch(() => null) : null
        const cp: CachedPanel = { id: r.panelId, svg: r.svg, out: r.out, key: r.key, mode, url: URL.createObjectURL(fontCss ? svgBlobWithFont(r.svg, fontCss) : svgBlob(r.svg)) }
        latest.set(slot, cp)
        cachePut(cp)
      }
      if (alive) setTick((t) => t + 1)
    })()
    return () => {
      alive = false
    }
  }, [pid, mode])

  // 그리기: 요청한 도판(generate)과 바로 그릴 도판(opts.auto) 중 지금 열쇠로 그린 적 없는 것만
  useEffect(() => {
    if (!data) return
    const wantDraw = jobs.filter((j) => !cache.has(j.key) && ((req && (req.all || req.ids.includes(j.def.id))) || autoIds.includes(j.def.id)))
    if (!wantDraw.length) {
      if (req) setReq(null)
      setBusy(false)
      setProgress(null)
      setQueue([])
      return
    }
    let alive = true
    const runReq = req
    void (async () => {
      setBusy(true)
      setQueue(wantDraw.map((j) => j.def.id))
      const needsTerrain = wantDraw.some((j) => usesOf(j.def.id, settings).some((x) => TERRAIN_IDS.has(x)) || (j.def.id === 'synth' && TERRAIN_IDS.has(synth.state.base)))
      if (needsTerrain) setProgress({ done: 0, total: wantDraw.length, label: '지형 분석' })
      const t = needsTerrain ? await terrainOf(data) : null
      if (!alive) return
      if (t) setTerrain(t)
      let drawn = 0
      for (const { def, key, labels } of wantDraw) {
        setProgress({ done: drawn, total: wantDraw.length, label: def.title })
        // 진행도를 먼저 그리게 한 번 쉼
        await new Promise((r) => setTimeout(r, 0))
        if (!alive) return
        try {
          const pr = panel ? rulesFor(settings, def.id) : null
          const r = await renderPanel(def, data, settings, vworldKey, date, t, def.id === 'synth' ? { synth, labels, panel: pr } : COMPARE_IDS.includes(def.id) ? { labels, scenarios: compareScenarios(), panel: pr } : { labels, panel: pr, law })
          // 패널 모드의 올린 글꼴은 그림 안에 넣어 화면에 보이게 (받는 SVG 글에는 이름만)
          const fontCss = pr?.font ? await fontStyleBlob(pr.font) : null
          const hit: CachedPanel = { ...r, url: URL.createObjectURL(fontCss ? svgBlobWithFont(r.svg, fontCss) : svgBlob(r.svg)), key, mode }
          // 다 그린 것은 요청이 바뀌어도 버리지 않음 (다음 차례에 그대로 씀)
          latest.set(slotOf(def.id), hit)
          cachePut(hit)
          void savePanel(pid, hit)
          if (alive) setPanels((cur) => ({ ...cur, [def.id]: hit }))
        } catch (e) {
          console.error(`도판 ${def.id}를 그리지 못함`, e)
        }
        drawn++
        if (alive) setQueue((q) => q.filter((x) => x !== def.id))
      }
      if (alive) {
        setBusy(false)
        setProgress(null)
        setQueue([])
        setReq((cur) => (cur === runReq ? null : cur))
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsSig, req, autoSig, data])

  /** 도판 생성: ids를 주면 그 도판만, 없으면 이 화면이 맡은 도판 전부 — 지금 열쇠로 그린 적 없는 것만 그림 */
  const generate = useCallback((ids?: string[]) => {
    setReq((cur) => ({ all: !!cur?.all || !ids, ids: [...new Set([...(cur?.ids ?? []), ...(ids ?? [])])] }))
  }, [])

  /** 그린 적 없거나 그린 뒤 자료·설정이 바뀐 도판 */
  const stale = jobs.filter((j) => panels[j.def.id]?.key !== j.key && !cache.has(j.key)).map((j) => j.def.id)

  return { data, settings, panels, busy, terrain, progress, stale, queue, generate }
}

/** 그린 도판을 브라우저 저장소에 (실패해도 이 세션에서는 그대로 보임) */
async function savePanel(projectId: string, p: CachedPanel): Promise<void> {
  try {
    await putPanelImage({ id: `${projectId}|${p.mode}|${p.id}`, projectId, mode: p.mode, panelId: p.id, key: p.key, svg: p.svg, out: p.out, savedAt: nowIso() })
  } catch (e) {
    console.warn('그린 도판을 브라우저에 저장하지 못함', e)
  }
}
