// 계획 값과 가정 (2026-11-21 묶음 F1): 학생이 넣은 값이 없으면 앱이 합리적인 값을 가정하고 '가정: …'으로 밝힌다.
// ⑪ 검토서 · 건축 가능 영역 · 도판 8 · ⑩ 모형이 같은 가정을 쓰도록 한곳에.
// 사용자 결정(2026-11-21): 모르는 값은 가정하고 판정 + 가정 표시(눌러서 고침).

import type { ZoneRule } from '../diagrams/panelsLaw'
import { zoneKey, type RegionTable } from './ordinances'
import { USE_CLASSES, type UsePick } from './uses'

export interface PlanValue {
  v: number
  /** 넣지 않아 앱이 가정한 까닭 (넣은 값이면 없음) */
  assumed?: string
}

/** 학생이 넣은 계획 값 (LawState의 일부) */
export interface PlanInput {
  use?: UsePick | null
  gfa?: number
  floors?: number
  basement?: number
  units?: number
}

export interface ZoneLimit {
  zone: string
  share: number
  pct: number
  /** 조례 값이면 조문, 법 상한이면 없음 */
  article?: string
  fromOrdinance: boolean
}

export interface Plan {
  use: UsePick | null
  useName: string
  gfa: PlanValue | null
  floors: PlanValue | null
  basement: PlanValue
  /** 공동주택·다가구·오피스텔 세대수 */
  units: PlanValue | null
  bcr: { pct: number; zones: ZoneLimit[] } | null
  far: { pct: number; zones: ZoneLimit[] } | null
}

type Zone = { name: string; share: number; rule: ZoneRule | null }

/** 용도지역마다 조례 값(없으면 법 상한) → 면적 비율로 나눈 평균 */
export function limitOf(kind: 'bcr' | 'far', zones: Zone[], region: RegionTable | null): { pct: number; zones: ZoneLimit[] } | null {
  const rows: ZoneLimit[] = []
  for (const z of zones) {
    const label = z.rule?.label ?? z.name
    const ord = region?.urban?.[kind]?.[zoneKey(label)]
    const law = z.rule ? (kind === 'bcr' ? z.rule.bcr : z.rule.farMax) : undefined
    if (ord) rows.push({ zone: label, share: z.share, pct: ord.pct, article: ord.article, fromOrdinance: true })
    else if (law !== undefined) rows.push({ zone: label, share: z.share, pct: law, fromOrdinance: false })
  }
  if (!rows.length) return null
  const total = rows.reduce((s, r) => s + r.share, 0) || 1
  return { pct: rows.reduce((s, r) => s + r.pct * r.share, 0) / total, zones: rows }
}

/** 세대수를 셀 용도 (공동주택(기숙사 제외)·다가구·오피스텔) */
export function hasUnits(use: UsePick | null | undefined): boolean {
  if (!use) return false
  if (use.no === '2') return use.sub !== '기숙사'
  if (use.no === '1') return use.sub === '다가구주택'
  if (use.no === '14') return use.sub === '오피스텔'
  return false
}

/** 세대 하나가 차지하는 연면적 어림 (전용 84㎡ 세대 + 공용·벽체) */
export const GFA_PER_UNIT = 110

export function planOf(input: PlanInput, siteArea: number, zones: Zone[], region: RegionTable | null): Plan {
  const use = input.use ?? null
  const cls = use ? USE_CLASSES.find((u) => u.no === use.no) : undefined
  const useName = cls ? (use?.sub && use.sub !== cls.name ? `${cls.name} · ${use.sub}` : cls.name) : '용도 미정'
  const bcr = limitOf('bcr', zones, region)
  const far = limitOf('far', zones, region)
  const gfa: PlanValue | null = input.gfa
    ? { v: input.gfa }
    : far && siteArea
      ? { v: Math.round((siteArea * far.pct) / 100), assumed: `연면적을 넣지 않아 용적률 상한(${round1(far.pct)}%)까지 지은 것으로 봄` }
      : null
  const floors: PlanValue | null = input.floors
    ? { v: input.floors }
    : gfa && bcr && siteArea
      ? { v: Math.max(1, Math.ceil(gfa.v / ((siteArea * bcr.pct) / 100))), assumed: '층수를 넣지 않아 건폐율 상한 바닥에 연면적을 쌓은 층수로 봄' }
      : null
  const basement: PlanValue = input.basement !== undefined ? { v: input.basement } : { v: 0, assumed: '지하층을 넣지 않아 없는 것으로 봄' }
  const units: PlanValue | null = !hasUnits(use)
    ? null
    : input.units
      ? { v: input.units }
      : gfa
        ? { v: Math.max(1, Math.round(gfa.v / GFA_PER_UNIT)), assumed: `세대수를 넣지 않아 연면적 ÷ ${GFA_PER_UNIT}㎡(전용 84㎡ 세대 어림)로 봄` }
        : null
  return { use, useName, gfa, floors, basement, units, bcr, far }
}

export const round1 = (n: number) => Math.round(n * 10) / 10
