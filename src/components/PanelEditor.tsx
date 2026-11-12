// ⑥ 도판 크게 보기 + 고치기 (2026-11-12 사용자 요청: 한번씩 잘못 표현되는 부분을 직접 고치기).
// 자료 빼기: 지도 도판에서 누른 곳의 점(정류소·역·상가·생활 시설)·도형(건물·공원·시설)을 골라 모든 도판·분석에서 뺀다.
// 표기 옮기기: 도판의 글자를 끌어 옮기거나 숨긴다 (그 도판에만).
// 고친 것은 프로젝트에 기록하고, 다시 수집해도 위치·이름·글 내용으로 다시 찾아 적용한다.

import { useEffect, useMemo, useRef, useState } from 'react'
import { featuresAt, type DiagramData, type HitCandidate } from '../diagrams/data'
import { makeFrame, MAP_CX, MAP_CY, MAP_R } from '../diagrams/frame'
import { ORDERED_PANELS, type PanelDef } from '../diagrams/panels'
import type { CachedPanel } from '../diagrams/useDiagrams'
import { editsOf, labelEditsFor, newEditId } from '../model/edits'
import { nowIso } from '../model/project'
import type { DiagramSettings, LabelEdit, Project, ProjectEdits } from '../model/types'

type Mode = 'view' | 'hide' | 'label'

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
  const viewH = Number(panel.svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)?.[1] ?? 1300)
  const viewW = Number(panel.svg.match(/viewBox="0 0 ([\d.]+) /)?.[1] ?? 1000)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const saveEdits = (fn: (e: ProjectEdits) => ProjectEdits) =>
    update((d) => {
      d.edits = fn({ hides: d.edits?.hides ?? [], labels: d.edits?.labels ?? [] })
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
  if (mode === 'hide' && clickAt) marks.push(`<circle cx="${clickAt[0]}" cy="${clickAt[1]}" r="${HIT_PX}" fill="none" stroke="#c62828" stroke-width="2" stroke-dasharray="4 3"/>`)
  if (mode === 'hide' && hover) {
    const [x, y] = frame.pt(hover.lon, hover.lat)
    marks.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="#c62828" fill-opacity="0.25" stroke="#c62828" stroke-width="3"/>`)
  }
  if (mode === 'hide')
    for (const h of edits.hides) {
      const [x, y] = frame.pt(h.lon, h.lat)
      if (inMap([x, y])) marks.push(`<g stroke="#c62828" stroke-width="3" stroke-linecap="round"><path d="M${x - 7} ${y - 7}L${x + 7} ${y + 7}M${x + 7} ${y - 7}L${x - 7} ${y + 7}"/></g>`)
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
          {mode === 'view' && "잘못 표현된 곳이 있으면 '자료 빼기'(정류소·건물 등을 모든 도판·분석에서 뺌)나 '표기 옮기기'(이 도판의 글자를 끌어 옮기거나 숨김)를 고르세요."}
          {mode === 'hide' && '지도에서 잘못된 점이나 건물을 누르면 그 자리의 자료가 오른쪽에 나옵니다. [빼기]를 누르면 모든 도판·분석에서 빠지고 기록에 남습니다 (다시 수집해도 유지). 환경 계산(일조·바람 등)은 다시 계산해야 반영됩니다.'}
          {mode === 'label' && '글자를 끌어 옮기세요. 글자를 누르면 오른쪽에서 숨기거나 원래 자리로 되돌릴 수 있습니다. 이 도판에만 적용됩니다.'}
        </p>
        <div className="panel-editor-body">
          <div
            className={`panel-edit-stage mode-${mode}`}
            onClick={mode === 'hide' ? onHideClick : undefined}
            onPointerDown={mode === 'label' ? onLabelDown : undefined}
            onPointerMove={mode === 'label' ? onLabelMove : undefined}
            onPointerUp={mode === 'label' ? onLabelUp : undefined}
          >
            <div ref={stageRef} className="panel-edit-svg" dangerouslySetInnerHTML={{ __html: panel.svg }} />
            {marks.length > 0 && <svg className="panel-edit-marks" viewBox={`0 0 ${viewW} ${viewH}`} dangerouslySetInnerHTML={{ __html: marks.join('') }} />}
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
