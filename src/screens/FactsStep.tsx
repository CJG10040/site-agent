import { useMemo, useState } from 'react'
import { makeCard, nextNumber, nowIso } from '../model/project'
import type { Card, CardStatus, Project, SourceRecord } from '../model/types'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  onGoData: () => void
}

type Filter = 'draft' | 'confirmed' | 'rejected' | 'all'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'draft', label: '검토 대기' },
  { id: 'confirmed', label: '확인됨' },
  { id: 'rejected', label: '제외' },
  { id: 'all', label: '전체' },
]

const TYPE_LABEL: Record<string, string> = {
  FACT: '사실',
  UNKNOWN: '미확인',
  OBSERVATION: '관찰',
  INTERPRETATION: '해석',
  TENSION: '긴장',
  OPPORTUNITY: '기회',
  QUESTION: '질문',
  HYPOTHESIS: '가설',
}

const CONFIDENCE_LABEL: Record<Card['confidence'], string> = { high: '신뢰 높음', medium: '신뢰 보통', low: '신뢰 낮음' }

const RELIABILITY_LABEL: Record<SourceRecord['reliability'], string> = {
  official: '공식 공간정보',
  computed: '프로그램 계산값',
  user: '사용자 입력 자료',
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('ko-KR') : '—'
}

function SourceDetail({ s }: { s: SourceRecord }) {
  return (
    <dl className="source-detail">
      <dt>출처</dt>
      <dd>
        {s.source_name} <span className="muted">({RELIABILITY_LABEL[s.reliability]})</span>
      </dd>
      <dt>자료</dt>
      <dd>
        {s.dataset_name} <span className="mono muted">{s.dataset_id}</span>
      </dd>
      <dt>수집</dt>
      <dd>{when(s.retrieved_at)}</dd>
      <dt>갱신일</dt>
      <dd>{s.update_date ?? '제공되지 않음'}</dd>
      <dt>범위</dt>
      <dd>
        {s.spatial_scale}
        {s.feature_count !== null ? ` · ${s.feature_count.toLocaleString('ko-KR')}건` : ''}
      </dd>
      <dt>좌표계</dt>
      <dd>{s.coordinate_system}</dd>
      <dt>한계</dt>
      <dd>{s.limitations || '—'}</dd>
      {s.license && s.license !== '—' && (
        <>
          <dt>이용 조건</dt>
          <dd>{s.license}</dd>
        </>
      )}
      {s.original_url && (
        <>
          <dt>원본</dt>
          <dd className="mono small">
            {/^https?:\/\//.test(s.original_url) ? (
              <a href={s.original_url} target="_blank" rel="noreferrer noopener">
                {s.original_url}
              </a>
            ) : (
              s.original_url
            )}
          </dd>
        </>
      )}
      {s.error && (
        <>
          <dt>오류</dt>
          <dd>{s.error}</dd>
        </>
      )}
    </dl>
  )
}

function FactCard({
  card,
  sources,
  onStatus,
  onEdit,
  onNote,
}: {
  card: Card
  sources: Map<string, SourceRecord>
  onStatus: (status: CardStatus) => void
  onEdit: (text: string) => void
  onNote: (note: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(card.text)
  const [openSource, setOpenSource] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState(!!card.user_note)
  const isUnknown = card.type === 'UNKNOWN'

  return (
    <article className={`card card-${card.type.toLowerCase()} status-${card.status}`}>
      <header className="card-head">
        <span className="card-id">{card.id}</span>
        <span className={`type-badge type-${card.type.toLowerCase()}`}>{TYPE_LABEL[card.type]}</span>
        {card.origin === 'user' && <span className="badge">직접 입력</span>}
        {card.edited && <span className="badge">수정함</span>}
        {card.human_validation_required && <span className="badge warn">사람 확인 필요</span>}
        <span className="spacer" />
        <span className="muted small">{CONFIDENCE_LABEL[card.confidence]}</span>
      </header>

      {editing ? (
        <div className="card-edit">
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label={`${card.id} 문장 수정`} />
          <div className="row">
            <button
              type="button"
              className="btn primary small"
              onClick={() => {
                if (text.trim() && text !== card.text) onEdit(text.trim())
                setEditing(false)
              }}
            >
              저장
            </button>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                setText(card.text)
                setEditing(false)
              }}
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <p className="card-text">{card.text}</p>
      )}

      {card.related_source_ids.length > 0 && (
        <div className="source-chips">
          {card.related_source_ids.map((id) => {
            const s = sources.get(id)
            return (
              <button
                key={id}
                type="button"
                className={`source-chip${openSource === id ? ' on' : ''}`}
                aria-expanded={openSource === id}
                onClick={() => setOpenSource(openSource === id ? null : id)}
              >
                {id} {s ? s.dataset_name : '(출처 없음)'}
              </button>
            )
          })}
        </div>
      )}
      {openSource && sources.get(openSource) && <SourceDetail s={sources.get(openSource)!} />}

      {noteOpen && (
        <textarea
          className="card-note"
          rows={2}
          value={card.user_note}
          placeholder="메모: 왜 그렇게 판단했는지, 현장에서 확인할 것 등"
          onChange={(e) => onNote(e.target.value)}
          aria-label={`${card.id} 메모`}
        />
      )}

      <footer className="card-actions">
        {card.status !== 'confirmed' && (
          <button type="button" className="btn small primary" onClick={() => onStatus('confirmed')}>
            {isUnknown ? '추가조사로 남기기' : '확인'}
          </button>
        )}
        {card.status === 'confirmed' && (
          <button type="button" className="btn small ghost" onClick={() => onStatus('draft')}>
            검토로 되돌리기
          </button>
        )}
        {!editing && (
          <button type="button" className="btn small ghost" onClick={() => setEditing(true)}>
            수정
          </button>
        )}
        {!noteOpen && (
          <button type="button" className="btn small ghost" onClick={() => setNoteOpen(true)}>
            메모
          </button>
        )}
        <span className="spacer" />
        {card.status !== 'rejected' ? (
          <button type="button" className="btn small ghost danger" onClick={() => onStatus('rejected')}>
            {isUnknown ? '해당 없음' : '제외'}
          </button>
        ) : (
          <button type="button" className="btn small ghost" onClick={() => onStatus('draft')}>
            되돌리기
          </button>
        )}
      </footer>
    </article>
  )
}

function AddFactForm({ topics, onAdd }: { topics: string[]; onAdd: (v: NewFact) => void }) {
  const [open, setOpen] = useState(false)
  const [v, setV] = useState<NewFact>({ text: '', topic: '', sourceName: '', url: '', date: '', limitations: '' })
  const set = (k: keyof NewFact, value: string) => setV((x) => ({ ...x, [k]: value }))
  const valid = v.text.trim() && v.sourceName.trim()

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        사실 직접 추가
      </button>
    )
  }

  return (
    <form
      className="add-fact"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        onAdd(v)
        setV({ text: '', topic: '', sourceName: '', url: '', date: '', limitations: '' })
        setOpen(false)
      }}
    >
      <h3>사실 직접 추가</h3>
      <p className="help">문헌·통계·도면 등에서 확인한 사실을 넣습니다. 사실에는 반드시 출처를 남깁니다. (현장에서 본 것은 Phase 3의 '현장 관찰'에 넣습니다.)</p>
      <label className="field">
        <span className="label">사실 *</span>
        <textarea rows={2} value={v.text} onChange={(e) => set('text', e.target.value)} placeholder="예: 충장로 상점가는 1970~90년대 광주 최대의 상업가로였다." />
      </label>
      <div className="form-grid">
        <label className="field">
          <span className="label">주제</span>
          <input list="fact-topics" type="text" value={v.topic} onChange={(e) => set('topic', e.target.value)} placeholder="예: 역사" />
          <datalist id="fact-topics">
            {topics.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span className="label">출처 이름 *</span>
          <input type="text" value={v.sourceName} onChange={(e) => set('sourceName', e.target.value)} placeholder="예: 광주광역시 동구청, 『충장로 100년』" />
        </label>
        <label className="field">
          <span className="label">출처 링크</span>
          <input type="text" value={v.url} onChange={(e) => set('url', e.target.value)} placeholder="https://…" />
        </label>
        <label className="field">
          <span className="label">자료 기준일</span>
          <input type="text" value={v.date} onChange={(e) => set('date', e.target.value)} placeholder="예: 2024년 12월" />
        </label>
      </div>
      <label className="field">
        <span className="label">한계</span>
        <input type="text" value={v.limitations} onChange={(e) => set('limitations', e.target.value)} placeholder="예: 구술 자료로 연도가 정확하지 않을 수 있음" />
      </label>
      <div className="row">
        <button type="submit" className="btn primary" disabled={!valid}>
          추가
        </button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          취소
        </button>
      </div>
    </form>
  )
}

interface NewFact {
  text: string
  topic: string
  sourceName: string
  url: string
  date: string
  limitations: string
}

export default function FactsStep({ project, update, onGoData }: Props) {
  const [filter, setFilter] = useState<Filter>('draft')
  const sources = useMemo(() => new Map(project.sources.map((s) => [s.source_id, s])), [project.sources])

  const cards = project.cards.filter((c) => c.type === 'FACT' || c.type === 'UNKNOWN')
  const counts = {
    draft: cards.filter((c) => c.status === 'draft').length,
    confirmed: cards.filter((c) => c.status === 'confirmed').length,
    rejected: cards.filter((c) => c.status === 'rejected').length,
    all: cards.length,
  }
  const confirmedFacts = cards.filter((c) => c.type === 'FACT' && c.status === 'confirmed').length
  const unknownOpen = cards.filter((c) => c.type === 'UNKNOWN' && c.status !== 'rejected').length

  const shown = filter === 'all' ? cards : cards.filter((c) => c.status === filter)
  const topics = [...new Set(shown.map((c) => c.topic))]
  const allTopics = [...new Set(cards.map((c) => c.topic).filter(Boolean))]

  const patch = (id: string, fn: (c: Card) => void) =>
    update((d) => {
      const c = d.cards.find((x) => x.id === id)
      if (c) {
        fn(c)
        c.updated_at = nowIso()
      }
    })

  const addFact = (v: NewFact) =>
    update((d) => {
      const sid = nextNumber(d, 'S')
      d.sources.push({
        source_id: sid,
        source_name: '사용자 입력',
        dataset_name: v.sourceName.trim(),
        dataset_id: 'user',
        retrieved_at: nowIso(),
        update_date: v.date.trim() || null,
        geometry: '—',
        coordinate_system: '—',
        spatial_scale: '—',
        time_range: null,
        raw_ref: null,
        normalized_value: null,
        unit: null,
        license: '',
        limitations: v.limitations.trim(),
        original_url: v.url.trim(),
        reliability: 'user',
        feature_count: null,
        status: 'ok',
        error: null,
      })
      d.cards.push(
        makeCard(d, {
          type: 'FACT',
          topic: v.topic.trim() || '기타',
          text: v.text.trim(),
          related_source_ids: [sid],
          related_card_ids: [],
          origin: 'user',
          confidence: 'medium',
          human_validation_required: false,
          status: 'confirmed',
          user_note: '',
          auto_key: null,
        }),
      )
    })

  return (
    <div className="form-page wide">
      <header className="form-head">
        <p className="eyebrow">⑤ 사실 카드</p>
        <h2>데이터에서 나온 사실을 확인하기</h2>
        <p className="muted">
          프로그램이 만든 문장은 <strong>초안</strong>입니다. 출처를 열어 보고 맞으면 확인, 틀리거나 중요하지 않으면 제외, 표현이
          어색하면 수정하세요. 확인한 사실만 다음 단계(해석·가설)의 근거로 쓰입니다.
        </p>
      </header>

      <div className="fact-summary">
        <div className={`meter${confirmedFacts >= 5 ? ' done' : ''}`}>
          <span className="meter-value">{confirmedFacts}</span>
          <span className="meter-label">확인된 사실 (MVP 기준 5개 이상)</span>
        </div>
        <div className="meter">
          <span className="meter-value">{counts.draft}</span>
          <span className="meter-label">검토 대기</span>
        </div>
        <div className="meter">
          <span className="meter-value">{unknownOpen}</span>
          <span className="meter-label">미확인 (추가조사 필요)</span>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="notice">
          <p>아직 사실 카드가 없습니다. 공간정보를 수집하면 초안이 만들어집니다.</p>
          <button type="button" className="btn small" onClick={onGoData}>
            공간정보 수집하러 가기
          </button>
        </div>
      ) : (
        <>
          <div className="segmented" role="tablist" aria-label="카드 상태">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
                {f.label} <span className="count">{counts[f.id]}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 && <p className="empty">이 상태의 카드가 없습니다.</p>}

          {topics.map((t) => (
            <section key={t} className="topic-group">
              <h3>{t}</h3>
              <div className="card-list">
                {shown
                  .filter((c) => c.topic === t)
                  .map((c) => (
                    <FactCard
                      key={c.id}
                      card={c}
                      sources={sources}
                      onStatus={(status) => patch(c.id, (x) => void (x.status = status))}
                      onEdit={(text) =>
                        patch(c.id, (x) => {
                          x.history.push({ at: nowIso(), text: x.text })
                          x.text = text
                          x.edited = true
                        })
                      }
                      onNote={(note) => patch(c.id, (x) => void (x.user_note = note))}
                    />
                  ))}
              </div>
            </section>
          ))}
        </>
      )}

      <AddFactForm topics={allTopics} onAdd={addFact} />
    </div>
  )
}
