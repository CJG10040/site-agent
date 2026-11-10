// 도판 색 묶음. 원칙: 도판 하나에 주제색 한 계열, 나머지는 회색 바탕, 모르는 값은 회색 '미상', 강조색은 대지 하나.

import type { PaletteId } from '../model/types'

export interface Palette {
  id: PaletteId
  label: string
  /** 글자·선 */
  ink: string
  /** 보조 글자 */
  subtle: string
  /** 주제가 아닌 건물(바탕) */
  base: string
  /** 미상 */
  unknown: string
  /** 물 */
  water: string
  /** 녹지 */
  green: string
  /** 대지 표시 */
  accent: string
  /** 범주색 (8개) */
  cat: string[]
  /** 단계색 양 끝 (밝음 → 어두움) */
  seq: string[]
}

export const PALETTES: Palette[] = [
  {
    id: 'default',
    label: '기본',
    ink: '#1e1e1c',
    subtle: '#6b6964',
    base: '#e3e1dc',
    unknown: '#cfccc5',
    water: '#8db9e2',
    green: '#9ccc8a',
    accent: '#e03131',
    cat: ['#f2b134', '#e8743b', '#c8435a', '#3d7dca', '#2a9d8f', '#8c6bb1', '#7a8b99', '#b07c4f'],
    seq: ['#f6efe1', '#e9c89a', '#d7925a', '#b45a3c', '#7a2e2a'],
  },
  {
    id: 'cvd',
    label: '색약 친화',
    ink: '#1e1e1c',
    subtle: '#6b6964',
    base: '#e3e1dc',
    unknown: '#cfccc5',
    water: '#56b4e9',
    green: '#009e73',
    accent: '#000000',
    // Okabe–Ito
    cat: ['#e69f00', '#d55e00', '#cc79a7', '#0072b2', '#009e73', '#56b4e9', '#999999', '#f0e442'],
    // viridis 계열
    seq: ['#fde725', '#7ad151', '#22a884', '#2a788e', '#414487'],
  },
  {
    id: 'mono',
    label: '흑백(인쇄)',
    ink: '#111111',
    subtle: '#555555',
    base: '#e6e6e6',
    unknown: '#d0d0d0',
    water: '#bdbdbd',
    green: '#a8a8a8',
    accent: '#000000',
    cat: ['#bdbdbd', '#8c8c8c', '#5e5e5e', '#333333', '#a3a3a3', '#717171', '#d4d4d4', '#1a1a1a'],
    seq: ['#f2f2f2', '#c7c7c7', '#969696', '#636363', '#252525'],
  },
]

export function paletteOf(id: PaletteId | undefined): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]
}

function hex(c: string): [number, number, number] {
  const h = c.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function toHex([r, g, b]: number[]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`
}

export function mix(a: string, b: string, t: number): string {
  const A = hex(a)
  const B = hex(b)
  return toHex(A.map((v, i) => v + (B[i] - v) * t))
}

/** 단계색 n개 (밝음 → 어두움) */
export function steps(pal: Palette, n: number): string[] {
  const stops = pal.seq
  if (n <= 1) return [stops[Math.floor(stops.length / 2)]]
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * (stops.length - 1)
    const k = Math.min(Math.floor(t), stops.length - 2)
    return mix(stops[k], stops[k + 1], t - k)
  })
}

/** 한 가지 색의 밝기 단계 n개 (연함 → 진함) */
export function shades(color: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => mix('#ffffff', color, 0.25 + (0.75 * (i + 1)) / n))
}

// ───────────────────────── 용도지역 색 ─────────────────────────

type ZoneGroup = 'residential' | 'commercial' | 'industrial' | 'green' | 'other'

const ZONE_LEVELS: [RegExp, ZoneGroup, number][] = [
  [/제1종전용주거/, 'residential', 0],
  [/제2종전용주거/, 'residential', 1],
  [/제1종일반주거/, 'residential', 2],
  [/제2종일반주거/, 'residential', 3],
  [/제3종일반주거/, 'residential', 4],
  [/준주거/, 'residential', 5],
  [/근린상업/, 'commercial', 0],
  [/유통상업/, 'commercial', 1],
  [/일반상업/, 'commercial', 2],
  [/중심상업/, 'commercial', 3],
  [/준공업/, 'industrial', 0],
  [/일반공업/, 'industrial', 1],
  [/전용공업/, 'industrial', 2],
  [/자연녹지/, 'green', 0],
  [/생산녹지/, 'green', 1],
  [/보전녹지/, 'green', 2],
  [/관리|농림|자연환경보전/, 'other', 1],
]

const ZONE_BASE: Record<string, Record<ZoneGroup, string>> = {
  default: { residential: '#e8b82e', commercial: '#d6455d', industrial: '#8e74c4', green: '#5c9e57', other: '#a39b78' },
  cvd: { residential: '#e69f00', commercial: '#cc79a7', industrial: '#0072b2', green: '#009e73', other: '#999999' },
  mono: { residential: '#9a9a9a', commercial: '#3a3a3a', industrial: '#666666', green: '#c4c4c4', other: '#dedede' },
}

export function zoningColor(name: string, pal: Palette): string {
  const hit = ZONE_LEVELS.find(([re]) => re.test(name.replace(/\s+/g, '')))
  const group: ZoneGroup = hit?.[1] ?? 'other'
  const level = hit?.[2] ?? 1
  const max = group === 'residential' ? 5 : group === 'other' ? 2 : 3
  const base = (ZONE_BASE[pal.id] ?? ZONE_BASE.default)[group]
  return mix('#ffffff', base, 0.35 + 0.65 * (level / max))
}

export const ZONE_GROUP_LABEL: Record<ZoneGroup, string> = {
  residential: '주거',
  commercial: '상업',
  industrial: '공업',
  green: '녹지',
  other: '관리·농림·보전',
}
