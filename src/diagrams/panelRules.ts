// 패널 규칙 (2026-11-21 묶음 D2): 프로젝트에 규칙 하나 + 도판 하나만 따로.
// 규칙은 패널 모드에만 쓴다 — 보통 도판(⑥ 기본·⑨ 보드·리포트)은 늘 지금 모습 그대로 (사용자 결정).
// 판 크기는 '지도 지름 mm'로 정하고, 글자(pt)·선(mm)은 그 크기에서 도판 단위로 바꿔 단계 배율을 셈한다.

import type { DiagramSettings, LineStep, PanelRules, PanelRulesEdit, TextStep } from '../model/types'
import { MAP_R } from './frame'
import { typeScale, type TypeScale } from './typeScale'

/** 1pt = 25.4/72 mm */
export const PT_MM = 25.4 / 72

/** 처음 값: 지도 120mm에서 보통 도판과 거의 같은 모습 (글자·선 숫자는 둥글게) */
export const DEFAULT_RULES: PanelRules = {
  mapMM: 120,
  legend: 'below',
  north: true,
  scale: true,
  text: { legend: 6.5, label: 5.5, note: 5, mark: 6 },
  line: { site: 0.4, frame: 0.2, bold: 0.4, line: 0.2, fine: 0.1 },
  font: '',
  dpi: 300,
}

/** 단계마다 보통 도판의 대표 크기 (도판 단위) — 이 크기가 규칙 값이 됨 */
const REF_TEXT: Record<TextStep, number> = { legend: 17, label: 15, note: 13, mark: 16 }
const REF_LINE: Record<LineStep, number> = { site: 3, frame: 1.5, bold: 3, line: 1.5, fine: 0.8 }

export const LINE_STEP_LABEL: Record<LineStep, string> = {
  site: '대지 경계',
  frame: '지도 틀',
  bold: '굵은 선',
  line: '보통 선',
  fine: '가는 선',
}
export const TEXT_STEPS: TextStep[] = ['legend', 'label', 'note', 'mark']
export const LINE_STEPS: LineStep[] = ['site', 'frame', 'bold', 'line', 'fine']

/** 규칙 + 고친 칸 */
export function mergeRules(base: PanelRules, e: PanelRulesEdit | undefined): PanelRules {
  if (!e) return base
  return { ...base, ...e, text: { ...base.text, ...(e.text ?? {}) }, line: { ...base.line, ...(e.line ?? {}) } } as PanelRules
}

/** 이 도판의 규칙 (처음 값 → 프로젝트 규칙 → 도판 하나만) */
export function rulesFor(s: DiagramSettings, id: string): PanelRules {
  return mergeRules(mergeRules(DEFAULT_RULES, s.panelRules), s.panelOver?.[id])
}

/** 그림이 바뀌는 열쇠 (해상도는 그림에 영향 없음) */
export function panelRulesKey(s: DiagramSettings, id: string): string {
  const r = rulesFor(s, id)
  return JSON.stringify([r.mapMM, r.legend, r.north, r.scale, r.text, r.line, r.font])
}

/** 도판 단위 1칸 = 몇 mm */
export function unitMM(r: PanelRules): number {
  return r.mapMM / (2 * MAP_R)
}

export interface RuleScale {
  rules: PanelRules
  /** 도판 단위 1칸 = mm */
  unit: number
  ty: TypeScale
  /** 선 단계 배율 */
  kl: Record<LineStep, number>
}

export function ruleScale(r: PanelRules): RuleScale {
  const u = unitMM(r)
  const kt = Object.fromEntries(TEXT_STEPS.map((s) => [s, (r.text[s] * PT_MM) / (REF_TEXT[s] * u)])) as Record<TextStep, number>
  const kl = Object.fromEntries(LINE_STEPS.map((s) => [s, r.line[s] / (REF_LINE[s] * u)])) as Record<LineStep, number>
  return { rules: r, unit: u, ty: typeScale(kt), kl }
}

/** 지금 굵기로 선 단계 나누기 */
export function lineStepOf(w: number): 'fine' | 'line' | 'bold' {
  return w < 1 ? 'fine' : w < 2.5 ? 'line' : 'bold'
}

const r2 = (x: number) => String(Math.round(x * 100) / 100)

/**
 * 도판 그림의 선 굵기를 단계 배율로 (패널 모드에서만).
 * 글자 둘레 흰 테두리(paint-order="stroke")는 글자 단계에서 이미 바꿨으므로 건드리지 않는다.
 */
export function scaleStrokes(svg: string, kl: Record<LineStep, number>): string {
  return svg.replace(/<[a-zA-Z][^>]*>/g, (tag) => {
    if (!tag.includes('stroke-width="') || tag.includes('paint-order="stroke"')) return tag
    return tag.replace(/stroke-width="([\d.]+)"/, (_m, v: string) => {
      const w = Number(v)
      return `stroke-width="${r2(w * kl[lineStepOf(w)])}"`
    })
  })
}

/** SVG 크기(mm)를 PNG 가로 픽셀로 — mm 크기가 없으면 null */
export function pngWidthForMM(svg: string, dpi: number): number | null {
  const m = svg.match(/<svg[^>]*\swidth="([\d.]+)mm"/)
  return m ? Math.round((Number(m[1]) / 25.4) * dpi) : null
}
