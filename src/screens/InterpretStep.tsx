import { useState } from 'react'
import CardDetail from '../components/CardDetail'
import FlowBoard from '../components/FlowBoard'
import RoundWorkbench from '../components/RoundWorkbench'
import { mvpProgress } from '../model/cards'
import { cardTitle, REACTION_LABEL, ROUNDS } from '../model/prompts'
import { nowIso } from '../model/project'
import type { Card, Project, RoundId } from '../model/types'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
}

type Tab = 'rounds' | 'board' | 'tension' | 'hyp'

const TABS: { id: Tab; label: string }[] = [
  { id: 'rounds', label: '챗봇 왕복' },
  { id: 'board', label: '카드 보드' },
  { id: 'tension', label: '긴장·기회' },
  { id: 'hyp', label: '가설 비교' },
]

const DIRECTIONS = ['보존할 것', '드러낼 것', '피할 것', '변환할 것']

const HYP_ROWS = ['근거', '해석', '해결하려는 긴장', '공간적 행동', '예상 경험', '장점', '위험', '추가 조사', '스케일']

function dirOf(c: Card): string {
  const v = c.fields?.['방향'] ?? ''
  return DIRECTIONS.find((d) => v.includes(d.slice(0, 2))) ?? ''
}

export default function InterpretStep({ project, update }: Props) {
  const [tab, setTab] = useState<Tab>('rounds')
  const [round, setRound] = useState<RoundId>(() => {
    const done = ROUNDS.filter((r) => project.cards.some((c) => c.round === r.id))
    const next = ROUNDS.find((r) => !r.optional && !done.some((d) => d.id === r.id))
    return next?.id ?? 'R3'
  })
  const [selected, setSelected] = useState<string | null>(null)
  const progress = mvpProgress(project)

  const tensions = project.cards.filter((c) => (c.type === 'TENSION' || c.type === 'OPPORTUNITY') && c.status !== 'rejected')
  const hyps = project.cards.filter((c) => c.type === 'HYPOTHESIS' && c.status !== 'rejected')

  const setDirection = (id: string, dir: string) =>
    update((d) => {
      const c = d.cards.find((x) => x.id === id)
      if (c) {
        c.fields = { ...(c.fields ?? {}), 방향: dir }
        c.updated_at = nowIso()
      }
    })

  return (
    <div className="interpret">
      <header className="interpret-head">
        <div>
          <p className="eyebrow">⑧ 해석·가설</p>
          <h2>사실과 관찰에서 설계 질문과 가설로</h2>
        </div>
        <ul className="mvp-strip" aria-label="MVP 진행">
          {progress.map((p) => (
            <li key={p.label} className={p.value >= p.target ? 'done' : ''}>
              <span className="mvp-value">
                {p.value}
                <span className="muted">/{p.target}</span>
              </span>
              <span className="mvp-label">{p.label}</span>
            </li>
          ))}
        </ul>
      </header>

      <nav className="segmented interpret-tabs" role="tablist" aria-label="보기">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className={`interpret-body${selected && tab !== 'rounds' ? ' with-detail' : ''}`}>
        <div className="interpret-main">
          {tab === 'rounds' && (
            <div className="rounds">
              <ol className="round-list">
                {ROUNDS.map((r) => {
                  const n = project.cards.filter((c) => c.round === r.id && c.status !== 'rejected').length
                  const sessions = (project.chatLog ?? []).filter((s) => s.round === r.id).length
                  return (
                    <li key={r.id}>
                      <button type="button" className={`round-item${round === r.id ? ' on' : ''}${n ? ' done' : ''}`} onClick={() => setRound(r.id)}>
                        <span className="round-num">{r.short}</span>
                        <span className="round-text">
                          <span className="round-title">
                            {r.title}
                            {r.optional && <span className="badge">선택</span>}
                          </span>
                          <span className="muted small">{n ? `카드 ${n}개 · 왕복 ${sessions}회` : r.produces}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
              <RoundWorkbench key={round} project={project} round={round} update={update} onImported={() => undefined} />
              {project.panelSummary !== undefined && (
                <section className="panel-summary">
                  <h3>패널용 대지해석 요약문</h3>
                  <textarea
                    rows={6}
                    value={project.panelSummary}
                    onChange={(e) =>
                      update((d) => {
                        d.panelSummary = e.target.value
                      })
                    }
                  />
                  <p className="help">⑤ 단계 답변에서 가져왔습니다. 직접 고쳐 쓰세요. 리포트(Phase 5)에 들어갑니다.</p>
                </section>
              )}
            </div>
          )}

          {tab === 'board' && <FlowBoard project={project} selectedId={selected} onSelect={setSelected} />}

          {tab === 'tension' && (
            <div className="buckets">
              {tensions.length === 0 && <p className="notice">아직 긴장·기회 카드가 없습니다. ① 단계 답변을 가져오세요.</p>}
              {[...DIRECTIONS, ''].map((dir) => {
                const cards = tensions.filter((c) => dirOf(c) === dir)
                if (dir === '' && cards.length === 0) return null
                return (
                  <section key={dir || 'none'} className="bucket">
                    <h3>
                      {dir || '방향 미정'} <span className="count">{cards.length}</span>
                    </h3>
                    {cards.map((c) => (
                      <div key={c.id} className={`bucket-card type-${c.type.toLowerCase()}${selected === c.id ? ' selected' : ''}`}>
                        <button type="button" className="bucket-open" onClick={() => setSelected(c.id)}>
                          <span className="card-id">{c.id}</span> <span className="small muted">{c.type === 'TENSION' ? '긴장' : '기회'}</span>
                          <strong>{c.fields?.['제목'] ?? ''}</strong>
                          <span>{c.text}</span>
                        </button>
                        <select value={dirOf(c)} onChange={(e) => setDirection(c.id, e.target.value)} aria-label={`${c.id} 방향`}>
                          <option value="">방향 미정</option>
                          {DIRECTIONS.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </section>
                )
              })}
            </div>
          )}

          {tab === 'hyp' && (
            <div className="hyp-compare">
              {hyps.length === 0 ? (
                <p className="notice">아직 설계 가설이 없습니다. ③ 단계 답변을 가져오세요.</p>
              ) : (
                <div className="hyp-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">항목</th>
                        {hyps.map((h) => (
                          <th key={h.id} scope="col">
                            <button type="button" className="link-btn left" onClick={() => setSelected(h.id)}>
                              {h.id}
                            </button>
                            <span className="hyp-title">{cardTitle(h)}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {HYP_ROWS.map((row) => (
                        <tr key={row}>
                          <th scope="row">{row}</th>
                          {hyps.map((h) => (
                            <td key={h.id}>{row === '근거' ? h.related_card_ids.join(', ') || h.fields?.['근거'] : h.fields?.[row] ?? ''}</td>
                          ))}
                        </tr>
                      ))}
                      <tr>
                        <th scope="row">나의 반응</th>
                        {hyps.map((h) => (
                          <td key={h.id}>{h.reaction ? REACTION_LABEL[h.reaction] : <span className="muted">—</span>}</td>
                        ))}
                      </tr>
                      <tr>
                        <th scope="row">메모</th>
                        {hyps.map((h) => (
                          <td key={h.id}>{h.user_note}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              <p className="help">가설 이름을 누르면 자세히 보고 반응(동의·발전시키기 등)을 남길 수 있습니다. 하나의 정답을 고르는 표가 아니라, 근거와 위험을 나란히 보는 표입니다.</p>
            </div>
          )}
        </div>

        {selected && tab !== 'rounds' && (
          <CardDetail project={project} cardId={selected} update={update} onSelect={setSelected} onClose={() => setSelected(null)} />
        )}
      </div>
    </div>
  )
}
