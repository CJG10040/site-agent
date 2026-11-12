// 14-F 분해 다이어그램 카드: 층 목록(위 → 아래로 보여 줌) · 순서 바꾸기 · 빼기 · 더하기 · 보는 방향 · 기본 구성으로.

import { EXPLODED_DEFAULT, explodedAz, explodedLayers, SITE_LAYER } from '../diagrams/exploded'
import { OVERLAY_IDS } from '../diagrams/overlay'
import { ORDERED_PANELS } from '../diagrams/panels'
import { panelLabel } from '../diagrams/render'
import { NOT_MAP_PANELS } from '../diagrams/synth'
import type { DiagramSettings } from '../model/types'

interface Props {
  settings: DiagramSettings
  setSettings: (patch: Partial<DiagramSettings>) => void
}

const OPTIONS = ORDERED_PANELS.filter((p) => !NOT_MAP_PANELS.has(p.id) && !OVERLAY_IDS.includes(p.id))
const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
const nameOf = (id: string) => (id === SITE_LAYER ? '대지' : panelLabel(id))

export default function ExplodedControls({ settings, setSettings }: Props) {
  const layers = explodedLayers(settings)
  const az = explodedAz(settings)
  const save = (next: string[], nextAz = az) => {
    const same = next.length === EXPLODED_DEFAULT.length && next.every((x, i) => x === EXPLODED_DEFAULT[i])
    setSettings({ exploded: same && nextAz === 225 ? undefined : { layers: next, az: nextAz } })
  }
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= layers.length) return
    const next = [...layers]
    ;[next[i], next[j]] = [next[j], next[i]]
    save(next)
  }
  // 위 층이 위에 오도록 거꾸로 보여 줌
  const shown = layers.map((id, i) => ({ id, i })).reverse()
  const addable = [...(layers.includes(SITE_LAYER) ? [] : [{ id: SITE_LAYER }]), ...OPTIONS.filter((p) => !layers.includes(p.id))]

  return (
    <div className="exploded-controls">
      <span className="label">층 (위 → 아래)</span>
      <ol className="exploded-list">
        {shown.map(({ id, i }) => (
          <li key={id}>
            <span className="exploded-name">{nameOf(id)}</span>
            <button type="button" className="btn small ghost" aria-label={`${nameOf(id)} 위로`} disabled={i === layers.length - 1} onClick={() => move(i, 1)}>
              ↑
            </button>
            <button type="button" className="btn small ghost" aria-label={`${nameOf(id)} 아래로`} disabled={i === 0} onClick={() => move(i, -1)}>
              ↓
            </button>
            <button type="button" className="link-btn small" disabled={layers.length <= 1} onClick={() => save(layers.filter((x) => x !== id))}>
              빼기
            </button>
          </li>
        ))}
      </ol>
      <div className="row exploded-row">
        <select
          value=""
          aria-label="층 더하기"
          onChange={(e) => {
            if (e.target.value) save([...layers, e.target.value])
          }}
        >
          <option value="">층 더하기 (맨 위에)…</option>
          {addable.map((p) => (
            <option key={p.id} value={p.id}>
              {nameOf(p.id)}
            </option>
          ))}
        </select>
        <label className="small">
          보는 방향{' '}
          <select value={az} onChange={(e) => save(layers, Number(e.target.value))}>
            {DIRS.map((d, k) => (
              <option key={d} value={k * 45}>
                {d}쪽에서
              </option>
            ))}
          </select>
        </label>
        {settings.exploded && (
          <button type="button" className="link-btn small" onClick={() => setSettings({ exploded: undefined })}>
            기본 구성으로
          </button>
        )}
      </div>
    </div>
  )
}
