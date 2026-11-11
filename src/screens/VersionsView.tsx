// ⑨ 리포트 › 변화 기록: 저장한 조사 버전 목록과 두 시점 비교 (카드·도판 결론·첫 질문·요약문·종합 다이어그램).

import { useEffect, useMemo, useState } from 'react'
import VersionSave from '../components/VersionSave'
import type { DiagramData } from '../diagrams/data'
import { ORDERED_PANELS } from '../diagrams/panels'
import { renderPanel, collectedDate } from '../diagrams/render'
import { svgBlob } from '../diagrams/export'
import { SYNTH_PANEL, synthCtxFrom } from '../diagrams/synth'
import { deleteVersion, listVersions, renameVersion } from '../model/db'
import { TYPE_LABEL } from '../model/prompts'
import type { DiagramSettings, Project } from '../model/types'
import { cardTitleOf, countsText, diffHeadline, diffVersions, snapshotOf, TRIGGER_LABEL, type VersionRecord, type VersionSnap } from '../model/versions'

interface Props {
  project: Project
  data: DiagramData | null
  settings: DiagramSettings
  vworldKey: string
}

const NOW = 'now'
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

function SynthThumb({ snap, data, settings, vworldKey, project, label }: { snap: VersionSnap; data: DiagramData; settings: DiagramSettings; vworldKey: string; project: Project; label: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const sig = JSON.stringify([snap.synth, snap.cards.length])
  useEffect(() => {
    let alive = true
    let u = ''
    void renderPanel(SYNTH_PANEL, data, settings, vworldKey, collectedDate(project), null, { synth: synthCtxFrom(snap.cards, snap.synth) }).then((r) => {
      if (!alive || r.out.empty) return
      u = URL.createObjectURL(svgBlob(r.svg))
      setUrl(u)
    })
    return () => {
      alive = false
      if (u) URL.revokeObjectURL(u)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, data])
  return (
    <figure className="version-synth">
      {url ? <img src={url} alt={`${label} 종합 다이어그램`} /> : <span className="muted small">종합 다이어그램 없음</span>}
      <figcaption className="small">{label}</figcaption>
    </figure>
  )
}

export default function VersionsView({ project, data, settings, vworldKey }: Props) {
  const [list, setList] = useState<VersionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [a, setA] = useState<string>('')
  const [b, setB] = useState<string>(NOW)
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const reload = () =>
    listVersions(project.id)
      .then((l) => {
        setList(l)
        setLoading(false)
        setA((cur) => (cur && l.some((v) => v.id === cur) ? cur : (l[0]?.id ?? '')))
      })
      .catch(() => setLoading(false))
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  const now = useMemo(() => snapshotOf(project), [project])
  const snapOf = (id: string): VersionSnap | null => (id === NOW ? now : (list.find((v) => v.id === id)?.snap ?? null))
  const nameOf = (id: string) => (id === NOW ? '지금' : (list.find((v) => v.id === id)?.name ?? ''))
  const sa = a ? snapOf(a) : null
  const sb = snapOf(b)
  const diff = sa && sb ? diffVersions(sa, sb) : null
  const titleOf = (id: string) => ORDERED_PANELS.find((p) => p.id === id)?.title ?? id

  const options = [
    { id: NOW, label: `지금 (${when(new Date().toISOString())})` },
    ...list.map((v) => ({ id: v.id, label: `${v.name} · ${when(v.createdAt)}` })),
  ]

  return (
    <div className="versions-view">
      <div className="report-toolbar no-print">
        <div className="row">
          <strong>조사 버전</strong>
          <span className="muted small">카드·도판 결론·첫 질문·요약문·종합 다이어그램을 시점별로 남겨 해석이 어떻게 바뀌었는지 봅니다. 수집한 원자료는 넣지 않습니다.</span>
          <span className="spacer" />
          <VersionSave project={project} className="btn small primary" onSaved={() => void reload()} />
        </div>
        <p className="help">'버전 저장'은 위 막대에도 있습니다. 다시 수집하기 직전과 리포트를 인쇄할 때는 바뀐 것이 있으면 자동으로 하나씩 남깁니다(자동 버전은 최근 20개까지). 프로젝트 파일로 내보내면 버전도 함께 옮겨집니다.</p>
      </div>

      <section className="versions-list">
        <h3>저장한 버전 ({list.length})</h3>
        {loading && <p className="muted">불러오는 중…</p>}
        {!loading && !list.length && <p className="muted">아직 저장한 버전이 없습니다. 크리틱 전후처럼 해석이 바뀌는 때에 '버전 저장'을 눌러 두세요.</p>}
        <ul>
          {list.map((v) => (
            <li key={v.id}>
              {editing === v.id ? (
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void renameVersion(v.id, editName.trim() || v.name).then(() => {
                      setEditing(null)
                      void reload()
                    })
                  }}
                >
                  <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} aria-label="버전 이름" />
                  <button type="submit" className="btn small">
                    바꾸기
                  </button>
                </form>
              ) : (
                <strong>{v.name}</strong>
              )}
              <span className="muted small">
                {when(v.createdAt)} · {TRIGGER_LABEL[v.trigger]}
              </span>
              <span className="small">{countsText(v.snap)}</span>
              <span className="spacer" />
              <button type="button" className="link-btn small" onClick={() => setA(v.id)}>
                비교 기준으로
              </button>
              <button
                type="button"
                className="link-btn small"
                onClick={() => {
                  setEditing(v.id)
                  setEditName(v.name)
                }}
              >
                이름
              </button>
              <button
                type="button"
                className="link-btn small"
                onClick={() => {
                  if (window.confirm(`'${v.name}' 버전을 지울까요? 되돌릴 수 없습니다.`)) void deleteVersion(v.id).then(() => void reload())
                }}
              >
                지우기
              </button>
            </li>
          ))}
        </ul>
      </section>

      {list.length > 0 && (
        <section className="versions-compare">
          <h3>비교</h3>
          <div className="row">
            <label className="field inline">
              <span className="label">이전</span>
              <select value={a} onChange={(e) => setA(e.target.value)}>
                {options
                  .filter((o) => o.id !== NOW)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
              </select>
            </label>
            <span aria-hidden="true">→</span>
            <label className="field inline">
              <span className="label">나중</span>
              <select value={b} onChange={(e) => setB(e.target.value)}>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {diff && sa && sb && (
            <>
              <p className="version-headline">
                <strong>{nameOf(a)}</strong> → <strong>{nameOf(b)}</strong>: {diffHeadline(diff)}
                {diff.siteChanged && <span className="tag warn"> 대지가 바뀜</span>}
                {diff.recollected && <span className="tag"> 다시 수집함</span>}
              </p>
              <table className="report-table version-counts">
                <thead>
                  <tr>
                    <th>카드</th>
                    {diff.counts.map((c) => (
                      <th key={c.type}>{c.label}</th>
                    ))}
                    <th>도판 결론</th>
                    <th>종합 기호</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>{nameOf(a)}</th>
                    {diff.counts.map((c) => (
                      <td key={c.type}>{c.a}</td>
                    ))}
                    <td>{Object.keys(sa.conclusions).length}</td>
                    <td>{diff.synth.a}</td>
                  </tr>
                  <tr>
                    <th>{nameOf(b)}</th>
                    {diff.counts.map((c) => (
                      <td key={c.type} className={c.b > c.a ? 'up' : c.b < c.a ? 'down' : ''}>
                        {c.b}
                      </td>
                    ))}
                    <td>{Object.keys(sb.conclusions).length}</td>
                    <td>{diff.synth.b}</td>
                  </tr>
                </tbody>
              </table>

              {diff.question.length > 0 && (
                <div className="version-sec">
                  <h4>첫 질문</h4>
                  {diff.question.map((q) => (
                    <p key={q.label} className="version-change">
                      <span className="label">{q.label}</span>
                      <del>{q.before || '(비어 있음)'}</del> → <ins>{q.after || '(비어 있음)'}</ins>
                    </p>
                  ))}
                </div>
              )}

              {diff.cards.length > 0 && (
                <div className="version-sec">
                  <h4>카드 ({diff.cards.length})</h4>
                  <ul className="version-cards">
                    {diff.cards.map((c) => (
                      <li key={`${c.kind}-${c.id}`} className={`kind-${c.kind}`}>
                        <span className="version-kind">{c.kind === 'added' ? '생김' : c.kind === 'removed' ? '빠짐' : '바뀜'}</span>
                        <span className="rid">{c.id}</span> <span className="muted small">{TYPE_LABEL[c.type]}</span>{' '}
                        {c.kind === 'changed' && c.before && c.after ? (
                          <>
                            {c.before.text !== c.after.text ? (
                              <>
                                <del>{c.before.text}</del> → <ins>{c.after.text}</ins>
                              </>
                            ) : (
                              cardTitleOf(c.after)
                            )}
                            <span className="muted small"> ({c.changes.join(', ')})</span>
                          </>
                        ) : (
                          <>
                            {cardTitleOf((c.after ?? c.before)!)}
                            {c.kind === 'removed' && <span className="muted small"> ({c.changes.join(', ')})</span>}
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {diff.conclusions.length > 0 && (
                <div className="version-sec">
                  <h4>도판 결론 ({diff.conclusions.length})</h4>
                  {diff.conclusions.map((c) => (
                    <p key={c.id} className="version-change">
                      <span className="label">{titleOf(c.id)}</span>
                      <del>{c.before || '(없음)'}</del> → <ins>{c.after || '(지움)'}</ins>
                    </p>
                  ))}
                </div>
              )}

              {diff.summary && (
                <div className="version-sec">
                  <h4>대지해석 요약문</h4>
                  <p className="version-change">
                    <del>{diff.summary.before || '(없음)'}</del>
                  </p>
                  <p className="version-change">
                    <ins>{diff.summary.after || '(없음)'}</ins>
                  </p>
                </div>
              )}

              {(diff.feedback.added.length > 0 || diff.feedback.changed.length > 0) && (
                <div className="version-sec">
                  <h4>피드백</h4>
                  {diff.feedback.added.map((f) => (
                    <p key={f.id} className="version-change">
                      <span className="version-kind kind-added-badge">적음</span> <span className="rid">{f.id}</span> {f.date} {f.who}: {f.text}
                    </p>
                  ))}
                  {diff.feedback.changed.map((f) => (
                    <p key={f.id} className="version-change">
                      <span className="rid">{f.id}</span> {f.text.slice(0, 60)} — <del>{f.before}</del> → <ins>{f.after}</ins>
                      {f.response && <span className="muted small"> ({f.response.slice(0, 80)})</span>}
                    </p>
                  ))}
                </div>
              )}

              {(diff.synth.a > 0 || diff.synth.b > 0) && (
                <div className="version-sec">
                  <h4>종합 다이어그램</h4>
                  {(diff.synth.added.length > 0 || diff.synth.removed.length > 0) && (
                    <p className="small">
                      {diff.synth.added.length > 0 && <>생김: {diff.synth.added.join(' / ')} </>}
                      {diff.synth.removed.length > 0 && <>· 빠짐: {diff.synth.removed.join(' / ')}</>}
                    </p>
                  )}
                  {data && (
                    <div className="version-synths">
                      <SynthThumb snap={sa} data={data} settings={settings} vworldKey={vworldKey} project={project} label={nameOf(a)} />
                      <SynthThumb snap={sb} data={data} settings={settings} vworldKey={vworldKey} project={project} label={nameOf(b)} />
                    </div>
                  )}
                </div>
              )}
              {diffHeadline(diff) === '바뀐 것 없음' && <p className="muted">두 시점의 해석이 같습니다.</p>}
            </>
          )}
        </section>
      )}
    </div>
  )
}
