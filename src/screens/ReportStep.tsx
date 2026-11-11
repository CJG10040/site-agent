import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePhotoUrl } from '../components/PhotoThumb'
import { areaM2, siteBoundary } from '../lib/geo'
import { boardSettingsOf, paperSize } from '../diagrams/board'
import { svgToPng } from '../diagrams/export'
import { ORDERED_PANELS, panelNumber } from '../diagrams/panels'
import { panelFileName } from '../diagrams/render'
import { useDiagrams } from '../diagrams/useDiagrams'
import { formatObservedAt, timeBand } from '../lib/photos'
import { observationsOf } from '../model/observations'
import { downloadBlob, nowIso } from '../model/project'
import { cardTitle, isRelation, REACTION_LABEL, ROUNDS } from '../model/prompts'
import type { Card, Project } from '../model/types'
import { listVersions, saveVersion } from '../model/db'
import { countsText, TRIGGER_LABEL, type VersionRecord } from '../model/versions'
import type { VWorldConfig } from '../sources/vworld'

const BoardView = lazy(() => import('./BoardView'))
const VersionsView = lazy(() => import('./VersionsView'))

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  config: VWorldConfig
}

type Paper = 'a4' | 'a3'
type Scope = 'all' | 'confirmed'

const HYP_ROWS = ['해석', '해결하려는 긴장', '공간적 행동', '예상 경험', '장점', '위험', '추가 조사', '스케일']
const DIRECTIONS = ['보존할 것', '드러낼 것', '피할 것', '변환할 것']

function statusLabel(c: Card): string {
  if (c.reaction) return REACTION_LABEL[c.reaction]
  if (c.type === 'OBSERVATION') return ''
  return c.status === 'confirmed' ? '확인' : '검토 중'
}

function ReportPhoto({ id, alt }: { id: string; alt: string }) {
  const url = usePhotoUrl(id)
  return url ? <img className="report-photo" src={url} alt={alt} /> : <span className="report-photo placeholder" />
}

function Refs({ ids }: { ids: string[] }) {
  if (!ids.length) return null
  return <span className="report-refs">근거 {ids.join(', ')}</span>
}

export default function ReportStep({ project, update, config }: Props) {
  const [paper, setPaper] = useState<Paper>('a4')
  const [scope, setScope] = useState<Scope>('all')
  const [view, setView] = useState<'report' | 'board' | 'versions'>('report')
  const [versions, setVersions] = useState<VersionRecord[]>([])
  const projectRef = useRef(project)
  projectRef.current = project
  useEffect(() => {
    void listVersions(project.id)
      .then(setVersions)
      .catch(() => setVersions([]))
  }, [project.id, view])

  const boundary = useMemo(() => siteBoundary(project.site), [project.site])

  const include = useCallback(
    (c: Card) => c.status !== 'rejected' && (scope === 'all' || c.status === 'confirmed' || c.type === 'OBSERVATION'),
    [scope],
  )
  const cards = project.cards.filter(include)
  const facts = cards.filter((c) => c.type === 'FACT' && c.status === 'confirmed')
  const observations = observationsOf(project).filter((o) => o.text.trim())
  const relations = cards.filter(isRelation)
  const tensions = cards.filter((c) => c.type === 'TENSION' || c.type === 'OPPORTUNITY')
  const interps = cards.filter((c) => c.type === 'INTERPRETATION' && !isRelation(c))
  const questions = cards.filter((c) => c.type === 'QUESTION')
  const hyps = cards.filter((c) => c.type === 'HYPOTHESIS')
  const unknowns = cards.filter((c) => c.type === 'UNKNOWN')
  const factTopics = [...new Set(facts.map((f) => f.topic))]

  const usedSourceIds = new Set(facts.flatMap((f) => f.related_source_ids))
  const sources = project.sources.filter((s) => usedSourceIds.has(s.source_id))

  const addr = project.site.address?.road || project.site.address?.parcel || project.site.parcels[0]?.addr || ''
  const officialArea = facts.find((f) => f.auto_key === 'land-official-area')?.text

  // ── 도판 (⑥ 도판 단계에서 '리포트에 넣기'로 고른 것)
  const includedIds = ORDERED_PANELS.filter((p) => project.diagrams?.panels[p.id]?.include !== false).map((p) => p.id)
  const { panels: diagramPanels, busy: diagramsBusy, settings: diagramSettings, data: diagramData, terrain } = useDiagrams(project, config.key, includedIds)
  const diagrams = ORDERED_PANELS.filter((p) => includedIds.includes(p.id) && diagramPanels[p.id] && !diagramPanels[p.id].out.empty)

  useEffect(() => {
    const onAfter = () => {
      update((d) => {
        d.reportPrintedAt = nowIso()
      })
      // 인쇄한 시점의 해석을 버전으로 (바로 앞 버전과 같으면 건너뜀)
      void saveVersion(projectRef.current, '리포트 인쇄', 'print')
        .then(() => listVersions(projectRef.current.id))
        .then(setVersions)
        .catch(() => undefined)
    }
    window.addEventListener('afterprint', onAfter)
    return () => window.removeEventListener('afterprint', onAfter)
  }, [update])

  const board = paperSize(boardSettingsOf(project.diagrams?.board))
  const pageCss =
    view === 'board'
      ? `@page { size: ${board.w}mm ${board.h}mm; margin: 0; }`
      : paper === 'a4'
        ? '@page { size: A4 portrait; margin: 12mm; }'
        : '@page { size: A3 landscape; margin: 12mm; }'
  const sessions = project.chatLog ?? []
  const chatbots = [...new Set(sessions.map((s) => s.chatbot).filter(Boolean))]

  let sec = 0
  const H = (title: string) => (
    <h2>
      <span className="sec-num">{++sec}</span> {title}
    </h2>
  )

  return (
    <div className="report-page">
      <style>{`@media print { ${pageCss} }`}</style>

      <div className="report-view-switch no-print">
        <div className="segmented" role="radiogroup" aria-label="보기">
          <button type="button" role="radio" aria-checked={view === 'report'} className={view === 'report' ? 'on' : ''} onClick={() => setView('report')}>
            리포트
          </button>
          <button type="button" role="radio" aria-checked={view === 'board'} className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>
            보드 (도판 조판)
          </button>
          <button type="button" role="radio" aria-checked={view === 'versions'} className={view === 'versions' ? 'on' : ''} onClick={() => setView('versions')}>
            변화 기록
          </button>
        </div>
        <span className="muted small">
          {view === 'report'
            ? '사실·관찰·해석·질문·가설을 담은 문서'
            : view === 'board'
              ? "'리포트에 넣기' 도판을 용지 한 장에 앉힌 판넬 — PDF·PNG 300dpi"
              : '저장한 조사 버전으로 해석이 어떻게 바뀌었는지 비교'}
        </span>
      </div>

      {view === 'versions' ? (
        <Suspense fallback={<p className="muted">불러오는 중…</p>}>
          <VersionsView project={project} data={diagramData} settings={diagramSettings} vworldKey={config.key} />
        </Suspense>
      ) : view === 'board' ? (
        <Suspense fallback={<p className="muted">보드를 여는 중…</p>}>
          <BoardView project={project} update={update} defs={diagrams} panels={diagramPanels} busy={diagramsBusy} data={diagramData} terrain={terrain} />
        </Suspense>
      ) : (
      <>
      <div className="report-toolbar no-print">
        <div className="row">
          <span className="label">판형</span>
          <div className="segmented">
            <button type="button" className={paper === 'a4' ? 'on' : ''} onClick={() => setPaper('a4')}>
              A4 세로
            </button>
            <button type="button" className={paper === 'a3' ? 'on' : ''} onClick={() => setPaper('a3')}>
              A3 가로
            </button>
          </div>
          <span className="label">카드</span>
          <div className="segmented">
            <button type="button" className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
              제외한 것만 빼고 전부
            </button>
            <button type="button" className={scope === 'confirmed' ? 'on' : ''} onClick={() => setScope('confirmed')}>
              확인·동의한 것만
            </button>
          </div>
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={() => window.print()} disabled={diagramsBusy}>
            인쇄 / PDF로 저장
          </button>
        </div>
        <p className="help">
          인쇄 창에서 대상(프린터)을 <strong>'PDF로 저장'</strong>으로 고르고, 설정에서 <strong>'배경 그래픽'</strong>을 켜세요. 용지는 위에서 고른 판형으로
          맞춰집니다.
        </p>
      </div>

      <article className={`report ${paper}`}>
        <header className="report-cover">
          <p className="eyebrow">대지해석 리포트</p>
          <h1>{project.brief.projectName || '이름 없는 프로젝트'}</h1>
          <dl className="cover-meta">
            {project.brief.theme && (
              <>
                <dt>과제·주제</dt>
                <dd>{project.brief.theme}</dd>
              </>
            )}
            {project.brief.program && (
              <>
                <dt>건축 프로그램</dt>
                <dd>{project.brief.program}</dd>
              </>
            )}
            {addr && (
              <>
                <dt>대지</dt>
                <dd>
                  {addr}
                  {boundary ? ` · 약 ${Math.round(areaM2(boundary)).toLocaleString('ko-KR')}㎡(도형 계산)` : ''} · 조사 반경 {project.site.radiusM}m
                </dd>
              </>
            )}
            <dt>작성일</dt>
            <dd>{new Date().toLocaleDateString('ko-KR')}</dd>
            <dt>카드 범위</dt>
            <dd>{scope === 'all' ? "학생이 제외한 카드를 뺀 전부 ('검토 중' 표시 포함)" : '학생이 확인·동의한 카드만'}</dd>
          </dl>
        </header>

        {project.panelSummary?.trim() && (
          <section className="report-sec summary">
            {H('대지해석 요약')}
            <p className="summary-text">{project.panelSummary}</p>
          </section>
        )}

        <section className="report-sec">
          {H('첫 질문과 관점')}
          <dl className="kv">
            {project.question.curiosity && (
              <>
                <dt>가장 궁금한 것</dt>
                <dd>{project.question.curiosity}</dd>
              </>
            )}
            {(project.question.lenses.length > 0 || project.question.lensOther) && (
              <>
                <dt>관심 관점</dt>
                <dd>{[...project.question.lenses, project.question.lensOther].filter(Boolean).join(', ')}</dd>
              </>
            )}
            {project.question.personal && (
              <>
                <dt>이 대지를 고른 이유·기억</dt>
                <dd>{project.question.personal}</dd>
              </>
            )}
            {project.question.avoid && (
              <>
                <dt>피하고 싶은 해석</dt>
                <dd>{project.question.avoid}</dd>
              </>
            )}
          </dl>
        </section>

        <section className="report-sec">
          {H(`대지의 사실 (${facts.length})`)}
          {officialArea && <p className="muted small">{officialArea}</p>}
          {facts.length === 0 && <p className="muted">확인한 사실이 없습니다.</p>}
          {factTopics.map((t) => (
            <div key={t} className="fact-group">
              <h3>{t}</h3>
              <ul className="report-list">
                {facts
                  .filter((f) => f.topic === t)
                  .map((f) => (
                    <li key={f.id}>
                      <span className="rid">{f.id}</span> {f.text}
                      {f.related_source_ids.length > 0 && <span className="report-refs">출처 {f.related_source_ids.join(', ')}</span>}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="report-sec">
          {H(`도판 (${diagrams.length})`)}
          {diagramsBusy && <p className="muted no-print">도판을 그리는 중…</p>}
          {!diagramsBusy && diagrams.length === 0 && <p className="muted">넣을 도판이 없습니다 (⑥ 도판 단계에서 '리포트에 넣기'를 고르세요).</p>}
          <div className="report-diagrams">
            {diagrams.map((def) => {
              const dp = diagramPanels[def.id]
              const note = project.diagrams?.panels[def.id]?.conclusion?.trim()
              return (
                <figure key={def.id} className="report-diagram">
                  <img src={dp.url} alt={def.title} />
                  <figcaption>
                    <strong>
                      도판 {panelNumber(def.id)}. {def.title}
                    </strong>
                    {note ? <span className="diagram-conclusion"> — {note}</span> : <span className="muted"> — 결론 미작성</span>}
                    <button
                      type="button"
                      className="link-btn no-print"
                      onClick={() =>
                        void svgToPng(dp.svg, diagramSettings.pngWidth, diagramSettings.background === 'white' ? '#ffffff' : null).then((blob) =>
                          downloadBlob(panelFileName(project, def, 'png'), blob),
                        )
                      }
                    >
                      PNG
                    </button>
                  </figcaption>
                </figure>
              )
            })}
          </div>
        </section>

        <section className="report-sec">
          {H(`현장 관찰 (${observations.length})`)}
          {observations.length === 0 && <p className="muted">현장 관찰이 없습니다.</p>}
          <div className="report-obs">
            {observations.map((o) => {
              const d = o.observation!
              const { band, weekend } = timeBand(d.observedAt)
              const rel = d.links.map((l) => `${l.cardId} ${l.relation === 'differ' ? '자료와 다름' : '일치'}`)
              return (
                <div key={o.id} className="obs-entry">
                  <p>
                    <span className="rid">{o.id}</span> {o.text}
                  </p>
                  <p className="muted small">
                    {d.observedAt ? `${formatObservedAt(d.observedAt)} · ${band}${weekend === null ? '' : weekend ? '·주말' : '·평일'}` : '시간 미상'} ·{' '}
                    {d.relative ?? '위치 미상'}
                    {[...d.senses, ...d.actors, ...d.actions].length > 0 && ` · ${[...d.senses, ...d.actors, ...d.actions].join(', ')}`}
                  </p>
                  {d.feeling && <p className="small">느낌: {d.feeling}</p>}
                  {(rel.length > 0 || d.discovery) && (
                    <p className="small">
                      {d.discovery && <span className="tag teal">새로운 발견</span>} {rel.join(' · ')}
                    </p>
                  )}
                  {d.photoIds.length > 0 && (
                    <div className="obs-photos">
                      {d.photoIds.slice(0, 3).map((pid, i) => (
                        <ReportPhoto key={pid} id={pid} alt={`${o.id} 사진 ${i + 1}`} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {relations.length > 0 && (
          <section className="report-sec">
            {H(`관계 분석 (${relations.length})`)}
            <table className="report-table">
              <thead>
                <tr>
                  <th>번호</th>
                  <th>관계 유형</th>
                  <th>내용</th>
                  <th>근거</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {relations.map((c) => (
                  <tr key={c.id}>
                    <td className="rid">{c.id}</td>
                    <td>{c.fields?.['관계 유형'] ?? ''}</td>
                    <td>{c.text}</td>
                    <td className="small">{c.related_card_ids.join(', ')}</td>
                    <td className="small">{statusLabel(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {tensions.length > 0 && (
          <section className="report-sec">
            {H('대지의 긴장과 기회')}
            <div className="report-buckets">
              {[...DIRECTIONS, ''].map((dir) => {
                const list = tensions.filter((c) => (dir ? (c.fields?.['방향'] ?? '').includes(dir.slice(0, 2)) : !DIRECTIONS.some((d) => (c.fields?.['방향'] ?? '').includes(d.slice(0, 2)))))
                if (!list.length) return null
                return (
                  <div key={dir || 'none'} className="report-bucket">
                    <h3>{dir || '방향 미정'}</h3>
                    {list.map((c) => (
                      <p key={c.id}>
                        <span className="rid">{c.id}</span> <span className="small muted">{c.type === 'TENSION' ? '긴장' : '기회'}</span>{' '}
                        {c.fields?.['제목'] && <strong>{c.fields['제목']}: </strong>}
                        {c.text} <Refs ids={c.related_card_ids} /> {statusLabel(c) && <span className="tag">{statusLabel(c)}</span>}
                      </p>
                    ))}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {interps.length > 0 && (
          <section className="report-sec">
            {H(`서로 다른 해석 (${interps.length})`)}
            <ul className="report-list">
              {interps.map((c) => (
                <li key={c.id}>
                  <span className="rid">{c.id}</span> {c.fields?.['관점'] && <span className="tag">{c.fields['관점']}</span>} {c.text}
                  {c.fields?.['반전 질문'] && <span className="small muted"> — 반전 질문: {c.fields['반전 질문']}</span>} <Refs ids={c.related_card_ids} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {questions.length > 0 && (
          <section className="report-sec">
            {H(`설계 질문 (${questions.length})`)}
            <ol className="report-questions">
              {questions.map((c) => (
                <li key={c.id}>
                  <strong>{c.text}</strong>{' '}
                  <span className="small muted">
                    {c.id}
                    {c.fields?.['질문 유형'] ? ` · ${c.fields['질문 유형']}` : ''}
                    {c.fields?.['스케일'] ? ` · ${c.fields['스케일']}` : ''}
                  </span>{' '}
                  <Refs ids={c.related_card_ids} />
                </li>
              ))}
            </ol>
          </section>
        )}

        {hyps.length > 0 && (
          <section className="report-sec">
            {H(`설계 가설 비교 (${hyps.length})`)}
            <div className="report-hyp-scroll">
              <table className="report-table hyp">
                <thead>
                  <tr>
                    <th />
                    {hyps.map((h) => (
                      <th key={h.id}>
                        <span className="rid">{h.id}</span> {cardTitle(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>근거</th>
                    {hyps.map((h) => (
                      <td key={h.id} className="small">
                        {h.related_card_ids.join(', ')}
                      </td>
                    ))}
                  </tr>
                  {HYP_ROWS.map((row) => (
                    <tr key={row}>
                      <th>{row}</th>
                      {hyps.map((h) => (
                        <td key={h.id}>{h.fields?.[row] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <th>학생 반응·메모</th>
                    {hyps.map((h) => (
                      <td key={h.id}>
                        {statusLabel(h)}
                        {h.user_note ? ` — ${h.user_note}` : ''}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        {unknowns.length > 0 && (
          <section className="report-sec">
            {H(`추가로 확인할 것 (${unknowns.length})`)}
            <ul className="report-list">
              {unknowns.map((c) => (
                <li key={c.id}>
                  <span className="rid">{c.id}</span> {c.text}
                  {c.fields?.['확인 방법'] && <span className="small muted"> — {c.fields['확인 방법']}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="report-sec">
          {H(`출처와 한계 (${sources.length})`)}
          <table className="report-table sources">
            <thead>
              <tr>
                <th>번호</th>
                <th>출처·자료</th>
                <th>수집·기준</th>
                <th>범위</th>
                <th>한계</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.source_id}>
                  <td className="rid">{s.source_id}</td>
                  <td>
                    {s.source_name}
                    <br />
                    <span className="small">{s.dataset_name}</span>
                  </td>
                  <td className="small">
                    {new Date(s.retrieved_at).toLocaleDateString('ko-KR')}
                    {s.time_range ? ` · ${s.time_range}` : ''}
                  </td>
                  <td className="small">{s.spatial_scale}</td>
                  <td className="small">{s.limitations}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">
            지적·용도지역 등 도시계획 정보는 참고용이며 법적 효력이 없습니다. 실제 규제는 토지이음 토지이용계획확인원과 조례로 확인해야 합니다. 통계는 거주 인구
            기준이며 시간대별 활동인구가 아닙니다.
          </p>
        </section>

        <section className="report-sec">
          {H('해석 과정 기록')}
          {versions.length > 0 && (
            <>
              <h3>조사 버전 ({versions.length})</h3>
              <ul className="report-list small">
                {[...versions].reverse().map((v) => (
                  <li key={v.id}>
                    <strong>{v.name}</strong> — {new Date(v.createdAt).toLocaleDateString('ko-KR')} · {TRIGGER_LABEL[v.trigger]} · {countsText(v.snap)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {sessions.length === 0 ? (
            <p className="muted">챗봇 왕복 기록이 없습니다.</p>
          ) : (
            <>
              <p className="small">
                관계·긴장·해석·질문·가설 카드는 학생이 정리한 사실·관찰을 근거로 챗봇{chatbots.length ? `(${chatbots.join(', ')})` : ''}이 제안하고, 학생이
                검토·반응·수정한 것입니다. 최종 판단은 학생에게 있습니다.
              </p>
              <ul className="report-list small">
                {ROUNDS.map((r) => {
                  const ss = sessions.filter((s) => s.round === r.id)
                  if (!ss.length) return null
                  const n = ss.reduce((sum, s) => sum + s.importedCardIds.length, 0)
                  return (
                    <li key={r.id}>
                      {r.short} {r.title}: {ss.length}회 ({ss.map((s) => new Date(s.createdAt).toLocaleDateString('ko-KR')).join(', ')}), 카드 {n}개
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </section>
      </article>
      </>
      )}
    </div>
  )
}
