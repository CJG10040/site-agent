// 보드 조판: '리포트에 넣기' 도판을 용지(A4~A1)에 2~6열로 앉히고 제목·대지 개요·도판별 결론을 붙인다.
// 결과는 용지 크기(mm 단위) SVG를 쪽마다 한 장씩 — 인쇄(PDF)와 PNG(300dpi)가 같은 그림을 쓴다.
// 사용자 결정(2026-11-11): ⑨ 리포트에 '보드', 용지 A4~A1·방향·2~6열, 순서 바꾸기, 제목·대지 개요·도판별 결론 → PDF·PNG 300dpi.

import type { BoardPaper, BoardSettings } from '../model/types'
import { esc, FONT, textWidth, wrap } from './compose'

/** 짧은 변 × 긴 변 (mm) */
export const PAPER_MM: Record<BoardPaper, [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
}

export const DEFAULT_BOARD: BoardSettings = {
  paper: 'A3',
  landscape: true,
  cols: 4,
  title: '',
  order: [],
  overview: true,
  conclusions: true,
}

export function boardSettingsOf(b: Partial<BoardSettings> | undefined): BoardSettings {
  return { ...DEFAULT_BOARD, ...(b ?? {}) }
}

export function paperSize(s: BoardSettings): { w: number; h: number } {
  const [a, b] = PAPER_MM[s.paper]
  return s.landscape ? { w: b, h: a } : { w: a, h: b }
}

/** 저장된 순서를 지금 넣을 도판에 맞춤 (새 도판은 기본 순서로 뒤에) */
export function boardOrder(order: string[], ids: string[]): string[] {
  const set = new Set(ids)
  const kept = order.filter((id) => set.has(id))
  return [...kept, ...ids.filter((id) => !kept.includes(id))]
}

export interface BoardPanel {
  id: string
  svg: string
  conclusion: string
}

export interface BoardHead {
  title: string
  subtitle: string
  overview: { label: string; value: string }[]
  footer: string
}

const INK = '#1d1d1b'
const SUBTLE = '#6b6862'
const ACCENT = '#c2410c'

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function aspectOf(svg: string): number {
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  return m ? Number(m[2]) / Number(m[1]) : 1.3
}

function clampLines(lines: string[], max: number, size: number, maxW: number): string[] {
  if (lines.length <= max) return lines
  const out = lines.slice(0, max)
  let last = out[max - 1]
  while (last.length > 1 && textWidth(`${last}…`, size) > maxW) last = last.slice(0, -1)
  out[max - 1] = `${last}…`
  return out
}

/** 보드 쪽들 (SVG 문자열) */
export function buildBoard(panels: BoardPanel[], s: BoardSettings, head: BoardHead): string[] {
  const { w, h } = paperSize(s)
  const k = Math.min(w, h) / 210
  const M = 12 * k
  const G = 5 * k
  const W = w - 2 * M
  const cols = Math.max(1, Math.min(6, Math.round(s.cols)))
  const cellW = (W - (cols - 1) * G) / cols
  const C = Math.max(2.1, Math.min(4.2, cellW * 0.03))
  const F = 2.3 * k
  const bottom = h - M - F * 1.6

  // 제목 머리 (첫 쪽은 크게 + 개요, 다음 쪽은 작게)
  const firstHead = (): { svg: string; bottom: number } => {
    const T = 7.5 * k
    const S = 3.4 * k
    const O = 3 * k
    let y = M + T
    const parts = [`<text x="${M}" y="${y.toFixed(2)}" font-size="${T.toFixed(2)}" font-weight="700" fill="${INK}">${esc(head.title)}</text>`]
    y += S * 1.9
    parts.push(`<text x="${M}" y="${y.toFixed(2)}" font-size="${S.toFixed(2)}" fill="${SUBTLE}">${esc(head.subtitle)}</text>`)
    if (s.overview && head.overview.length) {
      const text = head.overview.map((o) => `${o.label} ${o.value}`).join('   ·   ')
      const lines = clampLines(wrap(text, O, W), 3, O, W)
      for (const line of lines) {
        y += O * 1.65
        parts.push(`<text x="${M}" y="${y.toFixed(2)}" font-size="${O.toFixed(2)}" fill="${INK}">${esc(line)}</text>`)
      }
    }
    y += 3.2 * k
    parts.push(`<rect x="${M}" y="${y.toFixed(2)}" width="${W.toFixed(2)}" height="${(0.5 * k).toFixed(2)}" fill="${INK}"/>`)
    return { svg: `<g id="제목">${parts.join('')}</g>`, bottom: y + 5 * k }
  }
  const nextHead = (): { svg: string; bottom: number } => {
    const T = 4.2 * k
    const y = M + T
    return {
      svg: `<g id="제목"><text x="${M}" y="${y.toFixed(2)}" font-size="${T.toFixed(2)}" font-weight="700" fill="${INK}">${esc(head.title)}</text><rect x="${M}" y="${(y + 2.4 * k).toFixed(2)}" width="${W.toFixed(2)}" height="${(0.35 * k).toFixed(2)}" fill="${INK}"/></g>`,
      bottom: y + 6.5 * k,
    }
  }

  // 줄 단위로 나눠 쪽을 채운다
  const rows: BoardPanel[][] = []
  for (let i = 0; i < panels.length; i += cols) rows.push(panels.slice(i, i + cols))

  interface Page {
    head: { svg: string; bottom: number }
    body: string[]
  }
  // 줄마다 그림 높이(원래 크기)와 결론 높이
  const noteW = cellW - C * 1.8
  const infos = rows.map((row) => {
    const notes = row.map((p) => {
      const t = p.conclusion.trim().replace(/^결론\s*[:：]?\s*/, '')
      return s.conclusions && t ? clampLines(wrap(`결론 ${t}`, C, noteW), 3, C, noteW) : []
    })
    const noteLines = Math.max(0, ...notes.map((n) => n.length))
    return { row, notes, imgH: cellW * Math.max(...row.map((p) => aspectOf(p.svg))), noteH: noteLines ? C * 0.9 + noteLines * C * 1.42 : 0 }
  })

  const pages: Page[] = []
  let idx = 0
  while (idx < infos.length) {
    const head = pages.length ? nextHead() : firstHead()
    const avail = bottom - head.bottom
    // 원래 크기로 몇 줄 들어가는지
    let n = 0
    let used = 0
    while (idx + n < infos.length) {
      const r = infos[idx + n]
      const need = r.imgH + r.noteH + (n ? G : 0)
      if (used + need > avail + 1e-6) break
      used += need
      n++
    }
    let scale = 1
    if (n === 0) {
      // 빈 쪽에도 안 들어가면 줄여서 한 줄
      n = 1
      scale = Math.max(0.3, (avail - infos[idx].noteH) / infos[idx].imgH)
    } else if (idx + n < infos.length) {
      // 남는 자리가 크면 그림을 조금(최대 25%) 줄여 한 줄 더
      const set = infos.slice(idx, idx + n + 1)
      const fixed = set.reduce((a, r) => a + r.noteH, 0) + G * n
      const sc = (avail - fixed) / set.reduce((a, r) => a + r.imgH, 0)
      if (sc >= 0.75) {
        n += 1
        scale = Math.min(1, sc)
      }
    }
    const body: string[] = []
    let y = head.bottom
    for (const { row, notes, imgH: ih, noteH } of infos.slice(idx, idx + n)) {
      const imgH = ih * scale
      row.forEach((p, i) => {
        const x = M + i * (cellW + G)
        const dw = cellW * scale
        const dx = x + (cellW - dw) / 2
        const ph = dw * aspectOf(p.svg)
        body.push(
          `<image x="${dx.toFixed(2)}" y="${y.toFixed(2)}" width="${dw.toFixed(2)}" height="${ph.toFixed(2)}" preserveAspectRatio="xMidYMin meet" xlink:href="data:image/svg+xml;base64,${b64(p.svg)}"/>`,
        )
        const lines = notes[i]
        if (lines.length) {
          const ty = y + imgH + C * 0.9
          body.push(
            `<rect x="${x.toFixed(2)}" y="${(ty - C * 0.15).toFixed(2)}" width="${(0.7 * k).toFixed(2)}" height="${(lines.length * C * 1.42).toFixed(2)}" fill="${ACCENT}"/>`,
            ...lines.map(
              (l, j) =>
                `<text x="${(x + C * 1.6).toFixed(2)}" y="${(ty + C * 0.95 + j * C * 1.42).toFixed(2)}" font-size="${C.toFixed(2)}" fill="${INK}">${j === 0 ? `<tspan font-weight="700">결론</tspan> ${esc(l.replace(/^결론\s*/, ''))}` : esc(l)}</text>`,
            ),
          )
        }
      })
      y += imgH + noteH + G
    }
    pages.push({ head, body })
    idx += n
  }
  if (!pages.length) pages.push({ head: firstHead(), body: [] })

  return pages.map((p, i) => {
    const fy = h - M * 0.55
    const foot = `<g id="바닥글"><text x="${M}" y="${fy.toFixed(2)}" font-size="${F.toFixed(2)}" fill="${SUBTLE}">${esc(head.footer)}</text><text x="${(w - M).toFixed(2)}" y="${fy.toFixed(2)}" font-size="${F.toFixed(2)}" fill="${SUBTLE}" text-anchor="end">${i + 1} / ${pages.length}</text></g>`
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" font-family="${esc(FONT)}">`,
      `<rect id="바탕" width="${w}" height="${h}" fill="#ffffff"/>`,
      p.head.svg,
      `<g id="도판">${p.body.join('')}</g>`,
      foot,
      '</svg>',
    ].join('')
  })
}

/** 300dpi PNG 가로 픽셀 */
export function boardPngWidth(s: BoardSettings): number {
  return Math.round((paperSize(s).w / 25.4) * 300)
}
