// 도판 색 묶음. 원칙: 도판 하나에 주제색 한 계열, 나머지는 회색 바탕, 모르는 값은 회색 '미상', 강조색은 대지 하나.
// 3판(2026-11-12 사용자 결정): 분위기별 묶음(종이톤·재료·어두운 바탕·선명한 대비)을 더하고,
// 보드 전체에 한 묶음 + 학생이 색을 직접 고침 + 필요한 도판만 덮어쓰기. 색 조합은 참고 사이트를 베끼지 않고 새로 짬.

import type { DiagramSettings, PaletteEdit, PaletteId } from '../model/types'

export type PaletteGroup = '기본' | '종이톤' | '재료' | '어두운 바탕' | '선명한 대비'

export interface Palette {
  id: PaletteId
  label: string
  group: PaletteGroup
  /** 색 쓰는 방식: color 일반 / mono 흑백(명도로 구분) */
  kind: 'color' | 'mono'
  /** 어두운 바탕이면 true */
  dark?: boolean
  /** 종이(도판 바탕)·글자 테두리 */
  paper: string
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
  /** 단계색 (약함 → 강함 5개. 밝은 바탕이면 밝음 → 어두움) */
  seq: string[]
  /** 양쪽 단계색 (차가움 · 중간 · 뜨거움 5개) — 바람·온도 */
  div: string[]
  /** 학생이 색을 고친 묶음 (기본 묶음 전용 색 대신 묶음 색을 씀) */
  custom?: boolean
}

export const PALETTES: Palette[] = [
  {
    id: 'default',
    label: '기본',
    group: '기본',
    kind: 'color',
    paper: '#ffffff',
    ink: '#1e1e1c',
    subtle: '#6b6964',
    base: '#e3e1dc',
    unknown: '#cfccc5',
    water: '#8db9e2',
    green: '#9ccc8a',
    accent: '#e03131',
    cat: ['#f2b134', '#e8743b', '#c8435a', '#3d7dca', '#2a9d8f', '#8c6bb1', '#7a8b99', '#b07c4f'],
    seq: ['#f6efe1', '#e9c89a', '#d7925a', '#b45a3c', '#7a2e2a'],
    div: ['#3d6fb0', '#9cc0e3', '#efeee9', '#eea65a', '#c4442d'],
  },
  {
    id: 'cvd',
    label: '색약 친화',
    group: '기본',
    kind: 'color',
    paper: '#ffffff',
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
    div: ['#2a788e', '#7fb3c8', '#e8e8e8', '#e6a54a', '#b35806'],
  },
  {
    id: 'mono',
    label: '흑백(인쇄)',
    group: '기본',
    kind: 'mono',
    paper: '#ffffff',
    ink: '#111111',
    subtle: '#555555',
    base: '#e6e6e6',
    unknown: '#d0d0d0',
    water: '#bdbdbd',
    green: '#a8a8a8',
    accent: '#000000',
    cat: ['#bdbdbd', '#8c8c8c', '#5e5e5e', '#333333', '#a3a3a3', '#717171', '#d4d4d4', '#1a1a1a'],
    seq: ['#f2f2f2', '#c7c7c7', '#969696', '#636363', '#252525'],
    div: ['#252525', '#8c8c8c', '#e6e6e6', '#8c8c8c', '#252525'],
  },
  // ── 차분한 종이톤
  {
    id: 'paperSage',
    label: '종이·세이지',
    group: '종이톤',
    kind: 'color',
    paper: '#f5f2ea',
    ink: '#22302e',
    subtle: '#6c736c',
    base: '#dedacd',
    unknown: '#cdc8ba',
    water: '#a3c0c4',
    green: '#adbe96',
    accent: '#c4552f',
    cat: ['#d7a443', '#c9794a', '#a8504b', '#4b6f8c', '#5c8f86', '#8a7aa0', '#8b8c80', '#a8855c'],
    seq: ['#ece8da', '#c6d3bd', '#8daf9e', '#4e8080', '#244b56'],
    div: ['#33617a', '#9cbcc6', '#e9e4d8', '#dbab80', '#a8553a'],
  },
  {
    id: 'paperNavy',
    label: '종이·남색',
    group: '종이톤',
    kind: 'color',
    paper: '#f7f3ea',
    ink: '#1d2939',
    subtle: '#6a7180',
    base: '#e1dccf',
    unknown: '#cec9bd',
    water: '#a9c2cd',
    green: '#b8c7a2',
    accent: '#c8323a',
    cat: ['#e0b64f', '#d98a52', '#b8524f', '#3f6d96', '#5a958c', '#7f73a6', '#8e9099', '#ad8a62'],
    seq: ['#efe9dc', '#cdd8dc', '#94b4c4', '#4d7795', '#1e3a57'],
    div: ['#1e4f7a', '#8fb3cc', '#ebe6db', '#e3a873', '#b5493a'],
  },
  // ── 재료 톤
  {
    id: 'concrete',
    label: '콘크리트',
    group: '재료',
    kind: 'color',
    paper: '#f3f2ef',
    ink: '#2a2a29',
    subtle: '#6e6d69',
    base: '#d7d5d0',
    unknown: '#c6c4bf',
    water: '#a6b6bf',
    green: '#a7b19b',
    accent: '#d9480f',
    cat: ['#c9a65a', '#b9805a', '#9b5d55', '#5f7486', '#6f8d84', '#857d93', '#9a9893', '#a08b70'],
    seq: ['#ecebe7', '#cdcac3', '#a6a299', '#76726a', '#45423d'],
    div: ['#4f6b80', '#a9b8c2', '#e8e6e1', '#c9a07a', '#8f4e35'],
  },
  {
    id: 'brick',
    label: '벽돌',
    group: '재료',
    kind: 'color',
    paper: '#f6eee7',
    ink: '#38231e',
    subtle: '#7a635b',
    base: '#e4d4c8',
    unknown: '#d2c2b6',
    water: '#9eb4bc',
    green: '#a9b18c',
    accent: '#1f4e5f',
    cat: ['#d9a35b', '#c9714f', '#a3423a', '#5a6f86', '#6e8c7c', '#8a6f8f', '#9c8f86', '#b58a66'],
    seq: ['#f3e3d6', '#e1b099', '#c97a62', '#9a4a3c', '#5e2c22'],
    div: ['#3d6475', '#a3bcc4', '#efe5dc', '#d79a78', '#9a3d2c'],
  },
  {
    id: 'wood',
    label: '목재',
    group: '재료',
    kind: 'color',
    paper: '#f7f1e5',
    ink: '#33281c',
    subtle: '#76695a',
    base: '#e5d9c3',
    unknown: '#d3c7b1',
    water: '#a0b8b6',
    green: '#a2b07f',
    accent: '#b5452b',
    cat: ['#d8ab52', '#c48249', '#9c5a3f', '#56708a', '#6a8f74', '#8a7598', '#9b9282', '#b0905f'],
    seq: ['#f2e6ce', '#dbc199', '#be9969', '#8b6942', '#594026'],
    div: ['#476b7d', '#a5bfc2', '#efe7d7', '#d6a873', '#9c5530'],
  },
  {
    id: 'metal',
    label: '금속',
    group: '재료',
    kind: 'color',
    paper: '#eff1f3',
    ink: '#1e252c',
    subtle: '#636c76',
    base: '#d4d9de',
    unknown: '#c3c9cf',
    water: '#8fb0c6',
    green: '#9fb4a2',
    accent: '#e8590c',
    cat: ['#c9a84f', '#c67d4f', '#a5545c', '#4d6d93', '#4f8d8a', '#7a72a3', '#8e97a1', '#9b8a6e'],
    seq: ['#e8ecf0', '#c2cbd5', '#8d9bae', '#5b6d85', '#2e3d51'],
    div: ['#2f5f8a', '#9fb9d0', '#e6e9ec', '#d9a17a', '#a8482f'],
  },
  // ── 어두운 바탕 (단계색은 약할수록 바탕에 가깝게, 강할수록 밝게)
  {
    id: 'night',
    label: '밤 (검정)',
    group: '어두운 바탕',
    kind: 'color',
    dark: true,
    paper: '#17181b',
    ink: '#ecebe6',
    subtle: '#a09f99',
    base: '#3a3c41',
    unknown: '#4a4c52',
    water: '#2d5877',
    green: '#3e6a47',
    accent: '#ff6b4a',
    cat: ['#f2c14e', '#f28c48', '#ef5d6b', '#5aa9e6', '#4fc3a1', '#b28ddb', '#9aa3ad', '#d1a36a'],
    seq: ['#33373e', '#3d5a6b', '#4e8b9a', '#8cc6b5', '#e9f2c8'],
    div: ['#4f9de0', '#2f5675', '#3a3c41', '#a8653a', '#ff9a5a'],
  },
  {
    id: 'navy',
    label: '진남색',
    group: '어두운 바탕',
    kind: 'color',
    dark: true,
    paper: '#10213a',
    ink: '#eef2f6',
    subtle: '#9fb0c3',
    base: '#2b3d57',
    unknown: '#3a4a63',
    water: '#1d5f86',
    green: '#3a6c5b',
    accent: '#ffb703',
    cat: ['#ffd166', '#f4a261', '#ef6f6c', '#6cb4ee', '#4fd1b0', '#b79ced', '#9aa9bb', '#d8b07a'],
    seq: ['#24395a', '#2f5d7c', '#4f93a8', '#9fd3c7', '#f1f7d8'],
    div: ['#6cb4ee', '#2f5d7c', '#2b3d57', '#a8603d', '#ffa261'],
  },
  // ── 선명한 대비
  {
    id: 'vividRed',
    label: '빨강·남색',
    group: '선명한 대비',
    kind: 'color',
    paper: '#ffffff',
    ink: '#111418',
    subtle: '#5d636b',
    base: '#e2e3e4',
    unknown: '#cdcfd1',
    water: '#86b3d6',
    green: '#93c286',
    accent: '#e10600',
    cat: ['#ffb000', '#ff6a13', '#e10600', '#003f88', '#00a19a', '#7b2cbf', '#6c757d', '#a0522d'],
    seq: ['#fdf0d5', '#f4a582', '#d6604d', '#b2182b', '#67001f'],
    div: ['#003049', '#669bbc', '#f1f1ef', '#e76f51', '#c1121f'],
  },
  {
    id: 'vividTeal',
    label: '청록·주황',
    group: '선명한 대비',
    kind: 'color',
    paper: '#fbfbf8',
    ink: '#0f1a1c',
    subtle: '#59666a',
    base: '#dfe3e2',
    unknown: '#cbd1d0',
    water: '#7fc4d6',
    green: '#8fcf9a',
    accent: '#ff5a1f',
    cat: ['#ffbe0b', '#fb5607', '#e5383b', '#0a6ebd', '#0f9d8a', '#8338ec', '#6b7b80', '#b5835a'],
    seq: ['#e6f4f1', '#a6d9cf', '#4fb3a6', '#13857a', '#064e48'],
    div: ['#0a6ebd', '#8ec5e8', '#f0f0ec', '#ffa36c', '#e4572e'],
  },
]

export const PALETTE_GROUPS: PaletteGroup[] = ['기본', '종이톤', '재료', '어두운 바탕', '선명한 대비']

export function paletteOf(id: PaletteId | undefined): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]
}

export type SingleColorKey = 'paper' | 'ink' | 'subtle' | 'base' | 'unknown' | 'water' | 'green' | 'accent'

/** 고칠 수 있는 한 가지 색 (화면 글) */
export const EDIT_FIELDS: { key: SingleColorKey; label: string }[] = [
  { key: 'paper', label: '바탕(종이)' },
  { key: 'ink', label: '글자·선' },
  { key: 'subtle', label: '보조 글자' },
  { key: 'base', label: '바탕 건물' },
  { key: 'unknown', label: '미상' },
  { key: 'water', label: '물' },
  { key: 'green', label: '녹지' },
  { key: 'accent', label: '대지 강조' },
]

/** 고칠 수 있는 여러 색 줄 */
export const EDIT_LISTS: { key: 'seq' | 'cat' | 'div'; label: string; note: string }[] = [
  { key: 'seq', label: '단계색', note: '약함 → 강함 (높이·밀도·연대 등)' },
  { key: 'cat', label: '범주색', note: '종류 구분 (용도·업종·시설 등)' },
  { key: 'div', label: '양쪽 단계색', note: '차가움 · 중간 · 뜨거움 (바람·더위)' },
]

const HEX_RE = /^#[0-9a-f]{6}$/i

export function isHex(v: string | undefined): v is string {
  return !!v && HEX_RE.test(v)
}

/** 묶음에 학생이 고친 색을 얹는다 (빈 칸·잘못된 값은 묶음 색 그대로) */
export function applyPaletteEdit(pal: Palette, edit: PaletteEdit | undefined): Palette {
  if (!edit) return pal
  let changed = false
  const out: Palette = { ...pal }
  for (const { key } of EDIT_FIELDS) {
    const v = edit[key]
    if (isHex(v) && v.toLowerCase() !== pal[key].toLowerCase()) {
      out[key] = v.toLowerCase()
      changed = true
    }
  }
  for (const k of ['cat', 'seq', 'div'] as const) {
    const e = edit[k]
    if (!e) continue
    const next = pal[k].map((c, i) => (isHex(e[i]) ? e[i].toLowerCase() : c))
    if (next.some((c, i) => c !== pal[k][i].toLowerCase())) {
      out[k] = next
      changed = true
    }
  }
  if (!changed) return pal
  // 바탕 밝기가 바뀌면 어두운 바탕 여부도 따라감
  out.dark = luminance(out.paper) < 0.3
  out.custom = true
  return out
}

type ColorSettings = Pick<DiagramSettings, 'palette' | 'colors' | 'panelStyles'>

/** 이 도판에 쓸 색: 도판 덮어쓰기에 묶음이 있으면 그 묶음 + 도판 색, 없으면 보드 전체 묶음 + 전체 고친 색 + 도판 색 */
export function paletteFor(settings: ColorSettings, panelId?: string): Palette {
  const ps = panelId ? settings.panelStyles?.[panelId] : undefined
  if (ps?.palette) return applyPaletteEdit(paletteOf(ps.palette), ps.colors)
  return applyPaletteEdit(applyPaletteEdit(paletteOf(settings.palette), settings.colors), ps?.colors)
}

/** 다시 그려야 하는지 가리는 색 열쇠 */
export function paletteKey(settings: ColorSettings, panelId?: string): string {
  const p = paletteFor(settings, panelId)
  return p.custom ? `${p.id}~${[p.paper, p.ink, p.subtle, p.base, p.unknown, p.water, p.green, p.accent, ...p.cat, ...p.seq, ...p.div].join('').replace(/#/g, '')}` : p.id
}

/** 기본 묶음을 고치지 않고 그대로 쓰는지 (그 묶음 전용 색을 쓸 때) */
export function isStock(pal: Palette, id: PaletteId): boolean {
  return pal.id === id && !pal.custom
}

function hex(c: string): [number, number, number] {
  const h = c.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function toHex([r, g, b]: number[]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`
}

export function luminance(c: string): number {
  const [r, g, b] = hex(c).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function mix(a: string, b: string, t: number): string {
  const A = hex(a)
  const B = hex(b)
  return toHex(A.map((v, i) => v + (B[i] - v) * t))
}

/** 여러 색을 이어 n단계로 */
export function ramp(stops: string[], n: number): string[] {
  if (n <= 1) return [stops[Math.floor(stops.length / 2)]]
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * (stops.length - 1)
    const k = Math.min(Math.floor(t), stops.length - 2)
    return mix(stops[k], stops[k + 1], t - k)
  })
}

/** 단계색 n개 (약함 → 강함) */
export function steps(pal: Palette, n: number): string[] {
  return ramp(pal.seq, n)
}

/** 한 가지 색의 단계 n개 (연함 → 진함, from = 바탕색) */
export function shades(color: string, n: number, from = '#ffffff'): string[] {
  return Array.from({ length: n }, (_, i) => mix(from, color, 0.25 + (0.75 * (i + 1)) / n))
}

/** 흑백 묶음의 명도 단계 (연함 → 진함) */
export function monoShades(pal: Palette, n: number): string[] {
  return shades(pal.ink, n, pal.paper)
}

/** 바탕 쪽으로 옅게 (t = 0 바탕, 1 그 색) */
export function tint(pal: Palette, color: string, t: number): string {
  return mix(pal.paper, color, t)
}

// ───────────────────────── 주제별 색 (기본 묶음 전용 색 · 그 밖은 묶음에서) ─────────────────────────

/** 태양 궤적 하지·춘추분·동지 */
export function sunPathColors(pal: Palette): { summer: string; equinox: string; winter: string } {
  if (pal.kind === 'mono') return { summer: pal.ink, equinox: mix(pal.paper, pal.ink, 0.6), winter: mix(pal.paper, pal.ink, 0.4) }
  if (isStock(pal, 'default')) return { summer: '#e8590c', equinox: '#e0a100', winter: '#1c7ed6' }
  if (isStock(pal, 'cvd')) return { summer: '#d55e00', equinox: '#e69f00', winter: '#0072b2' }
  return { summer: pal.div[4], equinox: pal.cat[0], winter: pal.div[0] }
}

/** 막힘(느림) → 빠름 5단계 */
export function speedColors(pal: Palette): string[] {
  if (pal.kind === 'mono') return ramp([pal.ink, mix(pal.paper, pal.ink, 0.15)], 5)
  if (isStock(pal, 'default')) return ['#d7301f', '#f2862e', '#f2c94c', '#8cc084', '#3a8f5c']
  if (isStock(pal, 'cvd')) return ['#d55e00', '#e69f00', '#f0e442', '#56b4e9', '#0072b2']
  return [pal.div[4], mix(pal.div[4], pal.cat[0], 0.5), pal.cat[0], mix(pal.cat[0], pal.div[0], 0.5), pal.div[0]]
}

/** 더위 (약함 → 강함). stockRamp = 기본 묶음 전용 단계 */
export function heatColors(pal: Palette, n: number, stockRamp: (n: number) => string[]): string[] {
  if (pal.kind === 'mono') return monoShades(pal, n)
  if (isStock(pal, 'default')) return stockRamp(n)
  if (isStock(pal, 'cvd')) return steps(pal, n)
  return ramp([mix(pal.paper, pal.div[3], 0.35), pal.div[3], pal.div[4], mix(pal.div[4], pal.dark ? '#ffffff' : '#000000', 0.3)], n)
}

/** 한 가지 주제색 (높은 것 강조 등): 기본 묶음 전용 색이 있으면 그것 */
export function themeColor(pal: Palette, stock: { default: string; cvd: string; mono: string }, fallback: string): string {
  if (pal.kind === 'mono') return isStock(pal, 'mono') ? stock.mono : pal.ink
  if (isStock(pal, 'default')) return stock.default
  if (isStock(pal, 'cvd')) return stock.cvd
  return fallback
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
  // 용도지역은 관례 색(주거 노랑·상업 빨강·공업 보라·녹지 초록)을 지킨다. 흑백·색약만 따로
  const base = (ZONE_BASE[pal.kind === 'mono' ? 'mono' : pal.id === 'cvd' ? 'cvd' : 'default'] ?? ZONE_BASE.default)[group]
  return mix(pal.paper, base, 0.35 + 0.65 * (level / max))
}

export const ZONE_GROUP_LABEL: Record<ZoneGroup, string> = {
  residential: '주거',
  commercial: '상업',
  industrial: '공업',
  green: '녹지',
  other: '관리·농림·보전',
}
