// 도판 그리기 진입점: 설정 기본값, 도판 한 장 그리기, 파일 이름.

import type { DiagramSettings, Project } from '../model/types'
import { composePanel, siteMarkSvg, type PanelOutput } from './compose'
import type { DiagramData } from './data'
import { makeFrame } from './frame'
import { paletteOf } from './palette'
import type { TerrainAnalysis } from '../lib/terrainSite'
import { ORDERED_PANELS, panelNumber, type PanelCtx, type PanelDef } from './panels'
import type { SynthCtx } from './synth'

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
  extra: { synth?: SynthCtx | null } = {},
): Promise<RenderedPanel> {
  const R = def.frameR ? def.frameR(data, extra) : data.R
  const frame = makeFrame(data.center[0], data.center[1], R, settings.frame)
  const pal = paletteOf(settings.palette)
  let out: PanelOutput
  try {
    const ctx: PanelCtx = { d: data, f: frame, pal, st: settings, vworldKey, date, t: terrain, synth: extra.synth ?? null }
    // 종합 도판은 다른 도판의 그림을 같은 틀로 다시 그려 바탕에 깔 수 있다
    ctx.basePanel = async (id) => {
      const bd = ORDERED_PANELS.find((p) => p.id === id && p.id !== def.id)
      return bd ? await bd.render({ ...ctx, synth: null }) : null
    }
    ctx.panelLabel = panelLabel
    out = await def.render(ctx)
  } catch (e) {
    out = { layers: [], legend: [], summary: [], caption: '', empty: `그리는 중 오류: ${e instanceof Error ? e.message : String(e)}` }
  }
  const site = siteMarkSvg(frame, frame.path(data.boundary, false), data.center, settings, pal)
  const svg = composePanel(
    { id: def.id, number: panelNumber(def.id), title: def.title, subtitle: `반경 ${R.toLocaleString('ko-KR')}m · ${date} 수집` },
    out,
    frame,
    settings,
    pal,
    site,
  )
  return { id: def.id, svg, out }
}

export function panelFileName(project: Project, def: PanelDef, ext: string): string {
  const name = (project.brief.projectName || '대지').replace(/[\/:*?"<>|\s]+/g, '_').slice(0, 30)
  return `${name}_${String(panelNumber(def.id)).padStart(2, '0')}_${def.title.replace(/[\/:*?"<>|()\s·]+/g, '_')}.${ext}`
}
