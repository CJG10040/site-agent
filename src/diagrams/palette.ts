// 도판 색 묶음. 원칙: 도판 하나에 주제색 한 계열, 나머지는 회색 바탕, 모르는 값은 회색 '미상', 강조색은 대지 하나.
// 3판(2026-11-12 사용자 결정): 분위기별 묶음(종이톤·재료·어두운 바탕·선명한 대비)을 더하고,
// 보드 전체에 한 묶음 + 학생이 색을 직접 고침 + 필요한 도판만 덮어쓰기.
// 4판(2026-11-20 새 디자인 2차): 이름·묶음·성격은 그대로 두고, 조합을 공개된 지도·자료 시각화 색 자료로 다듬음 —
//   ColorBrewer(colorbrewer2.org) · Paul Tol 색 안내서 · CARTOColors · Okabe–Ito. 묶음마다 '참고:'에 적음.
// 검증(dataviz 검증 스크립트 + OKLab 계산, 지도 채움에 맞춘 기준):
//   범주색 — 이웃 칸이 보통 눈으로 ΔE ≥ 15, 적·녹 색약 시뮬레이션으로 ΔE ≥ 6 (범례가 늘 함께 있음)
//   범주색 칸의 뜻은 고정: 0 노랑(낮·밝음) · 1 주황 · 2 빨강·장미 · 3 파랑 · 4 청록 · 5 보라(밤) · 6 회색(기타) · 7 갈색
//   단계색 — 밝기가 한 방향으로 고르게, 가장 옅은 칸도 종이·바탕 건물과 구분됨 / 양쪽 단계색 — 가운데는 무채색
//   대지 강조색 — 종이 위 대비 3:1 이상, 단계색과 뚜렷이 다름

import type { DiagramSettings, PaletteEdit, PaletteId } from '../model/types'
import { themePalette } from './themePalette'

export type PaletteGroup = '기본' | '종이톤' | '파스텔' | '재료' | '어두운 바탕' | '선명한 대비' | '테마색'

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
    // 참고: 회색 바탕 + 남청 단계(ColorBrewer Blues·PuBu 참고) + Paul Tol bright·vibrant 범주 + ColorBrewer RdBu 양쪽
    id: 'default',
    label: '기본',
    group: '기본',
    kind: 'color',
    paper: '#ffffff',
    ink: '#18181b',
    subtle: '#5f5f66',
    base: '#e3e3e1',
    unknown: '#cbcbc8',
    water: '#94c0e2',
    green: '#a6d097',
    accent: '#d42a1e',
    cat: ['#ecb63c', '#e66f2e', '#bf385b', '#3a6eb2', '#1b9e8e', '#8d55b3', '#b0b3b8', '#8b5a2b'],
    seq: ['#ccd8e8', '#adc3e0', '#7798c4', '#43679a', '#1d365c'],
    div: ['#2c6aab', '#98c1df', '#efefed', '#f3a580', '#c7392b'],
  },
  {
    // 참고: Okabe–Ito 범주(그대로) + viridis 단계 + Paul Tol sunset 양쪽
    id: 'cvd',
    label: '색약 친화',
    group: '기본',
    kind: 'color',
    paper: '#ffffff',
    ink: '#111111',
    subtle: '#555555',
    base: '#e3e3e1',
    unknown: '#c9c9c6',
    water: '#9fcdec',
    green: '#7fc7a8',
    accent: '#000000',
    cat: ['#e69f00', '#d55e00', '#cc79a7', '#0072b2', '#009e73', '#56b4e9', '#7f7f7f', '#f0e442'],
    seq: ['#fde725', '#7ad151', '#22a884', '#2a788e', '#414487'],
    div: ['#364b9a', '#6ea6cd', '#ececea', '#fdb366', '#dd3d2d'],
  },
  {
    // 참고: 명도만으로 구분 (ColorBrewer Greys 참고)
    id: 'mono',
    label: '흑백(인쇄)',
    group: '기본',
    kind: 'mono',
    paper: '#ffffff',
    ink: '#18181b',
    subtle: '#555555',
    base: '#f0f0f0',
    unknown: '#e0e0e0',
    water: '#bdbdbd',
    green: '#a8a8a8',
    accent: '#000000',
    cat: ['#d4d4d4', '#8c8c8c', '#4a4a4a', '#b0b0b0', '#666666', '#e6e6e6', '#a0a0a0', '#252525'],
    seq: ['#d2d2d2', '#acacac', '#808080', '#525252', '#222222'],
    div: ['#252525', '#8c8c8c', '#e6e6e6', '#8c8c8c', '#252525'],
  },
  // ── 차분한 종이톤
  {
    // 참고: CARTO Antique 범주 + CARTO Mint 단계 + CARTO Geyser 양쪽
    id: 'paperSage',
    label: '종이·세이지',
    group: '종이톤',
    kind: 'color',
    paper: '#f4f1e8',
    ink: '#22302c',
    subtle: '#66706a',
    base: '#dcd8cc',
    unknown: '#c8c3b4',
    water: '#a6c2c4',
    green: '#aec195',
    accent: '#c4552f',
    cat: ['#deb058', '#c27448', '#963a35', '#466693', '#4a9a8c', '#875a8d', '#aeaa9c', '#77583a'],
    seq: ['#ccebdc', '#a9d3c6', '#63a6a0', '#287274', '#0d4f55'],
    div: ['#227a77', '#8db5a5', '#e9e6dd', '#e2a170', '#b9532f'],
  },
  {
    // 참고: Paul Tol medium-contrast(남색·금색) 범주 + 남색 단계(ColorBrewer PuBu 참고) + 버밀리언 대지
    id: 'paperNavy',
    label: '종이·남색',
    group: '종이톤',
    kind: 'color',
    paper: '#f6f2ea',
    ink: '#1c2738',
    subtle: '#667082',
    base: '#dfdacf',
    unknown: '#cbc6ba',
    water: '#a8c0cd',
    green: '#b5c49f',
    accent: '#c8323a',
    cat: ['#eabd5b', '#d47e43', '#a7414a', '#36659a', '#42978b', '#7b5fa8', '#adadb4', '#86603a'],
    seq: ['#d9e5f2', '#b0c3d4', '#7896b4', '#43678d', '#1b385c'],
    div: ['#1f4e7a', '#93b3cb', '#ebe6dc', '#e2a877', '#b5463a'],
  },
  // ── 파스텔 (옅은 색이 많아도 강한 쪽 끝과 글자는 읽히게 진하게)
  {
    // 참고: Paul Tol light 범주 + CARTO Burg 밝은 쪽 단계
    id: 'pastelBloom',
    label: '파스텔·봄',
    group: '파스텔',
    kind: 'color',
    paper: '#fdf9f7',
    ink: '#3a3445',
    subtle: '#716b7d',
    base: '#d9d6d7',
    unknown: '#c8c4c5',
    water: '#b7dbee',
    green: '#c3e2bd',
    accent: '#2a8c84',
    cat: ['#fce696', '#f3a47e', '#c76c85', '#7fa8dc', '#8cddc5', '#b493dd', '#d5cfd7', '#c09a74'],
    seq: ['#f6dbe3', '#eebccb', '#df97ae', '#c47391', '#8f4d6b'],
    div: ['#6f9fd6', '#b9d5ee', '#f3f1f1', '#f5bfa3', '#df8068'],
  },
  {
    // 참고: Paul Tol light 범주(하늘 쪽) + 하늘색 단계(ColorBrewer Blues 밝은 쪽 참고)
    id: 'pastelSky',
    label: '파스텔·하늘',
    group: '파스텔',
    kind: 'color',
    paper: '#f8fbfd',
    ink: '#2f3a4a',
    subtle: '#66738a',
    base: '#d3d6da',
    unknown: '#c1c6cc',
    water: '#a7d2ec',
    green: '#bde0c6',
    accent: '#de5d2c',
    cat: ['#ffedb5', '#f5ab86', '#cc748c', '#76a6dc', '#8cdcce', '#ac9be6', '#d0d6df', '#c4a27c'],
    seq: ['#d4e6f8', '#b6d1ee', '#8fb6e0', '#6890c4', '#456a9f'],
    div: ['#6a9cd6', '#b6d3ee', '#f2f2f0', '#f7c29a', '#e3856a'],
  },
  {
    // 참고: CARTO Pastel 범주 + CARTO Mint·TealGrn 밝은 쪽 단계
    id: 'pastelMint',
    label: '파스텔·민트',
    group: '파스텔',
    kind: 'color',
    paper: '#f7fbf8',
    ink: '#2e3b37',
    subtle: '#66766f',
    base: '#dcdfdd',
    unknown: '#cdd2cf',
    water: '#aad7e1',
    green: '#bde4c4',
    accent: '#e8645a',
    cat: ['#fee7a8', '#f5a274', '#cd6b84', '#82ade3', '#89e4cf', '#ad92dc', '#cbd3cf', '#bd9c6c'],
    seq: ['#d4efe0', '#b0dbc4', '#8fcab3', '#5fab95', '#377a69'],
    div: ['#5f9fcf', '#b2d6e8', '#f1f3ef', '#f5c09f', '#df8269'],
  },
  // ── 재료 톤 (재료의 색을 바탕·단계색에, 대지는 재료와 반대되는 색으로)
  {
    // 참고: 노출 콘크리트 회색 + 철골 청회색 단계 + 공사 안전 주황 대지
    id: 'concrete',
    label: '콘크리트',
    group: '재료',
    kind: 'color',
    paper: '#f2f2f0',
    ink: '#262626',
    subtle: '#696965',
    base: '#d6d5d1',
    unknown: '#c3c2be',
    water: '#a4b6c0',
    green: '#a6b19c',
    accent: '#e0531f',
    cat: ['#dcaf57', '#c06f42', '#8f3835', '#416088', '#4f9488', '#7c5f93', '#b4b3ae', '#7e5f3d'],
    seq: ['#d3e4f1', '#bcc5cd', '#8f9ca7', '#5b6a78', '#2f3b47'],
    div: ['#3f6680', '#a7bac7', '#e9e9e6', '#d4a27c', '#a24a2c'],
  },
  {
    // 참고: 적벽돌 단계(CARTO BrwnYl·RedOr 참고) + 청록 대지(벽돌의 반대색)
    id: 'brick',
    label: '벽돌',
    group: '재료',
    kind: 'color',
    paper: '#f6efe8',
    ink: '#38231e',
    subtle: '#7a635b',
    base: '#d6d0ca',
    unknown: '#c2bbb4',
    water: '#9fb5bd',
    green: '#a8b18b',
    accent: '#1f5f70',
    cat: ['#e2ab56', '#c66c45', '#93352f', '#4b6b90', '#5ea092', '#86608e', '#b5aba4', '#7a5636'],
    seq: ['#f2d8c6', '#e2b39b', '#c97b60', '#9b4a39', '#5e2a21'],
    div: ['#356475', '#a1bcc4', '#efe6dd', '#d79a78', '#983a2a'],
  },
  {
    // 참고: 목재 단계(CARTO Earth 갈색 쪽 참고) + 청록 대지
    id: 'wood',
    label: '목재',
    group: '재료',
    kind: 'color',
    paper: '#f7f1e6',
    ink: '#33281c',
    subtle: '#76695a',
    base: '#dedbd3',
    unknown: '#cbc7bd',
    water: '#a0b9b7',
    green: '#a3b080',
    accent: '#1f6f78',
    cat: ['#e3b558', '#c27a3f', '#8e452e', '#4b6a8e', '#5b9d84', '#86659c', '#b6ae9f', '#7b5c38'],
    seq: ['#f0dcb4', '#dcc29b', '#bd9a6a', '#8a6a44', '#56412a'],
    div: ['#40697a', '#a6c0c3', '#ece8e0', '#d7a974', '#9a5530'],
  },
  {
    // 참고: 금속(아연·강철) 청회색 단계 + 코르텐·구리 대지
    id: 'metal',
    label: '금속',
    group: '재료',
    kind: 'color',
    paper: '#eff1f3',
    ink: '#1e252c',
    subtle: '#626b75',
    base: '#d2d0ca',
    unknown: '#bebcb6',
    water: '#8fb0c6',
    green: '#9fb4a2',
    accent: '#c2571a',
    cat: ['#dcb354', '#c7743f', '#9c404a', '#3f6597', '#499a95', '#7663a8', '#b2b8bf', '#80643f'],
    seq: ['#d3dee9', '#b8c5d2', '#8a9db2', '#566e89', '#2b3d52'],
    div: ['#2f5f8a', '#a0bad1', '#e7eaed', '#d9a17a', '#a8482f'],
  },
  // ── 어두운 바탕 (단계색은 약할수록 바탕에 가깝게, 강할수록 밝게 — 어두운 지도는 밝은 쪽이 강함)
  {
    // 참고: 어두운 바탕은 밝을수록 강하게(CARTO 어두운 지도 안내) — CARTO ag_GrnYl 단계 + Paul Tol bright 범주를 밝게
    id: 'night',
    label: '밤 (검정)',
    group: '어두운 바탕',
    kind: 'color',
    dark: true,
    paper: '#161618',
    ink: '#ececec',
    subtle: '#9d9da3',
    base: '#34363b',
    unknown: '#45474d',
    water: '#1f4a66',
    green: '#2f5a3c',
    accent: '#ff5b4f',
    cat: ['#f0cd5a', '#f08a4b', '#d24c60', '#5aa2e6', '#4fd1b0', '#b88de3', '#7d838c', '#d6ad74'],
    seq: ['#22505e', '#127a7c', '#3aab7e', '#a6db68', '#edef5d'],
    div: ['#5aa9e6', '#2e5675', '#3a3c41', '#a8623a', '#ff9a5a'],
  },
  {
    // 참고: 진남색 바탕 + CARTO ag_Sunset 단계(밝을수록 강함) + 청록 대지
    id: 'navy',
    label: '진남색',
    group: '어두운 바탕',
    kind: 'color',
    dark: true,
    paper: '#0f2037',
    ink: '#eef2f6',
    subtle: '#9eafc2',
    base: '#263a55',
    unknown: '#344862',
    water: '#1c5a83',
    green: '#335f53',
    accent: '#c8f03c',
    cat: ['#ffe5ad', '#f4a261', '#dd5f5d', '#5fa8ec', '#4fd1b0', '#b79ced', '#6f7f93', '#e0bb86'],
    seq: ['#40307f', '#8a2f9e', '#d6448f', '#f7936f', '#efd9a3'],
    div: ['#6cb4ee', '#2f5d7c', '#383d43', '#a8603d', '#ffa261'],
  },
  // ── 선명한 대비
  {
    // 참고: ColorBrewer Reds 단계·RdBu 양쪽(그대로) + CARTO Bold 범주 + 남색 대지
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
    accent: '#003f88',
    cat: ['#f2b701', '#e3690f', '#cf2e66', '#3969ac', '#11a579', '#7f3c8d', '#b4b8aa', '#94502a'],
    seq: ['#ffdccb', '#fcae91', '#fb6a4a', '#de2d26', '#a50f15'],
    div: ['#0571b0', '#92c5de', '#f7f7f7', '#f4a582', '#ca0020'],
  },
  {
    // 참고: CARTO Mint 단계 + CARTO Geyser 양쪽 + CARTO Vivid 범주 + 주황 대지
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
    cat: ['#e8bc2e', '#e2700a', '#bd282a', '#2f8ac4', '#46b9a2', '#764e9f', '#b3b8b0', '#9a6a42'],
    seq: ['#def4d9', '#89c0b6', '#448c8a', '#287274', '#0d585f'],
    div: ['#008080', '#70a494', '#efefe9', '#de8a5a', '#ca562c'],
  },
]

export const PALETTE_GROUPS: PaletteGroup[] = ['기본', '종이톤', '파스텔', '재료', '어두운 바탕', '선명한 대비']

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

type ColorSettings = Pick<DiagramSettings, 'palette' | 'colors' | 'panelStyles' | 'theme'>

/** 보드 전체의 고치기 전 묶음 (테마색 조합이 있으면 그것) */
export function boardBase(settings: ColorSettings): Palette {
  return settings.theme ? themePalette(settings.theme) : paletteOf(settings.palette)
}

/** 이 도판에 쓸 색: 도판 덮어쓰기에 테마색·묶음이 있으면 그것 + 도판 색, 없으면 보드 전체(묶음 또는 테마색) + 전체 고친 색 + 도판 색 */
export function paletteFor(settings: ColorSettings, panelId?: string): Palette {
  const ps = panelId ? settings.panelStyles?.[panelId] : undefined
  if (ps?.theme) return applyPaletteEdit(themePalette(ps.theme), ps.colors)
  if (ps?.palette) return applyPaletteEdit(paletteOf(ps.palette), ps.colors)
  return applyPaletteEdit(applyPaletteEdit(boardBase(settings), settings.colors), ps?.colors)
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
