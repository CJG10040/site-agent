// 도판 결론 제안: 챗봇 프롬프트 만들기 + 답변에서 도판별 결론 꺼내기.

import { contextBlock } from '../model/prompts'
import type { Project } from '../model/types'
import type { PanelOutput } from './compose'
import { ORDERED_PANELS, panelNumber } from './panels'

export interface PanelForPrompt {
  id: string
  out: PanelOutput
}

export function buildPanelPrompt(project: Project, panels: PanelForPrompt[]): string {
  const notes = project.diagrams?.panels ?? {}
  const lines: string[] = []
  lines.push(
    '당신은 건축학과 학생의 대지분석을 돕는 조교입니다. 학생은 대지분석 도판(다이어그램)을 여러 장 만들었고, 도판마다 **결론 한 문장**을 붙이려 합니다.',
    '"판단 없는 사실 나열"이 대지분석에서 가장 흔한 실수입니다. 도판이 보여 주는 사실에서 대지에 대해 무엇을 판단할 수 있는지 한 문장으로 써 주세요.',
  )
  lines.push('', contextBlock(project))
  lines.push('', '## 도판과 도판에서 읽은 수치')
  for (const p of panels) {
    const def = ORDERED_PANELS.find((d) => d.id === p.id)
    if (!def || p.out.empty || p.out.summary.length === 0) continue
    lines.push('', `### 도판 ${panelNumber(p.id)} · ${def.title} (id: ${p.id})`)
    for (const s of p.out.summary) lines.push(`- ${s}`)
    if (p.out.caption) lines.push(`- 자료와 한계: ${p.out.caption}`)
    const mine = notes[p.id]?.conclusion?.trim()
    if (mine) lines.push(`- 학생이 지금 쓴 결론: ${mine}`)
  }
  lines.push(
    '',
    '## 요청',
    '각 도판마다 결론 후보를 **두 개씩** 제안하세요.',
    '- 결론1: 수치에서 바로 읽히는 현실적인 판단',
    '- 결론2: 사람·시간·관계처럼 다른 각도에서 본 판단 (학생의 첫 질문과 관점을 참고)',
    '',
    '## 지켜 주세요',
    '- 위 수치와 한계에 있는 것만 근거로 쓰고, 없는 사실을 지어내지 마세요.',
    '- 한 문장, 60자 안팎. "~이므로 ~" 처럼 읽은 사실과 판단을 함께 쓰세요.',
    '- 설계안을 정답처럼 정하지 말고 "~을 고려해야 한다", "~일 수 있다" 수준으로 쓰세요.',
    '- 미상이 많거나 자료가 부족해 판단하기 어려우면 그렇다고 쓰세요.',
    '- 학생이 이미 쓴 결론이 있으면 그것을 다듬은 안을 결론1로 주세요.',
    '',
    '## 답변 형식 (꼭 지켜 주세요 — 학생의 프로그램이 이 형식을 읽어 도판에 붙입니다)',
    '도판마다 아래처럼 쓰고, 다른 설명은 붙이지 마세요.',
    '',
    '### [도판] 도판id',
    '결론1: …',
    '결론2: …',
    '',
    '예시:',
    '### [도판] use',
    '결론1: 대지 주변 20m가 근린생활시설로 둘러싸여 있으므로 1층의 가로 연속성을 고려해야 한다.',
    '결론2: 낮에는 상가, 밤에는 비는 거리일 수 있어 시간대에 따라 다른 쓰임을 생각할 수 있다.',
  )
  return lines.join('\n')
}

/** 답변에서 도판별 결론 후보 꺼내기 */
export function parsePanelAnswer(text: string): { byId: Record<string, string[]>; unknown: string[] } {
  const byId: Record<string, string[]> = {}
  const unknown: string[] = []
  const header = /^#{1,4}\s*\[?\s*도판\s*\]?\s*(.+)$/
  let current: string | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\*\*/g, '').trim()
    const h = line.match(header)
    if (h) {
      const key = h[1].trim()
      const byIdHit = ORDERED_PANELS.find((p) => key.split(/[\s·(:]/).includes(p.id) || key.includes(`id: ${p.id}`))
      const byTitle =
        ORDERED_PANELS.find((p) => key.includes(p.title)) ?? ORDERED_PANELS.find((p) => key.includes(p.title.replace(/\s*\(.*\)$/, '')))
      const def = byIdHit ?? byTitle
      current = def ? def.id : null
      if (!def) unknown.push(key)
      continue
    }
    if (!current) continue
    const m = line.match(/^[-·•]?\s*결론\s*\d?\s*[:：]\s*(.+)$/)
    if (m && m[1].trim()) (byId[current] ??= []).push(m[1].trim())
  }
  return { byId, unknown }
}
