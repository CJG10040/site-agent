// 거리 슬라이더 (2026-11-18 사용자 요청: 주변 조사 반경·3D 모형 범위를 숫자 입력 대신 슬라이더로 — 인터뷰: 슬라이더 + 자주 쓰는 눈금).
// 250m~3km처럼 범위가 넓어 비례(로그) 간격: 250m·500m·1km·2km가 고르게 놓여 작은 값도 세밀하게 고름.
// 끄는 동안은 값만 바뀌고, 손을 떼거나(키보드는 잠시 멈추면) 한 번만 반영 — 3D 모형은 반영할 때 다시 만들기 때문.

import { useEffect, useRef, useState } from 'react'

interface Props {
  label: string
  value: number
  min: number
  max: number
  /** 값 간격 (m) */
  step: number
  /** 눈금 (범위 밖은 빠짐) */
  ticks: number[]
  format: (v: number) => string
  /** 값 옆 보조 글 (예: 가로·세로 1km) */
  sub?: (v: number) => string
  onCommit: (v: number) => void
  disabled?: boolean
}

const N = 1000

export const fmtDist = (m: number) => (m >= 1000 ? `${Math.round(m / 10) / 100}km` : `${Math.round(m)}m`)

export default function RangeSlider({ label, value, min, max, step, ticks, format, sub, onCommit, disabled }: Props) {
  const fixed = max <= min
  const lr = Math.log(max / min)
  const posOf = (v: number) => (fixed ? 0 : Math.round((Math.log(Math.max(min, Math.min(max, v)) / min) / lr) * N))
  const valOf = (p: number) => {
    if (fixed) return min
    const v = min * Math.exp((p / N) * lr)
    // 끝은 정확히 min·max, 그 사이는 step 단위
    if (p <= 0) return min
    if (p >= N) return max
    return Math.max(min, Math.min(max, Math.round(v / step) * step))
  }
  const [v, setVState] = useState(value)
  // 손을 뗄 때 쓸 최신 값 (렌더 사이에 이벤트가 와도 맞게)
  const cur = useRef(value)
  const setV = (x: number) => {
    cur.current = x
    setVState(x)
  }
  const dragging = useRef(false)
  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (!dragging.current) {
      cur.current = value
      setVState(value)
    }
  }, [value])
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    [],
  )
  const commit = (x: number) => {
    dragging.current = false
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    if (x !== value) onCommit(x)
  }
  const later = (x: number) => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => commit(x), 600)
  }
  const shown = ticks.filter((t) => t > min * 1.04 && t < max * 0.96)
  const marks = fixed ? [min] : [min, ...shown, max]

  return (
    <div className={`range-slider${disabled ? ' disabled' : ''}`}>
      <div className="range-slider-head">
        <span className="label">{label}</span>
        <strong className="range-slider-value">{format(v)}</strong>
        {sub && <span className="muted small">{sub(v)}</span>}
      </div>
      <input
        type="range"
        min={0}
        max={N}
        step={1}
        value={posOf(v)}
        disabled={disabled || fixed}
        aria-label={label}
        aria-valuetext={format(v)}
        onChange={(e) => {
          dragging.current = true
          setV(valOf(Number(e.target.value)))
        }}
        onPointerUp={() => commit(cur.current)}
        onTouchEnd={() => commit(cur.current)}
        onBlur={() => dragging.current && commit(cur.current)}
        onKeyDown={(e) => {
          // 화살표는 간격 하나씩 (비례 눈금이라 기본 이동은 너무 작음), Page는 다섯씩
          const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 5, PageDown: -5 }[e.key]
          if (d === undefined) return
          e.preventDefault()
          const x = Math.max(min, Math.min(max, Math.round((cur.current + d * step) / step) * step))
          dragging.current = true
          setV(x)
          later(x)
        }}
      />
      <div className="range-slider-ticks" aria-hidden="true">
        {marks.map((t, i) => (
          <button
            key={`${t}-${i}`}
            type="button"
            tabIndex={-1}
            disabled={disabled || fixed}
            className={`range-tick${i === 0 ? ' first' : i === marks.length - 1 ? ' last' : ''}${t === v ? ' on' : ''}`}
            style={{ left: `${(posOf(t) / N) * 100}%` }}
            onClick={() => {
              setV(t)
              commit(t)
            }}
          >
            {fmtDist(t)}
          </button>
        ))}
      </div>
    </div>
  )
}
