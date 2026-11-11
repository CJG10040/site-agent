// 종합 다이어그램 2판 기호 (2026-11-11): 모양 = 뜻. 자료 분석(개발계획서 §12)의 기호 어휘 —
// 흐름(차량·보행·바람·소음·시선), 선(경계·활성 가로면·축·완충대), 점(입구·랜드마크·결절점), 면(버블·보존 구역).
// 사용자 결정: 뜻이 있는 기호 세트 + 굵기(주·부·작은 것)·선 모양 위계 / 색은 '조건은 먹색, 방향을 정한 해석만 방향색'.
// 편집 화면과 완성 도판, 범례·도구 단추 그림이 모두 이 파일을 쓴다. 1판 그림(sym 없음)은 symOf로 읽는다.

import type { SynthItem, SynthKind, SynthSym, SynthTone } from '../model/types'
import { esc, textWidth, wrap } from './compose'
import type { Frame } from './frame'
import { mix } from './palette'

type P = [number, number]

// ───────────────────────── 색 ─────────────────────────

export const TONES: Record<SynthTone, { label: string; color: string }> = {
  keep: { label: '보존할 것', color: '#2e7d32' },
  reveal: { label: '드러낼 것', color: '#1f6fb2' },
  avoid: { label: '피할 것', color: '#c62828' },
  transform: { label: '변환할 것', color: '#e06c00' },
  neutral: { label: '조건 (방향 없음)', color: '#1d1d1b' },
}
export const TONE_ORDER: SynthTone[] = ['keep', 'reveal', 'avoid', 'transform', 'neutral']
/** 방향 네 가지 (조건 먹색 뺌) */
export const DIRECTION_TONES: SynthTone[] = ['keep', 'reveal', 'avoid', 'transform']

export interface SynthCard {
  id: string
  title: string
  type: string
  tone: SynthTone
}

// ───────────────────────── 기호 목록 ─────────────────────────

export type SymGroup = '흐름' | '선' | '점' | '면' | '글'

export interface SymDef {
  label: string
  group: SymGroup
  /** 점 찍는 방식 */
  geo: SynthKind
  /** 대지의 조건을 그리는 기호 — 고르면 색이 '조건(먹색)'으로 바뀜 */
  cond?: boolean
  /** 굵기(주·부·작은 것)를 고를 수 있음 */
  weighted?: boolean
  help: string
}

const PATH = '지도를 차례로 눌러 꺾은 선을 그리고, 마지막 점에서 두 번 누르거나 Enter로 마칩니다.'
const AREA = '꼭짓점을 차례로 누르고 두 번 누르거나 Enter로 닫습니다.'

export const SYMS: Record<SynthSym, SymDef> = {
  arrow: { label: '화살표', group: '흐름', geo: 'arrow', weighted: true, help: `${PATH} 연결·의도·움직임 (실선·점선을 고를 수 있음)` },
  car: { label: '차량 흐름', group: '흐름', geo: 'arrow', cond: true, weighted: true, help: `${PATH} 차가 다니는 길을 따라 (굵은 빈 화살표, 양방향 가능)` },
  walk: { label: '보행 흐름', group: '흐름', geo: 'arrow', cond: true, weighted: true, help: `${PATH} 사람이 걷는 길을 따라 (점선 화살표)` },
  wind: { label: '바람', group: '흐름', geo: 'arrow', cond: true, weighted: true, help: `${PATH} 바람이 불어오는 쪽에서 시작합니다 (물결 화살표)` },
  noise: { label: '소음', group: '흐름', geo: 'vector', cond: true, weighted: true, help: '소리가 나는 곳을 누르고, 소리가 퍼지는 쪽을 한 번 더 누릅니다.' },
  view: { label: '시선·조망', group: '흐름', geo: 'vector', cond: true, weighted: true, help: '보는 곳을 누르고, 바라보는 쪽(보이는 끝)을 한 번 더 누릅니다. 부채꼴 폭은 오른쪽에서 바꿉니다.' },
  edge: { label: '경계·단절', group: '선', geo: 'line', cond: true, weighted: true, help: `${PATH} 지나가기 어려운 경계 (톱니 쪽은 오른쪽에서 바꿈)` },
  frontage: { label: '활성 가로면', group: '선', geo: 'line', cond: true, weighted: true, help: `${PATH} 가게·입구가 줄지어 활기 있는 길가` },
  axis: { label: '축', group: '선', geo: 'line', weighted: true, help: `${PATH} 시각 축·정렬선 (쇄선)` },
  buffer: { label: '완충대', group: '선', geo: 'line', help: `${PATH} 소음·시선을 거르는 띠 (폭은 오른쪽에서)` },
  line: { label: '선', group: '선', geo: 'line', weighted: true, help: `${PATH} 실선·점선을 고를 수 있습니다.` },
  entry: { label: '입구', group: '점', geo: 'vector', help: '입구 자리를 누르고, 들어가는 쪽을 한 번 더 누릅니다.' },
  landmark: { label: '랜드마크', group: '점', geo: 'point', cond: true, help: '지도를 누른 곳에 놓습니다 (멀리서도 알아보는 기준점).' },
  node: { label: '결절점', group: '점', geo: 'point', cond: true, help: '지도를 누른 곳에 놓습니다 (길이 모이고 사람이 머무는 곳).' },
  bolt: { label: '긴장 지점', group: '점', geo: 'point', help: '지도를 누른 곳에 놓습니다 (번개).' },
  star: { label: '중요한 곳', group: '점', geo: 'point', help: '지도를 누른 곳에 놓습니다 (별).' },
  dot: { label: '점', group: '점', geo: 'point', help: '지도를 누른 곳에 놓습니다.' },
  zone: { label: '영역', group: '면', geo: 'area', help: `${AREA} 점선 테두리 구역` },
  bubble: { label: '버블', group: '면', geo: 'area', help: `${AREA} 둥글게 다듬어 그립니다 (쓰임·덩어리를 놓을 자리).` },
  keepout: { label: '보존·불가 구역', group: '면', geo: 'area', help: `${AREA} 빗금 구역 (남길 곳·지을 수 없는 곳)` },
  note: { label: '글상자', group: '글', geo: 'note', help: '누른 곳에 글상자를 놓고 오른쪽에서 글을 씁니다. 지시선은 오른쪽 버튼으로 끝을 찍습니다.' },
  card: { label: '카드', group: '글', geo: 'card', help: '오른쪽 카드 목록에서 [놓기]를 누른 뒤 지도에서 놓을 곳을 누릅니다.' },
}

/** 도구 단추·범례 차례 */
export const SYM_ORDER: SynthSym[] = [
  'arrow', 'car', 'walk', 'wind', 'noise', 'view',
  'edge', 'frontage', 'axis', 'buffer', 'line',
  'entry', 'landmark', 'node', 'bolt', 'star', 'dot',
  'zone', 'bubble', 'keepout',
  'note', 'card',
]
export const SYM_GROUPS: SymGroup[] = ['흐름', '선', '점', '면', '글']

export const WEIGHT_LABEL: Record<1 | 2 | 3, string> = { 3: '주', 2: '부', 1: '작은 것' }
export const DASH_LABEL = { solid: '실선', dash: '점선', dot: '점점이' } as const
export const VIEW_SPREADS = [30, 60, 90, 120]
export const BUFFER_WIDTHS = [5, 10, 15, 20, 30]

/** 1판 그림(sym 없음)도 읽는다 */
export function symOf(it: SynthItem): SynthSym {
  if (it.sym) return it.sym
  switch (it.kind) {
    case 'arrow':
      return 'arrow'
    case 'area':
      return 'zone'
    case 'point':
      return it.mark ?? 'dot'
    case 'line':
      return 'line'
    case 'vector':
      return 'view'
    default:
      return it.kind
  }
}

export function symLabel(it: SynthItem): string {
  return SYMS[symOf(it)].label
}

/** 굵기 배율 */
function wOf(it: SynthItem): number {
  const base = it.weight === 3 ? 1.5 : it.weight === 1 ? 0.65 : 1
  // 조건(먹색)은 한 단계 가늘게 — 방향색 해석이 먼저 읽히게
  return it.tone === 'neutral' ? base * 0.88 : base
}

// ───────────────────────── 기하 ─────────────────────────

const f1 = (n: number) => n.toFixed(1)

function pathD(pts: P[], closed = false): string {
  if (!pts.length) return ''
  return `M${pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L')}${closed ? 'Z' : ''}`
}

/** 겹친 점 빼기 */
function clean(pts: P[]): P[] {
  const out: P[] = []
  for (const p of pts) if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > 0.5) out.push(p)
  return out
}

function cum(pts: P[]): number[] {
  const c = [0]
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  return c
}

/** 선 위 거리 s의 점과 진행 방향(단위) */
function at(pts: P[], c: number[], s: number): { p: P; t: P } {
  const L = c[c.length - 1]
  const ss = Math.max(0, Math.min(L, s))
  let i = 0
  while (i < c.length - 2 && c[i + 1] < ss) i++
  const a = pts[i]
  const b = pts[i + 1] ?? pts[i]
  const seg = c[i + 1] - c[i] || 1
  const k = (ss - c[i]) / seg
  const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], t: [(b[0] - a[0]) / tl, (b[1] - a[1]) / tl] }
}

/** 진행 방향의 왼쪽 (화면 좌표, y 아래로) */
const leftOf = (t: P): P => [t[1], -t[0]]

function slice(pts: P[], s0: number, s1: number): P[] {
  const c = cum(pts)
  const out: P[] = [at(pts, c, s0).p]
  for (let i = 1; i < pts.length - 1; i++) if (c[i] > s0 && c[i] < s1) out.push(pts[i])
  out.push(at(pts, c, s1).p)
  return out
}

/** 꺾은선을 옆으로 dist만큼 (+ 왼쪽) — 꺾이는 곳은 맞붙임(지나치게 뾰족하면 줄임) */
function offset(pts: P[], dist: number): P[] {
  const n = pts.length
  const nrm = (a: P, b: P): P => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return leftOf([(b[0] - a[0]) / L, (b[1] - a[1]) / L])
  }
  return pts.map((p, i) => {
    const n1 = i > 0 ? nrm(pts[i - 1], p) : null
    const n2 = i < n - 1 ? nrm(p, pts[i + 1]) : null
    if (!n1 || !n2) {
      const q = (n1 ?? n2)!
      return [p[0] + q[0] * dist, p[1] + q[1] * dist] as P
    }
    let mx = n1[0] + n2[0]
    let my = n1[1] + n2[1]
    const ml = Math.hypot(mx, my)
    if (ml < 1e-6) return [p[0] + n1[0] * dist, p[1] + n1[1] * dist] as P
    mx /= ml
    my /= ml
    const k = Math.min(3, 1 / Math.max(0.2, mx * n1[0] + my * n1[1]))
    return [p[0] + mx * dist * k, p[1] + my * dist * k] as P
  })
}

/** 다각형 안 빗금 (화면 좌표, 기울기 ang°) */
function hatch(poly: P[], spacing: number, ang = -45): [P, P][] {
  if (poly.length < 3) return []
  const a = (ang * Math.PI) / 180
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const r = poly.map(([x, y]) => [x * ca + y * sa, -x * sa + y * ca] as P)
  const vs = r.map((p) => p[1])
  const vmin = Math.min(...vs)
  const vmax = Math.max(...vs)
  const back = (u: number, v: number): P => [u * ca - v * sa, u * sa + v * ca]
  const out: [P, P][] = []
  for (let v = Math.ceil(vmin / spacing) * spacing; v <= vmax && out.length < 4000; v += spacing) {
    const xs: number[] = []
    for (let i = 0; i < r.length; i++) {
      const p = r[i]
      const q = r[(i + 1) % r.length]
      if ((p[1] <= v && q[1] > v) || (q[1] <= v && p[1] > v)) xs.push(p[0] + ((v - p[1]) / (q[1] - p[1])) * (q[0] - p[0]))
    }
    xs.sort((m, n) => m - n)
    for (let k = 0; k + 1 < xs.length; k += 2) out.push([back(xs[k], v), back(xs[k + 1], v)])
  }
  return out
}

const segsD = (segs: [P, P][]) => segs.map(([p, q]) => `M${f1(p[0])} ${f1(p[1])}L${f1(q[0])} ${f1(q[1])}`).join('')

/** 꼭짓점을 지나는 매끈한 닫힌 곡선 (캣멀-롬) */
function smoothClosed(pts: P[]): string {
  const n = pts.length
  if (n < 3) return pathD(pts, true)
  const g = (i: number) => pts[(i + n) % n]
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`
  for (let i = 0; i < n; i++) {
    const p0 = g(i - 1)
    const p1 = g(i)
    const p2 = g(i + 1)
    const p3 = g(i + 2)
    const c1: P = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2: P = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${f1(c1[0])} ${f1(c1[1])} ${f1(c2[0])} ${f1(c2[1])} ${f1(p2[0])} ${f1(p2[1])}`
  }
  return `${d}Z`
}

/** 꺾은선 길이의 가운데 점 */
function midOf(px: P[]): P {
  const c = cum(px)
  return at(px, c, c[c.length - 1] / 2).p
}

// ───────────────────────── 작은 그림 조각 ─────────────────────────

const HALO = 'paint-order="stroke" stroke="#ffffff" stroke-width="4.5" stroke-linejoin="round"'

function label(x: number, y: number, text: string, color: string, size = 16, anchor: 'start' | 'middle' = 'middle', bold = true): string {
  if (!text.trim()) return ''
  const lines = wrap(text.trim(), size, 230).slice(0, 4)
  return lines
    .map(
      (l, i) =>
        `<text x="${f1(x)}" y="${f1(y + i * size * 1.25)}" font-size="${size}" ${bold ? 'font-weight="700"' : ''} text-anchor="${anchor}" fill="${color}" ${HALO}>${esc(l)}</text>`,
    )
    .join('')
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, color: string, size = 18): string {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const p = (da: number, r: number) => `${f1(x2 + Math.cos(a + da) * r)},${f1(y2 + Math.sin(a + da) * r)}`
  return `<polygon points="${f1(x2)},${f1(y2)} ${p(Math.PI - 0.42, size)} ${p(Math.PI + 0.42, size)}" fill="${color}"/>`
}

export function star(x: number, y: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.45 : r
    pts.push(`${f1(x + Math.cos(a) * rr)},${f1(y + Math.sin(a) * rr)}`)
  }
  return pts.join(' ')
}

export function bolt(x: number, y: number, s: number): string {
  const p = [
    [0.15, -1],
    [-0.55, 0.12],
    [-0.05, 0.12],
    [-0.2, 1],
    [0.55, -0.15],
    [0.05, -0.15],
  ]
  return p.map(([a, b]) => `${f1(x + a * s)},${f1(y + b * s)}`).join(' ')
}

function cardBadge(x: number, y: number, id: string, color: string): { svg: string; w: number } {
  const w = textWidth(id, 14) + 16
  return {
    svg: `<rect x="${f1(x - w / 2)}" y="${f1(y - 13)}" width="${f1(w)}" height="26" rx="13" fill="${color}" stroke="#ffffff" stroke-width="2"/><text x="${f1(x)}" y="${f1(y + 5)}" font-size="14" font-weight="700" text-anchor="middle" fill="#ffffff">${esc(id)}</text>`,
    w,
  }
}

/** 편집 화면: 가는 선도 쉽게 고르도록 보이지 않는 넓은 선 */
const hitPath = (d: string) => `<path d="${d}" fill="none" stroke="#000000" stroke-opacity="0" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>`
/** 고른 기호 둘레 */
const selPath = (d: string, color: string, closed = false) =>
  closed
    ? `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="0.28" stroke-width="10" stroke-linejoin="round"/>`
    : `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="0.22" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>`

function dashOf(it: SynthItem, W: number): string {
  if (it.dash === 'dash') return ` stroke-dasharray="${f1(16 * W)} ${f1(10 * W)}"`
  if (it.dash === 'dot') return ` stroke-dasharray="0.1 ${f1(11 * W)}"`
  return ''
}

// ───────────────────────── 기호 하나 ─────────────────────────

function itemBody(it: SynthItem, f: Frame, cards: Record<string, SynthCard>, sel: boolean, hit: boolean): string {
  const sym = symOf(it)
  const color = TONES[it.tone]?.color ?? TONES.neutral.color
  const W = wOf(it)
  const px = clean(it.pts.map(([lo, la]) => f.pt(lo, la)))
  const def = SYMS[sym]

  // ── 꺾은선 (흐름·선)
  if ((def.geo === 'arrow' || def.geo === 'line') && px.length >= 2) {
    const d = pathD(px)
    const pre = (hit ? hitPath(d) : '') + (sel ? selPath(d, color) : '')
    const c = cum(px)
    const L = c[c.length - 1]
    const [mx, my] = midOf(px)
    const lab = (dy: number) => label(mx, my - dy, it.label, color, 16)
    const headAt = (from: P, to: P, size: number) => arrowHead(from[0], from[1], to[0], to[1], color, size)
    const tail = () => [px[px.length - 2], px[px.length - 1]] as const
    const head0 = () => [px[1], px[0]] as const

    if (sym === 'car') {
      const sw = 16 * W
      const H = Math.min(28 * W, L * 0.45)
      const HW = sw * 1.05
      const s0 = it.both ? H : 0
      const shaft = slice(px, s0, Math.max(s0 + 1, L - H))
      const left = offset(shaft, sw / 2)
      const right = offset(shaft, -sw / 2)
      const e = at(px, c, L - H)
      const nE = leftOf(e.t)
      const end = px[px.length - 1]
      const poly: P[] = [...left, [e.p[0] + nE[0] * HW, e.p[1] + nE[1] * HW], end, [e.p[0] - nE[0] * HW, e.p[1] - nE[1] * HW], ...right.reverse()]
      if (it.both) {
        const s = at(px, c, H)
        const nS = leftOf(s.t)
        poly.push([s.p[0] - nS[0] * HW, s.p[1] - nS[1] * HW], px[0], [s.p[0] + nS[0] * HW, s.p[1] + nS[1] * HW])
      }
      return (
        pre +
        `<path d="${pathD(poly, true)}" fill="#ffffff" fill-opacity="0.8" stroke="${color}" stroke-width="${f1(2.6 * Math.sqrt(W))}" stroke-linejoin="round"/>` +
        lab(sw / 2 + 12)
      )
    }

    if (sym === 'walk') {
      const dash = `stroke-dasharray="0.1 ${f1(12 * W)}" stroke-linecap="round" stroke-linejoin="round"`
      const size = 17 * Math.pow(W, 0.7)
      const body = slice(px, it.both ? size * 0.8 : 0, L - size * 0.8)
      const bd = pathD(body)
      return (
        pre +
        `<path d="${bd}" fill="none" stroke="#ffffff" stroke-width="${f1(10.5 * W)}" ${dash}/>` +
        `<path d="${bd}" fill="none" stroke="${color}" stroke-width="${f1(7 * W)}" ${dash}/>` +
        headAt(...tail(), size) +
        (it.both ? headAt(...head0(), size) : '') +
        lab(12)
      )
    }

    if (sym === 'wind') {
      const lam = 36 * Math.sqrt(W)
      const amp = 6.5 * Math.sqrt(W)
      const size = 17 * Math.pow(W, 0.7)
      const wav: P[] = []
      const Lw = Math.max(0, L - size * 0.6)
      for (let s = 0; s <= Lw + 0.01; s += 3) {
        const { p, t } = at(px, c, s)
        const n = leftOf(t)
        const taper = Math.min(1, (Lw - s) / (lam * 0.5))
        const o = amp * Math.sin((2 * Math.PI * s) / lam) * Math.max(0, taper)
        wav.push([p[0] + n[0] * o, p[1] + n[1] * o])
      }
      const wd = pathD(wav)
      return (
        pre +
        `<path d="${wd}" fill="none" stroke="#ffffff" stroke-width="${f1(7 * W)}" stroke-opacity="0.85" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="${wd}" fill="none" stroke="${color}" stroke-width="${f1(3.4 * W)}" stroke-linecap="round" stroke-linejoin="round"/>` +
        headAt(...tail(), size) +
        lab(amp + 12)
      )
    }

    if (sym === 'edge') {
      const sgn = it.flip ? -1 : 1
      const step = 13 * W
      const ticks: [P, P][] = []
      for (let s = step / 2; s < L; s += step) {
        const { p, t } = at(px, c, s)
        const n = leftOf(t)
        ticks.push([p, [p[0] + n[0] * 10 * W * sgn, p[1] + n[1] * 10 * W * sgn]])
      }
      return (
        pre +
        `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="${f1(7.5 * W)}" stroke-opacity="0.85" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="${segsD(ticks)}" fill="none" stroke="${color}" stroke-width="${f1(2.2 * W)}"/>` +
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f1(3.6 * W)}" stroke-linecap="round" stroke-linejoin="round"/>` +
        lab(14 * W + 6)
      )
    }

    if (sym === 'frontage') {
      return (
        pre +
        `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="${f1(15 * W)}" stroke-opacity="0.85" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f1(9 * W)}" stroke-opacity="0.92" stroke-linecap="round" stroke-linejoin="round"/>` +
        lab(9 * W + 8)
      )
    }

    if (sym === 'axis') {
      const dash = `stroke-dasharray="${f1(24 * W)} ${f1(8 * W)} ${f1(5 * W)} ${f1(8 * W)}"`
      return (
        pre +
        `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="${f1(7.5 * W)}" stroke-opacity="0.85" stroke-linejoin="round" ${dash}/>` +
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f1(3.6 * W)}" stroke-linejoin="round" ${dash}/>` +
        lab(12)
      )
    }

    if (sym === 'buffer') {
      const wpx = Math.max(10, (it.spread ?? 15) * f.s)
      const left = offset(px, wpx / 2)
      const right = offset(px, -wpx / 2)
      const poly = [...left, ...[...right].reverse()]
      return (
        (hit ? `<path d="${pathD(poly, true)}" fill="#000000" fill-opacity="0"/>` : '') +
        pre +
        `<path d="${pathD(poly, true)}" fill="#ffffff" fill-opacity="0.55" stroke="none"/>` +
        `<path d="${pathD(poly, true)}" fill="${color}" fill-opacity="0.08" stroke="none"/>` +
        `<path d="${segsD(hatch(poly, Math.max(5, Math.min(9, wpx * 0.6))))}" fill="none" stroke="${color}" stroke-width="1.3" stroke-opacity="0.8"/>` +
        `<path d="${pathD(left)}${pathD(right)}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round"/>` +
        lab(wpx / 2 + 12)
      )
    }

    // 화살표·선 (1판 화살표 포함) — 선 모양을 고를 수 있음
    const dash = dashOf(it, W)
    const arrow = sym === 'arrow'
    const size = 18 * Math.pow(W, 0.7)
    return (
      pre +
      `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="${f1((sel ? 11 : 9) * W)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.8"${dash}/>` +
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f1((sel ? 7 : 5) * W)}" stroke-linecap="round" stroke-linejoin="round"${dash}/>` +
      (arrow ? headAt(...tail(), size) + (it.both ? headAt(...head0(), size) : '') : '') +
      lab(12)
    )
  }

  // ── 두 점 (기준점 → 방향)
  if (def.geo === 'vector' && px.length >= 2) {
    const [S, T] = px
    const dx = T[0] - S[0]
    const dy = T[1] - S[1]
    const D = Math.max(24, Math.hypot(dx, dy))
    const th = Math.atan2(dy, dx)
    const u: P = [Math.cos(th), Math.sin(th)]
    const ray = (r: number, a: number): P => [S[0] + Math.cos(a) * r, S[1] + Math.sin(a) * r]
    const dl = pathD([S, T])
    const pre = (hit ? hitPath(dl) : '') + (sel ? selPath(dl, color) : '')
    const tip: P = [S[0] + u[0] * D, S[1] + u[1] * D]
    const labEnd = label(tip[0] + u[0] * 16 + (u[0] >= 0 ? 4 : -4), tip[1] + u[1] * 16 + 5, it.label, color, 15, 'middle')

    if (sym === 'noise') {
      const al = (38 * Math.PI) / 180
      const arcs = [0.38, 0.68, 1]
        .map((k) => {
          const r = D * k
          const a = ray(r, th - al)
          const b = ray(r, th + al)
          return `M${f1(a[0])} ${f1(a[1])}A${f1(r)} ${f1(r)} 0 0 1 ${f1(b[0])} ${f1(b[1])}`
        })
        .join('')
      return (
        pre +
        `<path d="${arcs}" fill="none" stroke="#ffffff" stroke-width="${f1(7 * W)}" stroke-opacity="0.85" stroke-linecap="round"/>` +
        `<path d="${arcs}" fill="none" stroke="${color}" stroke-width="${f1(3.4 * W)}" stroke-linecap="round"/>` +
        `<circle cx="${f1(S[0])}" cy="${f1(S[1])}" r="${f1(6 * Math.sqrt(W))}" fill="${color}" stroke="#ffffff" stroke-width="2"/>` +
        labEnd
      )
    }

    if (sym === 'view') {
      const h = (((it.spread ?? 60) / 2) * Math.PI) / 180
      const a = ray(D, th - h)
      const b = ray(D, th + h)
      const large = h * 2 > Math.PI ? 1 : 0
      const arc = `M${f1(a[0])} ${f1(a[1])}A${f1(D)} ${f1(D)} 0 ${large} 1 ${f1(b[0])} ${f1(b[1])}`
      const wedge = `M${f1(S[0])} ${f1(S[1])}L${f1(a[0])} ${f1(a[1])}A${f1(D)} ${f1(D)} 0 ${large} 1 ${f1(b[0])} ${f1(b[1])}Z`
      return (
        (hit ? `<path d="${wedge}" fill="#000000" fill-opacity="0"/>` : '') +
        pre +
        `<path d="${wedge}" fill="${color}" fill-opacity="0.1"/>` +
        `<path d="M${f1(a[0])} ${f1(a[1])}L${f1(S[0])} ${f1(S[1])}L${f1(b[0])} ${f1(b[1])}" fill="none" stroke="${color}" stroke-width="${f1(2.4 * W)}" stroke-dasharray="9 6" stroke-linejoin="round"/>` +
        `<path d="${arc}" fill="none" stroke="${color}" stroke-width="${f1(2.4 * W)}"/>` +
        `<circle cx="${f1(S[0])}" cy="${f1(S[1])}" r="7" fill="${color}" stroke="#ffffff" stroke-width="2.5"/>` +
        labEnd
      )
    }

    // 입구: 끝이 입구 자리(S)에 닿는 삼각 표식 + 문턱 선, T 쪽으로 들어감
    const s = 22 * Math.pow(W, 0.7)
    const n = leftOf(u)
    const B: P = [S[0] - u[0] * s, S[1] - u[1] * s]
    const tri = [S, [B[0] + n[0] * s * 0.62, B[1] + n[1] * s * 0.62], [B[0] - n[0] * s * 0.62, B[1] - n[1] * s * 0.62]] as P[]
    const bar = [
      [S[0] + n[0] * s * 0.8, S[1] + n[1] * s * 0.8],
      [S[0] - n[0] * s * 0.8, S[1] - n[1] * s * 0.8],
    ] as P[]
    const hd = pathD([B, S])
    return (
      (hit ? hitPath(hd) : '') +
      (sel ? selPath(hd, color) : '') +
      `<path d="${pathD(bar)}" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/><path d="${pathD(bar)}" stroke="${color}" stroke-width="3.5" stroke-linecap="round"/>` +
      `<polygon points="${tri.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ')}" fill="${color}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>` +
      label(B[0] - u[0] * 14, B[1] - u[1] * 14 + 5, it.label, color, 15, 'middle')
    )
  }

  // ── 면
  if (def.geo === 'area' && px.length >= 3) {
    const d = pathD(px, true)
    const cx = px.reduce((sum, p) => sum + p[0], 0) / px.length
    const cy = px.reduce((sum, p) => sum + p[1], 0) / px.length
    const lab = label(cx, cy, it.label, color, 17)
    if (sym === 'bubble') {
      const sd = smoothClosed(px)
      return (sel ? selPath(sd, color, true) : '') + `<path d="${sd}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="2.5"/>` + lab
    }
    if (sym === 'keepout') {
      return (
        (sel ? selPath(d, color, true) : '') +
        `<path d="${d}" fill="${color}" fill-opacity="0.06"/>` +
        `<path d="${segsD(hatch(px, 11))}" fill="none" stroke="${color}" stroke-width="1.6" stroke-opacity="0.75"/>` +
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linejoin="round"/>` +
        lab
      )
    }
    return (sel ? selPath(d, color, true) : '') + `<path d="${d}" fill="${color}" fill-opacity="0.16" stroke="${color}" stroke-width="${sel ? 4 : 2.5}" stroke-dasharray="10 6" stroke-linejoin="round"/>` + lab
  }

  // ── 점
  if (def.geo === 'point' && px.length) {
    const [x, y] = px[0]
    const shape =
      sym === 'star'
        ? `<polygon points="${star(x, y, 15)}" fill="${color}" stroke="#ffffff" stroke-width="2"/>`
        : sym === 'bolt'
          ? `<polygon points="${bolt(x, y, 17)}" fill="${color}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/>`
          : sym === 'landmark'
            ? `<polygon points="${f1(x)},${f1(y - 18)} ${f1(x + 15.5)},${f1(y + 9)} ${f1(x - 15.5)},${f1(y + 9)}" fill="${color}" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/>`
            : sym === 'node'
              ? `<circle cx="${f1(x)}" cy="${f1(y)}" r="13" fill="#ffffff" stroke="${color}" stroke-width="3.5"/><circle cx="${f1(x)}" cy="${f1(y)}" r="5.5" fill="${color}"/>`
              : `<circle cx="${f1(x)}" cy="${f1(y)}" r="10" fill="${color}" stroke="#ffffff" stroke-width="2.5"/>`
    return (
      (hit ? `<circle cx="${f1(x)}" cy="${f1(y)}" r="22" fill="#000000" fill-opacity="0"/>` : '') +
      (sel ? `<circle cx="${f1(x)}" cy="${f1(y)}" r="22" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4 3"/>` : '') +
      shape +
      label(x + 20, y + 5, it.label, color, 15, 'start')
    )
  }

  // ── 카드
  if (def.geo === 'card' && px.length) {
    const [x, y] = px[0]
    const card = it.cardId ? cards[it.cardId] : undefined
    const badge = cardBadge(x, y, it.cardId ?? '?', color)
    const text = it.label.trim() || card?.title || '(지운 카드)'
    return (
      (sel ? `<rect x="${f1(x - badge.w / 2 - 5)}" y="${f1(y - 18)}" width="${f1(badge.w + 10)}" height="36" rx="18" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4 3"/>` : '') +
      badge.svg +
      label(x + badge.w / 2 + 6, y + 5, text, mix('#000000', color, 0.8), 15, 'start')
    )
  }

  // ── 글상자
  if (def.geo === 'note' && px.length) {
    const [x, y] = px[0]
    const lines = wrap(it.label.trim() || '메모', 15, 230).slice(0, 6)
    const w = Math.max(60, ...lines.map((l) => textWidth(l, 15))) + 18
    const h = lines.length * 19 + 14
    let leader = ''
    if (px[1]) {
      const [tx, ty] = px[1]
      // 상자 가장자리에서 시작
      const cx = Math.min(Math.max(tx, x), x + w)
      const cy = Math.min(Math.max(ty, y), y + h)
      leader = `<line x1="${f1(cx)}" y1="${f1(cy)}" x2="${f1(tx)}" y2="${f1(ty)}" stroke="${color}" stroke-width="2"/><circle cx="${f1(tx)}" cy="${f1(ty)}" r="4.5" fill="${color}"/>`
    }
    return (
      leader +
      `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${h}" rx="4" fill="#ffffff" fill-opacity="0.94" stroke="${color}" stroke-width="${sel ? 3.5 : 2}"/>` +
      lines.map((l, i) => `<text x="${f1(x + 9)}" y="${f1(y + 22 + i * 19)}" font-size="15" fill="${mix('#000000', color, 0.75)}">${esc(l)}</text>`).join('')
    )
  }
  return ''
}

/** 그리는 차례: 면 → 선 → 흐름 → 점·카드 → 글상자 (글이 위에 오게) */
const LAYER: Record<SymGroup, number> = { 면: 0, 선: 1, 흐름: 2, 점: 3, 글: 4 }

/** 기호들 (편집 화면과 완성 도판이 함께 씀) — 기호마다 data-id */
export function synthItemsSvg(items: SynthItem[], f: Frame, cards: Record<string, SynthCard>, selectedId: string | null = null, hit = false): string {
  const order = (it: SynthItem) => {
    const sym = symOf(it)
    return sym === 'note' ? 5 : sym === 'card' ? 4 : LAYER[SYMS[sym].group]
  }
  return items
    .map((it, i) => ({ it, i, o: order(it) }))
    .sort((a, b) => a.o - b.o || a.i - b.i)
    .map(({ it }) => {
      const body = itemBody(it, f, cards, it.id === selectedId, hit)
      // 조건(먹색)은 조금 옅게
      return body ? `<g data-id="${esc(it.id)}"${it.tone === 'neutral' && it.kind !== 'note' ? ' opacity="0.9"' : ''}>${body}</g>` : ''
    })
    .join('')
}

// ───────────────────────── 범례·단추 그림 (26×18) ─────────────────────────

export const GLYPH_W = 26
export const GLYPH_H = 18

export function symGlyph(sym: SynthSym, c: string): string {
  switch (sym) {
    case 'arrow':
      return `<path d="M2 9H17" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/><polygon points="25,9 16,4.5 16,13.5" fill="${c}"/>`
    case 'car':
      return `<polygon points="1.5,6 15,6 15,2.5 24.5,9 15,15.5 15,12 1.5,12" fill="#ffffff" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/>`
    case 'walk':
      return `<path d="M3 9H15" stroke="${c}" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="0.1 4.8"/><polygon points="25,9 17,4.5 17,13.5" fill="${c}"/>`
    case 'wind':
      return `<path d="M1.5 9q3-5 6 0t6 0t4 0" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/><polygon points="25,9 17,4.5 17,13.5" fill="${c}"/>`
    case 'noise':
      return `<circle cx="4" cy="9" r="2.4" fill="${c}"/><path d="M9.5 5a5 5 0 0 1 0 8M14 2.5a8.5 8.5 0 0 1 0 13M19 0.8a11 11 0 0 1 0 16.4" fill="none" stroke="${c}" stroke-width="1.7" stroke-linecap="round"/>`
    case 'view':
      return `<path d="M3 9L24 2.5A22 22 0 0 1 24 15.5Z" fill="${c}" fill-opacity="0.14"/><path d="M24 2.5L3 9L24 15.5" fill="none" stroke="${c}" stroke-width="1.4" stroke-dasharray="3 2"/><path d="M24 2.5A22 22 0 0 1 24 15.5" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="3.5" cy="9" r="2.6" fill="${c}"/>`
    case 'entry':
      return `<polygon points="17,9 6,2.5 6,15.5" fill="${c}"/><path d="M19.5 2V16" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`
    case 'edge':
      return `<path d="M3.5 7v5.5M8.5 7v5.5M13.5 7v5.5M18.5 7v5.5M23.5 7v5.5" stroke="${c}" stroke-width="1.4"/><path d="M1 7H25" stroke="${c}" stroke-width="2.2"/>`
    case 'frontage':
      return `<path d="M4 9H22" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`
    case 'axis':
      return `<path d="M1 9H25" stroke="${c}" stroke-width="2" stroke-dasharray="7 2.5 1.5 2.5"/>`
    case 'buffer':
      return `<path d="M3 14.5l7-11M9 14.5l7-11M15 14.5l7-11" stroke="${c}" stroke-width="0.9"/><path d="M1 3.5H25M1 14.5H25" stroke="${c}" stroke-width="1.6"/>`
    case 'line':
      return `<path d="M2.5 9H23.5" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`
    case 'dot':
      return `<circle cx="13" cy="9" r="5.5" fill="${c}"/>`
    case 'star':
      return `<polygon points="${star(13, 9.5, 8.5)}" fill="${c}"/>`
    case 'bolt':
      return `<polygon points="${bolt(13, 9, 8.5)}" fill="${c}"/>`
    case 'landmark':
      return `<polygon points="13,1.5 21,15.5 5,15.5" fill="${c}"/>`
    case 'node':
      return `<circle cx="13" cy="9" r="6.8" fill="#ffffff" stroke="${c}" stroke-width="2"/><circle cx="13" cy="9" r="2.8" fill="${c}"/>`
    case 'zone':
      return `<rect x="2" y="2.5" width="22" height="13" fill="${c}" fill-opacity="0.14" stroke="${c}" stroke-width="1.6" stroke-dasharray="4 2.5"/>`
    case 'bubble':
      return `<ellipse cx="13" cy="9" rx="11.5" ry="7" fill="${c}" fill-opacity="0.22" stroke="${c}" stroke-width="1.5"/>`
    case 'keepout':
      return `<path d="M2 9.5l7-7M2 15.5l13-13M8 15.5l13-13M14 15.5l10-10M20 15.5l4-4" stroke="${c}" stroke-width="0.9"/><rect x="2" y="2.5" width="22" height="13" fill="none" stroke="${c}" stroke-width="1.5"/>`
    case 'note':
      return `<rect x="2" y="2.5" width="22" height="13" rx="2" fill="#ffffff" stroke="${c}" stroke-width="1.4"/><path d="M5.5 7H20M5.5 11H15" stroke="${c}" stroke-width="1.2"/>`
    case 'card':
      return `<rect x="1.5" y="3" width="23" height="12" rx="6" fill="${c}"/><path d="M7 9H19" stroke="#ffffff" stroke-width="1.6"/>`
  }
}

/** 굵기 = 중요도 범례 */
export function weightGlyph(c: string): string {
  return `<path d="M1 3H25" stroke="${c}" stroke-width="1"/><path d="M1 8.5H25" stroke="${c}" stroke-width="2.2"/><path d="M1 15H25" stroke="${c}" stroke-width="3.8"/>`
}
