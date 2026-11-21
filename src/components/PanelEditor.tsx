// ⑥ 도판 크게 보기 + 고치기 (2026-11-12 사용자 요청: 한번씩 잘못 표현되는 부분을 직접 고치기).
// 자료 빼기: 지도 도판에서 누른 곳의 점(정류소·역·상가·생활 시설)·도형(건물·공원·시설)을 골라 모든 도판·분석에서 뺀다.
// 건물 더하기 (2026-11-21 묶음 C5): 자료에 아직 없는 새 건물을 지도에서 외곽선으로 그리고 층수·용도를 넣는다 (모든 도판·분석·3D 모형에).
// 표기 옮기기: 도판의 글자를 끌어 옮기거나 숨긴다 (그 도판에만).
// 고친 것은 프로젝트에 기록하고, 다시 수집해도 위치·이름·글 내용으로 다시 찾아 적용한다.

import { useEffect, useMemo, useRef, useState } from 'react'
import { area as turfArea, booleanPointInPolygon, centroid as turfCentroid, feature as turfFeature, polygon as turfPolygon } from '@turf/turf'
import { featuresAt, type DiagramData, type HitCandidate } from '../diagrams/data'
import { makeFrame, MAP_CX, MAP_CY, MAP_R } from '../diagrams/frame'
import { ORDERED_PANELS, type PanelDef } from '../diagrams/panels'
import type { CachedPanel } from '../diagrams/useDiagrams'
import { ADD_USES, addDesc, editsOf, labelEditsFor, newEditId } from '../model/edits'
import { nowIso } from '../model/project'
import type { DiagramSettings, LabelEdit, Project, ProjectEdits } from '../model/types'

type Mode = 'view' | 'hide' | 'add' | 'label'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  def: PanelDef
  panel: CachedPanel
  data: DiagramData
  settings: DiagramSettings
  onClose: () => void
  onSvg: () => void
  onPng: () => void
}

/** 누른 곳 둘레 (도판 단위 px) */
const HIT_PX = 16

export default function PanelEditor({ project, update, def, panel, data, settings, onClose, onSvg, onPng }: Props) {
  const [mode, setMode] = useState<Mode>('view')
  const [hits, setHits] = useState<HitCandidate[] | null>(null)
  const [clickAt, setClickAt] = useState<[number, number] | null>(null)
  const [hover, setHover] = useState<HitCandidate | null>(null)
  const [reason, setReason] = useState('')
  const [selKey, setSelKey] = useState<string | null>(null)
  // 건물 더하기: 찍은 꼭짓점(도판 좌표), 닫았는지, 입력
  const [draft, setDraft] = useState<[number, number][]>([])
  const [closed, setClosed] = useState(false)
  const [addForm, setAddForm] = useState({ floors: '', use: '', name: '', reason: '' })
  const stageRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ key: string; text: string; start: [number, number]; el: SVGGraphicsElement; base: [number, number]; moved: boolean } | null>(null)

  const edits = editsOf(project)
  const labelEdits = labelEditsFor(project, def.id)
  const mapPanel = !panel.out.noFrame && !panel.out.empty && def.id !== 'synth'
  const in3d = !!settings.view3d?.includes(def.id)
  const frame = useMemo(() => {
    // 겹쳐 보기는 아래 도판의 틀
    const borrow = def.frameFrom?.(settings)
    const fd = borrow ? (ORDERED_PANELS.find((p) => p.id === borrow) ?? def) : def
    const R = fd.frameR ? fd.frameR(data) : data.R
    return makeFrame(data.center[0], data.center[1], R, settings.frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, data, settings.frame, settings.overlays])
  // 패널 모드 도판은 viewBox 원점이 0이 아님 (2026-11-21 묶음 D2)
  const vb = panel.svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/)
  const viewX = Number(vb?.[1] ?? 0)
  const viewY = Number(vb?.[2] ?? 0)
  const viewW = Number(vb?.[3] ?? 1000)
  const viewH = Number(vb?.[4] ?? 1300)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const saveEdits = (fn: (e: ProjectEdits) => ProjectEdits) =>
    update((d) => {
      d.edits = fn({ hides: d.edits?.hides ?? [], labels: d.edits?.labels ?? [], adds: d.edits?.adds ?? [] })
    })

  // ── 도판 좌표
  const svgEl = () => stageRef.current?.querySelector('svg') as SVGSVGElement | null
  const toView = (e: { clientX: number; clientY: number }): [number, number] | null => {
    const svg = svgEl()
    const m = svg?.getScreenCTM()
    if (!svg || !m) return null
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const q = pt.matrixTransform(m.inverse())
    return [q.x, q.y]
  }
  const inMap = ([x, y]: [number, number]) => (settings.frame === 'circle' ? Math.hypot(x - MAP_CX, y - MAP_CY) <= MAP_R : Math.abs(x - MAP_CX) <= MAP_R && Math.abs(y - MAP_CY) <= MAP_R)

  // ── 자료 빼기
  const onHideClick = (e: React.MouseEvent) => {
    const p = toView(e)
    if (!p || !inMap(p)) {
      setHits(null)
      setClickAt(null)
      return
    }
    const [lon, lat] = frame.inv(p[0], p[1])
    setClickAt(p)
    setHits(featuresAt(data, lon, lat, HIT_PX / frame.s))
  }
  const hide = (h: HitCandidate) => {
    saveEdits((e) => ({ ...e, hides: [...e.hides, { id: newEditId(), layer: h.layer, lon: h.lon, lat: h.lat, name: h.name, desc: h.desc, reason: reason.trim(), createdAt: nowIso() }] }))
    setHits((cur) => (cur ? cur.filter((x) => x !== h) : cur))
    setHover(null)
  }
  const unhide = (id: string) => saveEdits((e) => ({ ...e, hides: e.hides.filter((h) => h.id !== id) }))

  // ── 건물 더하기
  const onAddClick = (e: React.MouseEvent) => {
    if (closed) return
    const p = toView(e)
    if (!p || !inMap(p)) return
    const first = draft[0]
    // 첫 점 가까이 누르면 닫기
    if (draft.length >= 3 && first && Math.hypot(p[0] - first[0], p[1] - first[1]) < 10) {
      setClosed(true)
      return
    }
    const last = draft[draft.length - 1]
    // 두 번 누르기의 두 번째 등 같은 자리는 건너뜀
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 3) return
    setDraft([...draft, p])
  }
  const draftRing = (): [number, number][] => {
    const r = draft.map(([x, y]) => frame.inv(x, y) as [number, number])
    return r.length ? [...r, r[0]] : r
  }
  const draftArea = closed && draft.length >= 3 ? turfArea(turfPolygon([draftRing()])) : 0
  // 가운데가 대지 안이면 '대지 안 기존 건물'로 보고 분석에서 뺌 (현황 도판에 점선) — 그리는 사람이 알게
  const draftOnSite = closed && draft.length >= 3 ? booleanPointInPolygon(turfCentroid(turfPolygon([draftRing()])), turfFeature(data.boundary)) : false
  const resetDraft = () => {
    setDraft([])
    setClosed(false)
  }
  const addBuilding = () => {
    if (!closed || draft.length < 3) return
    const floors = Number(addForm.floors)
    saveEdits((e) => ({
      ...e,
      adds: [
        ...(e.adds ?? []),
        {
          id: newEditId(),
          ring: draftRing(),
          floors: Number.isFinite(floors) && floors > 0 ? Math.round(floors) : null,
          use: addForm.use,
          name: addForm.name.trim(),
          reason: addForm.reason.trim(),
          source: 'map',
          createdAt: nowIso(),
        },
      ],
    }))
    resetDraft()
    setAddForm({ floors: '', use: '', name: '', reason: '' })
  }
  const unadd = (id: string) => saveEdits((e) => ({ ...e, adds: (e.adds ?? []).filter((a) => a.id !== id) }))

  // ── 표기 옮기기
  const upsertLabel = (key: string, text: string, patch: Partial<LabelEdit>) =>
    saveEdits((e) => {
      const cur = e.labels.find((l) => l.panelId === def.id && l.key === key)
      const next: LabelEdit = { id: cur?.id ?? newEditId(), panelId: def.id, key, text, dx: cur?.dx ?? 0, dy: cur?.dy ?? 0, hidden: cur?.hidden ?? false, createdAt: cur?.createdAt ?? nowIso(), ...patch }
      // 원래 자리·보임으로 돌아오면 기록에서 뺌
      const others = e.labels.filter((l) => !(l.panelId === def.id && l.key === key))
      return { ...e, labels: !next.hidden && Math.abs(next.dx) < 0.5 && Math.abs(next.dy) < 0.5 ? others : [...others, next] }
    })
  const onLabelDown = (e: React.PointerEvent) => {
    const el = (e.target as Element).closest('[data-lk]') as SVGGraphicsElement | null
    const p = toView(e)
    if (!el || !p) {
      setSelKey(null)
      return
    }
    const key = el.getAttribute('data-lk') ?? ''
    const cur = labelEdits.find((l) => l.key === key)
    drag.current = { key, text: el.textContent ?? '', start: p, el, base: [cur?.dx ?? 0, cur?.dy ?? 0], moved: false }
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // 펜·터치 흉내 등에서 잡을 수 없는 포인터는 그냥 둠
    }
    e.preventDefault()
  }
  const onLabelMove = (e: React.PointerEvent) => {
    const dr = drag.current
    const p = dr && toView(e)
    if (!dr || !p) return
    const dx = p[0] - dr.start[0]
    const dy = p[1] - dr.start[1]
    if (Math.hypot(dx, dy) > 2) dr.moved = true
    dr.el.setAttribute('transform', `translate(${dx.toFixed(1)} ${dy.toFixed(1)})`)
  }
  const onLabelUp = (e: React.PointerEvent) => {
    const dr = drag.current
    drag.current = null
    if (!dr) return
    const p = toView(e)
    setSelKey(dr.key)
    if (!dr.moved || !p) {
      dr.el.removeAttribute('transform')
      return
    }
    upsertLabel(dr.key, dr.text, { dx: dr.base[0] + p[0] - dr.start[0], dy: dr.base[1] + p[1] - dr.start[1] })
  }
  const sel = selKey ? labelEdits.find((l) => l.key === selKey) : undefined

  // 고르거나 가리킨 것 표시 (도판 위에 겹친 그림)
  const marks: string[] = []
  if (mode === 'hide' && clickAt) marks.push(`<circle cx="${clickAt[0]}" cy="${clickAt[1]}" r="${HIT_PX}" fill="none" stroke="#d42a1e" stroke-width="2" stroke-dasharray="4 3"/>`)
  if (mode === 'hide' && hover) {
    const [x, y] = frame.pt(hover.lon, hover.lat)
    marks.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="#d42a1e" fill-opacity="0.25" stroke="#d42a1e" stroke-width="3"/>`)
  }
  if (mode === 'add') {
    for (const a of edits.adds) {
      const pts = a.ring.map(([lon, lat]) => frame.pt(lon, lat))
      marks.push(`<path d="M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z" fill="#d42a1e" fill-opacity="0.12" stroke="#d42a1e" stroke-width="2"/>`)
    }
    if (draft.length) {
      const d = `M${draft.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}${closed ? 'Z' : ''}`
      marks.push(`<path d="${d}" fill="${closed ? '#d42a1e' : 'none'}" fill-opacity="0.25" stroke="#d42a1e" stroke-width="2.5" stroke-dasharray="${closed ? '' : '6 4'}"/>`)
      draft.forEach(([x, y], i) => marks.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${i === 0 && !closed ? 7 : 4.5}" fill="#fff" stroke="#d42a1e" stroke-width="2.5"/>`))
    }
  }
  if (mode === 'hide')
    for (const h of edits.hides) {
      const [x, y] = frame.pt(h.lon, h.lat)
      if (inMap([x, y])) marks.push(`<g stroke="#d42a1e" stroke-width="3" stroke-linecap="round"><path d="M${x - 7} ${y - 7}L${x + 7} ${y + 7}M${x + 7} ${y - 7}L${x - 7} ${y + 7}"/></g>`)
    }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className={`diagram-viewer panel-editor${mode !== 'view' ? ' editing' : ''}`} role="dialog" aria-modal="true" aria-label={def.title} onClick={(e) => e.stopPropagation()}>
        <div className="row panel-editor-bar">
          <div className="segmented small" role="radiogroup" aria-label="고치기">
            <button type="button" role="radio" aria-checked={mode === 'view'} className={mode === 'view' ? 'on' : ''} onClick={() => setMode('view')}>
              보기
            </button>
            <button type="button" role="radio" aria-checked={mode === 'hide'} className={mode === 'hide' ? 'on' : ''} disabled={!mapPanel} title={mapPanel ? '' : in3d ? '3D에서는 평면으로 바꾼 뒤 빼세요' : '지도 도판에서만'} onClick={() => setMode('hide')}>
              자료 빼기
            </button>
            <button type="button" role="radio" aria-checked={mode === 'add'} className={mode === 'add' ? 'on' : ''} disabled={!mapPanel} title={mapPanel ? '' : in3d ? '3D에서는 평면으로 바꾼 뒤 그리세요' : '지도 도판에서만'} onClick={() => setMode('add')}>
              건물 더하기
            </button>
            <button type="button" role="radio" aria-checked={mode === 'label'} className={mode === 'label' ? 'on' : ''} onClick={() => setMode('label')}>
              표기 옮기기
            </button>
          </div>
          <span className="spacer" />
          <button type="button" className="btn small" onClick={onSvg}>
            SVG
          </button>
          <button type="button" className="btn small" onClick={onPng}>
            PNG
          </button>
          <button type="button" className="btn small ghost" onClick={onClose}>
            닫기
          </button>
        </div>
        <p className="help small">
          {mode === 'view' && "잘못 표현된 곳이 있으면 '자료 빼기'(정류소·건물 등을 모든 도판·분석에서 뺌), '건물 더하기'(자료에 아직 없는 새 건물을 그려 넣음), '표기 옮기기'(이 도판의 글자를 끌어 옮기거나 숨김)를 고르세요."}
          {mode === 'add' && "지도를 눌러 새 건물의 외곽선 꼭짓점을 차례로 찍고, 첫 점을 다시 누르거나 '다 그림'으로 닫으세요. 층수·용도를 넣고 [더하기]를 누르면 모든 도판·분석·3D 모형에 들어갑니다 (다시 수집해도 유지). 환경 계산(일조·바람 등)은 다시 계산해야 반영됩니다."}
          {mode === 'hide' && '지도에서 잘못된 점이나 건물을 누르면 그 자리의 자료가 오른쪽에 나옵니다. [빼기]를 누르면 모든 도판·분석에서 빠지고 기록에 남습니다 (다시 수집해도 유지). 환경 계산(일조·바람 등)은 다시 계산해야 반영됩니다.'}
          {mode === 'label' && '글자를 끌어 옮기세요. 글자를 누르면 오른쪽에서 숨기거나 원래 자리로 되돌릴 수 있습니다. 이 도판에만 적용됩니다.'}
        </p>
        <div className="panel-editor-body">
          <div
            className={`panel-edit-stage mode-${mode}`}
            onClick={mode === 'hide' ? onHideClick : mode === 'add' ? onAddClick : undefined}
            onPointerDown={mode === 'label' ? onLabelDown : undefined}
            onPointerMove={mode === 'label' ? onLabelMove : undefined}
            onPointerUp={mode === 'label' ? onLabelUp : undefined}
          >
            <div ref={stageRef} className="panel-edit-svg" dangerouslySetInnerHTML={{ __html: panel.svg }} />
            {marks.length > 0 && <svg className="panel-edit-marks" viewBox={`${viewX} ${viewY} ${viewW} ${viewH}`} dangerouslySetInnerHTML={{ __html: marks.join('') }} />}
          </div>
          {mode !== 'view' && (
            <aside className="panel-editor-side">
              {mode === 'hide' && (
                <>
                  <section className="block">
                    <h3>누른 곳의 자료</h3>
                    {!hits && <p className="muted small">지도를 누르세요.</p>}
                    {hits && hits.length === 0 && <p className="muted small">여기에는 뺄 수 있는 점·건물이 없습니다 (도로·지형·계산 그림은 뺄 수 없음).</p>}
                    {hits && hits.length > 0 && (
                      <>
                        <label className="field">
                          <span className="label">이유 (선택)</span>
                          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 터미널 자체 기록, 현장에 없음" />
                        </label>
                        <ul className="edit-hits">
                          {hits.map((h, i) => (
                            <li key={i} onMouseEnter={() => setHover(h)} onMouseLeave={() => setHover(null)}>
                              <span>{h.desc}</span>
                              <button type="button" className="btn small" onClick={() => hide(h)}>
                                빼기
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </section>
                  <section className="block">
                    <h3>뺀 자료 ({edits.hides.length})</h3>
                    {edits.hides.length === 0 && <p className="muted small">아직 없습니다.</p>}
                    <ul className="edit-list">
                      {edits.hides.map((h) => (
                        <li key={h.id}>
                          <span>
                            {h.desc}
                            {h.reason && <span className="muted small"> — {h.reason}</span>}
                            {data.hidden.missing.some((m) => m.id === h.id) && <span className="edit-missing small"> 지금 자료에서 못 찾음</span>}
                          </span>
                          <button type="button" className="link-btn small" onClick={() => unhide(h.id)}>
                            되돌리기
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
              {mode === 'add' && (
                <>
                  <section className="block add-building">
                    <h3>새 건물</h3>
                    {!closed && (
                      <>
                        <p className="muted small">{draft.length === 0 ? '지도에서 외곽선의 첫 꼭짓점을 누르세요.' : `꼭짓점 ${draft.length}개 — 첫 점(큰 원)을 다시 누르거나 '다 그림'으로 닫기`}</p>
                        <div className="row">
                          <button type="button" className="btn small ghost" disabled={!draft.length} onClick={() => setDraft(draft.slice(0, -1))}>
                            점 하나 지우기
                          </button>
                          <button type="button" className="btn small ghost" disabled={!draft.length} onClick={resetDraft}>
                            다시 그리기
                          </button>
                          <button type="button" className="btn small" disabled={draft.length < 3} onClick={() => setClosed(true)}>
                            다 그림
                          </button>
                        </div>
                      </>
                    )}
                    {closed && (
                      <>
                        <p className="small">바닥 넓이 약 {Math.round(draftArea).toLocaleString('ko-KR')}㎡</p>
                        {draftOnSite && <p className="notice small">가운데가 대지 안이라 '대지 안 기존 건물'로 보고 분석에서 뺍니다 (현황 도판에만 점선). 내 설계안은 ⑩ 설계안 칸에서 올리세요.</p>}
                        <div className="add-fields">
                          <label className="field">
                            <span className="label">지상 층수</span>
                            <input type="number" min={1} step={1} value={addForm.floors} onChange={(e) => setAddForm({ ...addForm, floors: e.target.value })} placeholder="예: 5" />
                          </label>
                          <label className="field">
                            <span className="label">용도</span>
                            <select value={addForm.use} onChange={(e) => setAddForm({ ...addForm, use: e.target.value })}>
                              {ADD_USES.map(([k, l]) => (
                                <option key={k} value={k}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="field">
                            <span className="label">이름 (선택)</span>
                            <input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="예: ○○ 오피스텔" />
                          </label>
                          <label className="field">
                            <span className="label">이유 (선택)</span>
                            <input value={addForm.reason} onChange={(e) => setAddForm({ ...addForm, reason: e.target.value })} placeholder="예: 2025년 준공, 자료에 아직 없음" />
                          </label>
                        </div>
                        <div className="row">
                          <button type="button" className="btn small ghost" onClick={() => setClosed(false)}>
                            더 고치기
                          </button>
                          <button type="button" className="btn small ghost" onClick={resetDraft}>
                            지우기
                          </button>
                          <span className="spacer" />
                          <button type="button" className="btn small primary" onClick={addBuilding}>
                            더하기
                          </button>
                        </div>
                      </>
                    )}
                  </section>
                  <section className="block">
                    <h3>더한 건물 ({edits.adds.length})</h3>
                    {edits.adds.length === 0 && <p className="muted small">아직 없습니다. 라이노 파일의 '주변 변경' 레이어도 ⑩ 설계안 칸에서 더할 수 있습니다.</p>}
                    <ul className="edit-list">
                      {edits.adds.map((a) => (
                        <li key={a.id}>
                          <span>
                            {addDesc(a)}
                            {a.reason && <span className="muted small"> — {a.reason}</span>}
                          </span>
                          <button type="button" className="link-btn small" onClick={() => unadd(a.id)}>
                            되돌리기
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
              {mode === 'label' && (
                <>
                  <section className="block">
                    <h3>고른 글자</h3>
                    {!selKey && <p className="muted small">글자를 누르거나 끌어 보세요.</p>}
                    {selKey && (
                      <>
                        <p className="small">
                          <strong>{selKey.replace(/#\d+$/, '')}</strong>
                          {sel && !sel.hidden && <span className="muted"> (옮김)</span>}
                        </p>
                        <div className="row">
                          <button type="button" className="btn small" onClick={() => upsertLabel(selKey, selKey.replace(/#\d+$/, ''), { hidden: true })}>
                            숨기기
                          </button>
                          <button type="button" className="btn small ghost" disabled={!sel} onClick={() => upsertLabel(selKey, selKey.replace(/#\d+$/, ''), { dx: 0, dy: 0, hidden: false })}>
                            원래대로
                          </button>
                        </div>
                      </>
                    )}
                  </section>
                  <section className="block">
                    <h3>이 도판에서 고친 표기 ({labelEdits.length})</h3>
                    {labelEdits.length === 0 && <p className="muted small">아직 없습니다.</p>}
                    <ul className="edit-list">
                      {labelEdits.map((l) => (
                        <li key={l.id}>
                          <span>
                            {l.text || l.key.replace(/#\d+$/, '')} <span className="muted small">{l.hidden ? '숨김' : '옮김'}</span>
                          </span>
                          <button type="button" className="link-btn small" onClick={() => upsertLabel(l.key, l.text, { dx: 0, dy: 0, hidden: false })}>
                            되돌리기
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
