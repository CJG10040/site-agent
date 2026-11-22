// 설계안 나란히 비교 도판 (2026-11-21 묶음 C9, 사용자 결정: 일조시간(대지 주변) + 3D 매스, 일조는 '줄어든 곳' 차이 지도까지).
// 빈 대지(현황)·A안·B안 중 2~3개를 골라 같은 도판을 한 장에 칸으로 나란히 놓고, 차이를 수치로 적는다.
// 안마다 자료(DiagramData)는 화면 쪽(useDiagrams)에서 만들어 c.scenarios로 넘겨준다.

import { unpackGrid, type UnpackedGrid } from '../lib/env/grid'
import { SUN_DAYS } from '../lib/sun'
import { esc, type LegendItem, type PanelLayer, type PanelOutput } from './compose'
import type { DiagramData } from './data'
import { frameShapeSvg } from './frame'
import { mix } from './palette'
import type { PanelCtx, PanelDef } from './panels'
import { fineHalfOf, gridImage, maskOf, siteFarOf } from './panelsEnv'
import { to3d } from './view3d'

export const COMPARE_SUN = 'compareSun'
export const COMPARE_3D = 'compare3d'
export const COMPARE_IDS = [COMPARE_SUN, COMPARE_3D]

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

/** 비교에 넣을 안: 설정이 없으면 현황 + 앞의 설계안 2개 */
export function compareIds(designIds: string[], chosen: string[] | undefined): string[] {
  const ok = new Set(['', ...designIds])
  const pick = (chosen ?? []).filter((id) => ok.has(id))
  return (pick.length >= 2 ? pick : ['', ...designIds]).slice(0, 3)
}

const LABEL_H = 34

/** 칸 배치: 열 n개, 줄 rows개 → 지도 한 칸 크기와 자리 (세로 가운데) */
function layout(n: number, rows: number) {
  const W = 1000 / n
  const size = Math.min(W - 16, (1000 - rows * LABEL_H) / rows)
  const height = rows * (LABEL_H + size)
  const top = Math.max(0, (1000 - height) / 2)
  const cell = (col: number, row: number) => ({ x: col * W + (W - size) / 2, y: top + row * (LABEL_H + size) + LABEL_H, size })
  return { W, size, cell, height }
}

/** 안마다 환경 계산이 학생이 고친 것(더한·뺀 건물)보다 먼저면 그 안 이름 */
function staleNames(ss: { id: string; name: string; d: DiagramData; editedAt?: string }[]): string[] {
  return ss.filter((s) => s.editedAt && s.d.env && s.d.env.computedAt < s.editedAt).map(scenarioName)
}

/** 1000×1000 지도 그림을 칸에 넣음 (틀로 자르고, 틀·대지 윤곽) */
function placeMap(c: PanelCtx, layers: PanelLayer[], box: { x: number; y: number; size: number }, clipId: string, d: DiagramData): string {
  const k = box.size / 1000
  const clipped = layers.filter((l) => !l.noClip).map((l) => l.svg).join('')
  const free = layers.filter((l) => l.noClip).map((l) => l.svg).join('')
  const frame =
    frameShapeSvg(c.f).slice(0, -2)
  return (
    `<defs><clipPath id="${clipId}">${frame}/></clipPath></defs>` +
    `<g transform="translate(${box.x.toFixed(1)} ${box.y.toFixed(1)}) scale(${k.toFixed(4)})">` +
    `${frame} fill="${c.pal.paper}"/>` +
    `<g clip-path="url(#${clipId})">${clipped}<path d="${c.f.path(d.boundary, false)}" fill="none" stroke="${c.pal.accent}" stroke-width="2.5" vector-effect="non-scaling-stroke"/></g>` +
    `${frame} fill="none" stroke="${c.pal.ink}" stroke-opacity="0.4" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
    free +
    `</g>`
  )
}

function label(x: number, y: number, w: number, text: string, sub: string, c: PanelCtx): string {
  return (
    `<text x="${(x + w / 2).toFixed(1)}" y="${(y - 12).toFixed(1)}" font-size="${c.ty.v('label', 16)}" font-weight="600" text-anchor="middle" fill="${c.pal.ink}">${esc(text)}` +
    (sub ? `<tspan font-size="${c.ty.v('note', 12)}" font-weight="400" fill="${c.pal.subtle}"> ${esc(sub)}</tspan>` : '') +
    `</text>`
  )
}

function scenarioName(s: { id: string; name: string }): string {
  return s.id ? s.name : '현황 (빈 대지)'
}

// ───────────────────────── 일조시간 비교 ─────────────────────────

/** 줄어든 일조(분) 단계와 색 */
const DROP_BINS = [30, 60, 120]
function dropColors(c: PanelCtx): string[] {
  return [mix(c.pal.paper, c.pal.accent, 0.28), mix(c.pal.paper, c.pal.accent, 0.6), c.pal.accent]
}

const compareSunPanel: PanelDef = {
  id: COMPARE_SUN,
  title: '설계안 비교: 일조시간 (대지 주변)',
  group: '설계안 비교',
  needs: "⑩에서 설계안을 올리고, 공간정보에서 '환경 계산'을 하세요. 설계안은 '보는 안'에서 고른 뒤 '계산하기'로 안마다 계산합니다.",
  frameR: (d: DiagramData) => fineHalfOf(d),
  render: async (c): Promise<PanelOutput> => {
    const ss = c.scenarios ?? []
    if (ss.length < 2) return { layers: [], legend: [], summary: [], caption: '', empty: '비교할 안이 두 개 넘게 있어야 합니다', noFrame: true, hideBase: true }
    const day = SUN_DAYS.find((x) => x.key === c.st.sunDay) ?? SUN_DAYS[2]
    const missing = ss.filter((s) => !s.d.env || s.d.env.version !== 1).map(scenarioName)
    const now = ss.find((s) => !s.id)
    const withDiff = !!now?.d.env && ss.some((s) => s.id && s.d.env)
    const L = layout(ss.length, withDiff ? 2 : 1)
    let svg = ''
    let legend: LegendItem[] = []
    const summary: string[] = []
    const grids = new Map<string, UnpackedGrid>()
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i]
      const box = L.cell(i, 0)
      const sub = s.d.env ? await c.renderOther?.('sunSite', s.d) : null
      if (sub && !sub.empty) {
        svg += placeMap(c, sub.layers, box, `cmp-sun-${i}`, s.d)
        if (!legend.length) legend = sub.legend
        if (sub.summary[0]) summary.push(`${scenarioName(s)}: ${sub.summary[0].replace(/^.*?대지 안 일조: /, '대지 안 일조 ')}`)
        const set = s.d.env!.fine
        grids.set(s.id, unpackGrid(set[day.key]))
      } else {
        svg += `<rect x="${box.x}" y="${box.y}" width="${box.size}" height="${box.size}" fill="none" stroke="${c.pal.subtle}" stroke-dasharray="4 4"/><text x="${box.x + box.size / 2}" y="${box.y + box.size / 2}" font-size="${c.ty.v('note', 14)}" text-anchor="middle" fill="${c.pal.subtle}">환경 계산 없음</text>`
      }
      svg += label(box.x, box.y, box.size, scenarioName(s), s.id ? '' : '대지 안 기존 건물 뺌', c)
    }
    // 줄어든 곳: 설계안 − 현황 (같은 칸이면)
    const g0 = grids.get('')
    if (withDiff && g0 && now) {
      const colors = dropColors(c)
      const site = maskOf({ ...c, d: now.d }, g0, 'site')
      for (let i = 0; i < ss.length; i++) {
        const s = ss[i]
        const box = L.cell(i, 1)
        if (!s.id) {
          svg += `<text x="${(box.x + box.size / 2).toFixed(1)}" y="${(box.y + box.size / 2).toFixed(1)}" font-size="${c.ty.v('note', 14)}" text-anchor="middle" fill="${c.pal.subtle}"><tspan x="${(box.x + box.size / 2).toFixed(1)}">아래 줄: 현황보다</tspan><tspan x="${(box.x + box.size / 2).toFixed(1)}" dy="${c.ty.v('note', 20)}">일조가 줄어든 곳</tspan></text>`
          continue
        }
        const g = grids.get(s.id)
        if (!g || g.nx !== g0.nx || g.ny !== g0.ny || g.x0 !== g0.x0) continue
        const diff: UnpackedGrid = { ...g0, at: (k: number) => g.at(k) - g0.at(k) }
        const img = gridImage(c, diff, (v) => (v <= -DROP_BINS[2] ? colors[2] : v <= -DROP_BINS[1] ? colors[1] : v <= -DROP_BINS[0] ? colors[0] : null))
        const bld = `<path d="${s.d.buildings.map((b) => c.f.path(b.geom, false)).join('')}" fill="${mix(c.pal.paper, c.pal.ink, 0.22)}"/>`
        svg += placeMap(c, [{ id: '줄어든_일조', svg: img }, { id: '건물', svg: bld }], box, `cmp-drop-${i}`, s.d)
        svg += label(box.x, box.y, box.size, `${s.name} − 현황`, '줄어든 일조', c)
        // 대지 밖에서 줄어든 넓이
        const cellA = g0.cell * g0.cell
        let drop1 = 0
        let under2 = 0
        for (let k = 0; k < g0.nx * g0.ny; k++) {
          if (site[k]) continue
          const a = g0.at(k)
          const b = g.at(k)
          if (!Number.isFinite(a) || !Number.isFinite(b)) continue
          if (b - a <= -60) drop1++
          if (a >= 120 && b < 120) under2++
        }
        summary.push(`${s.name}: 대지 밖에서 ${day.label} 일조가 1시간 넘게 줄어든 넓이 약 ${fmt(drop1 * cellA)}㎡, 2시간 이상 → 2시간 미만이 된 넓이 약 ${fmt(under2 * cellA)}㎡`)
      }
      legend = [...legend, ...DROP_BINS.map((b, i) => ({ color: colors[i], label: `줄어든 일조 ${i < DROP_BINS.length - 1 ? `${b / 60 >= 1 ? `${b / 60}시간` : `${b}분`}~${DROP_BINS[i + 1] / 60}시간` : `${b / 60}시간 이상`}` }))]
    }
    if (missing.length) summary.push(`환경 계산이 없는 안: ${missing.join(', ')} — '보는 안'에서 고른 뒤 '계산하기'`)
    const stale = staleNames(ss)
    if (stale.length) summary.push(`주의: ${stale.join(', ')}의 환경 계산이 더하거나 뺀 건물보다 먼저라 차이에 섞일 수 있음 — '보는 안'에서 그 안을 고른 뒤 '다시 계산'`)
    return {
      layers: [{ id: '설계안_비교_일조', svg }],
      legend,
      legendTitle: `${day.label} 일조시간 (안마다 따로 계산)`,
      summary,
      caption: `안마다 같은 방법으로 계산한 ${day.label} 일조시간(10분마다 건물 그림자 + 지형) · 설계안은 2.5D 덩어리(필로티·돌출 아래는 꽉 찬 것으로) · 줄어든 곳 = 설계안 − 현황 · 참고용이며 일조권 판정에 쓸 수 없음`,
      noFrame: true,
      hideBase: true,
    }
  },
}

// ───────────────────────── 3D 매스 비교 ─────────────────────────

const compare3dPanel: PanelDef = {
  id: COMPARE_3D,
  title: '설계안 비교: 3D 매스',
  group: '설계안 비교',
  needs: '⑩에서 설계안을 올리세요.',
  // 대지가 다 들어오되 가깝게 (매스가 잘 보이게)
  frameR: (d: DiagramData) => Math.max(120, Math.min(fineHalfOf(d), Math.ceil((siteFarOf(d) + 50) / 10) * 10)),
  render: (c): PanelOutput => {
    const ss = c.scenarios ?? []
    if (ss.length < 2) return { layers: [], legend: [], summary: [], caption: '', empty: '비교할 안이 두 개 넘게 있어야 합니다', noFrame: true, hideBase: true }
    const L = layout(ss.length, 1)
    let svg = ''
    const summary: string[] = []
    ss.forEach((s, i) => {
      const box = L.cell(i, 0)
      const flat: PanelOutput = { layers: [{ id: '건물', svg: '' }], legend: [], summary: [], caption: '' }
      const site = `<path d="${c.f.path(s.d.boundary, false)}" fill="${c.pal.accent}" fill-opacity="0.08" stroke="${c.pal.accent}" stroke-width="2.5"/>`
      const out = to3d(flat, { d: s.d, f: c.f, pal: c.pal, st: c.st, ty: c.ty }, site, `cmp3d-${i}`)
      const k = box.size / 1000
      svg += `<g transform="translate(${box.x.toFixed(1)} ${box.y.toFixed(1)}) scale(${k.toFixed(4)})">${out.layers.map((l) => l.svg).join('')}</g>`
      const sc = s.d.scenario
      svg += label(box.x, box.y, box.size, scenarioName(s), sc ? `최고 약 ${fmt(sc.maxHeight, 1)}m` : '', c)
      if (sc) summary.push(`${s.name}: 가장 높은 곳 약 ${fmt(sc.maxHeight, 1)}m, 위에서 본 넓이 약 ${fmt(sc.footprint)}㎡`)
    })
    return {
      layers: [{ id: '설계안_비교_3D', svg }],
      legend: [
        { color: c.pal.accent, label: '설계안 (올린 매스 그대로)' },
        { color: mix(c.pal.paper, c.pal.base, 0.9), label: '주변 건물' },
      ],
      summary,
      caption: `같은 방향(${c.st.cam3d?.az ?? 225}°)·기울기에서 본 3D · 대지 안 기존 건물은 뺌 · 주변 건물 높이는 실측 또는 층수 × 용도별 층고(어림)`,
      noFrame: true,
      hideBase: true,
    }
  },
}

export const COMPARE_PANELS: PanelDef[] = [compareSunPanel, compare3dPanel]
