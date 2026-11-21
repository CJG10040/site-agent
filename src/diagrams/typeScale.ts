// 도판 글자 단계 (2026-11-21 묶음 D1): 도판 안 글자 크기를 쓰임새 단계로 묶는다.
// 보통 도판은 모든 배율이 1이라 지금 모습 그대로이고, 패널 모드(묶음 D2)는 규칙(pt)에서 단계마다 배율을 셈한다.
// 글자 둘레 흰 테두리·줄 간격·글자 기준 띄움도 같은 배율로 늘고 준다 (선 굵기는 따로: lineScale).

import type { TextStep } from '../model/types'

export type { TextStep }

/** 단계 이름 (규칙 화면) */
export const TEXT_STEP_LABEL: Record<TextStep, string> = {
  legend: '범례',
  label: '지도 위 이름',
  note: '작은 글자 (숫자·주석)',
  mark: '방위표·축척',
}

export interface TypeScale {
  /** 단계 배율 (보통 도판은 1) */
  k: (step: TextStep) => number
  /** 지금 숫자 n에 단계 배율을 곱한 값을 SVG 글로 — 배율 1이면 n 그대로 (글자 크기·글자 테두리 굵기) */
  v: (step: TextStep, n: number) => string
}

function trim(x: number): string {
  return String(Math.round(x * 100) / 100)
}

export function typeScale(k: Partial<Record<TextStep, number>> = {}): TypeScale {
  const kOf = (s: TextStep) => k[s] ?? 1
  return {
    k: kOf,
    v: (s, n) => {
      const f = kOf(s)
      return f === 1 ? String(n) : trim(n * f)
    },
  }
}

/** 보통 도판: 모든 단계 배율 1 */
export const UNIT_TYPE: TypeScale = typeScale()
