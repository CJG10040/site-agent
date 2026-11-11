// ⑧ 해석·가설 › 종합 다이어그램: 긴장·기회·가설 카드를 지도에 놓고 화살표·영역·포인트·글상자를 그린다.
// 바탕 그림(도판 틀)은 한 번 그려 두고, 기호는 위에 겹친 SVG에서 바로 그린다 (완성 도판과 같은 그리기 함수).

import { useEffect, useMemo, useRef, useState } from 'react'
import { FONT } from '../diagrams/compose'
import { svgBlob, svgToPng } from '../diagrams/export'
import { makeFrame } from '../diagrams/frame'
import { ORDERED_PANELS } from '../diagrams/panels'
import { collectedDate, panelFileName, renderPanel } from '../diagrams/render'
import { CARD_TYPE_LABEL, KIND_LABEL, NOT_MAP_PANELS, SYNTH_DEFAULT, SYNTH_PANEL, synthCtxOf, synthItemsSvg, TONE_ORDER, TONES } from '../diagrams/synth'
import { useDiagrams } from '../diagrams/useDiagrams'
import { fineHalfFor, fineTerrainCached } from '../lib/terrainFine'
import { analyzeTerrain } from '../lib/terrainSite'
import { downloadBlob, nowIso } from '../model/project'
import type { Project, SynthItem, SynthState, SynthTone } from '../model/types'
import type { VWorldConfig } from '../sources/vworld'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  config: VWorldConfig
}

type Tool = 'select' | 'arrow' | 'area' | 'point' | 'note' | 'card'
type LL = [number, number]

const TOOLS: { id: Tool; label: string; help: string }[] = [
  { id: 'select', label: '고르기·옮기기', help: '기호를 눌러 고르고 끌어 옮깁니다. 고른 기호의 꼭짓점(흰 점)을 끌면 모양이 바뀝니다. Delete로 지웁니다.' },
  { id: 'arrow', label: '화살표', help: '지도를 차례로 눌러 꺾은 선을 그리고, 마지막 점에서 두 번 누르거나 Enter로 마칩니다 (흐름·축·시선).' },
  { id: 'area', label: '영역', help: '꼭짓점을 차례로 누르고 두 번 누르거나 Enter로 닫습니다 (구역·덩어리·보존할 곳).' },
  { id: 'point', label: '포인트', help: '지도를 누른 곳에 점·별·번개(긴장 지점)를 놓습니다.' },
  { id: 'note', label: '글상자', help: '누른 곳에 글상자를 놓고 오른쪽에서 글을 씁니다. 지시선은 오른쪽 버튼으로 끝을 찍습니다.' },
  { id: 'card', label: '카드 놓기', help: '오른쪽 카드 목록에서 [놓기]를 누른 뒤 지도에서 놓을 곳을 누릅니다.' },
]

const RADII = [150, 300, 500, 800]
const TERRAIN_BASES = new Set(['terrain'])

const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

export default function SynthEditor({ project, update, config }: Props) {
  const { data, settings, panels } = useDiagrams(project, config.key, ['synth'])
  const synth = useMemo(() => synthCtxOf(project), [project])
  const state = synth.state
  const [tool, setTool] = useState<Tool>('select')
  const [tone, setTone] = useState<SynthTone>('reveal')
  const [mark, setMark] = useState<'dot' | 'star' | 'bolt'>('bolt')
  const [draft, setDraft] = useState<LL[]>([])
  const [hover, setHover] = useState<[number, number] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [placingCard, setPlacingCard] = useState<string | null>(null)
  const [leaderFor, setLeaderFor] = useState<string | null>(null)
  const [dragItems, setDragItems] = useState<SynthItem[] | null>(null)
  const [base, setBase] = useState<{ url: string; H: number } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const labelRef = useRef<HTMLTextAreaElement | null>(null)
  const drag = useRef<{ mode: 'move' | 'vertex'; id: string; idx?: number; start: LL; orig: SynthItem[] } | null>(null)

  const items = dragItems ?? state.items
  const selected = items.find((i) => i.id === selectedId) ?? null
  const R = data ? SYNTH_PANEL.frameR!(data, { synth }) : 0
  const frame = useMemo(() => (data ? makeFrame(data.center[0], data.center[1], R, settings.frame) : null), [data, R, settings.frame])

  const save = (next: SynthItem[], patch: Partial<SynthState> = {}) =>
    update((d) => {
      d.synth = { ...SYNTH_DEFAULT, ...(d.synth ?? {}), ...patch, items: next, updatedAt: nowIso() }
    })
  const patchItem = (id: string, patch: Partial<SynthItem>) => save(state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  const add = (it: Omit<SynthItem, 'id'>) => {
    const item = { ...it, id: newId() }
    save([...state.items, item])
    setSelectedId(item.id)
    return item
  }
  const remove = (id: string) => {
    save(state.items.filter((i) => i.id !== id))
    setSelectedId(null)
  }

  // ── 바탕 그림 (기호 없이)
  const baseKey = `${state.base}|${R}|${settings.frame}|${settings.palette}|${settings.background}|${project.collectedAt ?? ''}`
  useEffect(() => {
    if (!data) return
    let alive = true
    let url = ''
    void (async () => {
      const t = TERRAIN_BASES.has(state.base) ? await analyzeTerrain(data.center, data.boundary, data.R, fineTerrainCached(data.ngii, data.center, fineHalfFor(data.R))).catch(() => null) : null
      const r = await renderPanel(SYNTH_PANEL, data, settings, config.key, collectedDate(project), t, { synth: { ...synth, baseOnly: true } })
      if (!alive) return
      const m = r.svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)
      url = URL.createObjectURL(svgBlob(r.svg))
      setBase({ url, H: m ? Number(m[1]) : 1300 })
    })()
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, baseKey])

  const finishDraft = () => {
    const pts = draft.filter((p, i) => i === 0 || Math.hypot(p[0] - draft[i - 1][0], p[1] - draft[i - 1][1]) > 1e-7)
    if (tool === 'arrow' && pts.length >= 2) add({ kind: 'arrow', pts, tone, label: '' })
    if (tool === 'area' && pts.length >= 3) add({ kind: 'area', pts, tone, label: '' })
    setDraft([])
    setHover(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select')
      if (e.key === 'Enter' && draft.length && !typing) finishDraft()
      if (e.key === 'Escape') {
        setDraft([])
        setPlacingCard(null)
        setLeaderFor(null)
        setSelectedId(null)
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !typing) remove(selectedId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const toSvg = (e: { clientX: number; clientY: number }): [number, number] | null => {
    const svg = svgRef.current
    const m = svg?.getScreenCTM()
    if (!svg || !m) return null
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(m.inverse())
    return [p.x, p.y]
  }

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!frame) return
    const p = toSvg(e)
    if (!p) return
    const ll = frame.inv(p[0], p[1])
    if (leaderFor) {
      const it = state.items.find((i) => i.id === leaderFor)
      if (it) patchItem(it.id, { pts: [it.pts[0], ll] })
      setLeaderFor(null)
      return
    }
    const target = e.target as Element
    if (tool === 'select') {
      const v = target.closest('[data-vertex]')
      if (v && selectedId) {
        drag.current = { mode: 'vertex', id: selectedId, idx: Number(v.getAttribute('data-vertex')), start: ll, orig: state.items }
        svgRef.current?.setPointerCapture(e.pointerId)
        return
      }
      const g = target.closest('[data-id]')
      if (g) {
        const id = g.getAttribute('data-id')!
        setSelectedId(id)
        drag.current = { mode: 'move', id, start: ll, orig: state.items }
        svgRef.current?.setPointerCapture(e.pointerId)
      } else setSelectedId(null)
      return
    }
    if (tool === 'arrow' || tool === 'area') setDraft((d) => [...d, ll])
    else if (tool === 'point') add({ kind: 'point', pts: [ll], tone, mark, label: '' })
    else if (tool === 'note') {
      add({ kind: 'note', pts: [ll], tone, label: '' })
      setTimeout(() => labelRef.current?.focus(), 50)
    } else if (tool === 'card' && placingCard) {
      add({ kind: 'card', pts: [ll], tone: synth.cards[placingCard]?.tone ?? tone, label: '', cardId: placingCard })
      setPlacingCard(null)
      setTool('select')
    }
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toSvg(e)
    if (!p || !frame) return
    const dr = drag.current
    if (dr) {
      const ll = frame.inv(p[0], p[1])
      const dx = ll[0] - dr.start[0]
      const dy = ll[1] - dr.start[1]
      setDragItems(
        dr.orig.map((i) =>
          i.id !== dr.id
            ? i
            : dr.mode === 'move'
              ? { ...i, pts: i.pts.map(([a, b]) => [a + dx, b + dy] as LL) }
              : { ...i, pts: i.pts.map((q, k) => (k === dr.idx ? ([q[0] + dx, q[1] + dy] as LL) : q)) },
        ),
      )
    } else if (draft.length) setHover(p)
  }

  const onUp = () => {
    if (drag.current && dragItems) save(dragItems)
    drag.current = null
    setDragItems(null)
  }

  const cardsList = Object.values(synth.cards)
  const placed = new Set(state.items.filter((i) => i.kind === 'card').map((i) => i.cardId))
  const baseOptions = ORDERED_PANELS.filter((p) => !NOT_MAP_PANELS.has(p.id))
  const final = panels.synth
  const toolHelp = TOOLS.find((t) => t.id === tool)?.help ?? ''

  if (!data || !frame) {
    return <p className="notice">먼저 ④ 공간정보를 수집해야 종합 다이어그램을 그릴 수 있습니다.</p>
  }

  const px = (ll: LL) => frame.pt(ll[0], ll[1])
  const draftPx = [...draft.map(px), ...(hover ? [hover] : [])]

  return (
    <div className="synth">
      <div className="synth-toolbar">
        <div className="segmented small" role="radiogroup" aria-label="도구">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={tool === t.id}
              className={tool === t.id ? 'on' : ''}
              onClick={() => {
                setTool(t.id)
                setDraft([])
                setHover(null)
                if (t.id !== 'card') setPlacingCard(null)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="synth-tones" role="radiogroup" aria-label="색 (방향)">
          {TONE_ORDER.map((t) => {
            // 고르기 도구일 때만 고른 기호의 색을 바꾸고, 그리는 도구에서는 다음에 그릴 색
            const editing = selected && tool === 'select'
            const on = editing ? selected.tone === t : tone === t
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={on}
                className={`tone-chip${on ? ' on' : ''}`}
                style={{ ['--tone' as string]: TONES[t].color }}
                onClick={() => {
                  setTone(t)
                  if (editing) patchItem(selected.id, { tone: t })
                }}
              >
                {TONES[t].label}
              </button>
            )
          })}
        </div>
        {tool === 'point' && (
          <select value={mark} onChange={(e) => setMark(e.target.value as typeof mark)} aria-label="포인트 모양">
            <option value="bolt">번개 (긴장 지점)</option>
            <option value="star">별 (중요한 곳)</option>
            <option value="dot">점</option>
          </select>
        )}
      </div>
      <p className="help">
        {leaderFor ? '지시선 끝을 지도에서 누르세요 (Esc로 취소).' : placingCard ? `${placingCard} 카드를 놓을 곳을 지도에서 누르세요.` : toolHelp}
        {draft.length > 0 && ` — 점 ${draft.length}개 · Enter 또는 두 번 눌러 마치기 · Esc 취소`}
      </p>

      <div className="synth-body">
        <div className="synth-stage">
          {base ? <img src={base.url} alt="종합 다이어그램 바탕" draggable={false} /> : <p className="muted">바탕을 그리는 중…</p>}
          {base && (
            <svg
              ref={svgRef}
              className={`synth-overlay tool-${tool}`}
              viewBox={`0 0 1000 ${base.H}`}
              fontFamily={FONT}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onDoubleClick={() => (tool === 'arrow' || tool === 'area') && finishDraft()}
            >
              <g dangerouslySetInnerHTML={{ __html: synthItemsSvg(items, frame, synth.cards, selectedId, true) }} />
              {draftPx.length > 0 && (
                <polyline
                  points={[...draftPx, ...(tool === 'area' && draftPx.length > 2 ? [draftPx[0]] : [])].map(([x, y]) => `${x},${y}`).join(' ')}
                  fill={tool === 'area' ? TONES[tone].color : 'none'}
                  fillOpacity={0.12}
                  stroke={TONES[tone].color}
                  strokeWidth={4}
                  strokeDasharray="6 5"
                />
              )}
              {draftPx.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={5} fill="#ffffff" stroke={TONES[tone].color} strokeWidth={2} />
              ))}
              {selected &&
                tool === 'select' &&
                selected.pts.map((ll, i) => {
                  const [x, y] = px(ll)
                  return <circle key={i} data-vertex={i} cx={x} cy={y} r={8} fill="#ffffff" stroke="#1d1d1b" strokeWidth={2} className="synth-handle" />
                })}
            </svg>
          )}
        </div>

        <aside className="synth-side">
          {selected ? (
            <section className="block">
              <h3>
                고른 기호: {KIND_LABEL[selected.kind]}
                {selected.cardId ? ` ${selected.cardId}` : ''}
              </h3>
              <label className="field">
                <span className="label">{selected.kind === 'card' ? '글 (비우면 카드 제목)' : '글'}</span>
                <textarea ref={labelRef} rows={3} value={selected.label} onChange={(e) => patchItem(selected.id, { label: e.target.value })} placeholder={selected.kind === 'card' ? synth.cards[selected.cardId ?? '']?.title : '짧게 (예: 금남로 축을 대지까지 끌어들이기)'} />
              </label>
              {selected.kind === 'arrow' && (
                <label className="check-row small">
                  <input type="checkbox" checked={!!selected.both} onChange={(e) => patchItem(selected.id, { both: e.target.checked })} />
                  양쪽 화살표
                </label>
              )}
              {selected.kind === 'point' && (
                <select value={selected.mark ?? 'dot'} onChange={(e) => patchItem(selected.id, { mark: e.target.value as SynthItem['mark'] })} aria-label="포인트 모양">
                  <option value="bolt">번개 (긴장 지점)</option>
                  <option value="star">별 (중요한 곳)</option>
                  <option value="dot">점</option>
                </select>
              )}
              {selected.kind === 'note' && (
                <div className="row">
                  <button type="button" className="btn small" onClick={() => setLeaderFor(selected.id)}>
                    {selected.pts[1] ? '지시선 끝 다시 찍기' : '지시선 끝 찍기'}
                  </button>
                  {selected.pts[1] && (
                    <button type="button" className="link-btn small" onClick={() => patchItem(selected.id, { pts: [selected.pts[0]] })}>
                      지시선 없애기
                    </button>
                  )}
                </div>
              )}
              <div className="row">
                <button type="button" className="btn small ghost" onClick={() => remove(selected.id)}>
                  지우기
                </button>
                <button type="button" className="link-btn small" onClick={() => setSelectedId(null)}>
                  고르기 풀기
                </button>
              </div>
            </section>
          ) : (
            <p className="muted small">기호를 고르면 여기서 글·색·모양을 바꿉니다. 새 기호는 위의 색으로 그려집니다(긴장·기회 카드의 '방향'과 같은 네 가지).</p>
          )}

          <section className="block">
            <h3>카드 ({cardsList.length})</h3>
            {cardsList.length === 0 && <p className="muted small">아직 긴장·기회·가설 카드가 없습니다. '챗봇 왕복'에서 만든 뒤 놓을 수 있고, 카드 없이 기호만 그려도 됩니다.</p>}
            <ul className="synth-cards">
              {cardsList.map((c) => (
                <li key={c.id} className={placingCard === c.id ? 'on' : ''}>
                  <span className="synth-card-dot" style={{ background: TONES[c.tone].color }} />
                  <span className="synth-card-text">
                    <strong>{c.id}</strong> <span className="muted small">{CARD_TYPE_LABEL[c.type]}</span> {c.title}
                  </span>
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => {
                      setTool('card')
                      setPlacingCard(c.id)
                      setSelectedId(null)
                    }}
                  >
                    {placed.has(c.id) ? '한 번 더' : '놓기'}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="block">
            <h3>바탕·범위</h3>
            <label className="field">
              <span className="label">바탕</span>
              <select value={state.base} onChange={(e) => save(state.items, { base: e.target.value })}>
                <option value="plain">회색 건물·도로 (기본)</option>
                {baseOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} (연하게)
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">도판 반경</span>
              <select value={state.radius ?? 0} onChange={(e) => save(state.items, { radius: Number(e.target.value) || null })}>
                <option value={0}>수집 반경 ({data.R}m)</option>
                {RADII.filter((r) => r < data.R).map((r) => (
                  <option key={r} value={r}>
                    {r}m (대지 가까이)
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="block">
            <h3>내보내기</h3>
            <p className="muted small">완성 도판은 ⑨ 리포트·보드의 마지막 도판으로 자동으로 들어갑니다 (⑥ 도판의 '리포트에 넣기'로 뺄 수 있음).</p>
            <div className="row">
              <button type="button" className="btn small" disabled={!final || !!final.out.empty} onClick={() => final && downloadBlob(panelFileName(project, SYNTH_PANEL, 'svg'), svgBlob(final.svg))}>
                SVG
              </button>
              <button
                type="button"
                className="btn small"
                disabled={!final || !!final.out.empty}
                onClick={() =>
                  final &&
                  void svgToPng(final.svg, settings.pngWidth, settings.background === 'white' ? '#ffffff' : null)
                    .then((b) => downloadBlob(panelFileName(project, SYNTH_PANEL, 'png'), b))
                    .catch((e) => setMsg(String(e)))
                }
              >
                PNG
              </button>
              {state.items.length > 0 && (
                <button
                  type="button"
                  className="link-btn small"
                  onClick={() => {
                    if (window.confirm(`기호 ${state.items.length}개를 모두 지울까요?`)) {
                      save([])
                      setSelectedId(null)
                    }
                  }}
                >
                  모두 지우기
                </button>
              )}
            </div>
            {msg && <p className="notice error">{msg}</p>}
          </section>
        </aside>
      </div>
    </div>
  )
}
