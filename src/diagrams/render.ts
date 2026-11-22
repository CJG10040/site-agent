// 도판 그리기 진입점: 설정 기본값, 도판 한 장 그리기, 파일 이름.

import { applyLabelEdits, editNote } from '../model/edits'
import type { DiagramSettings, LabelEdit, PanelRules, Project } from '../model/types'
import { composePanel, composePanelMode, siteMarkSvg, type PanelOutput } from './compose'
import { rectHalf, ruleScale, scaleStrokes } from './panelRules'
import type { DiagramData } from './data'
import { makeFrame } from './frame'
import { paletteFor } from './palette'
import type { TerrainAnalysis } from '../lib/terrainSite'
import { ORDERED_PANELS, panelNumber, type PanelCtx, type PanelDef } from './panels'
import { NOT_MAP_PANELS, type SynthCtx } from './synth'
import { is3d, to3d } from './view3d'
import { UNIT_SYM, UNIT_TYPE } from './typeScale'
import { COMPARE_IDS } from './panelsCompare'
import type { LawCtx } from '../law/envelopeData'

/** 3D로 볼 수 있는 도판 (단면·그래프·하늘 그림·바람장미는 제외, 종합 다이어그램은 됨) */
export function can3d(id: string): boolean {
  if (COMPARE_IDS.includes(id)) return false
  return id === 'synth' || !NOT_MAP_PANELS.has(id)
}

export const DEFAULT_SETTINGS: DiagramSettings = {
  frame: 'circle',
  palette: 'default',
  background: 'white',
  siteMark: 'outline',
  highFloors: 10,
  lowFloors: 4,
  sunDay: 'winter',
  sunHour: 12,
  pngWidth: 2000,
  windSeason: 0,
  speedSnap: -1,
  planFloors: 5,
  sectionAngle: 0,
  sectionVex: 1,
  sectionRange: 'site',
  fieldStyle: 'smooth',
  windStyle: 'lines',
  terrainShade: true,
}

export function settingsOf(project: Project): DiagramSettings {
  return { ...DEFAULT_SETTINGS, ...(project.diagrams?.settings ?? {}) }
}

export interface RenderedPanel {
  id: string
  svg: string
  out: PanelOutput
}

/** 도판 id → '도판 12 바람장미' */
export function panelLabel(id: string): string {
  const p = ORDERED_PANELS.find((x) => x.id === id)
  return p ? `도판 ${panelNumber(id)} ${p.title}` : `도판 ${id}`
}

export function collectedDate(project: Project): string {
  return project.collectedAt ? project.collectedAt.slice(0, 10) : '수집 전'
}

export async function renderPanel(
  def: PanelDef,
  data: DiagramData,
  settings: DiagramSettings,
  vworldKey: string,
  date: string,
  terrain: TerrainAnalysis | null = null,
  extra: { synth?: SynthCtx | null; labels?: LabelEdit[]; scenarios?: { id: string; name: string; d: DiagramData; editedAt?: string }[]; panel?: PanelRules | null; law?: LawCtx | null; past?: PanelCtx['past'] } = {},
): Promise<RenderedPanel> {
  // 겹쳐 보기는 아래 도판의 틀을 빌림
  const borrow = def.frameFrom?.(settings)
  const fd = borrow ? (ORDERED_PANELS.find((p) => p.id === borrow) ?? def) : def
  const R = fd.frameR ? fd.frameR(data, extra) : data.R
  // 패널 모드 직사각 틀 (2026-11-22): 그림은 정사각 그대로 그리고 틀이 가운데를 직사각으로 잘라 냄
  const half = extra.panel ? rectHalf(extra.panel) : undefined
  const frame = makeFrame(data.center[0], data.center[1], R, half ? 'square' : settings.frame, half)
  const pal = paletteFor(settings, def.id)
  let out: PanelOutput
  // 패널 모드(2026-11-21 묶음 D2): 규칙에서 글자·선 단계 배율. 보통 도판은 모두 1
  const rs = extra.panel ? ruleScale(extra.panel) : null
  const ty = rs ? rs.ty : UNIT_TYPE
  const ctx: PanelCtx = { d: data, f: frame, pal, st: settings, vworldKey, date, t: terrain, synth: extra.synth ?? null, ty, sy: rs ? rs.sy : UNIT_SYM, law: extra.law ?? null, past: extra.past ?? null }
  try {
    // 종합 도판은 다른 도판의 그림을 같은 틀로 다시 그려 바탕에 깔 수 있다
    ctx.basePanel = async (id) => {
      const bd = ORDERED_PANELS.find((p) => p.id === id && p.id !== def.id)
      return bd ? await bd.render({ ...ctx, synth: null }) : null
    }
    ctx.panelLabel = panelLabel
    // 설계안 비교: 안마다 자료로 다른 도판을 같은 틀로 다시 그림
    ctx.scenarios = extra.scenarios
    ctx.renderOther = async (id, d) => {
      const bd = ORDERED_PANELS.find((p) => p.id === id && p.id !== def.id)
      return bd ? await bd.render({ ...ctx, d, synth: null, scenarios: undefined }) : null
    }
    out = await def.render(ctx)
  } catch (e) {
    out = { layers: [], legend: [], summary: [], caption: '', empty: `그리는 중 오류: ${e instanceof Error ? e.message : String(e)}` }
  }
  // 학생이 고친 것 (2026-11-12): 뺀 자료 수·옮긴 표기 수를 캡션에, 표기는 글자를 찾아 옮기거나 숨김
  const labels = extra.labels ?? []
  const note = editNote(data.hidden?.applied ?? 0, labels.length)
  if (note && !out.empty) out = { ...out, caption: out.caption ? `${out.caption} · ${note}` : note }
  const site = siteMarkSvg(frame, frame.path(data.boundary, false), data.center, settings, pal, rs ? rs.kl.site : 1)
  // 14-E: 이 도판을 3D로 (지도 도판만)
  if (is3d(settings, def.id) && can3d(def.id) && !out.empty && !out.noFrame) {
    try {
      out = to3d(out, ctx, site, `clip-${def.id}`, def.three?.(ctx))
    } catch (e) {
      out = { ...out, caption: `${out.caption} · 3D로 그리지 못함: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  const meta = { id: def.id, number: panelNumber(def.id), title: def.title, subtitle: `반경 ${R.toLocaleString('ko-KR')}m · ${date} 수집` }
  // 패널 모드: 그림 속 선 굵기를 규칙 단계로 바꾸고, 제목·출처 없이 mm 크기로
  if (rs) out = { ...out, layers: out.layers.map((l) => ({ ...l, svg: scaleStrokes(l.svg, rs.kl) })) }
  const svg = applyLabelEdits(
    rs ? composePanelMode(meta, out, frame, settings, pal, site, { rules: rs.rules, unit: rs.unit, ty }) : composePanel(meta, out, frame, settings, pal, site, ty),
    labels,
  )
  return { id: def.id, svg, out }
}

export function panelFileName(project: Project, def: PanelDef, ext: string): string {
  const name = (project.brief.projectName || '대지').replace(/[\/:*?"<>|\s]+/g, '_').slice(0, 30)
  return `${name}_${String(panelNumber(def.id)).padStart(2, '0')}_${def.title.replace(/[\/:*?"<>|()\s·]+/g, '_')}.${ext}`
}
