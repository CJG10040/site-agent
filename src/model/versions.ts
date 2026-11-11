// 조사 버전 (Phase 12): 해석의 시점별 기록을 저장하고 두 시점을 비교한다.
// 사용자 결정(2026-11-11): 학생이 '버전 저장'(이름 붙임) + 자동(다시 수집 직전·리포트 인쇄 때).
// 버전은 프로젝트와 따로 IndexedDB 'versions'에 둔다 (프로젝트는 고칠 때마다 저장되므로 그 안에 넣으면 무거워짐).
// 수집한 원자료는 넣지 않고(크기), 해석에 해당하는 것만: 카드·도판 결론·요약문·첫 질문·과제·종합 다이어그램.

import { areaM2, siteBoundary } from '../lib/geo'
import { siteKey } from './project'
import { REACTION_LABEL, TYPE_LABEL } from './prompts'
import { FB_STATUS_LABEL } from './feedback'
import { symLabel } from '../diagrams/synthSymbols'
import type { Brief, Card, CardType, Feedback, FirstQuestion, Project, SynthState } from './types'

export type VersionTrigger = 'manual' | 'recollect' | 'print' | 'feedback'

export const TRIGGER_LABEL: Record<VersionTrigger, string> = { manual: '직접 저장', recollect: '다시 수집 전 자동', print: '리포트 인쇄 때 자동', feedback: '피드백 받을 때' }

export interface VersionSnap {
  brief: Brief
  question: FirstQuestion
  site: { address: string; radiusM: number; areaM2: number | null; siteKey: string }
  collectedAt: string | null
  cards: Card[]
  /** 도판 id → 결론 한 문장 */
  conclusions: Record<string, string>
  panelSummary: string
  synth: SynthState | null
  /** 피드백과 반영 (예전 버전에는 없음) */
  feedback?: Feedback[]
}

export interface VersionRecord {
  id: string
  projectId: string
  name: string
  createdAt: string
  trigger: VersionTrigger
  snap: VersionSnap
}

export const CARD_ORDER: CardType[] = ['FACT', 'OBSERVATION', 'UNKNOWN', 'INTERPRETATION', 'TENSION', 'OPPORTUNITY', 'QUESTION', 'HYPOTHESIS']

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export function snapshotOf(p: Project): VersionSnap {
  const b = siteBoundary(p.site)
  const conclusions: Record<string, string> = {}
  for (const [id, n] of Object.entries(p.diagrams?.panels ?? {})) if (n.conclusion?.trim()) conclusions[id] = n.conclusion.trim()
  return clone({
    brief: p.brief,
    question: p.question,
    site: {
      address: p.site.address?.road || p.site.address?.parcel || p.site.parcels[0]?.addr || '',
      radiusM: p.site.radiusM,
      areaM2: b ? Math.round(areaM2(b)) : null,
      siteKey: siteKey(p.site),
    },
    collectedAt: p.collectedAt,
    cards: p.cards,
    conclusions,
    panelSummary: p.panelSummary ?? '',
    synth: p.synth ?? null,
    feedback: p.feedback ?? [],
  })
}

/** 해석이 같은지 (자동 저장에서 바뀐 것이 없으면 건너뜀) */
export function sameSnap(a: VersionSnap, b: VersionSnap): boolean {
  const key = (s: VersionSnap) =>
    JSON.stringify([
      s.cards.map((c) => [c.id, c.type, c.text, c.status, c.reaction ?? null, c.user_note, c.fields ?? null]),
      s.conclusions,
      s.panelSummary,
      s.question,
      s.synth?.items ?? [],
      (s.feedback ?? []).map((f) => [f.id, f.text, f.status, f.response]),
    ])
  return key(a) === key(b)
}

/** 살아 있는(제외하지 않은) 카드 수 */
export function countsOf(s: VersionSnap): Record<CardType, number> {
  const out = Object.fromEntries(CARD_ORDER.map((t) => [t, 0])) as Record<CardType, number>
  for (const c of s.cards) if (c.status !== 'rejected') out[c.type]++
  return out
}

export function countsText(s: VersionSnap): string {
  const n = countsOf(s)
  const parts = CARD_ORDER.filter((t) => n[t]).map((t) => `${TYPE_LABEL[t]} ${n[t]}`)
  const concl = Object.keys(s.conclusions).length
  const synth = s.synth?.items.length ?? 0
  return [...parts, concl ? `도판 결론 ${concl}` : '', synth ? `종합 기호 ${synth}` : ''].filter(Boolean).join(' · ') || '카드 없음'
}

// ───────────────────────── 비교 ─────────────────────────

export interface CardChange {
  id: string
  type: CardType
  kind: 'added' | 'removed' | 'changed'
  before?: Card
  after?: Card
  /** 바뀐 것 설명 (예: '내용', '상태: 검토 중 → 확인') */
  changes: string[]
}

export interface VersionDiff {
  counts: { type: CardType; label: string; a: number; b: number }[]
  cards: CardChange[]
  conclusions: { id: string; before: string; after: string }[]
  summary: { before: string; after: string } | null
  question: { label: string; before: string; after: string }[]
  synth: { a: number; b: number; added: string[]; removed: string[] }
  /** 피드백: 새로 적은 것, 반영 상태가 바뀐 것 */
  feedback: { added: Feedback[]; changed: { id: string; text: string; before: string; after: string; response: string }[] }
  siteChanged: boolean
  recollected: boolean
}

const STATUS_LABEL: Record<string, string> = { draft: '검토 중', confirmed: '확인', rejected: '제외' }

export function cardTitleOf(c: Card): string {
  return c.fields?.['제목'] || c.text
}

function synthLabels(s: SynthState | null, cards: Card[]): string[] {
  const byId = new Map(cards.map((c) => [c.id, c]))
  return (s?.items ?? []).map((i) => {
    if (i.kind === 'card') {
      const c = i.cardId ? byId.get(i.cardId) : undefined
      return `카드 ${i.cardId ?? ''} ${i.label.trim() || (c ? cardTitleOf(c) : '')}`.trim()
    }
    return `${symLabel(i)}: ${i.label.trim() || '(글 없음)'}`
  })
}

/** a(이전) → b(나중) */
export function diffVersions(a: VersionSnap, b: VersionSnap): VersionDiff {
  const ca = countsOf(a)
  const cb = countsOf(b)
  const counts = CARD_ORDER.map((t) => ({ type: t, label: TYPE_LABEL[t], a: ca[t], b: cb[t] })).filter((x) => x.a || x.b)

  const A = new Map(a.cards.map((c) => [c.id, c]))
  const B = new Map(b.cards.map((c) => [c.id, c]))
  const cards: CardChange[] = []
  for (const c of b.cards) {
    const prev = A.get(c.id)
    if (!prev || (prev.status === 'rejected' && c.status !== 'rejected')) {
      if (c.status !== 'rejected') cards.push({ id: c.id, type: c.type, kind: 'added', after: c, changes: [] })
      continue
    }
    if (c.status === 'rejected' && prev.status !== 'rejected') {
      cards.push({ id: c.id, type: c.type, kind: 'removed', before: prev, after: c, changes: ['제외함'] })
      continue
    }
    const ch: string[] = []
    if (prev.text !== c.text) ch.push('내용')
    if (JSON.stringify(prev.fields ?? {}) !== JSON.stringify(c.fields ?? {})) {
      const keys = new Set([...Object.keys(prev.fields ?? {}), ...Object.keys(c.fields ?? {})])
      const changed = [...keys].filter((k) => (prev.fields?.[k] ?? '') !== (c.fields?.[k] ?? ''))
      if (changed.length) ch.push(changed.join('·'))
    }
    if (prev.status !== c.status) ch.push(`상태: ${STATUS_LABEL[prev.status] ?? prev.status} → ${STATUS_LABEL[c.status] ?? c.status}`)
    if ((prev.reaction ?? null) !== (c.reaction ?? null))
      ch.push(`반응: ${prev.reaction ? REACTION_LABEL[prev.reaction] : '없음'} → ${c.reaction ? REACTION_LABEL[c.reaction] : '없음'}`)
    if (prev.user_note !== c.user_note) ch.push('메모')
    if (ch.length) cards.push({ id: c.id, type: c.type, kind: 'changed', before: prev, after: c, changes: ch })
  }
  for (const c of a.cards) if (!B.has(c.id) && c.status !== 'rejected') cards.push({ id: c.id, type: c.type, kind: 'removed', before: c, changes: ['지워짐'] })
  cards.sort((x, y) => CARD_ORDER.indexOf(x.type) - CARD_ORDER.indexOf(y.type) || x.id.localeCompare(y.id))

  const ids = new Set([...Object.keys(a.conclusions), ...Object.keys(b.conclusions)])
  const conclusions = [...ids].filter((id) => (a.conclusions[id] ?? '') !== (b.conclusions[id] ?? '')).map((id) => ({ id, before: a.conclusions[id] ?? '', after: b.conclusions[id] ?? '' }))

  const qLabels: [keyof FirstQuestion, string][] = [
    ['curiosity', '가장 궁금한 것'],
    ['personal', '이 대지를 고른 이유'],
    ['avoid', '피하고 싶은 해석'],
  ]
  const question = qLabels
    .filter(([k]) => String(a.question[k] ?? '') !== String(b.question[k] ?? ''))
    .map(([k, label]) => ({ label, before: String(a.question[k] ?? ''), after: String(b.question[k] ?? '') }))
  const la = [...a.question.lenses, a.question.lensOther].filter(Boolean).join(', ')
  const lb = [...b.question.lenses, b.question.lensOther].filter(Boolean).join(', ')
  if (la !== lb) question.push({ label: '관심 관점', before: la, after: lb })

  const sa = synthLabels(a.synth, a.cards)
  const sb = synthLabels(b.synth, b.cards)
  const fa = new Map((a.feedback ?? []).map((f) => [f.id, f]))
  const fbAdded = (b.feedback ?? []).filter((f) => !fa.has(f.id))
  const fbChanged = (b.feedback ?? [])
    .filter((f) => fa.has(f.id) && fa.get(f.id)!.status !== f.status)
    .map((f) => ({ id: f.id, text: f.text, before: FB_STATUS_LABEL[fa.get(f.id)!.status], after: FB_STATUS_LABEL[f.status], response: f.response }))
  return {
    feedback: { added: fbAdded, changed: fbChanged },
    counts,
    cards,
    conclusions,
    summary: a.panelSummary.trim() !== b.panelSummary.trim() ? { before: a.panelSummary, after: b.panelSummary } : null,
    question,
    synth: { a: sa.length, b: sb.length, added: sb.filter((x) => !sa.includes(x)), removed: sa.filter((x) => !sb.includes(x)) },
    siteChanged: a.site.siteKey !== b.site.siteKey,
    recollected: (a.collectedAt ?? '') !== (b.collectedAt ?? ''),
  }
}

export function diffHeadline(d: VersionDiff): string {
  const added = d.cards.filter((c) => c.kind === 'added').length
  const removed = d.cards.filter((c) => c.kind === 'removed').length
  const changed = d.cards.filter((c) => c.kind === 'changed').length
  const parts = [
    // 카드 변화는 처음 나오는 것에만 '카드'를 붙인다 (예: 카드 1개 생김, 2개 바뀜 / 카드 1개 바뀜)
    [added ? `${added}개 생김` : '', removed ? `${removed}개 빠짐` : '', changed ? `${changed}개 바뀜` : '']
      .filter(Boolean)
      .map((s, i) => (i === 0 ? `카드 ${s}` : s))
      .join(', '),
    d.conclusions.length ? `도판 결론 ${d.conclusions.length}개 바뀜` : '',
    d.synth.added.length || d.synth.removed.length ? `종합 다이어그램 기호 +${d.synth.added.length} −${d.synth.removed.length}` : '',
    d.question.length ? '첫 질문 바뀜' : '',
    d.summary ? '요약문 바뀜' : '',
    d.feedback.added.length ? `피드백 ${d.feedback.added.length}개 적음` : '',
    d.feedback.changed.length ? `피드백 반영 상태 ${d.feedback.changed.length}개 바뀜` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : '바뀐 것 없음'
}
