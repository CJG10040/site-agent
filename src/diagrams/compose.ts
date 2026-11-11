// 도판 한 장을 SVG 문자열로 짠다.
// 그룹마다 id를 붙여 일러스트레이터에서 레이어로 열리게 한다.

import type { DiagramSettings } from '../model/types'
import { MAP_CX, MAP_CY, MAP_R, niceLength, SHEET_W, type Frame } from './frame'
import type { Palette } from './palette'

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
      return `<circle cx="${x + 9}" cy="${y + 9}" r="7" fill="${c}" stroke="#ffffff" stroke-width="1.5"/>`
    case 'square':
      return `<rect x="${x + 2}" y="${y + 2}" width="14" height="14" fill="${c}" stroke="#ffffff" stroke-width="1.5"/>`
    case 'line':
      return `<line x1="${x}" y1="${y + 9}" x2="${x + 22}" y2="${y + 9}" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`
    case 'outline':
      return `<rect x="${x + 1}" y="${y + 1}" width="18" height="16" fill="none" stroke="${c}" stroke-width="2.5"/>`
    default:
      return `<rect x="${x}" y="${y}" width="20" height="18" rx="2" fill="${c}" stroke="${pal.ink}" stroke-opacity="0.15"/>`
  }
}

export interface ComposeMeta {
  id: string
  number: number
  title: string
  subtitle: string
}

export function siteMarkSvg(frame: Frame, boundaryPath: string, center: [number, number], settings: DiagramSettings, pal: Palette): string {
  const [cx, cy] = frame.pt(center[0], center[1])
  if (settings.siteMark === 'dot') {
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9" fill="${pal.accent}" stroke="#ffffff" stroke-width="2.5"/>`
  }
  if (settings.siteMark === 'fill') {
    return `<path d="${boundaryPath}" fill="${pal.accent}" fill-opacity="0.85" stroke="${pal.accent}" stroke-width="2" stroke-linejoin="round"/>`
  }
  // 대지가 너무 작게 보이면 점을 함께
  const tiny = boundaryPath.length < 400 && frame.R >= 800
  return `<path d="${boundaryPath}" fill="none" stroke="#ffffff" stroke-width="6" stroke-linejoin="round"/><path d="${boundaryPath}" fill="${pal.accent}" fill-opacity="0.12" stroke="${pal.accent}" stroke-width="3" stroke-linejoin="round"/>${
    tiny ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="${pal.accent}"/>` : ''
  }`
}

export function composePanel(meta: ComposeMeta, out: PanelOutput, frame: Frame, settings: DiagramSettings, pal: Palette, siteSvg: string): string {
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
      while (textWidth(label, 17) > colW - 40 && label.length > 2) label = label.slice(0, -2) + '…'
      return `${swatch(item, x, y, pal)}<text x="${x + 30}" y="${y + 15}" font-size="17" fill="${pal.ink}">${esc(label)}</text>`
    })
    .join('')
  const captionTop = legendTop + rows * 32 + (rows ? 18 : 0)
  const captionLines = wrap(out.caption, 13, SHEET_W - 80)
  const height = Math.ceil(captionTop + captionLines.length * 19 + 28)

  // 방위표·축척 (사각 틀은 모서리에서 조금 안쪽으로)
  const sq = frame.shape !== 'circle'
  const nx = MAP_CX + MAP_R - (sq ? 40 : 10)
  const ny = MAP_CY - MAP_R + (sq ? 30 : 14)
  const north = `<g id="방위표"><path d="M${nx} ${ny} L${nx + 11} ${ny + 32} L${nx} ${ny + 25} L${nx - 11} ${ny + 32} Z" fill="${pal.ink}"/><text x="${nx}" y="${ny + 52}" font-size="16" font-weight="700" text-anchor="middle" fill="${pal.ink}">N</text></g>`
  const len = niceLength(frame.R * 0.45)
  const lenPx = len * frame.s
  const sx = MAP_CX - MAP_R + (sq ? 30 : 40)
  const sy = MAP_CY + MAP_R - (sq ? 30 : 18)
  const scale = `<g id="축척"><rect x="${sx}" y="${sy}" width="${lenPx.toFixed(1)}" height="6" fill="${pal.ink}"/><rect x="${sx}" y="${sy - 6}" width="2" height="12" fill="${pal.ink}"/><rect x="${(sx + lenPx - 2).toFixed(1)}" y="${sy - 6}" width="2" height="12" fill="${pal.ink}"/><text x="${(sx + lenPx + 10).toFixed(1)}" y="${sy + 7}" font-size="15" fill="${pal.ink}">${len >= 1000 ? `${len / 1000}km` : `${len}m`}</text></g>`

  const layers = out.layers
    .map((l) => `<g id="${esc(l.id.replace(/\s+/g, '_'))}"${l.noClip || out.noFrame ? '' : ` clip-path="url(#${clipId})"`}>${l.svg}</g>`)
    .join('')
  const nf = !!out.noFrame

  const bg = settings.background === 'white' ? `<rect id="바탕색" width="${SHEET_W}" height="${height}" fill="#ffffff"/>` : ''
  const emptyNote = out.empty
    ? `<text x="${MAP_CX}" y="${MAP_CY}" font-size="22" text-anchor="middle" fill="${pal.subtle}">${esc(out.empty)}</text>`
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
        ? `<circle id="틀_바탕" cx="${MAP_CX}" cy="${MAP_CY}" r="${MAP_R}" fill="#ffffff"/>`
        : `<rect id="틀_바탕" x="${MAP_CX - MAP_R}" y="${MAP_CY - MAP_R}" width="${MAP_R * 2}" height="${MAP_R * 2}" fill="#ffffff"/>`,
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
    `<g id="제목"><text x="40" y="1012" font-size="34" font-weight="700" fill="${pal.ink}"><tspan fill="${pal.subtle}" font-weight="400">${String(meta.number).padStart(2, '0')}  </tspan>${esc(meta.title)}</text>`,
    `<text x="40" y="1046" font-size="17" fill="${pal.subtle}">${esc(meta.subtitle)}</text></g>`,
    `<g id="범례">${out.legendTitle ? `<text x="40" y="${legendTop - 10}" font-size="16" font-weight="700" fill="${pal.ink}">${esc(out.legendTitle)}</text>` : ''}${legendSvg}</g>`,
    `<g id="출처">${captionLines.map((l, i) => `<text x="40" y="${captionTop + 14 + i * 19}" font-size="13" fill="${pal.subtle}">${esc(l)}</text>`).join('')}</g>`,
    `</g></svg>`,
  ].join('')
}
