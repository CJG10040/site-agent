// 도판 한 장을 SVG 문자열로 짠다.
// 그룹마다 id를 붙여 일러스트레이터에서 레이어로 열리게 한다.

import type { DiagramSettings, HideLayer, PanelRules } from '../model/types'
import { MAP_CX, MAP_CY, MAP_R, niceLength, SHEET_W, type Frame } from './frame'
import type { Palette } from './palette'
import { UNIT_TYPE, type TypeScale } from './typeScale'

export interface LegendItem {
  color: string
  label: string
  /** box 면, dot 점, square 네모 점, line 선, outline 테두리 */
  shape?: 'box' | 'dot' | 'square' | 'line' | 'outline'
  /** 직접 그린 작은 그림 (26×18, 원점 0,0) — 있으면 shape 대신 (종합 다이어그램 기호) */
  glyph?: string
}

export interface PanelLayer {
  /** 그룹 이름 (일러스트레이터 레이어 이름) */
  id: string
  svg: string
  /** true면 도판 틀로 자르지 않음 (예: 태양 궤적 글자) */
  noClip?: boolean
}

export interface PanelOutput {
  layers: PanelLayer[]
  legend: LegendItem[]
  legendTitle?: string
  /** 도판에서 읽은 수치 (화면 표시 + 챗봇 프롬프트) */
  summary: string[]
  /** 출처·기준일·한계 */
  caption: string
  /** 자료가 없어 그릴 수 없을 때의 안내 */
  empty?: string
  /** 대지 표시를 그리지 않음 (예: 항공사진은 위에 따로) */
  hideBase?: boolean
  /** 축척 막대를 그리지 않음 (지도가 아닌 그림) */
  noScale?: boolean
  /** 원·사각 지도 틀 없이 도판 영역 전체에 그림 (단면도 등): 틀·방위표·축척·대지 표시 없음, 자르지 않음 */
  noFrame?: boolean
  /** 이 도판을 만든 점 자료 목록 — 앱 화면 카드 아래에서 학생이 확인·빼기 (그림·SVG·PNG·리포트에는 안 들어감) */
  basis?: BasisGroup[]
}

/** 도판 근거 목록의 한 줄 (2026-11-21 사용자 결정: 점 자료 도판 전부, 화면에서만) */
export interface BasisItem {
  layer: HideLayer
  name: string
  /** 분류 (예: 카페, 지하철역, 음식 · 한식) */
  kind: string
  lon: number
  lat: number
  /** 대지 중심에서 직선거리(m) */
  distM: number
  addr?: string
  /** 원래 자료의 장소 페이지 (없으면 화면에서 카카오맵 좌표 링크) */
  url?: string
  /** 덧붙임 (걸어서 n분, 정류소 번호, 건물·층 등) */
  note?: string
}

export interface BasisGroup {
  title: string
  items: BasisItem[]
}

export const FONT = "Pretendard, 'Pretendard Variable', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 글자 폭 어림 (한글은 글자 크기만큼, 영숫자는 약 0.56배) */
export function textWidth(s: string, size: number): number {
  let w = 0
  for (const ch of s) w += /[ㄱ-힣一-鿿]/.test(ch) ? size : /[A-Z]/.test(ch) ? size * 0.66 : size * 0.56
  return w
}

export function wrap(text: string, size: number, maxW: number): string[] {
  const words = text.split(/(\s+)/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (textWidth(cur + w, size) > maxW && cur.trim()) {
      lines.push(cur.trim())
      cur = w.trimStart()
    } else cur += w
  }
  if (cur.trim()) lines.push(cur.trim())
  return lines
}

function swatch(item: LegendItem, x: number, y: number, pal: Palette): string {
  if (item.glyph) return `<g transform="translate(${x - 2} ${y})">${item.glyph}</g>`
  const c = esc(item.color)
  switch (item.shape) {
    case 'dot':
      return `<circle cx="${x + 9}" cy="${y + 9}" r="7" fill="${c}" stroke="${pal.paper}" stroke-width="1.5"/>`
    case 'square':
      return `<rect x="${x + 2}" y="${y + 2}" width="14" height="14" fill="${c}" stroke="${pal.paper}" stroke-width="1.5"/>`
    case 'line':
      return `<line x1="${x}" y1="${y + 9}" x2="${x + 22}" y2="${y + 9}" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`
    case 'outline':
      return `<rect x="${x + 1}" y="${y + 1}" width="18" height="16" fill="none" stroke="${c}" stroke-width="2.5"/>`
    default:
      return `<rect x="${x}" y="${y}" width="20" height="18" fill="${c}" stroke="${pal.ink}" stroke-opacity="0.2" stroke-width="0.8"/>`
  }
}

export interface ComposeMeta {
  id: string
  number: number
  title: string
  subtitle: string
}

/** k = 대지 경계 선 배율 (패널 규칙, 보통 도판은 1) */
export function siteMarkSvg(frame: Frame, boundaryPath: string, center: [number, number], settings: DiagramSettings, pal: Palette, k = 1): string {
  const [cx, cy] = frame.pt(center[0], center[1])
  const w = (n: number) => (k === 1 ? String(n) : String(Math.round(n * k * 100) / 100))
  if (settings.siteMark === 'dot') {
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9" fill="${pal.accent}" stroke="${pal.paper}" stroke-width="${w(2.5)}"/>`
  }
  if (settings.siteMark === 'fill') {
    return `<path d="${boundaryPath}" fill="${pal.accent}" fill-opacity="0.85" stroke="${pal.accent}" stroke-width="${w(2)}" stroke-linejoin="round"/>`
  }
  // 대지가 너무 작게 보이면 점을 함께
  const tiny = boundaryPath.length < 400 && frame.R >= 800
  return `<path d="${boundaryPath}" fill="none" stroke="${pal.paper}" stroke-width="${w(6)}" stroke-linejoin="round"/><path d="${boundaryPath}" fill="${pal.accent}" fill-opacity="0.12" stroke="${pal.accent}" stroke-width="${w(3)}" stroke-linejoin="round"/>${
    tiny ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="${pal.accent}"/>` : ''
  }`
}

export function composePanel(meta: ComposeMeta, out: PanelOutput, frame: Frame, settings: DiagramSettings, pal: Palette, siteSvg: string, ty: TypeScale = UNIT_TYPE): string {
  const clipId = `clip-${meta.id}`
  const frameShape =
    frame.shape === 'circle'
      ? `<circle cx="${MAP_CX}" cy="${MAP_CY}" r="${MAP_R}"/>`
      : `<rect x="${MAP_CX - MAP_R}" y="${MAP_CY - MAP_R}" width="${MAP_R * 2}" height="${MAP_R * 2}"/>`

  // 범례 배치: 3열
  const colW = (SHEET_W - 80) / 3
  const legendTop = 1080 + (out.legendTitle ? 26 : 0)
  const rows = Math.ceil(out.legend.length / 3)
  const legendSvg = out.legend
    .map((item, i) => {
      const col = i % 3
      const row = Math.floor(i / 3)
      const x = 40 + col * colW
      const y = legendTop + row * 32
      let label = item.label
      while (textWidth(label, 17 * ty.k('legend')) > colW - 40 && label.length > 2) label = label.slice(0, -2) + '…'
      return `${swatch(item, x, y, pal)}<text x="${x + 30}" y="${y + 15}" font-size="${ty.v('legend', 17)}" fill="${pal.ink}">${esc(label)}</text>`
    })
    .join('')
  const captionTop = legendTop + rows * 32 + (rows ? 18 : 0)
  const captionLines = wrap(out.caption, 13, SHEET_W - 80)
  const height = Math.ceil(captionTop + captionLines.length * 19 + 28)

  // 방위표·축척 (사각 틀은 모서리에서 조금 안쪽으로)
  const sq = frame.shape !== 'circle'
  const nx = MAP_CX + MAP_R - (sq ? 40 : 10)
  const ny = MAP_CY - MAP_R + (sq ? 30 : 14)
  const north = `<g id="방위표"><path d="M${nx} ${ny} L${nx + 11} ${ny + 32} L${nx} ${ny + 25} L${nx - 11} ${ny + 32} Z" fill="${pal.ink}"/><text x="${nx}" y="${ny + 52}" font-size="${ty.v('mark', 16)}" font-weight="600" text-anchor="middle" fill="${pal.ink}">N</text></g>`
  const len = niceLength(frame.R * 0.45)
  const lenPx = len * frame.s
  const sx = MAP_CX - MAP_R + (sq ? 30 : 40)
  const sy = MAP_CY + MAP_R - (sq ? 30 : 18)
  const scale = `<g id="축척"><rect x="${sx}" y="${sy}" width="${lenPx.toFixed(1)}" height="6" fill="${pal.ink}"/><rect x="${sx}" y="${sy - 6}" width="2" height="12" fill="${pal.ink}"/><rect x="${(sx + lenPx - 2).toFixed(1)}" y="${sy - 6}" width="2" height="12" fill="${pal.ink}"/><text x="${(sx + lenPx + 10).toFixed(1)}" y="${sy + 7}" font-size="${ty.v('mark', 15)}" fill="${pal.ink}">${len >= 1000 ? `${len / 1000}km` : `${len}m`}</text></g>`

  const layers = out.layers
    .map((l) => `<g id="${esc(l.id.replace(/\s+/g, '_'))}"${l.noClip || out.noFrame ? '' : ` clip-path="url(#${clipId})"`}>${l.svg}</g>`)
    .join('')
  const nf = !!out.noFrame

  const bg = settings.background === 'white' ? `<rect id="바탕색" width="${SHEET_W}" height="${height}" fill="${pal.paper}"/>` : ''
  const emptyNote = out.empty
    ? `<text x="${MAP_CX}" y="${MAP_CY}" font-size="${ty.v('label', 22)}" text-anchor="middle" fill="${pal.subtle}">${esc(out.empty)}</text>`
    : ''

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}" height="${height}" viewBox="0 0 ${SHEET_W} ${height}" font-family="${esc(FONT)}">`,
    `<title>${esc(meta.title)}</title>`,
    `<defs><clipPath id="${clipId}">${frameShape}</clipPath></defs>`,
    bg,
    `<g id="도판_${meta.number}_${esc(meta.title.replace(/[\s·()]+/g, '_'))}">`,
    nf
      ? ''
      : frame.shape === 'circle'
        ? `<circle id="틀_바탕" cx="${MAP_CX}" cy="${MAP_CY}" r="${MAP_R}" fill="${pal.paper}"/>`
        : `<rect id="틀_바탕" x="${MAP_CX - MAP_R}" y="${MAP_CY - MAP_R}" width="${MAP_R * 2}" height="${MAP_R * 2}" fill="${pal.paper}"/>`,
    layers,
    out.hideBase || nf ? '' : `<g id="대지" clip-path="url(#${clipId})">${siteSvg}</g>`,
    nf
      ? ''
      : frame.shape === 'circle'
        ? `<circle id="틀" cx="${MAP_CX}" cy="${MAP_CY}" r="${MAP_R}" fill="none" stroke="${pal.ink}" stroke-opacity="0.45" stroke-width="1.5"/>`
        : `<rect id="틀" x="${MAP_CX - MAP_R}" y="${MAP_CY - MAP_R}" width="${MAP_R * 2}" height="${MAP_R * 2}" fill="none" stroke="${pal.ink}" stroke-opacity="0.45" stroke-width="1.5"/>`,
    emptyNote,
    nf ? '' : north,
    out.noScale || nf ? '' : scale,
    // 제목·부제·출처는 보통 도판에만 (패널 모드는 다이어그램만 — 2026-11-21) — 글자 단계 밖
    `<g id="제목"><text x="40" y="1012" font-size="34" font-weight="600" fill="${pal.ink}"><tspan fill="${pal.subtle}" font-weight="400">${String(meta.number).padStart(2, '0')}  </tspan>${esc(meta.title)}</text>`,
    `<text x="40" y="1046" font-size="17" fill="${pal.subtle}">${esc(meta.subtitle)}</text></g>`,
    `<g id="범례">${out.legendTitle ? `<text x="40" y="${legendTop - 10}" font-size="${ty.v('legend', 16)}" font-weight="600" fill="${pal.ink}">${esc(out.legendTitle)}</text>` : ''}${legendSvg}</g>`,
    `<g id="출처">${captionLines.map((l, i) => `<text x="40" y="${captionTop + 14 + i * 19}" font-size="13" fill="${pal.subtle}">${esc(l)}</text>`).join('')}</g>`,
    `</g></svg>`,
  ].join('')
}

// ───────────────────────── 패널 모드 (2026-11-21 묶음 D2·D4) ─────────────────────────
// 사용자 결정: 제목·부제·출처·캡션을 모두 빼고 다이어그램만 / 판 크기 = 지도 지름 mm, 범례는 아래·오른쪽에 필요한 만큼(또는 빼기) /
// 범례·방위표·축척은 각각 켜고 끄기. 조판은 일러스트레이터 등 바깥 프로그램에서 하므로 그룹 이름(레이어)은 그대로 둔다.

export interface PanelModeOpts {
  rules: PanelRules
  /** 도판 단위 1칸 = mm */
  unit: number
  ty: TypeScale
}

const f1 = (x: number) => String(Math.round(x * 10) / 10)
const f2 = (x: number) => String(Math.round(x * 100) / 100)

export function composePanelMode(meta: ComposeMeta, out: PanelOutput, frame: Frame, settings: DiagramSettings, pal: Palette, siteSvg: string, o: PanelModeOpts): string {
  const { rules, unit, ty } = o
  const clipId = `clip-${meta.id}`
  const nf = !!out.noFrame
  const sq = frame.shape !== 'circle'
  const frameShape = sq
    ? `<rect x="${MAP_CX - MAP_R}" y="${MAP_CY - MAP_R}" width="${MAP_R * 2}" height="${MAP_R * 2}"/>`
    : `<circle cx="${MAP_CX}" cy="${MAP_CY}" r="${MAP_R}"/>`

  // 그림 영역: 지도면 틀 둘레에 조금 여유, 지도가 아닌 그림(단면·그래프·3D)은 보통 도판의 그림 칸 그대로
  const PAD = 24
  const box = nf ? { x: 0, y: 0, w: SHEET_W, h: SHEET_W } : { x: MAP_CX - MAP_R - PAD, y: MAP_CY - MAP_R - PAD, w: 2 * (MAP_R + PAD), h: 2 * (MAP_R + PAD) }
  const inner = nf ? { x: 40, w: SHEET_W - 80, y: 40 } : { x: MAP_CX - MAP_R, w: 2 * MAP_R, y: MAP_CY - MAP_R }

  // 범례: 글자 단계에 맞춰 견본·줄 간격도 함께
  const L = 17 * ty.k('legend')
  const sw = L / 17
  const rowH = 32 * sw
  const items = rules.legend === 'none' ? [] : out.legend
  const titleH = out.legendTitle && items.length ? 26 * sw : 0
  const itemW = Math.max(0, ...items.map((it) => 30 * sw + textWidth(it.label, L))) + 16 * sw
  const gap = 20 * sw
  let W = box.w
  let H = box.h
  let legendSvg = ''
  if (items.length) {
    const below = rules.legend === 'below'
    const cols = below ? Math.max(1, Math.min(4, Math.floor(inner.w / itemW))) : 1
    const colW = below ? inner.w / cols : itemW
    const x0 = below ? inner.x : box.x + box.w + gap
    const y0 = below ? box.y + box.h + gap : inner.y
    const top = y0 + titleH
    legendSvg = items
      .map((item, i) => {
        const x = x0 + (i % cols) * colW
        const y = top + Math.floor(i / cols) * rowH
        let label = item.label
        while (textWidth(label, L) > colW - 34 * sw && label.length > 2) label = label.slice(0, -2) + '…'
        return `<g transform="translate(${f2(x)} ${f2(y)}) scale(${f2(sw)})">${swatch(item, 0, 0, pal)}</g><text x="${f1(x + 30 * sw)}" y="${f1(y + 15 * sw)}" font-size="${ty.v('legend', 17)}" fill="${pal.ink}">${esc(label)}</text>`
      })
      .join('')
    if (out.legendTitle) legendSvg = `<text x="${f1(x0)}" y="${f1(y0 + 16 * sw)}" font-size="${ty.v('legend', 16)}" font-weight="600" fill="${pal.ink}">${esc(out.legendTitle)}</text>${legendSvg}`
    const rows = Math.ceil(items.length / cols)
    const bottom = top + rows * rowH
    if (below) H = Math.max(H, bottom - box.y + 4 * sw)
    else {
      W = x0 + itemW - box.x
      H = Math.max(H, bottom - box.y)
    }
  }

  // 방위표·축척: 글자 단계(방위표·축척)에 맞춰 그림도 함께 (일러스트레이터에서 글자 크기가 바로 보이게 변환 없이)
  const km = ty.k('mark')
  const nx = MAP_CX + MAP_R - (sq ? 40 : 10)
  const ny = MAP_CY - MAP_R + (sq ? 30 : 14)
  const P = (dx: number, dy: number) => `${f1(nx + dx * km)} ${f1(ny + dy * km)}`
  const north = `<g id="방위표"><path d="M${P(0, 0)} L${P(11, 32)} L${P(0, 25)} L${P(-11, 32)} Z" fill="${pal.ink}"/><text x="${f1(nx)}" y="${f1(ny + 52 * km)}" font-size="${ty.v('mark', 16)}" font-weight="600" text-anchor="middle" fill="${pal.ink}">N</text></g>`
  const len = niceLength(frame.R * 0.45)
  const lenPx = len * frame.s
  const sx = MAP_CX - MAP_R + (sq ? 30 : 40)
  const sy = MAP_CY + MAP_R - (sq ? 30 : 18)
  const scale = `<g id="축척"><rect x="${sx}" y="${f1(sy)}" width="${lenPx.toFixed(1)}" height="${f2(6 * km)}" fill="${pal.ink}"/><rect x="${sx}" y="${f1(sy - 6 * km)}" width="${f2(2 * km)}" height="${f2(12 * km)}" fill="${pal.ink}"/><rect x="${f1(sx + lenPx - 2 * km)}" y="${f1(sy - 6 * km)}" width="${f2(2 * km)}" height="${f2(12 * km)}" fill="${pal.ink}"/><text x="${f1(sx + lenPx + 10 * km)}" y="${f1(sy + 7 * km)}" font-size="${ty.v('mark', 15)}" fill="${pal.ink}">${len >= 1000 ? `${len / 1000}km` : `${len}m`}</text></g>`

  // 3D 그림은 자기 방위표를 그림 안에 그림 — 방위표를 끄면 함께 뺌
  const layers = out.layers
    .filter((l) => rules.north || l.id !== '3D_방위')
    .map((l) => `<g id="${esc(l.id.replace(/\s+/g, '_'))}"${l.noClip || nf ? '' : ` clip-path="url(#${clipId})"`}>${l.svg}</g>`)
    .join('')
  const frameW = f2(rules.line.frame / unit)
  const font = rules.font ? `'${rules.font.replace(/['"<>&]/g, '')}', ${FONT}` : FONT
  const bg = settings.background === 'white' ? `<rect id="바탕색" x="${box.x}" y="${box.y}" width="${f1(W)}" height="${f1(H)}" fill="${pal.paper}"/>` : ''
  const emptyNote = out.empty ? `<text x="${MAP_CX}" y="${MAP_CY}" font-size="${ty.v('label', 22)}" text-anchor="middle" fill="${pal.subtle}">${esc(out.empty)}</text>` : ''
  const mm = (x: number) => f2(x * unit)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${mm(W)}mm" height="${mm(H)}mm" viewBox="${box.x} ${box.y} ${f1(W)} ${f1(H)}" font-family="${esc(font)}">`,
    `<defs><clipPath id="${clipId}">${frameShape}</clipPath></defs>`,
    bg,
    `<g id="도판_${meta.number}_${esc(meta.title.replace(/[\s·()]+/g, '_'))}">`,
    nf ? '' : sq ? `<rect id="틀_바탕" x="${MAP_CX - MAP_R}" y="${MAP_CY - MAP_R}" width="${MAP_R * 2}" height="${MAP_R * 2}" fill="${pal.paper}"/>` : `<circle id="틀_바탕" cx="${MAP_CX}" cy="${MAP_CY}" r="${MAP_R}" fill="${pal.paper}"/>`,
    layers,
    out.hideBase || nf ? '' : `<g id="대지" clip-path="url(#${clipId})">${siteSvg}</g>`,
    nf
      ? ''
      : sq
        ? `<rect id="틀" x="${MAP_CX - MAP_R}" y="${MAP_CY - MAP_R}" width="${MAP_R * 2}" height="${MAP_R * 2}" fill="none" stroke="${pal.ink}" stroke-opacity="0.45" stroke-width="${frameW}"/>`
        : `<circle id="틀" cx="${MAP_CX}" cy="${MAP_CY}" r="${MAP_R}" fill="none" stroke="${pal.ink}" stroke-opacity="0.45" stroke-width="${frameW}"/>`,
    emptyNote,
    nf || !rules.north ? '' : north,
    out.noScale || nf || !rules.scale ? '' : scale,
    legendSvg ? `<g id="범례">${legendSvg}</g>` : '',
    `</g></svg>`,
  ].join('')
}
