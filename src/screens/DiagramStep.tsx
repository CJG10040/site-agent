import { useEffect, useMemo, useState } from 'react'
import type { PanelOutput } from '../diagrams/compose'
import { svgBlob, svgToPng, zipBlob } from '../diagrams/export'
import { siteOverview } from '../diagrams/overview'
import { PALETTES } from '../diagrams/palette'
import { ORDERED_PANELS, PANEL_GROUP_ORDER, panelNumber, type PanelDef } from '../diagrams/panels'
import { buildPanelPrompt, parsePanelAnswer } from '../diagrams/prompt'
import { DEFAULT_SETTINGS, panelFileName } from '../diagrams/render'
import { useDiagrams, type CachedPanel } from '../diagrams/useDiagrams'
import { upsertDrafts } from '../model/applyCollection'
import { appendSpeedSnapshot } from '../model/applyMove'
import { downloadBlob, nowIso } from '../model/project'
import { splitPrompt } from '../model/prompts'
import type { DiagramSettings, PanelNote, Project } from '../model/types'
import { snapshotLabel, timeBand, toSnapshot, trafficInBox } from '../sources/its'
import type { ApiKeys } from '../sources/keys'
import type { VWorldConfig } from '../sources/vworld'
import { SEASONS } from '../sources/wind'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  config: VWorldConfig
  keys: ApiKeys
  onGoData: () => void
  onNext: () => void
}

const EMPTY_NOTE: PanelNote = { conclusion: '', suggestions: [], include: true, source: null, updatedAt: '' }

function noteOf(project: Project, id: string): PanelNote {
  return { ...EMPTY_NOTE, ...(project.diagrams?.panels[id] ?? {}) }
}

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg-field">
      <span className="label">{label}</span>
      <div className="segmented small" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Viewer({ panel, def, onClose, onSvg, onPng }: { panel: CachedPanel; def: PanelDef; onClose: () => void; onSvg: () => void; onPng: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="diagram-viewer" role="dialog" aria-modal="true" aria-label={def.title} onClick={(e) => e.stopPropagation()}>
        <img src={panel.url} alt={def.title} />
        <div className="row">
          <button type="button" className="btn small" onClick={onSvg}>
            SVG
          </button>
          <button type="button" className="btn small" onClick={onPng}>
            PNG
          </button>
          <span className="spacer" />
          <button type="button" className="btn small ghost" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

export default function DiagramStep({ project, update, config, keys, onGoData, onNext }: Props) {
  const { data, settings, panels, busy, terrain } = useDiagrams(project, config.key)
  const [viewing, setViewing] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [chatbot, setChatbot] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [copied, setCopied] = useState<number | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const [speedBusy, setSpeedBusy] = useState(false)
  // 처음 열 때 결론이 하나도 없으면 챗봇 상자를 펼쳐 둔다 (그 뒤로는 사용자가 연 대로)
  const [chatOpen, setChatOpen] = useState(() => !Object.values(project.diagrams?.panels ?? {}).some((n) => n.conclusion.trim()))

  const overview = useMemo(() => (data ? siteOverview(project, data, terrain) : null), [data, project, terrain])

  const setSettings = (patch: Partial<DiagramSettings>) =>
    update((d) => {
      const cur = d.diagrams ?? { settings: { ...DEFAULT_SETTINGS }, panels: {} }
      cur.settings = { ...DEFAULT_SETTINGS, ...cur.settings, ...patch }
      d.diagrams = cur
    })

  const patchNote = (id: string, patch: Partial<PanelNote>) =>
    update((d) => {
      const cur = d.diagrams ?? { settings: { ...DEFAULT_SETTINGS }, panels: {} }
      cur.panels = { ...cur.panels, [id]: { ...EMPTY_NOTE, ...cur.panels[id], ...patch, updatedAt: nowIso() } }
      d.diagrams = cur
    })

  /** 실시간 도로 속도 한 장면 더 받기 (출근·낮·퇴근 시간 비교용) */
  const fetchSpeed = async () => {
    if (!data || speedBusy) return
    setSpeedBusy(true)
    setMsg(null)
    try {
      const R = data.R
      const [lon, lat] = data.center
      const dLat = R / 110574
      const dLon = R / (111320 * Math.cos((lat * Math.PI) / 180))
      const snap = toSnapshot(await trafficInBox(keys, [lon - dLon, lat - dLat, lon + dLon, lat + dLat]))
      if (!Object.keys(snap.speeds).length) throw new Error('이 범위에 속도 자료가 있는 도로가 없습니다')
      const last = data.speedSnaps[data.speedSnaps.length - 1]
      if (last && snap.created && last.created === snap.created)
        throw new Error(`아직 새 자료가 없습니다 (${snapshotLabel(last)} 자료가 최신, 약 5분마다 갱신)`)
      update((d) => {
        appendSpeedSnapshot(d, snap, R, upsertDrafts)
        const cur = d.diagrams ?? { settings: { ...DEFAULT_SETTINGS }, panels: {} }
        cur.settings = { ...DEFAULT_SETTINGS, ...cur.settings, speedSnap: -1 }
        d.diagrams = cur
      })
      setMsg({ kind: 'ok', text: `${snapshotLabel(snap)}(${timeBand(snap)}) 속도 장면을 더했습니다. 사실 카드 '교통'도 고쳤습니다.` })
    } catch (e) {
      setMsg({ kind: 'error', text: `속도를 받지 못했습니다: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setSpeedBusy(false)
    }
  }

  const ready = ORDERED_PANELS.filter((p) => panels[p.id] && !panels[p.id].out.empty)
  const written = ORDERED_PANELS.filter((p) => noteOf(project, p.id).conclusion.trim()).length

  const prompt = useMemo(
    () => buildPanelPrompt(project, ready.map((p) => ({ id: p.id, out: panels[p.id].out as PanelOutput }))),
    // 결론을 쓰는 동안에도 프롬프트에 반영되도록 project 전체에 따름
    [project, panels, ready],
  )
  const parts = splitPrompt(prompt, 9000)

  const copy = async (text: string, i: number) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(i)
      window.setTimeout(() => setCopied(null), 1500)
    } catch {
      setMsg({ kind: 'error', text: '복사하지 못했습니다. 프롬프트를 직접 선택해 복사하세요.' })
    }
  }

  const importAnswer = () => {
    const r = parsePanelAnswer(answer)
    const ids = Object.keys(r.byId)
    if (!ids.length) {
      setMsg({ kind: 'error', text: "답변에서 '### [도판] 도판id' 와 '결론1:' 형식을 찾지 못했습니다. 챗봇에게 형식을 지켜 달라고 다시 요청해 보세요." })
      return
    }
    update((d) => {
      const cur = d.diagrams ?? { settings: { ...DEFAULT_SETTINGS }, panels: {} }
      const t = nowIso()
      for (const id of ids) {
        const prev = { ...EMPTY_NOTE, ...cur.panels[id] }
        cur.panels[id] = { ...prev, suggestions: r.byId[id].slice(0, 4), updatedAt: t }
      }
      cur.chatLog = [...(cur.chatLog ?? []), { at: t, chatbot: chatbot.trim(), prompt, answer, matched: ids.length }]
      d.diagrams = cur
    })
    setAnswer('')
    setMsg({ kind: 'ok', text: `${ids.length}개 도판에 결론 후보를 붙였습니다. 각 도판에서 후보를 눌러 고르거나 고쳐 쓰세요.${r.unknown.length ? ` (알아보지 못한 제목 ${r.unknown.length}개)` : ''}` })
  }

  const downloadSvg = (def: PanelDef) => {
    const p = panels[def.id]
    if (p) downloadBlob(panelFileName(project, def, 'svg'), svgBlob(p.svg))
  }
  const downloadPng = async (def: PanelDef) => {
    const p = panels[def.id]
    if (!p) return
    try {
      downloadBlob(panelFileName(project, def, 'png'), await svgToPng(p.svg, settings.pngWidth, settings.background === 'white' ? '#ffffff' : null))
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }
  const downloadAll = async (kind: 'svg' | 'png') => {
    setExporting(kind)
    try {
      const files: { name: string; data: Blob | string }[] = []
      for (const def of ready) {
        const p = panels[def.id]
        files.push({
          name: panelFileName(project, def, kind),
          data: kind === 'svg' ? `<?xml version="1.0" encoding="UTF-8"?>\n${p.svg}` : await svgToPng(p.svg, settings.pngWidth, settings.background === 'white' ? '#ffffff' : null),
        })
      }
      const name = (project.brief.projectName || '대지').replace(/[\\/:*?"<>|\s]+/g, '_')
      downloadBlob(`${name}_도판_${kind.toUpperCase()}.zip`, await zipBlob(files))
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setExporting(null)
    }
  }

  if (!data) {
    return (
      <div className="form-page wide">
        <header className="form-head">
          <p className="eyebrow">⑥ 도판</p>
          <h2>도판으로 보고 결론 한 문장 쓰기</h2>
        </header>
        <div className="notice">
          <p>먼저 대지를 정하고 공간정보를 수집해야 도판을 그릴 수 있습니다.</p>
          <button type="button" className="btn small" onClick={onGoData}>
            공간정보 수집하러 가기
          </button>
        </div>
      </div>
    )
  }

  const viewDef = viewing ? ORDERED_PANELS.find((p) => p.id === viewing) : null

  return (
    <div className="form-page wide diagrams-page">
      <header className="form-head">
        <p className="eyebrow">⑥ 도판</p>
        <h2>도판으로 보고 결론 한 문장 쓰기</h2>
        <p className="muted">
          도판 한 장에는 사실 하나만 담았습니다. 각 도판에서 <strong>무엇을 판단할 수 있는지 한 문장</strong>으로 적어 보세요. 챗봇에게 결론 후보를 받을 수도 있습니다. 적은
          결론은 해석 단계의 프롬프트와 리포트에 함께 들어갑니다. 모르는 값은 회색 '미상'으로 두었습니다.
        </p>
      </header>

      {!project.collectedAt && (
        <p className="notice">
          아직 공간정보를 수집하지 않았습니다.{' '}
          <button type="button" className="link-btn" onClick={onGoData}>
            공간정보 수집
          </button>
        </p>
      )}

      {overview && (
        <section className="overview-card">
          <div>
            <h3>대지</h3>
            <dl>
              {overview.site.map((it) => (
                <div key={it.label}>
                  <dt>{it.label}</dt>
                  <dd>
                    {it.value}
                    {it.note && <span className="muted small"> {it.note}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h3>주변 (반경 {data.R}m)</h3>
            <dl>
              {overview.around.map((it) => (
                <div key={it.label}>
                  <dt>{it.label}</dt>
                  <dd>
                    {it.value}
                    {it.note && <span className="muted small"> {it.note}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="muted small overview-note">{overview.note}</p>
        </section>
      )}

      <section className="diagram-settings">
        <Seg label="틀" value={settings.frame} options={[{ v: 'circle', label: '원형' }, { v: 'square', label: '사각형' }]} onChange={(v) => setSettings({ frame: v })} />
        <Seg label="색" value={settings.palette} options={PALETTES.map((p) => ({ v: p.id, label: p.label }))} onChange={(v) => setSettings({ palette: v })} />
        <Seg label="바탕" value={settings.background} options={[{ v: 'white', label: '흰색' }, { v: 'none', label: '투명' }]} onChange={(v) => setSettings({ background: v })} />
        <Seg
          label="대지 표시"
          value={settings.siteMark}
          options={[
            { v: 'outline', label: '경계선' },
            { v: 'fill', label: '채움' },
            { v: 'dot', label: '점' },
          ]}
          onChange={(v) => setSettings({ siteMark: v })}
        />
        <label className="num-field">
          <span className="label">고층 기준</span>
          <input type="number" min={3} max={60} value={settings.highFloors} onChange={(e) => setSettings({ highFloors: Math.max(3, Number(e.target.value) || 10) })} />
          <span className="muted small">층 이상</span>
        </label>
        <label className="num-field">
          <span className="label">저층 기준</span>
          <input type="number" min={1} max={20} value={settings.lowFloors} onChange={(e) => setSettings({ lowFloors: Math.max(1, Number(e.target.value) || 4) })} />
          <span className="muted small">층 이하</span>
        </label>
        <Seg
          label="그림자·일조 날짜"
          value={settings.sunDay}
          options={[
            { v: 'winter', label: '동지' },
            { v: 'equinox', label: '춘·추분' },
            { v: 'summer', label: '하지' },
          ]}
          onChange={(v) => setSettings({ sunDay: v })}
        />
        <label className="num-field">
          <span className="label">그림자 시각 {settings.sunHour}시</span>
          <input type="range" min={7} max={18} step={1} value={settings.sunHour} onChange={(e) => setSettings({ sunHour: Number(e.target.value) })} />
        </label>
        {data?.env && (
          <label className="num-field">
            <span className="label">계획 층수 (가시권)</span>
            <input type="number" min={1} max={80} value={settings.planFloors} onChange={(e) => setSettings({ planFloors: Math.max(1, Math.min(80, Number(e.target.value) || 5)) })} />
            <span className="muted small">층 × 3m</span>
          </label>
        )}
        {data?.wind && (
          <Seg label="바람장미" value={settings.windSeason} options={SEASONS.map((s, i) => ({ v: i, label: s }))} onChange={(v) => setSettings({ windSeason: v })} />
        )}
        {data && (data.speedSnaps.length > 0 || project.dataSelection?.includes('traffic')) && (
          <div className="seg-field speed-field">
            <span className="label">도로 속도 장면</span>
            <div className="row">
              {data.speedSnaps.length > 0 && (
                <select
                  value={settings.speedSnap >= 0 && settings.speedSnap < data.speedSnaps.length ? settings.speedSnap : data.speedSnaps.length - 1}
                  onChange={(e) => setSettings({ speedSnap: Number(e.target.value) })}
                  aria-label="도로 속도 장면"
                >
                  {data.speedSnaps.map((s, i) => (
                    <option key={s.at} value={i}>
                      {snapshotLabel(s)} · {timeBand(s)}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="btn small" disabled={speedBusy || !keys.itsKey.trim()} onClick={() => void fetchSpeed()} title={keys.itsKey.trim() ? '' : '설정에서 국가교통정보센터 키를 넣으세요'}>
                {speedBusy ? '받는 중…' : '지금 한 번 더 받기'}
              </button>
            </div>
          </div>
        )}
        <Seg label="PNG 크기" value={settings.pngWidth} options={[{ v: 2000, label: '2000px' }, { v: 4000, label: '4000px' }]} onChange={(v) => setSettings({ pngWidth: v })} />
        <div className="diagram-export">
          <button type="button" className="btn small" disabled={!!exporting || busy || !ready.length} onClick={() => void downloadAll('svg')}>
            {exporting === 'svg' ? '묶는 중…' : 'SVG 모두 (ZIP)'}
          </button>
          <button type="button" className="btn small" disabled={!!exporting || busy || !ready.length} onClick={() => void downloadAll('png')}>
            {exporting === 'png' ? '만드는 중…' : 'PNG 모두 (ZIP)'}
          </button>
        </div>
      </section>

      <details className="block chat-box" open={chatOpen} onToggle={(e) => setChatOpen(e.currentTarget.open)}>
        <summary>
          <strong>챗봇에게 도판별 결론 후보 받기</strong> <span className="muted small">— 결론 {written}/{ready.length}개 작성</span>
        </summary>
        <ol className="steps-list">
          <li>
            프롬프트를 복사해 챗봇에 붙여넣으세요{parts.length > 1 ? ` (길어서 ${parts.length}개로 나눔 — 차례로 붙여넣기)` : ''}.
            <div className="row">
              {parts.map((p, i) => (
                <button key={i} type="button" className="btn small" disabled={busy && !ready.length} onClick={() => void copy(p, i)}>
                  {copied === i ? '복사됨' : parts.length > 1 ? `프롬프트 ${i + 1}/${parts.length} 복사` : '프롬프트 복사'}
                </button>
              ))}
              {busy && <span className="muted small">도판을 그리는 중이라 아직 모든 도판이 들어가지 않았습니다.</span>}
            </div>
          </li>
          <li>
            챗봇의 답변 전체를 붙여넣고 [후보 넣기]를 누르세요.
            <input type="text" className="chatbot-name" placeholder="쓴 챗봇 이름 (선택)" value={chatbot} onChange={(e) => setChatbot(e.target.value)} />
            <textarea rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="### [도판] use&#10;결론1: …&#10;결론2: …" />
            <div className="row">
              <button type="button" className="btn primary small" disabled={!answer.trim()} onClick={importAnswer}>
                후보 넣기
              </button>
            </div>
          </li>
        </ol>
        {msg && <p className={`notice ${msg.kind === 'error' ? 'error' : 'ok'}`}>{msg.text}</p>}
      </details>

      {busy && <p className="loading">도판을 그리는 중… ({Object.keys(panels).length}/{ORDERED_PANELS.length})</p>}

      {PANEL_GROUP_ORDER.map((g) => {
        const defs = ORDERED_PANELS.filter((p) => p.group === g)
        return (
          <section key={g} className="diagram-group">
            <h3>{g}</h3>
            <div className="diagram-grid">
              {defs.map((def) => {
                const p = panels[def.id]
                const note = noteOf(project, def.id)
                const empty = p?.out.empty
                return (
                  <article key={def.id} className={`diagram-card${empty ? ' empty' : ''}`}>
                    <button type="button" className="diagram-thumb" onClick={() => p && setViewing(def.id)} aria-label={`${def.title} 크게 보기`} disabled={!p}>
                      {p ? <img src={p.url} alt={def.title} loading="lazy" /> : <span className="muted small">그리는 중…</span>}
                    </button>
                    <div className="diagram-body">
                      <h4>
                        <span className="muted">{String(panelNumber(def.id)).padStart(2, '0')}</span> {def.title}
                      </h4>
                      {empty ? (
                        <p className="muted small">
                          {empty}. {def.needs}
                        </p>
                      ) : (
                        <ul className="diagram-summary">
                          {(p?.out.summary ?? []).map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      )}
                      {!empty && (
                        <>
                          <label className="field">
                            <span className="label">결론 한 문장</span>
                            <textarea
                              rows={2}
                              value={note.conclusion}
                              placeholder="이 도판에서 대지에 대해 판단할 수 있는 것"
                              onChange={(e) => patchNote(def.id, { conclusion: e.target.value, source: 'user' })}
                            />
                          </label>
                          {note.suggestions.length > 0 && (
                            <div className="suggestions">
                              <span className="muted small">챗봇 후보 (눌러서 쓰기)</span>
                              {note.suggestions.map((s, i) => (
                                <button key={i} type="button" className={`chip small suggestion${note.conclusion === s ? ' on' : ''}`} onClick={() => patchNote(def.id, { conclusion: s, source: 'chatbot' })}>
                                  {s}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="row diagram-actions">
                            <label className="check-row small">
                              <input type="checkbox" checked={note.include} onChange={(e) => patchNote(def.id, { include: e.target.checked })} />
                              리포트에 넣기
                            </label>
                            <span className="spacer" />
                            <button type="button" className="btn small ghost" disabled={!p} onClick={() => downloadSvg(def)}>
                              SVG
                            </button>
                            <button type="button" className="btn small ghost" disabled={!p} onClick={() => void downloadPng(def)}>
                              PNG
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        )
      })}

      <div className="panel-foot">
        <p className="muted small">결론 {written}개 작성 · 결론은 해석 단계 프롬프트와 리포트에 함께 들어갑니다.</p>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={onNext}>
          현장 관찰로
        </button>
      </div>

      {viewing && viewDef && panels[viewing] && (
        <Viewer panel={panels[viewing]} def={viewDef} onClose={() => setViewing(null)} onSvg={() => downloadSvg(viewDef)} onPng={() => void downloadPng(viewDef)} />
      )}
    </div>
  )
}
