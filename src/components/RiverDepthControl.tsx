// ⑩ 3D 모형 하천 깊이 강조 막대 (2026-11-17 사용자 결정: 강조 정도 막대, 렌더링 모델·콘타 모형 같은 값).
// 끄는 동안은 글만 바뀌고, 손을 뗀 뒤 0.5초 지나면 반영(모형을 다시 만듦 — 넓은 범위는 몇 초).

import { useEffect, useState } from 'react'

interface Props {
  /** 0 ~ 1.5 (1 = 처음 어림) */
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}

const fmt1 = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 1 })

export default function RiverDepthControl({ value, onChange, disabled }: Props) {
  const [pct, setPct] = useState(Math.round(value * 100))
  useEffect(() => setPct(Math.round(value * 100)), [value])
  useEffect(() => {
    if (pct === Math.round(value * 100)) return
    const t = window.setTimeout(() => onChange(pct / 100), 500)
    return () => window.clearTimeout(t)
  }, [pct, value, onChange])
  const k = pct / 100
  return (
    <section>
      <h3>하천 깊이</h3>
      <label className="num-field river-depth">
        <span className="label">
          깊이 강조 <strong>{pct}%</strong>
        </span>
        <input type="range" min={0} max={150} step={10} value={pct} disabled={disabled} onChange={(e) => setPct(Number(e.target.value))} aria-label="하천 깊이 강조" />
        {pct !== 100 && (
          <button type="button" className="btn small" disabled={disabled} onClick={() => setPct(100)}>
            처음 값
          </button>
        )}
      </label>
      <p className="muted small">
        {k > 0
          ? `둑에서 물 면까지 — 물 폭 10m 약 ${fmt1(2.1 * k)}m · 30m 약 ${fmt1(3.3 * k)}m · 50m 넘으면 약 ${fmt1(4.5 * k)}m (둔치 자료가 없으면 절반).`
          : '자료 그대로 — 물 면을 가까운 물가 땅 중 가장 낮은 높이에 둠 (수치지도에는 하천 바닥 높이가 없음).'}{' '}
        0% 자료 그대로 · 100% 처음 값 · 150% 더 깊게. 렌더링 모델·콘타 모형에 같이 들어갑니다.
      </p>
    </section>
  )
}
