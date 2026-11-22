// 과거와 현재 그림 만들기 (2026-11-22): 나란히(옛 사진 | 지금) · 옛 물길 · 시기별 시가지(2×2).
// 알아서 그리지 않음 — 단계 화면의 '그리기'를 눌러야 만들고, 만든 그림은 브라우저 저장소(panelImages)에 두어 리포트·보드도 씀.

import type { DiagramData } from '../diagrams/data'
import { ORDERED_PANELS } from '../diagrams/panels'
import { GROWTH_DEFS, OLD_RIVER, PRESENT_MAP, pastPhotoDef } from '../diagrams/panelsPast'
import { collectedDate, renderPanel, settingsOf } from '../diagrams/render'
import { makeFrame } from '../diagrams/frame'
import { getPhoto, listPanelImages, putPanelImage, type PanelImageRecord } from '../model/db'
import { nowIso, siteKey } from '../model/project'
import type { PastImage, Project } from '../model/types'
import { affineOf, pastLayerFor } from './georef'

export interface PastOutput {
  /** past:pair:사진id · past:oldRiver · past:growth */
  id: string
  title: string
  svg: string
  summary: string[]
  /** 그릴 때의 입력 — 지금 입력과 다르면 '바뀜' */
  key: string
}

/** 여러 장을 격자로 한 SVG에 (각 도판은 그대로 안에 넣음 — 일러스트레이터에서 그룹으로 열림) */
export function composeGrid(svgs: string[], cols: number, background: string | null): string {
  const sizes = svgs.map((s) => {
    const m = s.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/)
    return m ? [Number(m[1]), Number(m[2])] : [1000, 1100]
  })
  const gap = 24
  const W = Math.max(...sizes.map((z) => z[0]))
  const rows = Math.ceil(svgs.length / cols)
  const rowH = Array.from({ length: rows }, (_, r) => Math.max(...sizes.slice(r * cols, r * cols + cols).map((z) => z[1])))
  const total = { w: cols * W + (cols - 1) * gap, h: rowH.reduce((a, b) => a + b, 0) + (rows - 1) * gap }
  let y = 0
  let body = ''
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const i = r * cols + k
      if (i >= svgs.length) break
      body += svgs[i].replace(/^<svg /, `<svg x="${k * (W + gap)}" y="${y}" `)
    }
    y += rowH[r] + gap
  }
  const bg = background ? `<rect width="${total.w}" height="${total.h}" fill="${background}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total.w}" height="${total.h}" viewBox="0 0 ${total.w} ${total.h}">${bg}${body}</svg>`
}

function baseKey(project: Project, vworldKey: string): string {
  const s = settingsOf(project)
  return JSON.stringify([project.collectedAt, siteKey(project.site), project.collectedRadiusM ?? project.site.radiusM, s.frame, s.palette, s.background, s.siteMark, vworldKey ? 1 : 0, (project.edits?.hides ?? []).length])
}

/** 사진 하나의 나란히 그림 열쇠 */
export function pairKey(project: Project, img: PastImage, vworldKey: string): string {
  const p = project.past
  return `${baseKey(project, vworldKey)}|${JSON.stringify([img.gcps, img.year, img.name, p?.present ?? 'map', !!p?.roadsOver])}`
}
export const oldRiverKey = (project: Project, vworldKey: string) => `${baseKey(project, vworldKey)}|river`
export const growthKey = (project: Project, vworldKey: string) => `${baseKey(project, vworldKey)}|growth`

export const pastTitle = (img: PastImage) => `${img.name}${img.year ? ` (${img.year}년)` : ''}`

/** 그림 하나: 옛 사진 | 지금 */
async function drawPair(project: Project, data: DiagramData, img: PastImage, vworldKey: string): Promise<PastOutput | null> {
  const s = settingsOf(project)
  const date = collectedDate(project)
  const t = affineOf(img, data.center[0], data.center[1])
  const rec = await getPhoto(img.id)
  if (!t || !rec) return null
  const f = makeFrame(data.center[0], data.center[1], data.R, s.frame)
  const layer = await pastLayerFor(rec.blob, img, t, f)
  const title = `옛 항공사진 ${img.year ? `${img.year}년` : ''}`.trim()
  const left = await renderPanel(pastPhotoDef(title), data, s, vworldKey, date, null, { past: { layer, year: img.year, name: img.name, roadsOver: !!project.past?.roadsOver } })
  const aerialDef = ORDERED_PANELS.find((d) => d.id === 'aerial')
  const useAerial = (project.past?.present ?? 'map') === 'aerial' && !!vworldKey.trim() && aerialDef
  const right = useAerial ? await renderPanel({ ...aerialDef, id: 'presentAerial', title: '지금 항공사진' }, data, s, vworldKey, date, null, {}) : await renderPanel(PRESENT_MAP, data, s, vworldKey, date, null, {})
  return {
    id: `past:pair:${img.id}`,
    title: `과거와 현재 · ${pastTitle(img)}`,
    svg: composeGrid([left.svg, right.svg], 2, s.background === 'white' ? '#ffffff' : null),
    summary: [...left.out.summary, ...right.out.summary],
    key: pairKey(project, img, vworldKey),
  }
}

async function drawOldRiver(project: Project, data: DiagramData, vworldKey: string): Promise<PastOutput> {
  const s = settingsOf(project)
  const r = await renderPanel(OLD_RIVER, data, s, vworldKey, collectedDate(project), null, {})
  return { id: 'past:oldRiver', title: '과거와 현재 · 옛 물길과 지금', svg: r.svg, summary: r.out.summary, key: oldRiverKey(project, vworldKey) }
}

async function drawGrowth(project: Project, data: DiagramData, vworldKey: string): Promise<PastOutput> {
  const s = settingsOf(project)
  const parts = []
  for (const d of GROWTH_DEFS) parts.push(await renderPanel(d, data, s, vworldKey, collectedDate(project), null, {}))
  return {
    id: 'past:growth',
    title: '과거와 현재 · 시기별 시가지',
    svg: composeGrid(
      parts.map((p) => p.svg),
      2,
      s.background === 'white' ? '#ffffff' : null,
    ),
    summary: parts.flatMap((p) => p.out.summary),
    key: growthKey(project, vworldKey),
  }
}

/** 그릴 그림 목록 (위치를 맞춘 사진마다 하나 + 옛 물길 + 시기별 시가지) */
export function pastOutputIds(project: Project, data: DiagramData | null): string[] {
  const imgs = (project.past?.images ?? []).filter((i) => i.gcps.length >= 3)
  return [...imgs.map((i) => `past:pair:${i.id}`), ...(data?.oldRivers.length ? ['past:oldRiver'] : []), 'past:growth']
}

export function keyFor(id: string, project: Project, vworldKey: string): string {
  if (id === 'past:oldRiver') return oldRiverKey(project, vworldKey)
  if (id === 'past:growth') return growthKey(project, vworldKey)
  const img = project.past?.images.find((i) => `past:pair:${i.id}` === id)
  return img ? pairKey(project, img, vworldKey) : ''
}

/** 그리기 (ids를 주면 그것만) — 다 그리면 저장소에 */
export async function drawPast(project: Project, data: DiagramData, vworldKey: string, ids: string[], onStep?: (label: string, i: number, n: number) => void): Promise<PastOutput[]> {
  const out: PastOutput[] = []
  let i = 0
  for (const id of ids) {
    onStep?.(id, i++, ids.length)
    await new Promise((r) => setTimeout(r, 0))
    let o: PastOutput | null = null
    if (id === 'past:oldRiver') o = await drawOldRiver(project, data, vworldKey)
    else if (id === 'past:growth') o = await drawGrowth(project, data, vworldKey)
    else {
      const img = project.past?.images.find((x) => `past:pair:${x.id}` === id)
      if (img) o = await drawPair(project, data, img, vworldKey)
    }
    if (!o) continue
    out.push(o)
    await putPanelImage({ id: `${project.id}|n|${o.id}`, projectId: project.id, mode: 'n', panelId: o.id, key: o.key, svg: o.svg, out: { layers: [], legend: [], summary: o.summary, caption: o.title }, savedAt: nowIso() }).catch(() => undefined)
  }
  return out
}

/** 저장해 둔 그림 꺼내기 */
export async function loadPastOutputs(projectId: string): Promise<PastOutput[]> {
  const recs: PanelImageRecord[] = await listPanelImages(projectId, 'n').catch(() => [])
  return recs.filter((r) => r.panelId.startsWith('past:')).map((r) => ({ id: r.panelId, title: r.out.caption, svg: r.svg, summary: r.out.summary, key: r.key }))
}
