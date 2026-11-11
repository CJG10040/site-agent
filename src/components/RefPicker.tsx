// 카드·도판 고르기 (교수 피드백의 '관련 카드·도판', 종합 다이어그램 기호의 '근거'가 함께 씀)

import { ORDERED_PANELS, panelNumber } from '../diagrams/panels'
import { cardTitle, TYPE_LABEL } from '../model/prompts'
import type { CardType, Project } from '../model/types'

/** 카드 고르기 목록의 묶음 차례 (사실·관찰이 먼저 — 근거로 많이 고름) */
const TYPE_ORDER: CardType[] = ['FACT', 'OBSERVATION', 'UNKNOWN', 'INTERPRETATION', 'TENSION', 'OPPORTUNITY', 'QUESTION', 'HYPOTHESIS']

interface Props {
  project: Project
  cardIds: string[]
  panelIds: string[]
  onChange: (cardIds: string[], panelIds: string[]) => void
  cardPlaceholder?: string
  panelPlaceholder?: string
  /** 고를 수 없는 도판 (예: 종합 다이어그램 자신) */
  excludePanels?: string[]
}

export default function RefPicker({ project, cardIds, panelIds, onChange, cardPlaceholder = '+ 관련 카드', panelPlaceholder = '+ 관련 도판', excludePanels = [] }: Props) {
  const cards = project.cards.filter((c) => c.status !== 'rejected')
  const groups = TYPE_ORDER.map((t) => ({ t, list: cards.filter((c) => c.type === t) })).filter((g) => g.list.length)
  return (
    <div className="fb-refs">
      <select value="" onChange={(e) => e.target.value && !cardIds.includes(e.target.value) && onChange([...cardIds, e.target.value], panelIds)} aria-label={cardPlaceholder}>
        <option value="">{cardPlaceholder}</option>
        {groups.map((g) => (
          <optgroup key={g.t} label={`${TYPE_LABEL[g.t]} (${g.list.length})`}>
            {g.list.map((c) => (
              <option key={c.id} value={c.id} disabled={cardIds.includes(c.id)}>
                {c.id} · {cardTitle(c).slice(0, 40)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <select value="" onChange={(e) => e.target.value && !panelIds.includes(e.target.value) && onChange(cardIds, [...panelIds, e.target.value])} aria-label={panelPlaceholder}>
        <option value="">{panelPlaceholder}</option>
        {ORDERED_PANELS.filter((p) => !excludePanels.includes(p.id)).map((p) => (
          <option key={p.id} value={p.id} disabled={panelIds.includes(p.id)}>
            {String(panelNumber(p.id)).padStart(2, '0')} {p.title}
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
