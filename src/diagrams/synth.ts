// 종합 다이어그램 (Phase 12): 긴장·기회·가설 카드를 지도에 놓고 화살표·영역·포인트·글상자로 대지해석을 한 장에 모은다.
// 사용자 결정(2026-11-11): 카드에서 놓고 직접 그리기 / 기호 = 화살표·영역·포인트(점·별·번개)·글상자 /
// 바탕 = 회색 건물·도로(기본), 다른 도판을 골라 연하게 깔 수 있음 / ⑧ 해석·가설 탭에서 그리고 ⑨ 리포트·보드에는 마지막 도판으로.

import { cardTitle } from '../model/prompts'
import type { Card, Project, SynthItem, SynthState, SynthTone } from '../model/types'
import type { LegendItem, PanelLayer, PanelOutput } from './compose'
import { mix } from './palette'
import type { PanelCtx, PanelDef } from './panels'
import { SYM_ORDER, SYMS, symGlyph, symOf, synthItemsSvg, TONE_ORDER, TONES, weightGlyph, type SynthCard } from './synthSymbols'

// 기호·색·그리기는 synthSymbols.ts (2판)
export { synthItemsSvg, TONE_ORDER, TONES, type SynthCard } from './synthSymbols'

/** 1판 이름 (도판 요약 등) */
export const KIND_LABEL: Record<SynthItem['kind'], string> = { arrow: '화살표', line: '선', vector: '두 점 기호', area: '영역', point: '포인트', note: '글상자', card: '카드' }

/** 카드의 '방향' 칸 → 색 */
export function toneOfDirection(dir: string | undefined): SynthTone {
  const v = dir ?? ''
  if (v.includes('보존')) return 'keep'
  if (v.includes('드러')) return 'reveal'
  if (v.includes('피할') || v.includes('피하')) return 'avoid'
  if (v.includes('변환')) return 'transform'
  return 'neutral'
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

/** 카드 번호 모양 (F-03, O-12 …) */
const CARD_ID_RE = /\b[FOITPQHU]-\d{2,}\b/g

const uniq = (a: string[]) => [...new Set(a)]

/** 카드의 근거 카드 번호: 관련 카드 + '근거' 칸에 적힌 번호 */
export function cardRefs(c: Card): string[] {
  return uniq([...(c.related_card_ids ?? []), ...((c.fields?.['근거'] ?? '').match(CARD_ID_RE) ?? [])]).filter((id) => id !== c.id)
}

export interface Evidence {
  cards: string[]
  panels: string[]
}

/** 기호의 근거 (2판 12-B): 직접 이은 카드·도판 + 카드 배지는 그 카드와 카드의 근거 */
export function evidenceOf(it: SynthItem, cards: Record<string, SynthCard>): Evidence {
  const own = it.kind === 'card' && it.cardId ? [it.cardId, ...(cards[it.cardId]?.refs ?? [])] : []
  return { cards: uniq([...own, ...(it.evidence?.cards ?? [])]), panels: uniq(it.evidence?.panels ?? []) }
}

export function hasEvidence(ev: Evidence): boolean {
  return ev.cards.length + ev.panels.length > 0
}

/** 'F-03, O-02 · 도판 12 바람장미' */
export function evidenceText(ev: Evidence, panelLabel: (id: string) => string = (id) => `도판 ${id}`): string {
  return [ev.cards.join(', '), ev.panels.map(panelLabel).join(', ')].filter(Boolean).join(' · ')
}

/** 근거를 따지지 않는 기호 (글상자는 메모) */
export const needsEvidence = (it: SynthItem) => it.kind !== 'note'

export function synthCtxOf(project: Project): SynthCtx {
  return synthCtxFrom(project.cards, project.synth ?? null)
}

/** 카드와 그림만으로 (저장한 버전을 다시 그릴 때) */
export function synthCtxFrom(cardList: Card[], synth: SynthState | null): SynthCtx {
  const cards: Record<string, SynthCard> = {}
  for (const c of cardList) {
    if (!SYNTH_CARD_TYPES.has(c.type) || c.status === 'rejected') continue
    cards[c.id] = { id: c.id, title: cardTitle(c), type: c.type, tone: toneOfDirection(c.fields?.['방향']), refs: cardRefs(c) }
  }
  return { state: { ...SYNTH_DEFAULT, ...(synth ?? {}) }, cards }
}

/** 도판 바탕으로 쓰지 않는 것 (지도가 아닌 그림) */
export const NOT_MAP_PANELS = new Set(['sectionA', 'sectionB', 'storesCompare', 'poiReach', 'skyDome', 'wind', 'synth'])

function summaryOf(items: SynthItem[], cards: Record<string, SynthCard>, panelLabel?: (id: string) => string): string[] {
  return items.map((it) => {
    const ev = evidenceOf(it, cards)
    const evText = needsEvidence(it) ? (hasEvidence(ev) ? ` — 근거: ${evidenceText(ev, panelLabel)}` : ' — 근거 없음') : ''
    return summaryLine(it, cards) + evText
  })
}

/** 기호 한 줄 (도판 요약·리포트 표) */
export function summaryLine(it: SynthItem, cards: Record<string, SynthCard>): string {
  const tone = TONES[it.tone].label
  if (it.kind === 'card') {
    const c = it.cardId ? cards[it.cardId] : undefined
    return `카드 ${it.cardId ?? ''} (${c ? CARD_TYPE_LABEL[c.type] : '?'}, ${tone}): ${it.label.trim() || c?.title || ''}`
  }
  const sym = symOf(it)
  const extra = [
    SYMS[sym].weighted && it.weight === 3 ? '주' : SYMS[sym].weighted && it.weight === 1 ? '작은 것' : '',
    it.both ? '양방향' : '',
    sym === 'view' ? `폭 ${it.spread ?? 60}°` : sym === 'buffer' ? `폭 ${it.spread ?? 15}m` : '',
  ].filter(Boolean)
  return `${SYMS[sym].label}${extra.length ? `(${extra.join(', ')})` : ''} · ${tone}: ${it.label.trim() || '(글 없음)'}`
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
  needs: '⑧ 해석·가설 › 종합 다이어그램에서 카드를 놓고 흐름·경계·영역 같은 기호를 그리면 들어갑니다.',
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
    // 범례: 색(방향 / 조건 먹색) → 기호 모양(먹색으로) → 굵기
    const used = TONE_ORDER.filter((t) => items.some((i) => i.tone === t))
    const legend: LegendItem[] = used.map((t) => ({ color: TONES[t].color, label: t === 'neutral' ? '조건 (방향 없음, 먹색)' : TONES[t].label }))
    const ink = TONES.neutral.color
    const syms = new Set(items.map(symOf))
    for (const sym of SYM_ORDER) if (syms.has(sym) && sym !== 'note' && sym !== 'card') legend.push({ color: ink, label: SYMS[sym].label, glyph: symGlyph(sym, ink) })
    const weights = new Set(items.filter((i) => SYMS[symOf(i)].weighted).map((i) => i.weight ?? 2))
    if (weights.size > 1) legend.push({ color: ink, label: '굵기 = 중요도 (주·부·작은 것)', glyph: weightGlyph(ink) })
    const hasCond = used.includes('neutral')
    const hasDir = used.some((t) => t !== 'neutral')
    const nCards = items.filter((i) => i.kind === 'card').length
    const judged = items.filter(needsEvidence)
    const nEv = { total: judged.length, linked: judged.filter((i) => hasEvidence(evidenceOf(i, s.cards))).length }
    return {
      layers: [...base, { id: '종합_기호', svg: synthItemsSvg(items, c.f, s.cards) }],
      legendTitle: hasCond && hasDir ? '먹색 = 대지의 조건 · 색 = 설계 방향' : hasDir ? '색 = 설계 방향' : '먹색 = 대지의 조건',
      legend,
      summary: summaryOf(items, s.cards, c.panelLabel),
      caption: `학생이 그린 종합 다이어그램 · 바탕: ${s.state.base === 'plain' ? '회색 건물·도로' : `${baseName} 도판(연하게)`}${nCards ? ` · 번호는 ⑧ 해석·가설의 카드(${nCards}장)` : ''}${nEv.total ? ` · 근거를 이은 기호 ${nEv.linked}/${nEv.total}개` : ''} · 해석이며 사실이 아님 — 근거는 카드의 출처와 도판을 볼 것`,
    }
  },
}
