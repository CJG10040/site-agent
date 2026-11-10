// 도판 그리기 진입점: 설정 기본값, 도판 한 장 그리기, 파일 이름.

import type { DiagramSettings, Project } from '../model/types'
import { composePanel, siteMarkSvg, type PanelOutput } from './compose'
import type { DiagramData } from './data'
import { makeFrame } from './frame'
import { paletteOf } from './palette'
import { panelNumber, type PanelDef } from './panels'

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
}

export function settingsOf(project: Project): DiagramSettings {
  return { ...DEFAULT_SETTINGS, ...(project.diagrams?.settings ?? {}) }
}

export interface RenderedPanel {
  id: string
  svg: string
  out: PanelOutput
}

export function collectedDate(project: Project): string {
  return project.collectedAt ? project.collectedAt.slice(0, 10) : '수집 전'
}

export async function renderPanel(def: PanelDef, data: DiagramData, settings: DiagramSettings, vworldKey: string, date: string): Promise<RenderedPanel> {
  const frame = makeFrame(data.center[0], data.center[1], data.R, settings.frame)
  const pal = paletteOf(settings.palette)
  let out: PanelOutput
  try {
    out = await def.render({ d: data, f: frame, pal, st: settings, vworldKey, date })
  } catch (e) {
    out = { layers: [], legend: [], summary: [], caption: '', empty: `그리는 중 오류: ${e instanceof Error ? e.message : String(e)}` }
  }
  const site = siteMarkSvg(frame, frame.path(data.boundary, false), data.center, settings, pal)
  const svg = composePanel(
    { id: def.id, number: panelNumber(def.id), title: def.title, subtitle: `반경 ${data.R}m · ${date} 수집` },
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
