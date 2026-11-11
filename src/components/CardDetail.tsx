import { useState } from 'react'
import { dependents, setReaction } from '../model/cards'
import { FB_STATUS_LABEL, feedbackForCard } from '../model/feedback'
import { cardTitle, isAiCard, REACTION_LABEL, TYPE_LABEL } from '../model/prompts'
import { nowIso } from '../model/project'
import type { Card, Project, Reaction } from '../model/types'

interface Props {
  project: Project
  cardId: string
  update: (fn: (draft: Project) => void) => void
  onSelect: (id: string) => void
  onClose: () => void
}

const REACTIONS: Reaction[] = ['agree', 'partial', 'differs', 'unimportant', 'investigate', 'counter', 'develop']

const ROUND_LABEL: Record<string, string> = { R1: '① 관계·긴장·기회', R2: '② 해석·질문', R3: '③ 가설', R4: '④ 심화', R5: '⑤ 조사·요약' }

const FIELD_ORDER = [
  '구분',
  '관계 유형',
  '관점',
  '질문 유형',
  '방향',
  '해석',
  '해결하려는 긴장',
  '공간적 행동',
  '예상 경험',
  '장점',
  '위험',
  '추가 조사',
  '확인 방법',
  '반전 질문',
  '스케일',
  '확인 필요',
  '근거 확인',
  '확신도',
]

export function typeClass(c: Card): string {
  if (c.type === 'INTERPRETATION' && c.fields?.['구분'] === '관계') return 'type-relation'
  return `type-${c.type.toLowerCase()}`
}

export function typeName(c: Card): string {
  if (c.type === 'INTERPRETATION' && c.fields?.['구분'] === '관계') return '관계'
  return TYPE_LABEL[c.type] ?? c.type
}

export default function CardDetail({ project, cardId, update, onSelect, onClose }: Props) {
  const card = project.cards.find((c) => c.id === cardId)
  const [editing, setEditing] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [draftFields, setDraftFields] = useState<Record<string, string>>({})
  if (!card) return null
  const ai = isAiCard(card)
  const byId = new Map(project.cards.map((c) => [c.id, c]))
  const users = dependents(project).get(card.id) ?? []
  const fieldKeys = [...FIELD_ORDER.filter((k) => card.fields?.[k]), ...Object.keys(card.fields ?? {}).filter((k) => !FIELD_ORDER.includes(k) && k !== '제목' && k !== '내용' && k !== '근거')]

  const patch = (fn: (c: Card) => void) =>
    update((d) => {
      const c = d.cards.find((x) => x.id === cardId)
      if (c) {
        fn(c)
        c.updated_at = nowIso()
      }
    })

  const startEdit = () => {
    setDraftText(card.text)
    setDraftFields({ ...(card.fields ?? {}) })
    setEditing(true)
  }

  const saveEdit = () => {
    patch((c) => {
      if (c.text !== draftText) c.history.push({ at: nowIso(), text: c.text })
      c.text = draftText.trim()
      c.fields = { ...draftFields }
      c.edited = true
    })
    setEditing(false)
  }

  return (
    <aside className="card-detail" aria-label={`${card.id} 자세히`}>
      <header className="card-detail-head">
        <span className="card-id">{card.id}</span>
        <span className={`type-badge ${typeClass(card)}`}>{typeName(card)}</span>
        {card.round && <span className="muted small">{ROUND_LABEL[card.round]}</span>}
        <span className="spacer" />
        <button type="button" className="btn ghost small" onClick={onClose}>
          닫기
        </button>
      </header>

      {editing ? (
        <div className="card-edit">
          {card.fields?.['제목'] !== undefined && (
            <label className="field">
              <span className="label">제목</span>
              <input type="text" value={draftFields['제목'] ?? ''} onChange={(e) => setDraftFields((f) => ({ ...f, 제목: e.target.value }))} />
            </label>
          )}
          <label className="field">
            <span className="label">{card.type === 'HYPOTHESIS' ? '가설 (한 줄)' : '내용'}</span>
            <textarea rows={3} value={draftText} onChange={(e) => setDraftText(e.target.value)} />
          </label>
          {fieldKeys.map((k) => (
            <label key={k} className="field">
              <span className="label">{k}</span>
              <textarea rows={2} value={draftFields[k] ?? ''} onChange={(e) => setDraftFields((f) => ({ ...f, [k]: e.target.value }))} />
            </label>
          ))}
          <div className="row">
            <button type="button" className="btn primary small" onClick={saveEdit}>
              저장
            </button>
            <button type="button" className="btn ghost small" onClick={() => setEditing(false)}>
              취소
            </button>
          </div>
        </div>
      ) : (
        <>
          {card.fields?.['제목'] && card.type !== 'HYPOTHESIS' && <h3 className="detail-title">{card.fields['제목']}</h3>}
          <p className={`detail-text${card.type === 'HYPOTHESIS' ? ' detail-title' : ''}`}>{card.type === 'HYPOTHESIS' ? cardTitle(card) : card.text}</p>
          {fieldKeys.length > 0 && (
            <dl className="detail-fields">
              {fieldKeys.map((k) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{card.fields![k]}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}

      {card.related_card_ids.length > 0 && (
        <section className="detail-refs">
          <h4>근거</h4>
          <ul>
            {card.related_card_ids.map((r) => {
              const rc = byId.get(r)
              return (
                <li key={r}>
                  <button type="button" className="ref-chip" onClick={() => rc && onSelect(r)} disabled={!rc}>
                    <span className="card-id">{r}</span> {rc ? cardTitle(rc).slice(0, 60) : '(지워진 카드)'}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {users.length > 0 && (
        <section className="detail-refs">
          <h4>이 카드를 근거로 쓴 카드</h4>
          <ul>
            {users.map((u) => (
              <li key={u}>
                <button type="button" className="ref-chip" onClick={() => onSelect(u)}>
                  <span className="card-id">{u}</span> {cardTitle(byId.get(u)!).slice(0, 60)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {feedbackForCard(project, card.id).length > 0 && (
        <section className="detail-refs">
          <h4>받은 피드백</h4>
          <ul className="detail-feedback">
            {feedbackForCard(project, card.id).map((f) => (
              <li key={f.id}>
                <span className="card-id">{f.id}</span> <span className={`fb-badge status-${f.status}`}>{FB_STATUS_LABEL[f.status]}</span> {f.date} {f.who}: {f.text}
                {f.response && <span className="muted small"> → {f.response}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ai ? (
        <section className="detail-react">
          <h4>나의 반응</h4>
          <div className="chips">
            {REACTIONS.map((r) => (
              <button
                key={r}
                type="button"
                className={`chip small react-${r}${card.reaction === r ? ' on' : ''}`}
                aria-pressed={card.reaction === r}
                onClick={() => patch((c) => setReaction(c, c.reaction === r ? null : r))}
              >
                {REACTION_LABEL[r]}
              </button>
            ))}
            {!editing && (
              <button type="button" className="chip small" onClick={startEdit}>
                직접 수정
              </button>
            )}
          </div>
          <p className="help">'반대 해석 만들기'·'발전시키기'를 고른 카드는 ④ 심화 단계 프롬프트에 들어갑니다. '중요하지 않음'은 다음 단계에서 빠집니다.</p>
        </section>
      ) : (
        <p className="help">사실·관찰 카드는 ⑤ 사실 카드, ⑥ 현장 관찰에서 고칩니다.</p>
      )}

      <label className="field">
        <span className="label">메모 (다음 단계 프롬프트에 함께 들어갑니다)</span>
        <textarea rows={2} value={card.user_note} placeholder="예: 현장에서는 저녁에 오히려 사람이 많았다" onChange={(e) => patch((c) => void (c.user_note = e.target.value))} />
      </label>
      {card.history.length > 0 && <p className="muted small">수정 {card.history.length}회 (처음 문장: {card.history[0].text.slice(0, 50)}…)</p>}
    </aside>
  )
}
