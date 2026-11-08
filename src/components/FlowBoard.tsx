import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { lineage } from '../model/cards'
import { cardTitle, isRelation, REACTION_LABEL } from '../model/prompts'
import type { Card, Project } from '../model/types'
import { typeClass, typeName } from './CardDetail'

interface Props {
  project: Project
  selectedId: string | null
  onSelect: (id: string | null) => void
}

interface Column {
  id: string
  label: string
  match: (c: Card) => boolean
}

// 요청서 5장의 사고 흐름: 사실·관찰 → 관계 → 긴장·기회 → 해석 → 설계 질문 → 설계 가설
const COLUMNS: Column[] = [
  { id: 'base', label: '사실·관찰·미확인', match: (c) => (c.type === 'FACT' && c.status === 'confirmed') || c.type === 'OBSERVATION' || c.type === 'UNKNOWN' },
  { id: 'rel', label: '관계', match: (c) => isRelation(c) },
  { id: 'tension', label: '긴장·기회', match: (c) => c.type === 'TENSION' || c.type === 'OPPORTUNITY' },
  { id: 'interp', label: '해석', match: (c) => c.type === 'INTERPRETATION' && !isRelation(c) },
  { id: 'question', label: '설계 질문', match: (c) => c.type === 'QUESTION' },
  { id: 'hyp', label: '설계 가설', match: (c) => c.type === 'HYPOTHESIS' },
]

interface Edge {
  from: string
  to: string
}

interface Line {
  key: string
  d: string
  active: boolean
}

export default function FlowBoard({ project, selectedId, onSelect }: Props) {
  const [onlyUsed, setOnlyUsed] = useState(true)
  const [showRejected, setShowRejected] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef(new Map<string, HTMLElement>())
  const [lines, setLines] = useState<Line[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })

  const visible = useMemo(() => {
    const live = project.cards.filter((c) => (showRejected || c.status !== 'rejected') && !(c.type === 'OBSERVATION' && !c.text.trim()))
    const used = new Set(live.flatMap((c) => c.related_card_ids))
    return live.filter((c) => {
      if (!COLUMNS.some((col) => col.match(c))) return false
      // 사실·관찰 열은 근거로 쓰인 것만 (선택 시)
      if (onlyUsed && COLUMNS[0].match(c) && c.origin !== 'chatbot') return used.has(c.id)
      return true
    })
  }, [project.cards, onlyUsed, showRejected])

  const visibleIds = useMemo(() => new Set(visible.map((c) => c.id)), [visible])
  const edges: Edge[] = useMemo(
    () => visible.flatMap((c) => c.related_card_ids.filter((r) => visibleIds.has(r)).map((r) => ({ from: r, to: c.id }))),
    [visible, visibleIds],
  )
  const highlight = useMemo(() => (selectedId ? lineage(project, selectedId) : null), [project, selectedId])
  const colOf = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of visible) m.set(c.id, COLUMNS.findIndex((col) => col.match(c)))
    return m
  }, [visible])

  const measure = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const base = wrap.getBoundingClientRect()
    const pos = (id: string) => {
      const el = cardRefs.current.get(id)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { l: r.left - base.left + wrap.scrollLeft, r: r.right - base.left + wrap.scrollLeft, y: r.top - base.top + wrap.scrollTop + Math.min(r.height / 2, 28) }
    }
    const out: Line[] = []
    for (const e of edges) {
      const a = pos(e.from)
      const b = pos(e.to)
      if (!a || !b) continue
      const forward = (colOf.get(e.from) ?? 0) <= (colOf.get(e.to) ?? 0)
      const x1 = forward ? a.r : a.l
      const x2 = forward ? b.l : b.r
      const dx = Math.max(40, Math.abs(x2 - x1) / 2) * (forward ? 1 : -1)
      out.push({
        key: `${e.from}>${e.to}`,
        d: `M ${x1} ${a.y} C ${x1 + dx} ${a.y}, ${x2 - dx} ${b.y}, ${x2} ${b.y}`,
        active: !!highlight && highlight.has(e.from) && highlight.has(e.to),
      })
    }
    setLines(out)
    setSize({ w: wrap.scrollWidth, h: wrap.scrollHeight })
  }, [edges, colOf, highlight])

  useLayoutEffect(() => {
    measure()
  }, [measure, visible])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(wrap)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  const aiCount = project.cards.filter((c) => c.origin === 'chatbot').length

  return (
    <div className="flow">
      <div className="flow-tools">
        <label className="check-row">
          <input type="checkbox" checked={onlyUsed} onChange={(e) => setOnlyUsed(e.target.checked)} />
          사실·관찰은 근거로 쓰인 것만
        </label>
        <label className="check-row">
          <input type="checkbox" checked={showRejected} onChange={(e) => setShowRejected(e.target.checked)} />
          '중요하지 않음'으로 뺀 카드도 보기
        </label>
        {selectedId && (
          <button type="button" className="btn ghost small" onClick={() => onSelect(null)}>
            강조 해제
          </button>
        )}
      </div>
      {aiCount === 0 && <p className="notice">아직 챗봇 답변으로 만든 카드가 없습니다. [챗봇 왕복] 탭에서 ① 단계부터 시작하세요.</p>}
      <div className="flow-wrap" ref={wrapRef} onClick={(e) => e.target === e.currentTarget && onSelect(null)}>
        <svg className="flow-lines" width={size.w} height={size.h} aria-hidden="true">
          {lines.map((l) => (
            <path key={l.key} d={l.d} className={l.active ? 'active' : highlight ? 'dim' : ''} />
          ))}
        </svg>
        <div className="flow-cols">
          {COLUMNS.map((col) => {
            const cards = visible.filter((c) => col.match(c))
            return (
              <section key={col.id} className="flow-col">
                <h3>
                  {col.label} <span className="count">{cards.length}</span>
                </h3>
                {cards.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    ref={(el) => {
                      if (el) cardRefs.current.set(c.id, el)
                      else cardRefs.current.delete(c.id)
                    }}
                    className={`flow-card ${typeClass(c)}${selectedId === c.id ? ' selected' : ''}${highlight && !highlight.has(c.id) ? ' dim' : ''}${c.status === 'rejected' ? ' rejected' : ''}`}
                    onClick={() => onSelect(c.id)}
                  >
                    <span className="flow-card-head">
                      <span className="card-id">{c.id}</span>
                      <span className="flow-type">{typeName(c)}</span>
                      {c.fields?.['관점'] && <span className="flow-type">· {c.fields['관점']}</span>}
                      {c.human_validation_required && <span className="flow-warn" title="확인 필요">!</span>}
                    </span>
                    <span className="flow-card-text">{cardTitle(c)}</span>
                    {c.reaction && <span className={`flow-react react-${c.reaction}`}>{REACTION_LABEL[c.reaction]}</span>}
                  </button>
                ))}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
