// 14-D 겹쳐 보기 카드의 고르기: 아래 도판 · 위 도판 · 위 도판 진하기 · 면/선만.

import { useEffect, useRef, useState } from 'react'
import { OVERLAY_IDS } from '../diagrams/overlay'
import { ORDERED_PANELS } from '../diagrams/panels'
import { panelLabel } from '../diagrams/render'
import { NOT_MAP_PANELS } from '../diagrams/synth'
import type { DiagramSettings, OverlaySpec } from '../model/types'

interface Props {
  id: string
  settings: DiagramSettings
  setSettings: (patch: Partial<DiagramSettings>) => void
}

const OPTIONS = ORDERED_PANELS.filter((p) => !NOT_MAP_PANELS.has(p.id) && !OVERLAY_IDS.includes(p.id))

/** 자주 쓰는 짝 (둘 다 있으면 바로 고르게) */
const PRESETS: { label: string; base: string; top: string; mode: OverlaySpec['mode'] }[] = [
  { label: '인구밀도 + 건물 용도', base: 'population', top: 'use', mode: 'fill' },
  { label: '용도지역 + 건물 높이', base: 'zoning', top: 'height', mode: 'lines' },
  { label: '지형 + 도로 위계', base: 'terrain', top: 'roads', mode: 'fill' },
  { label: '항공사진 + 건물 용도', base: 'aerial', top: 'use', mode: 'lines' },
  { label: '일조시간 + 상가 업종', base: 'sunWide', top: 'stores', mode: 'fill' },
]

export default function OverlayControls({ id, settings, setSettings }: Props) {
  const slot = OVERLAY_IDS.indexOf(id)
  const cur = settings.overlays?.[slot] ?? null
  const [opacity, setOpacity] = useState(cur?.opacity ?? 0.75)
  const timer = useRef<number | null>(null)
  useEffect(() => setOpacity(cur?.opacity ?? 0.75), [cur?.opacity])
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), [])

  const save = (next: OverlaySpec | null) => {
    const list = [...(settings.overlays ?? [])]
    while (list.length <= slot) list.push(null)
    list[slot] = next
    while (list.length && !list[list.length - 1]) list.pop()
    setSettings({ overlays: list.length ? list : undefined })
  }
  const patch = (p: Partial<OverlaySpec>) => save({ base: cur?.base ?? '', top: cur?.top ?? '', opacity: cur?.opacity ?? 0.75, mode: cur?.mode ?? 'fill', ...p })
  const has = (pid: string) => OPTIONS.some((o) => o.id === pid)

  return (
    <div className="overlay-controls">
      <label className="field">
        <span className="label">아래 도판</span>
        <select value={cur?.base ?? ''} onChange={(e) => patch({ base: e.target.value })}>
          <option value="">고르기…</option>
          {OPTIONS.map((p) => (
            <option key={p.id} value={p.id} disabled={p.id === cur?.top}>
              {panelLabel(p.id)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">위 도판</span>
        <select value={cur?.top ?? ''} onChange={(e) => patch({ top: e.target.value })}>
          <option value="">고르기…</option>
          {OPTIONS.map((p) => (
            <option key={p.id} value={p.id} disabled={p.id === cur?.base}>
              {panelLabel(p.id)}
            </option>
          ))}
        </select>
      </label>
      <div className="row overlay-row">
        <div className="segmented small" role="radiogroup" aria-label="위 도판 표현">
          {(
            [
              ['fill', '면 그대로'],
              ['lines', '선만'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={(cur?.mode ?? 'fill') === v} className={(cur?.mode ?? 'fill') === v ? 'on' : ''} onClick={() => patch({ mode: v })}>
              {l}
            </button>
          ))}
        </div>
        <label className="small overlay-opacity">
          위 진하기 {Math.round(opacity * 100)}%
          <input
            type="range"
            min={0.15}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => {
              const v = Number(e.target.value)
              setOpacity(v)
              if (timer.current) window.clearTimeout(timer.current)
              timer.current = window.setTimeout(() => patch({ opacity: v }), 400)
            }}
          />
        </label>
        {cur && (
          <button type="button" className="link-btn small" onClick={() => save(null)}>
            비우기
          </button>
        )}
      </div>
      {!cur?.base && !cur?.top && (
        <div className="overlay-presets">
          <span className="muted small">자주 쓰는 짝:</span>
          {PRESETS.filter((p) => has(p.base) && has(p.top)).map((p) => (
            <button key={p.label} type="button" className="chip small" onClick={() => save({ base: p.base, top: p.top, mode: p.mode, opacity: 0.75 })}>
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
