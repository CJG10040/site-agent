// 교수 피드백 (Phase 12): 크리틱에서 받은 말을 카드·도판에 잇고 반영했는지 기록한다.
// 사용자 결정(2026-11-11): 피드백마다 날짜·누가·내용·관련 카드·도판·반영 상태(반영함·보류·다르게 판단)·어떻게 반영했는지, 리포트에 넣기.

import type { Feedback, FeedbackStatus, Project } from './types'

export const FB_STATUS: FeedbackStatus[] = ['open', 'applied', 'hold', 'disagree']

export const FB_STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: '아직 안 정함',
  applied: '반영함',
  hold: '보류',
  disagree: '다르게 판단',
}

export const FB_WHO = ['교수', '조교', '동료', '외부 전문가']

export const FB_RESPONSE_HINT: Record<FeedbackStatus, string> = {
  open: '어떻게 할지 정하면 적으세요',
  applied: '어떻게 반영했는지 (예: 가설 H-02의 공간적 행동을 골목 쪽 마당으로 바꿈)',
  hold: '왜 보류했는지, 무엇을 더 확인해야 하는지',
  disagree: '왜 다르게 판단했는지 (근거 카드 번호와 함께)',
}

export function feedbackOf(project: Project): Feedback[] {
  return project.feedback ?? []
}

export function feedbackForCard(project: Project, cardId: string): Feedback[] {
  return feedbackOf(project).filter((f) => f.cardIds.includes(cardId))
}

export function feedbackForPanel(project: Project, panelId: string): Feedback[] {
  return feedbackOf(project).filter((f) => f.panelIds.includes(panelId))
}

/** 챗봇 프롬프트에 넣는 피드백 (다음 해석 단계가 피드백을 고려하도록) */
export function feedbackBlock(project: Project, panelTitle: (id: string) => string = (id) => id): string {
  const list = feedbackOf(project)
  if (!list.length) return ''
  const lines = ['## 받은 피드백과 학생의 판단 (해석할 때 고려하되, 학생이 다르게 판단한 것은 그 판단을 존중하세요)']
  for (const f of list) {
    const refs = [...f.cardIds, ...f.panelIds.map((p) => `도판 「${panelTitle(p)}」`)].join(', ')
    lines.push(
      `- ${f.id} [${f.date} ${f.who}${f.occasion ? `, ${f.occasion}` : ''}] ${f.text.trim().slice(0, 300)}${refs ? ` (관련: ${refs})` : ''} → ${FB_STATUS_LABEL[f.status]}${f.response.trim() ? `: ${f.response.trim().slice(0, 200)}` : ''}`,
    )
  }
  return lines.join('\n')
}

export function feedbackCounts(list: Feedback[]): Record<FeedbackStatus, number> {
  const out = { open: 0, applied: 0, hold: 0, disagree: 0 } as Record<FeedbackStatus, number>
  for (const f of list) out[f.status]++
  return out
}
