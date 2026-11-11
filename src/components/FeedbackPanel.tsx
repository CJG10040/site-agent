// ⑧ 해석·가설 › 피드백: 크리틱에서 받은 말을 적고 카드·도판에 이은 뒤, 반영했는지(반영함·보류·다르게 판단)와 어떻게 했는지 기록한다.
// 적을 때 그 시점을 조사 버전으로 저장해 두면 '받은 뒤 바뀐 것'을 바로 보여 준다.

import { useEffect, useMemo, useState } from 'react'
import { ORDERED_PANELS } from '../diagrams/panels'
import { listVersions, saveVersion } from '../model/db'
import { FB_RESPONSE_HINT, FB_STATUS, FB_STATUS_LABEL, FB_WHO, feedbackCounts, feedbackOf } from '../model/feedback'
import { nextNumber, nowIso } from '../model/project'
import { cardTitle, TYPE_LABEL } from '../model/prompts'
import type { Feedback, FeedbackStatus, Project } from '../model/types'
import { diffHeadline, diffVersions, snapshotOf, type VersionRecord } from '../model/versions'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  onOpenCard: (id: string) => void
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Draft {
  date: string
  who: string
  occasion: string
  text: string
  cardIds: string[]
  panelIds: string[]
}

const EMPTY: Draft = { date: '', who: '교수', occasion: '', text: '', cardIds: [], panelIds: [] }

function RefPicker({ project, cardIds, panelIds, onChange }: { project: Project; cardIds: string[]; panelIds: string[]; onChange: (c: string[], p: string[]) => void }) {
  const cards = project.cards.filter((c) => c.status !== 'rejected')
  return (
    <div className="fb-refs">
      <select
        value=""
        onChange={(e) => e.target.value && !cardIds.includes(e.target.value) && onChange([...cardIds, e.target.value], panelIds)}
        aria-label="관련 카드 더하기"
      >
        <option value="">+ 관련 카드</option>
        {cards.map((c) => (
          <option key={c.id} value={c.id}>
            {c.id} {TYPE_LABEL[c.type]} · {cardTitle(c).slice(0, 40)}
          </option>
        ))}
      </select>
      <select
        value=""
        onChange={(e) => e.target.value && !panelIds.includes(e.target.value) && onChange(cardIds, [...panelIds, e.target.value])}
        aria-label="관련 도판 더하기"
      >
        <option value="">+ 관련 도판</option>
        {ORDERED_PANELS.map((p, i) => (
          <option key={p.id} value={p.id}>
            {String(i + 1).padStart(2, '0')} {p.title}
          </option>
        ))}
      </select>
      <span className="fb-chips">
        {cardIds.map((id) => (
          <button key={id} type="button" className="chip small" onClick={() => onChange(cardIds.filter((x) => x !== id), panelIds)} title="빼기">
            {id} ×
          </button>
        ))}
        {panelIds.map((id) => (
          <button key={id} type="button" className="chip small" onClick={() => onChange(cardIds, panelIds.filter((x) => x !== id))} title="빼기">
            도판 {ORDERED_PANELS.find((p) => p.id === id)?.title ?? id} ×
          </button>
        ))}
      </span>
    </div>
  )
}

export default function FeedbackPanel({ project, update, onOpenCard }: Props) {
  const list = feedbackOf(project)
  const [draft, setDraft] = useState<Draft>({ ...EMPTY, date: today() })
  const [whoOther, setWhoOther] = useState('')
  const [withVersion, setWithVersion] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [versions, setVersions] = useState<VersionRecord[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void listVersions(project.id)
      .then(setVersions)
      .catch(() => setVersions([]))
  }, [project.id, list.length])

  const now = useMemo(() => snapshotOf(project), [project])
  const counts = feedbackCounts(list)
  const byId = new Map(project.cards.map((c) => [c.id, c]))

  const patch = (id: string, p: Partial<Feedback>) =>
    update((d) => {
      d.feedback = (d.feedback ?? []).map((f) => (f.id === id ? { ...f, ...p, updatedAt: nowIso() } : f))
    })

  const add = async () => {
    const who = draft.who === '기타' ? whoOther.trim() || '기타' : draft.who
    if (!draft.text.trim()) return
    setBusy(true)
    let versionId: string | null = null
    if (withVersion) {
      const v = await saveVersion(project, `${draft.occasion.trim() || `${who} 피드백`} (${draft.date})`, 'feedback').catch(() => null)
      versionId = v?.id ?? null
    }
    update((d) => {
      const id = nextNumber(d, 'FB')
      const t = nowIso()
      d.feedback = [
        ...(d.feedback ?? []),
        { id, date: draft.date || today(), who, occasion: draft.occasion.trim(), text: draft.text.trim(), cardIds: draft.cardIds, panelIds: draft.panelIds, status: 'open', response: '', versionId, createdAt: t, updatedAt: t },
      ]
    })
    setDraft({ ...EMPTY, date: draft.date, who: draft.who, occasion: draft.occasion })
    setMsg(withVersion ? '피드백을 적고 지금 해석을 버전으로 저장했습니다.' : '피드백을 적었습니다.')
    setBusy(false)
    window.setTimeout(() => setMsg(null), 3000)
  }

  const remove = (id: string) =>
    update((d) => {
      d.feedback = (d.feedback ?? []).filter((f) => f.id !== id)
    })

  // 자리(크리틱)별로 묶어 최근 것부터
  const groups = useMemo(() => {
    const m = new Map<string, Feedback[]>()
    for (const f of [...list].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))) {
      const k = `${f.date}|${f.occasion}`
      m.set(k, [...(m.get(k) ?? []), f])
    }
    return [...m.entries()]
  }, [list])

  return (
    <div className="feedback">
      <section className="feedback-form block">
        <h3>피드백 적기</h3>
        <div className="row fb-meta">
          <label className="field inline">
            <span className="label">받은 날</span>
            <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          </label>
          <label className="field inline">
            <span className="label">누가</span>
            <select value={draft.who} onChange={(e) => setDraft({ ...draft, who: e.target.value })}>
              {[...FB_WHO, '기타'].map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          {draft.who === '기타' && (
            <label className="field inline">
              <span className="label">누구</span>
              <input type="text" value={whoOther} onChange={(e) => setWhoOther(e.target.value)} placeholder="예: 스튜디오 외부 심사" />
            </label>
          )}
          <label className="field inline grow">
            <span className="label">자리</span>
            <input type="text" value={draft.occasion} onChange={(e) => setDraft({ ...draft, occasion: e.target.value })} placeholder="예: 중간 크리틱, 개별 지도" />
          </label>
        </div>
        <label className="field">
          <span className="label">피드백 내용 (들은 그대로, 짧게 여러 개면 하나씩)</span>
          <textarea rows={3} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="예: 골목의 밤 이용을 근거 없이 단정했다. 저녁 시간대 관찰이 더 필요하다." />
        </label>
        <RefPicker project={project} cardIds={draft.cardIds} panelIds={draft.panelIds} onChange={(c, p) => setDraft({ ...draft, cardIds: c, panelIds: p })} />
        <div className="row">
          <label className="check-row small">
            <input type="checkbox" checked={withVersion} onChange={(e) => setWithVersion(e.target.checked)} />
            받은 시점의 해석을 버전으로 저장 (나중에 '받은 뒤 바뀐 것'을 봄)
          </label>
          <span className="spacer" />
          <button type="button" className="btn primary small" disabled={!draft.text.trim() || busy} onClick={() => void add()}>
            적기
          </button>
        </div>
        {msg && <p className="notice ok">{msg}</p>}
        <p className="help">적은 피드백과 반영 여부는 다음 챗봇 왕복 프롬프트와 ⑨ 리포트에 들어갑니다. 받아들이지 않기로 한 것도 '다르게 판단'과 이유를 적어 두면 해석의 근거가 됩니다.</p>
      </section>

      {list.length > 0 && (
        <p className="fb-counts small">
          피드백 {list.length}개 · {FB_STATUS.map((s) => `${FB_STATUS_LABEL[s]} ${counts[s]}`).join(' · ')}
        </p>
      )}

      {groups.map(([key, items]) => {
        const [date, occasion] = key.split('|')
        return (
          <section key={key} className="fb-group">
            <h3>
              {date} {occasion && <span>· {occasion}</span>}
            </h3>
            {items.map((f) => {
              const v = f.versionId ? versions.find((x) => x.id === f.versionId) : undefined
              // 받은 뒤 해석(카드·결론·질문·종합 다이어그램)이 바뀐 것만 — 피드백 기록 자체는 빼고
              const sinceRaw = v ? diffHeadline(diffVersions({ ...v.snap, feedback: [] }, { ...now, feedback: [] })) : null
              const since = sinceRaw === '바뀐 것 없음' ? '아직 해석이 바뀌지 않음' : sinceRaw
              return (
                <article key={f.id} className={`fb-item status-${f.status}`}>
                  <header className="row">
                    <span className="card-id">{f.id}</span>
                    <strong>{f.who}</strong>
                    <span className="spacer" />
                    <button type="button" className="link-btn small" onClick={() => setEditing(editing === f.id ? null : f.id)}>
                      {editing === f.id ? '고치기 닫기' : '고치기'}
                    </button>
                    <button type="button" className="link-btn small" onClick={() => window.confirm(`${f.id} 피드백을 지울까요?`) && remove(f.id)}>
                      지우기
                    </button>
                  </header>
                  {editing === f.id ? (
                    <div className="fb-edit">
                      <div className="row fb-meta">
                        <input type="date" value={f.date} onChange={(e) => patch(f.id, { date: e.target.value })} aria-label="받은 날" />
                        <input type="text" value={f.who} onChange={(e) => patch(f.id, { who: e.target.value })} aria-label="누가" />
                        <input type="text" value={f.occasion} onChange={(e) => patch(f.id, { occasion: e.target.value })} aria-label="자리" placeholder="자리" />
                      </div>
                      <textarea rows={3} value={f.text} onChange={(e) => patch(f.id, { text: e.target.value })} aria-label="피드백 내용" />
                      <RefPicker project={project} cardIds={f.cardIds} panelIds={f.panelIds} onChange={(c, p) => patch(f.id, { cardIds: c, panelIds: p })} />
                    </div>
                  ) : (
                    <>
                      <p className="fb-text">{f.text}</p>
                      {(f.cardIds.length > 0 || f.panelIds.length > 0) && (
                        <div className="fb-chips">
                          {f.cardIds.map((id) => (
                            <button key={id} type="button" className="ref-chip" onClick={() => byId.has(id) && onOpenCard(id)} disabled={!byId.has(id)}>
                              <span className="card-id">{id}</span> {byId.get(id) ? cardTitle(byId.get(id)!).slice(0, 40) : '(지워진 카드)'}
                            </button>
                          ))}
                          {f.panelIds.map((id) => (
                            <span key={id} className="ref-chip">
                              도판 {ORDERED_PANELS.find((p) => p.id === id)?.title ?? id}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  <div className="segmented small fb-status" role="radiogroup" aria-label={`${f.id} 반영 상태`}>
                    {FB_STATUS.map((s: FeedbackStatus) => (
                      <button key={s} type="button" role="radio" aria-checked={f.status === s} className={f.status === s ? 'on' : ''} onClick={() => patch(f.id, { status: s })}>
                        {FB_STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                  <textarea rows={2} value={f.response} placeholder={FB_RESPONSE_HINT[f.status]} onChange={(e) => patch(f.id, { response: e.target.value })} aria-label={`${f.id} 반영 내용`} />
                  {since && (
                    <p className="small muted">
                      받은 뒤 바뀐 것: {since} <span className="muted">(⑨ 리포트 › 변화 기록에서 '{v!.name}'과 비교)</span>
                    </p>
                  )}
                </article>
              )
            })}
          </section>
        )
      })}
      {!list.length && <p className="muted">아직 적은 피드백이 없습니다.</p>}
    </div>
  )
}
