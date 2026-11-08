import { useState } from 'react'
import type { Card, ObservationDetail } from '../model/types'

type Links = ObservationDetail['links']

interface Props {
  facts: Card[]
  links: Links
  onChange: (next: Links) => void
}

const REL_LABEL = { match: '일치', differ: '현장과 다름' } as const

/** 관찰과 관련된 사실 카드를 고르고 '일치 / 현장과 다름'을 표시 */
export default function FactLinker({ facts, links, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(links.length === 0)
  const relOf = (id: string) => links.find((l) => l.cardId === id)?.relation ?? null

  const set = (id: string, relation: 'match' | 'differ') => {
    const cur = relOf(id)
    if (cur === relation) onChange(links.filter((l) => l.cardId !== id))
    else onChange([...links.filter((l) => l.cardId !== id), { cardId: id, relation }])
  }

  const q = query.trim()
  const filtered = q ? facts.filter((f) => f.text.includes(q) || f.topic.includes(q) || f.id.includes(q.toUpperCase())) : facts
  // 연결한 사실을 먼저
  const shown = [...filtered].sort((a, b) => Number(!!relOf(b.id)) - Number(!!relOf(a.id)))

  const linked = facts.filter((f) => relOf(f.id))

  return (
    <fieldset className="field fact-linker">
      <legend className="label">관련 사실 (공공데이터와 비교)</legend>
      {linked.length > 0 && (
        <ul className="linked-facts">
          {linked.map((f) => (
            <li key={f.id} className={`rel-${relOf(f.id)}`}>
              <span className="card-id">{f.id}</span> <span className="rel-badge">{REL_LABEL[relOf(f.id)!]}</span> {f.text}
            </li>
          ))}
        </ul>
      )}
      {facts.length === 0 ? (
        <p className="help">아직 사실 카드가 없습니다. ④ 공간정보를 수집하면 연결할 수 있습니다.</p>
      ) : (
        <>
          <button type="button" className="link-btn left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? '사실 목록 닫기' : linked.length ? '연결 바꾸기' : '관련 사실 고르기'}
          </button>
          {open && (
            <div className="fact-pick">
              <input type="search" value={query} placeholder="사실 검색 (예: 층수, 1인 가구, F-10)" onChange={(e) => setQuery(e.target.value)} aria-label="사실 검색" />
              <ul>
                {shown.map((f) => {
                  const rel = relOf(f.id)
                  return (
                    <li key={f.id} className={rel ? `rel-${rel}` : ''}>
                      <p>
                        <span className="card-id">{f.id}</span> <span className="muted small">{f.topic}</span>
                        {f.status === 'draft' && <span className="badge">검토 대기</span>}
                      </p>
                      <p className="fact-pick-text">{f.text}</p>
                      <div className="row">
                        <button type="button" className={`chip small${rel === 'match' ? ' on' : ''}`} aria-pressed={rel === 'match'} onClick={() => set(f.id, 'match')}>
                          일치
                        </button>
                        <button
                          type="button"
                          className={`chip small differ${rel === 'differ' ? ' on' : ''}`}
                          aria-pressed={rel === 'differ'}
                          onClick={() => set(f.id, 'differ')}
                        >
                          현장과 다름
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </fieldset>
  )
}
