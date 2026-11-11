// 종합 다이어그램 (Phase 12): 긴장·기회·가설 카드를 지도에 놓고 화살표·영역·포인트·글상자로 대지해석을 한 장에 모은다.
// 사용자 결정(2026-11-11): 카드에서 놓고 직접 그리기 / 기호 = 화살표·영역·포인트(점·별·번개)·글상자 /
// 바탕 = 회색 건물·도로(기본), 다른 도판을 골라 연하게 깔 수 있음 / ⑧ 해석·가설 탭에서 그리고 ⑨ 리포트·보드에는 마지막 도판으로.

import { cardTitle } from '../model/prompts'
import type { Card, Project, SynthItem, SynthState, SynthTone } from '../model/types'
import { esc, textWidth, wrap, type LegendItem, type PanelLayer, type PanelOutput } from './compose'
import type { Frame } from './frame'
import { mix } from './palette'
import type { PanelCtx, PanelDef } from './panels'

export const TONES: Record<SynthTone, { label: string; color: string }> = {
  keep: { label: '보존할 것', color: '#2e7d32' },
  reveal: { label: '드러낼 것', color: '#1f6fb2' },
  avoid: { label: '피할 것', color: '#c62828' },
  transform: { label: '변환할 것', color: '#e06c00' },
  neutral: { label: '그 밖', color: '#1d1d1b' },
}
export const TONE_ORDER: SynthTone[] = ['keep', 'reveal', 'avoid', 'transform', 'neutral']

export const KIND_LABEL: Record<SynthItem['kind'], string> = { arrow: '화살표', area: '영역', point: '포인트', note: '글상자', card: '카드' }

/** 카드의 '방향' 칸 → 색 */
export function toneOfDirection(dir: string | undefined): SynthTone {
  const v = dir ?? ''
  if (v.includes('보존')) return 'keep'
  if (v.includes('드러')) return 'reveal'
  if (v.includes('피할') || v.includes('피하')) return 'avoid'
  if (v.includes('변환')) return 'transform'
  return 'neutral'
}

export interface SynthCard {
  id: string
  title: string
  type: string
  tone: SynthTone
}

export interface SynthCtx {
  state: SynthState
  cards: Record<string, SynthCard>
  /** 편집 화면용: 기호 없이 바탕만 */
  baseOnly?: boolean
}

export const SYNTH_DEFAULT: SynthState = { items: [], base: 'plain', radius: null, updatedAt: '' }

export const SYNTH_CARD_TYPES = new Set(['TENSION', 'OPPORTUNITY', 'HYPOTHESIS'])
export const CARD_TYPE_LABEL: Record<string, string> = { TENSION: '긴장', OPPORTUNITY: '기회', HYPOTHESIS: '가설' }

export function synthCtxOf(project: Project): SynthCtx {
  return synthCtxFrom(project.cards, project.synth ?? null)
}

/** 카드와 그림만으로 (저장한 버전을 다시 그릴 때) */
export function synthCtxFrom(cardList: Card[], synth: SynthState | null): SynthCtx {
  const cards: Record<string, SynthCard> = {}
  for (const c of cardList) {
    if (!SYNTH_CARD_TYPES.has(c.type) || c.status === 'rejected') continue
    cards[c.id] = { id: c.id, title: cardTitle(c), type: c.type, tone: toneOfDirection(c.fields?.['방향']) }
  }
  return { state: { ...SYNTH_DEFAULT, ...(synth ?? {}) }, cards }
}

/** 도판 바탕으로 쓰지 않는 것 (지도가 아닌 그림) */
export const NOT_MAP_PANELS = new Set(['sectionA', 'sectionB', 'storesCompare', 'poiReach', 'skyDome', 'wind', 'synth'])

// ───────────────────────── 그리기 ─────────────────────────

const HALO = 'paint-order="stroke" stroke="#ffffff" stroke-width="4.5" stroke-linejoin="round"'

function label(x: number, y: number, text: string, color: string, size = 16, anchor: 'start' | 'middle' = 'middle', bold = true): string {
  if (!text.trim()) return ''
  const lines = wrap(text.trim(), size, 230).slice(0, 4)
  return lines
    .map(
      (l, i) =>
        `<text x="${x.toFixed(1)}" y="${(y + i * size * 1.25).toFixed(1)}" font-size="${size}" ${bold ? 'font-weight="700"' : ''} text-anchor="${anchor}" fill="${color}" ${HALO}>${esc(l)}</text>`,
    )
    .join('')
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, color: string, size = 18): string {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const p = (da: number, r: number) => `${(x2 + Math.cos(a + da) * r).toFixed(1)},${(y2 + Math.sin(a + da) * r).toFixed(1)}`
  return `<polygon points="${x2.toFixed(1)},${y2.toFixed(1)} ${p(Math.PI - 0.42, size)} ${p(Math.PI + 0.42, size)}" fill="${color}"/>`
}

function star(x: number, y: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.45 : r
    pts.push(`${(x + Math.cos(a) * rr).toFixed(1)},${(y + Math.sin(a) * rr).toFixed(1)}`)
  }
  return pts.join(' ')
}

function bolt(x: number, y: number, s: number): string {
  const p = [
    [0.15, -1],
    [-0.55, 0.12],
    [-0.05, 0.12],
    [-0.2, 1],
    [0.55, -0.15],
    [0.05, -0.15],
  ]
  return p.map(([a, b]) => `${(x + a * s).toFixed(1)},${(y + b * s).toFixed(1)}`).join(' ')
}

/** 꺾은선 길이의 가운데 점 */
function midOf(px: [number, number][]): [number, number] {
  let total = 0
  for (let i = 1; i < px.length; i++) total += Math.hypot(px[i][0] - px[i - 1][0], px[i][1] - px[i - 1][1])
  let acc = 0
  for (let i = 1; i < px.length; i++) {
    const L = Math.hypot(px[i][0] - px[i - 1][0], px[i][1] - px[i - 1][1])
    if (acc + L >= total / 2 && L > 0) {
      const t = (total / 2 - acc) / L
      return [px[i - 1][0] + (px[i][0] - px[i - 1][0]) * t, px[i - 1][1] + (px[i][1] - px[i - 1][1]) * t]
    }
    acc += L
  }
  return px[0]
}

function cardBadge(x: number, y: number, id: string, color: string): { svg: string; w: number } {
  const w = textWidth(id, 14) + 16
  return {
    svg: `<rect x="${(x - w / 2).toFixed(1)}" y="${(y - 13).toFixed(1)}" width="${w.toFixed(1)}" height="26" rx="13" fill="${color}" stroke="#ffffff" stroke-width="2"/><text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" font-size="14" font-weight="700" text-anchor="middle" fill="#ffffff">${esc(id)}</text>`,
    w,
  }
}

/** 기호들 (편집 화면과 완성 도판이 함께 씀) — 기호마다 data-id */
export function synthItemsSvg(items: SynthItem[], f: Frame, cards: Record<string, SynthCard>, selectedId: string | null = null, hit = false): string {
  // 영역 → 화살표 → 포인트·카드·글상자 순으로 (글이 위에 오게)
  const order: SynthItem['kind'][] = ['area', 'arrow', 'point', 'card', 'note']
  const out: string[] = []
  for (const kind of order)
    for (const it of items.filter((i) => i.kind === kind)) {
      const color = TONES[it.tone]?.color ?? TONES.neutral.color
      const px = it.pts.map(([lo, la]) => f.pt(lo, la))
      const sel = it.id === selectedId
      let body = ''
      if (it.kind === 'area' && px.length >= 3) {
        const d = `M${px.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`
        const cx = px.reduce((s, p) => s + p[0], 0) / px.length
        const cy = px.reduce((s, p) => s + p[1], 0) / px.length
        body = `<path d="${d}" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-width="${sel ? 4 : 2.5}" stroke-dasharray="10 6" stroke-linejoin="round"/>${label(cx, cy, it.label, color, 17)}`
      } else if (it.kind === 'arrow' && px.length >= 2) {
        const d = `M${px.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}`
        const [a, b] = [px[px.length - 2], px[px.length - 1]]
        const [mx, my] = midOf(px)
        body =
          // 편집 화면에서 가는 선도 쉽게 고르도록 보이지 않는 넓은 선
          (hit ? `<path d="${d}" fill="none" stroke="#000000" stroke-opacity="0" stroke-width="28" stroke-linecap="round"/>` : '') +
          `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="${sel ? 11 : 9}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.8"/>` +
          `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sel ? 7 : 5}" stroke-linecap="round" stroke-linejoin="round"/>` +
          arrowHead(a[0], a[1], b[0], b[1], color) +
          (it.both ? arrowHead(px[1][0], px[1][1], px[0][0], px[0][1], color) : '') +
          label(mx, my - 12, it.label, color, 16)
      } else if (it.kind === 'point' && px.length) {
        const [x, y] = px[0]
        const m = it.mark ?? 'dot'
        const shape =
          m === 'star'
            ? `<polygon points="${star(x, y, 15)}" fill="${color}" stroke="#ffffff" stroke-width="2"/>`
            : m === 'bolt'
              ? `<polygon points="${bolt(x, y, 17)}" fill="${color}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>`
              : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" fill="${color}" stroke="#ffffff" stroke-width="2.5"/>`
        body =
          (hit ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="22" fill="#000000" fill-opacity="0"/>` : '') +
          (sel ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="22" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4 3"/>` : '') +
          shape + label(x + 20, y + 5, it.label, color, 15, 'start')
      } else if (it.kind === 'card' && px.length) {
        const [x, y] = px[0]
        const card = it.cardId ? cards[it.cardId] : undefined
        const badge = cardBadge(x, y, it.cardId ?? '?', color)
        const text = it.label.trim() || card?.title || '(지운 카드)'
        body = (sel ? `<rect x="${(x - badge.w / 2 - 5).toFixed(1)}" y="${(y - 18).toFixed(1)}" width="${(badge.w + 10).toFixed(1)}" height="36" rx="18" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4 3"/>` : '') + badge.svg + label(x + badge.w / 2 + 6, y + 5, text, mix('#000000', color, 0.8), 15, 'start')
      } else if (it.kind === 'note' && px.length) {
        const [x, y] = px[0]
        const lines = wrap(it.label.trim() || '메모', 15, 230).slice(0, 6)
        const w = Math.max(60, ...lines.map((l) => textWidth(l, 15))) + 18
        const h = lines.length * 19 + 14
        let leader = ''
        if (px[1]) {
          const [tx, ty] = px[1]
          // 상자 가장자리에서 시작
          const cx = Math.min(Math.max(tx, x), x + w)
          const cy = Math.min(Math.max(ty, y), y + h)
          leader = `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="${color}" stroke-width="2"/><circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="4.5" fill="${color}"/>`
        }
        body =
          leader +
          `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="4" fill="#ffffff" fill-opacity="0.94" stroke="${color}" stroke-width="${sel ? 3.5 : 2}"/>` +
          lines.map((l, i) => `<text x="${(x + 9).toFixed(1)}" y="${(y + 22 + i * 19).toFixed(1)}" font-size="15" fill="${mix('#000000', color, 0.75)}">${esc(l)}</text>`).join('')
      }
      if (body) out.push(`<g data-id="${esc(it.id)}">${body}</g>`)
    }
  return out.join('')
}

function summaryOf(items: SynthItem[], cards: Record<string, SynthCard>): string[] {
  return items.map((it) => {
    const tone = TONES[it.tone].label
    if (it.kind === 'card') {
      const c = it.cardId ? cards[it.cardId] : undefined
      return `카드 ${it.cardId ?? ''} (${c ? CARD_TYPE_LABEL[c.type] : '?'}, ${tone}): ${it.label.trim() || c?.title || ''}`
    }
    const shape = it.kind === 'point' ? (it.mark === 'bolt' ? '긴장 지점' : it.mark === 'star' ? '중요한 곳' : '포인트') : KIND_LABEL[it.kind]
    return `${shape}${it.kind === 'arrow' && it.both ? '(양방향)' : ''} · ${tone}: ${it.label.trim() || '(글 없음)'}`
  })
}

function plainBase(c: PanelCtx): PanelLayer[] {
  const b = c.d.buildings.map((x) => c.f.path(x.geom, false)).join('')
  const r = c.d.roads.map((x) => c.f.path(x.geom)).join('')
  const areas = c.d.ngii?.roads.length ? `<path d="${c.d.ngii.roads.map((g) => c.f.path(g)).join('')}" fill="${mix('#ffffff', c.pal.ink, 0.07)}"/>` : ''
  return [
    { id: '바탕_도로', svg: `${areas}${r ? `<path d="${r}" fill="none" stroke="${mix('#ffffff', c.pal.ink, 0.2)}" stroke-width="1" stroke-linecap="round"/>` : ''}` },
    { id: '바탕_건물', svg: b ? `<path d="${b}" fill="${mix('#ffffff', c.pal.ink, 0.16)}"/>` : '' },
  ]
}

export const SYNTH_PANEL: PanelDef = {
  id: 'synth',
  title: '종합 다이어그램',
  group: '종합',
  needs: '⑧ 해석·가설 › 종합 다이어그램에서 카드를 놓고 화살표·영역·메모를 그리면 들어갑니다.',
  frameR: (d, x) => {
    const r = x?.synth?.state.radius
    return r && r > 0 ? Math.min(r, d.R) : d.R
  },
  render: async (c): Promise<PanelOutput> => {
    const s = c.synth
    const items = s?.state.items ?? []
    if (!s || (!items.length && !s.baseOnly)) {
      return { layers: plainBase(c), legend: [], summary: [], caption: '', empty: '⑧ 해석·가설 › 종합 다이어그램에서 그리세요' }
    }
    // 바탕
    let base: PanelLayer[] = plainBase(c)
    let baseName = '회색 건물·도로'
    if (s.state.base !== 'plain' && c.basePanel) {
      const o = await c.basePanel(s.state.base).catch(() => null)
      if (o && !o.empty && !o.noFrame) {
        base = o.layers.map((l) => ({ ...l, id: `바탕_${l.id}`, svg: `<g opacity="0.45">${l.svg}</g>` }))
        baseName = o.legendTitle ? `${o.legendTitle}` : s.state.base
      }
    }
    if (s.baseOnly) return { layers: base, legend: [], summary: [], caption: '' }
    const used = TONE_ORDER.filter((t) => items.some((i) => i.tone === t))
    const legend: LegendItem[] = used.map((t) => ({ color: TONES[t].color, label: TONES[t].label }))
    const kinds = new Set(items.map((i) => (i.kind === 'point' ? `point-${i.mark ?? 'dot'}` : i.kind)))
    if (kinds.has('arrow')) legend.push({ color: TONES.neutral.color, label: '화살표: 흐름·축·시선', shape: 'line' })
    if (kinds.has('area')) legend.push({ color: TONES.neutral.color, label: '영역 (점선)', shape: 'outline' })
    if (kinds.has('point-bolt')) legend.push({ color: TONES.neutral.color, label: '번개: 긴장 지점', shape: 'dot' })
    if (kinds.has('point-star')) legend.push({ color: TONES.neutral.color, label: '별: 중요한 곳', shape: 'dot' })
    const nCards = items.filter((i) => i.kind === 'card').length
    return {
      layers: [...base, { id: '종합_기호', svg: synthItemsSvg(items, c.f, s.cards) }],
      legendTitle: '색 = 설계 방향',
      legend,
      summary: summaryOf(items, s.cards),
      caption: `학생이 그린 종합 다이어그램 · 바탕: ${s.state.base === 'plain' ? '회색 건물·도로' : `${baseName} 도판(연하게)`}${nCards ? ` · 번호는 ⑧ 해석·가설의 카드(${nCards}장)` : ''} · 해석이며 사실이 아님 — 근거는 카드의 출처를 볼 것`,
    }
  },
}
