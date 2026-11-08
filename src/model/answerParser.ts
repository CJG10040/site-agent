// 챗봇 답변 → 카드 (계획서 4.3)
//  - `### [유형] N번호` 블록을 찾고, 그 아래 `항목명: 내용` 줄을 읽는다 (여러 줄 내용 허용)
//  - 근거 번호를 정리(F-3 → F-03)하고, 프로젝트에 없는 번호는 '근거 확인 필요'로 표시
//  - 형식에 맞지 않는 부분은 버리지 않고 '분류되지 않은 답변'으로 돌려준다

import { makeCard, newId, nowIso } from './project'
import type { Card, CardType, ChatSession, Project, RoundId } from './types'

export type ParsedTag = CardType | 'RELATION' | 'SUMMARY'

const TAGS: Record<string, ParsedTag> = {
  관계: 'RELATION',
  RELATION: 'RELATION',
  긴장: 'TENSION',
  TENSION: 'TENSION',
  기회: 'OPPORTUNITY',
  OPPORTUNITY: 'OPPORTUNITY',
  해석: 'INTERPRETATION',
  INTERPRETATION: 'INTERPRETATION',
  질문: 'QUESTION',
  '설계 질문': 'QUESTION',
  QUESTION: 'QUESTION',
  가설: 'HYPOTHESIS',
  '설계 가설': 'HYPOTHESIS',
  HYPOTHESIS: 'HYPOTHESIS',
  미확인: 'UNKNOWN',
  UNKNOWN: 'UNKNOWN',
  요약: 'SUMMARY',
  SUMMARY: 'SUMMARY',
}

const FIELD_KEYS = [
  '근거',
  '관계 유형',
  '내용',
  '확신도',
  '제목',
  '방향',
  '확인 필요',
  '관점',
  '반전 질문',
  '질문 유형',
  '스케일',
  '해석',
  '해결하려는 긴장',
  '공간적 행동',
  '예상 경험',
  '예상되는 사용자 경험',
  '장점',
  '위험',
  '위험 또는 부작용',
  '추가 조사',
  '확인 방법',
]

const KEY_ALIAS: Record<string, string> = {
  '예상되는 사용자 경험': '예상 경험',
  '위험 또는 부작용': '위험',
  '추가로 필요한 조사': '추가 조사',
  '근거가 된 사실': '근거',
}

export interface ParsedItem {
  key: string // 미리보기에서 고르기용
  tag: ParsedTag
  label: string | null // N1 등
  text: string
  fields: Record<string, string>
  refs: string[] // 정리된 근거 번호 (F-03, N2 …)
  invalidRefs: string[]
  confidence: Card['confidence']
}

export interface ParseResult {
  items: ParsedItem[]
  leftover: string
  warnings: string[]
}

const HEADER = new RegExp(
  `^\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?\\[\\s*(${Object.keys(TAGS)
    .map((t) => t.replace(/ /g, '\\s*'))
    .join('|')})\\s*\\](?:\\*\\*)?\\s*(N\\s*\\d+)?\\s*[-–—:.)]?\\s*([^\\n]*)$`,
  'i',
)

const FIELD_LINE = /^\s*(?:[-*•]\s*)?(?:\*\*)?([가-힣A-Za-z ]{1,14}?)(?:\*\*)?\s*[:：]\s*(.*)$/

function normalizeKey(raw: string): string | null {
  const k = raw.replace(/\s+/g, ' ').trim()
  if (KEY_ALIAS[k]) return KEY_ALIAS[k]
  return FIELD_KEYS.includes(k) ? k : null
}

/** 근거 문자열에서 번호만 뽑아 정리: "F-3, O02, N1" → ["F-03","O-02","N1"] */
export function extractRefs(s: string): string[] {
  const out: string[] = []
  const re = /\b([FOUITPQH])\s*-?\s*(\d{1,3})\b|\b(N)\s*(\d+)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const id = m[1] ? `${m[1]}-${m[2].padStart(2, '0')}` : `N${m[4]}`
    if (!out.includes(id)) out.push(id)
  }
  return out
}

function confidenceOf(v: string | undefined): Card['confidence'] {
  if (!v) return 'medium'
  if (/높/.test(v) || /high/i.test(v)) return 'high'
  if (/낮/.test(v) || /low/i.test(v)) return 'low'
  return 'medium'
}

export function parseAnswer(answer: string, project: Project): ParseResult {
  const lines = answer.replace(/\r\n/g, '\n').split('\n')
  const blocks: { tag: ParsedTag; label: string | null; title: string; body: string[] }[] = []
  const leftover: string[] = []
  let cur: (typeof blocks)[number] | null = null

  for (const line of lines) {
    if (/^\s*```/.test(line)) continue // 코드 블록 표시는 무시
    const h = line.match(HEADER)
    if (h) {
      const tagKey = Object.keys(TAGS).find((t) => t.replace(/\s/g, '').toLowerCase() === h[1].replace(/\s/g, '').toLowerCase())
      cur = {
        tag: TAGS[tagKey ?? h[1]] ?? 'INTERPRETATION',
        label: h[2] ? h[2].replace(/\s/g, '').toUpperCase() : null,
        title: (h[3] ?? '').replace(/\*\*/g, '').trim(),
        body: [],
      }
      blocks.push(cur)
      continue
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      cur = null
      continue
    }
    if (cur) {
      // 빈 줄 다음에 항목명 없는 글이 오면 블록이 끝난 것으로 본다 (끝인사 등이 마지막 항목에 붙지 않도록)
      const isField = (() => {
        const m = line.match(FIELD_LINE)
        return !!(m && normalizeKey(m[1]))
      })()
      const prevBlank = cur.body.length > 0 && !cur.body[cur.body.length - 1].trim()
      const hasField = cur.body.some((l) => {
        const m = l.match(FIELD_LINE)
        return !!(m && normalizeKey(m[1]))
      })
      if (line.trim() && !isField && prevBlank && hasField) {
        cur = null
        leftover.push(line)
        continue
      }
      cur.body.push(line)
    } else if (line.trim()) leftover.push(line)
  }

  const existing = new Set(project.cards.map((c) => c.id))
  const labels = new Set(blocks.map((b) => b.label).filter((l): l is string => !!l))
  const warnings: string[] = []

  const items: ParsedItem[] = blocks.map((b, i) => {
    const fields: Record<string, string> = {}
    let lastKey: string | null = null
    const loose: string[] = []
    for (const raw of b.body) {
      const m = raw.match(FIELD_LINE)
      const key = m ? normalizeKey(m[1]) : null
      if (m && key) {
        fields[key] = m[2].trim()
        lastKey = key
      } else if (raw.trim()) {
        const t = raw.trim().replace(/^[-*•]\s*/, '')
        if (lastKey) fields[lastKey] = `${fields[lastKey]}${fields[lastKey] ? '\n' : ''}${t}`
        else loose.push(t)
      }
    }
    if (loose.length && !fields['내용']) fields['내용'] = loose.join('\n')
    // 머리줄 뒤에 붙은 글은 제목으로 (예: "### [긴장] N1 — 비어 있는 저녁")
    if (b.title && !fields['제목']) fields['제목'] = b.title

    const refs = extractRefs(fields['근거'] ?? '')
    // 가설의 '해결하려는 긴장'에 적힌 번호도 근거로 본다
    for (const r of extractRefs(fields['해결하려는 긴장'] ?? '')) if (!refs.includes(r)) refs.push(r)
    const invalidRefs = refs.filter((r) => (r.startsWith('N') ? !labels.has(r) : !existing.has(r)))

    let text: string
    if (b.tag === 'HYPOTHESIS') text = fields['제목'] || fields['공간적 행동'] || fields['내용'] || ''
    else text = fields['내용'] || fields['제목'] || ''
    if (!text) warnings.push(`${b.label ?? `${i + 1}번째 블록`}: 내용을 찾지 못했습니다.`)

    return {
      key: `${i}`,
      tag: b.tag,
      label: b.label,
      text: text.trim(),
      fields,
      refs,
      invalidRefs,
      confidence: confidenceOf(fields['확신도']),
    }
  })

  if (blocks.length === 0) warnings.push('정해진 형식의 블록(### [유형] N번호)을 찾지 못했습니다. 챗봇에게 "답변 형식을 지켜 다시 써 달라"고 요청해 보세요.')
  return { items, leftover: leftover.join('\n').trim(), warnings }
}

const TAG_TO_TYPE: Record<ParsedTag, CardType> = {
  RELATION: 'INTERPRETATION',
  INTERPRETATION: 'INTERPRETATION',
  TENSION: 'TENSION',
  OPPORTUNITY: 'OPPORTUNITY',
  QUESTION: 'QUESTION',
  HYPOTHESIS: 'HYPOTHESIS',
  UNKNOWN: 'UNKNOWN',
  SUMMARY: 'UNKNOWN',
  FACT: 'FACT',
  OBSERVATION: 'OBSERVATION',
}

const TOPIC: Record<string, string> = {
  RELATION: '관계',
  INTERPRETATION: '해석',
  TENSION: '긴장',
  OPPORTUNITY: '기회',
  QUESTION: '설계 질문',
  HYPOTHESIS: '설계 가설',
  UNKNOWN: '추가 조사',
}

/**
 * 고른 항목을 카드로 만든다. N번호는 새 카드 번호로 바꾸고, 근거 연결도 새 번호로 고친다.
 * replacePrevious면 같은 단계에서 사용자가 손대지 않은 이전 카드를 지운다.
 */
export function importItems(
  project: Project,
  round: RoundId,
  items: ParsedItem[],
  opts: { prompt: string; answer: string; chatbot: string; replacePrevious: boolean },
): { created: string[]; removed: number; summary: boolean } {
  let removed = 0
  if (opts.replacePrevious) {
    const before = project.cards.length
    project.cards = project.cards.filter((c) => !(c.round === round && c.origin === 'chatbot' && !c.reaction && !c.edited && !c.user_note.trim()))
    removed = before - project.cards.length
  }

  const created: Card[] = []
  const labelMap = new Map<string, string>()
  let summary = false
  for (const it of items) {
    if (it.tag === 'SUMMARY') {
      project.panelSummary = it.text
      summary = true
      continue
    }
    const fields = { ...it.fields }
    if (it.tag === 'RELATION') fields['구분'] = '관계'
    if (it.invalidRefs.length) fields['근거 확인'] = `답변에 프로젝트에 없는 번호가 있었음: ${it.invalidRefs.join(', ')}`
    const card = makeCard(project, {
      type: TAG_TO_TYPE[it.tag],
      topic: TOPIC[it.tag] ?? '해석',
      text: it.text,
      related_source_ids: [],
      related_card_ids: [],
      origin: 'chatbot',
      confidence: it.confidence,
      human_validation_required: it.invalidRefs.length > 0 || !!fields['확인 필요'],
      status: 'draft',
      user_note: '',
      auto_key: null,
    })
    card.uid = newId()
    card.fields = fields
    card.round = round
    card.reaction = null
    created.push(card)
    if (it.label) labelMap.set(it.label, card.id)
  }
  // 근거 번호 바꾸기 (N번호 → 새 카드 번호), 없는 번호는 빼고 메모에 남김
  items
    .filter((it) => it.tag !== 'SUMMARY')
    .forEach((it, i) => {
      const card = created[i]
      card.related_card_ids = it.refs.map((r) => labelMap.get(r) ?? r).filter((r) => !it.invalidRefs.includes(r))
    })
  project.cards.push(...created)

  const session: ChatSession = {
    id: newId(),
    round,
    createdAt: nowIso(),
    prompt: opts.prompt,
    answer: opts.answer,
    answeredAt: nowIso(),
    chatbot: opts.chatbot,
    importedCardIds: created.map((c) => c.id),
  }
  project.chatLog = [...(project.chatLog ?? []), session]
  return { created: created.map((c) => c.id), removed, summary }
}
