// 설계안 비교 도판에 넣을 안 고르기 (2026-11-21 묶음 C9): 현황·A안·B안 … 중 2~3개.
// 다른 설정처럼 초안으로 모았다가 '도판 생성'에서 다시 그림.

import { compareIds } from '../diagrams/panelsCompare'
import type { DiagramSettings, Project } from '../model/types'

interface Props {
  project: Project
  settings: DiagramSettings
  setSettings: (patch: Partial<DiagramSettings>) => void
}

export default function CompareControls({ project, settings, setSettings }: Props) {
  const designs = project.designs ?? []
  const cur = compareIds(
    designs.map((d) => d.id),
    settings.compare,
  )
  const opts: [string, string][] = [['', '현황'], ...designs.map((d) => [d.id, d.name] as [string, string])]
  const toggle = (id: string) => {
    const on = cur.includes(id)
    if (on && cur.length <= 2) return
    if (!on && cur.length >= 3) return
    const next = on ? cur.filter((x) => x !== id) : opts.map(([k]) => k).filter((k) => k === id || cur.includes(k))
    setSettings({ compare: next })
  }
  return (
    <div className="compare-controls">
      <span className="label small">비교할 안 (2~3개)</span>
      <div className="row">
        {opts.map(([id, label]) => {
          const on = cur.includes(id)
          const blocked = (on && cur.length <= 2) || (!on && cur.length >= 3)
          return (
            <button key={id || 'now'} type="button" className={`chip small${on ? ' on' : ''}`} aria-pressed={on} disabled={blocked} title={blocked ? (on ? '두 개는 있어야 합니다' : '세 개까지') : ''} onClick={() => toggle(id)}>
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
