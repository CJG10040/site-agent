// 끌어 옮기고 휠로 키우는 SVG 보기 (과거와 현재 — 세 점 맞추기, 2026-11-22).
// 끌지 않고 누르면 그 자리의 그림 좌표를 onPick으로.

import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  /** 그림 좌표 범위 */
  box: [number, number, number, number]
  children: ReactNode
  /** 찍은 점 (그림 좌표) */
  points: { x: number; y: number; label: string; color: string }[]
  onPick?: (x: number, y: number) => void
  label: string
}

export default function PanZoom({ box, children, points, onPick, label }: Props) {
  const ref = useRef<SVGSVGElement>(null)
  const [vb, setVb] = useState(box)
  const drag = useRef<{ x: number; y: number; vb: [number, number, number, number]; moved: boolean } | null>(null)
  useEffect(() => setVb(box), [box])

  const toSvg = (cx: number, cy: number): [number, number] | null => {
    const el = ref.current
    const m = el?.getScreenCTM()
    if (!el || !m) return null
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse())
    return [p.x, p.y]
  }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = toSvg(e.clientX, e.clientY)
      if (!p) return
      const k = e.deltaY > 0 ? 1.2 : 1 / 1.2
      setVb(([x, y, w, h]) => {
        const nw = Math.min(box[2] * 3, Math.max(box[2] / 200, w * k))
        const kk = nw / w
        return [p[0] - (p[0] - x) * kk, p[1] - (p[1] - y) * kk, nw, h * kk]
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const r = vb[2] / 70
  return (
    <div className="panzoom">
      <svg
        ref={ref}
        viewBox={vb.join(' ')}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={label}
        onPointerDown={(e) => {
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, vb, moved: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d || !ref.current) return
          const dx = e.clientX - d.x
          const dy = e.clientY - d.y
          if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
          if (!d.moved) return
          const scale = d.vb[2] / ref.current.clientWidth
          const scaleY = d.vb[3] / ref.current.clientHeight
          const k = Math.max(scale, scaleY)
          setVb([d.vb[0] - dx * k, d.vb[1] - dy * k, d.vb[2], d.vb[3]])
        }}
        onPointerUp={(e) => {
          const d = drag.current
          drag.current = null
          if (d && !d.moved && onPick) {
            const p = toSvg(e.clientX, e.clientY)
            if (p) onPick(p[0], p[1])
          }
        }}
      >
        {children}
        {points.map((p) => (
          <g key={p.label} pointerEvents="none">
            <circle cx={p.x} cy={p.y} r={r} fill="none" stroke="#ffffff" strokeWidth={r / 2.2} />
            <circle cx={p.x} cy={p.y} r={r} fill="none" stroke={p.color} strokeWidth={r / 4} />
            <text x={p.x + r * 1.4} y={p.y - r * 1.2} fontSize={r * 2.2} fontWeight={700} fill={p.color} stroke="#ffffff" strokeWidth={r / 3} paintOrder="stroke">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="panzoom-tools">
        <button type="button" className="btn small ghost" onClick={() => setVb(box)}>
          전체 보기
        </button>
        <span className="muted small">휠 = 확대 · 끌기 = 옮기기 · 누르기 = 점 찍기</span>
      </div>
    </div>
  )
}
