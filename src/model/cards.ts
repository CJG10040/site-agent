// 카드 보드에서 쓰는 도우미: 반응(F-12), 근거 추적, MVP 진행

import { isAiCard, isRelation } from './prompts'
import { nowIso } from './project'
import type { Card, Project, Reaction } from './types'

/** 반응에 따른 상태: 동의 계열은 확인, '중요하지 않음'은 제외, 나머지는 검토 중 */
export function setReaction(card: Card, reaction: Reaction | null): void {
  card.reaction = reaction
  card.status = reaction === 'unimportant' ? 'rejected' : reaction === 'agree' || reaction === 'partial' || reaction === 'develop' ? 'confirmed' : 'draft'
  card.updated_at = nowIso()
}

export function patchCard(project: Project, id: string, fn: (c: Card) => void): void {
  const c = project.cards.find((x) => x.id === id)
  if (!c) return
  fn(c)
  c.updated_at = nowIso()
}

/** 카드 → 그 카드를 근거로 쓴 카드들 */
export function dependents(project: Project): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const c of project.cards) for (const r of c.related_card_ids) m.set(r, [...(m.get(r) ?? []), c.id])
  return m
}

/** 선택한 카드의 위(근거)·아래(파생) 줄기 전체 */
export function lineage(project: Project, id: string): Set<string> {
  const byId = new Map(project.cards.map((c) => [c.id, c]))
  const deps = dependents(project)
  const seen = new Set<string>([id])
  const up = [id]
  while (up.length) {
    const cur = byId.get(up.pop()!)
    for (const r of cur?.related_card_ids ?? []) if (!seen.has(r)) seen.add(r), up.push(r)
  }
  const down = [id]
  const seenDown = new Set<string>([id])
  while (down.length) {
    for (const d of deps.get(down.pop()!) ?? []) if (!seenDown.has(d)) seenDown.add(d), seen.add(d), down.push(d)
  }
  return seen
}

export interface MvpProgress {
  label: string
  value: number
  target: number
}

/** 요청서 12장 MVP 성공 기준 */
export function mvpProgress(project: Project): MvpProgress[] {
  const live = project.cards.filter((c) => c.status !== 'rejected')
  return [
    { label: '확인한 사실', value: live.filter((c) => c.type === 'FACT' && c.status === 'confirmed').length, target: 5 },
    { label: '현장 관찰', value: live.filter((c) => c.type === 'OBSERVATION' && c.text.trim()).length, target: 5 },
    { label: '관계', value: live.filter(isRelation).length, target: 5 },
    { label: '긴장', value: live.filter((c) => c.type === 'TENSION').length, target: 3 },
    { label: '설계 질문', value: live.filter((c) => c.type === 'QUESTION').length, target: 3 },
    { label: '설계 가설', value: live.filter((c) => c.type === 'HYPOTHESIS').length, target: 3 },
  ]
}

export function aiCards(project: Project): Card[] {
  return project.cards.filter(isAiCard)
}
