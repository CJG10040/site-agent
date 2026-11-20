// 테마색으로 도판 색 묶음 전체를 만든다.
// 사람 눈에 고르게 보이는 OKLCH(밝기·채도·색상)에서 짜고, sRGB 밖이면 채도를 줄여 맞춘다.
//
// 새 방식 (2026-11-20 사용자 요청 '테마색 + 포인트색'): spec.point가 있으면 pointPalette()
// - 테마색 = 단계색(옅음 → 진함)과 바탕·글자의 아주 옅은 기운. 포인트색 = 대지 강조와 양쪽 단계색의 한쪽 끝
// - 범주색 8칸은 뜻(0 노랑·1 주황·2 빨강·3 파랑·4 청록·5 보라·6 회색·7 갈색)을 지키며 두 색 쪽으로 조금 기울이고,
//   테마색·포인트색과 가장 가까운 칸에는 그 색을 그대로 넣음. 이웃 칸은 보통 눈 ΔE ≥ 15, 적·녹 색약 ΔE ≥ 6이 되도록 밝기를 조정
// - 추천 짝(THEME_PAIRS)은 위 규칙으로 만든 묶음이 검증을 통과하는 짝만 둠
//
// 예전 방식 (2026-11-12): point가 없는 저장된 테마는 그대로 보이게 legacyPalette()로 짬
// - 단계색: 테마색의 밝은 쪽 → 진한 쪽 / 범주색: 유사색·보색·세 색으로 색상을 돌림 / 강조색: 보색 쪽
// - 물·녹지는 뜻을 지키려고 파랑·초록 색상을 유지하고 밝기만 맞춤 (두 방식 모두)

import type { ThemeSpec } from '../model/types'
import type { Palette } from './palette'

type Lch = [number, number, number]

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

export function hexToOklch(hex: string): Lch {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => toLin(parseInt(h.slice(i, i + 2), 16) / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.hypot(A, B)
  const H = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360
  return [L, C, H]
}

function lchToRgb([L, C, H]: Lch): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180)
  const b = C * Math.sin((H * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
}

/** OKLCH → #rrggbb (sRGB 밖이면 채도를 줄임) */
export function oklchToHex(L: number, C: number, H: number): string {
  let c = Math.max(0, C)
  let rgb = lchToRgb([L, c, H])
  for (let i = 0; i < 40 && rgb.some((v) => v < -0.0005 || v > 1.0005); i++) {
    c *= 0.9
    rgb = lchToRgb([L, c, H])
  }
  return `#${rgb.map((v) => Math.round(Math.max(0, Math.min(1, fromLin(Math.max(0, v)))) * 255).toString(16).padStart(2, '0')).join('')}`
}

const HARMONY: Record<ThemeSpec['harmony'], number[]> = {
  analog: [0, 30, -30, 60, -60, 90, 0, -90],
  complement: [0, 180, 30, 210, -30, 150, 0, 200],
  triad: [0, 120, 240, 30, 150, 270, 0, 60],
}

export const HARMONY_LABEL: Record<ThemeSpec['harmony'], string> = { analog: '유사색', complement: '보색', triad: '세 색' }
export const TONE_LABEL: Record<ThemeSpec['tone'], string> = { light: '밝게', pastel: '파스텔', dark: '어둡게' }

/** 따뜻한 정도 (주황 쪽 1, 파랑 쪽 −1) */
const warmth = (h: number) => Math.cos(((h - 50) * Math.PI) / 180)

/** 예전 방식 (포인트색 없이 테마색 하나 + 조합) */
function legacyPalette(spec: ThemeSpec): Palette {
  const [, C0raw, h0] = hexToOklch(/^#[0-9a-f]{6}$/i.test(spec.color) ? spec.color : '#4b6f8c')
  const C0 = Math.max(0.005, C0raw)
  // 채도 배율: 회색에 가까운 테마는 단계색도 차분하게
  const k = Math.max(0.25, Math.min(1.3, C0 / 0.12))
  const v = Math.max(0, Math.floor(spec.variant || 0))
  const dark = spec.tone === 'dark'
  const pastel = spec.tone === 'pastel'
  const hc = (h0 + 180) % 360
  const [hot, cold] = warmth(h0) >= warmth(hc) ? [h0, hc] : [hc, h0]
  const H = (d: number) => (((h0 + d) % 360) + 360) % 360
  const X = oklchToHex

  // 범주색: '다른 조합'마다 시작 순서를 돌림 (회색 자리 6은 그대로)
  const offs = HARMONY[spec.harmony] ?? HARMONY.complement
  const colored = offs.filter((_, i) => i !== 6)
  const rot = colored.map((_, i) => colored[(i + v) % colored.length])
  const catL = dark ? [0.8, 0.7, 0.76, 0.66, 0.84, 0.72, 0.6, 0.74] : pastel ? [0.86, 0.8, 0.84, 0.78, 0.88, 0.82, 0.78, 0.8] : [0.72, 0.6, 0.67, 0.56, 0.76, 0.63, 0.62, 0.58]
  const catC = pastel ? 0.075 : Math.max(0.1, Math.min(0.15, 0.13 * Math.max(k, 0.8)))
  let ri = 0
  const cat = catL.map((L, i) => (i === 6 ? X(L, 0.012, h0) : X(L, catC, H(rot[ri++]))))

  // 강조색: 보색 근처, '다른 조합'마다 ±30° 흔듦
  const ha = (hc + ((v % 3) - 1) * 30 + 360) % 360

  const seqL = dark ? [0.3, 0.42, 0.57, 0.73, 0.9] : pastel ? [0.93, 0.86, 0.77, 0.66, 0.52] : [0.96, 0.84, 0.68, 0.52, 0.36]
  const seqC = (dark ? [0.03, 0.07, 0.1, 0.11, 0.08] : pastel ? [0.035, 0.06, 0.08, 0.095, 0.1] : [0.025, 0.06, 0.1, 0.12, 0.11]).map((c) => c * k)
  const seq = seqL.map((L, i) => X(L, seqC[i], h0))

  const div = dark
    ? [X(0.75, 0.12, cold), X(0.48, 0.08, cold), X(0.34, 0.015, h0), X(0.52, 0.1, hot), X(0.78, 0.15, hot)]
    : pastel
      ? [X(0.62, 0.09, cold), X(0.82, 0.05, cold), X(0.96, 0.008, h0), X(0.84, 0.06, hot), X(0.66, 0.11, hot)]
      : [X(0.45, 0.12, cold), X(0.75, 0.07, cold), X(0.95, 0.01, h0), X(0.76, 0.09, hot), X(0.55, 0.15, hot)]

  const tint = Math.min(0.014, 0.012 * k)
  const p: Palette = {
    id: 'theme',
    label: `테마색 ${spec.color}`,
    group: '테마색',
    kind: 'color',
    dark,
    custom: true,
    paper: dark ? X(0.2, 0.025 * k, h0) : pastel ? X(0.985, Math.min(0.01, tint), h0) : X(0.982, tint * 0.7, h0),
    ink: dark ? X(0.94, 0.01, h0) : X(0.26, 0.025, h0),
    subtle: dark ? X(0.72, 0.02, h0) : X(0.53, 0.02, h0),
    base: dark ? X(0.34, 0.018, h0) : pastel ? X(0.91, 0.012, h0) : X(0.88, 0.012, h0),
    unknown: dark ? X(0.4, 0.01, h0) : pastel ? X(0.85, 0.008, h0) : X(0.81, 0.008, h0),
    water: dark ? X(0.42, 0.07, 235) : pastel ? X(0.84, 0.05, 235) : X(0.78, 0.07, 235),
    green: dark ? X(0.45, 0.07, 145) : pastel ? X(0.87, 0.06, 145) : X(0.82, 0.08, 145),
    accent: dark ? X(0.76, 0.16, ha) : pastel ? X(0.64, 0.16, ha) : X(0.58, 0.19, ha),
    cat,
    seq,
    div,
  }
  return p
}

// ───────────────────────── 새 방식: 테마색 + 포인트색 ─────────────────────────

const HEX_RE = /^#[0-9a-f]{6}$/i

export function themePalette(spec: ThemeSpec): Palette {
  return spec.point && HEX_RE.test(spec.point) ? pointPalette(spec) : legacyPalette(spec)
}

/** 추천 짝: 테마색(단계·바탕) + 포인트색(대지·강조). 모두 밝게·파스텔·어둡게에서 검증 통과 */
export const THEME_PAIRS: { name: string; color: string; point: string }[] = [
  { name: '먹 + 레드라인', color: '#3f4046', point: '#d42a1e' },
  { name: '남색 + 주황', color: '#2f4b7c', point: '#e8713a' },
  { name: '청록 + 산호', color: '#1f7a7a', point: '#ec6a50' },
  { name: '세이지 + 테라코타', color: '#6f8f72', point: '#c4673f' },
  { name: '슬레이트 + 머스터드', color: '#4f6d8f', point: '#d4a017' },
  { name: '숲 + 금빛', color: '#2f5d4a', point: '#e0a83c' },
  { name: '와인 + 민트', color: '#7a2e4a', point: '#2fb39a' },
  { name: '올리브 + 버밀리언', color: '#6b7a3a', point: '#d9482b' },
  { name: '라벤더 + 올리브', color: '#6f63a8', point: '#8f9a2c' },
  { name: '모래 + 남청', color: '#a88a5a', point: '#1f4e79' },
  { name: '회청 + 분홍', color: '#557587', point: '#e0607e' },
  { name: '갈색 + 하늘', color: '#7a5236', point: '#3a9ad9' },
]

// 색 거리 (OKLab ×100)와 적·녹 색약 흉내 (Machado 2009, 강도 1.0 — dataviz 검증 스크립트와 같은 모형)
const M_PROT = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281, 0.099216],
  [-0.003882, -0.048116, 1.051998],
]
const M_DEUT = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
]
function linRgb(hex: string): number[] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => toLin(parseInt(h.slice(i, i + 2), 16) / 255))
}
function labOf(v: number[]): [number, number, number] {
  const [rr, gg, bb] = v.map((x) => Math.max(0, x))
  const l = Math.cbrt(0.4122214708 * rr + 0.5363325363 * gg + 0.0514459929 * bb)
  const m = Math.cbrt(0.2119034982 * rr + 0.6806995451 * gg + 0.1073969566 * bb)
  const s = Math.cbrt(0.0883024619 * rr + 0.2817188376 * gg + 0.6299787005 * bb)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
const applyM = (M: number[][], v: number[]) => M.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2])
const dist = (a: number[], b: number[]) => 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
export function deNormal(a: string, b: string): number {
  return dist(labOf(linRgb(a)), labOf(linRgb(b)))
}
export function deCvd(a: string, b: string): number {
  const A = linRgb(a)
  const B = linRgb(b)
  return Math.min(dist(labOf(applyM(M_PROT, A)), labOf(applyM(M_PROT, B))), dist(labOf(applyM(M_DEUT, A)), labOf(applyM(M_DEUT, B))))
}
export function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = linRgb(h)
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** 원 위에서 a를 b 쪽으로 t만큼 */
function towardHue(a: number, b: number, t: number): number {
  const d = ((b - a + 540) % 360) - 180
  return (a + d * t + 360) % 360
}
const hueGap = (a: number, b: number) => Math.abs(((b - a + 540) % 360) - 180)

/** 범주색 칸의 뜻(색상)과 밝기 자리 — 이웃 칸은 밝기를 번갈아 둬서 구분을 돕는다 */
const SLOT_H = [85, 52, 18, 255, 185, 305, 0, 62]
const SLOT_L: Record<ThemeSpec['tone'], number[]> = {
  light: [0.8, 0.66, 0.54, 0.54, 0.66, 0.52, 0.74, 0.47],
  pastel: [0.9, 0.76, 0.66, 0.68, 0.83, 0.65, 0.86, 0.6],
  dark: [0.86, 0.72, 0.6, 0.68, 0.82, 0.66, 0.55, 0.78],
}
const SLOT_C: Record<ThemeSpec['tone'], number> = { light: 0.13, pastel: 0.085, dark: 0.12 }

/** 이웃 칸 구분이 모자라면 칸의 밝기·채도·색상을 조금씩 움직임.
 *  먼저 고정 칸(테마색·포인트색)이 아닌 쪽을, 그래도 안 되면 고정 칸도 밝기만(색상은 그대로) 움직임. 회색 칸(6)은 그대로 */
function separate(cat: string[], fixed: Set<number>, needN = 15.5, needC = 6.5): string[] {
  const out = [...cat]
  const ok = (a: string, b: string) => deNormal(a, b) >= needN && deCvd(a, b) >= needC
  const search = (i: number, cands: number[], hueSteps: number[], fixedCost: number) => {
    let best: { cost: number; j: number; c: string } | null = null
    for (const j of cands) {
      const [L0, C0, H0] = hexToOklch(out[j])
      const other = j === i ? out[i + 1] : out[i]
      const far = j === i ? out[i - 1] : out[j + 1]
      for (let dl = -0.2; dl <= 0.2001; dl += 0.02) {
        for (const kc of [0.8, 0.9, 1, 1.15, 1.3]) {
          for (const dh of hueSteps) {
            const c = oklchToHex(Math.min(0.95, Math.max(0.3, L0 + dl)), C0 * kc, (H0 + dh + 360) % 360)
            if (!ok(c, other) || (far !== undefined && !ok(c, far))) continue
            const cost = Math.abs(dl) * 3 + Math.abs(kc - 1) + Math.abs(dh) / 20 + (fixed.has(j) ? fixedCost : 0)
            if (!best || cost < best.cost) best = { cost, j, c }
          }
        }
      }
    }
    return best
  }
  for (let pass = 0; pass < 5; pass++) {
    let changed = false
    for (let i = 0; i < out.length - 1; i++) {
      if (ok(out[i], out[i + 1])) continue
      const free = [i + 1, i].filter((j) => !fixed.has(j) && j !== 6)
      let best = search(i, free, [-10, 0, 10], 0)
      if (!best) best = search(i, [i + 1, i].filter((j) => fixed.has(j)), [0], 1)
      if (best) {
        out[best.j] = best.c
        changed = true
      }
    }
    if (!changed) break
  }
  return out
}

export function pointPalette(spec: ThemeSpec): Palette {
  const theme = HEX_RE.test(spec.color) ? spec.color : '#3f4046'
  const point = spec.point && HEX_RE.test(spec.point) ? spec.point : '#d42a1e'
  const [, Ct, ht] = hexToOklch(theme)
  const [Lp, Cp, hp] = hexToOklch(point)
  const tone = spec.tone
  const dark = tone === 'dark'
  const pastel = tone === 'pastel'
  const X = oklchToHex
  // 테마색의 채도 배율: 회색에 가까운 테마는 단계색도 차분하게 (먹 + 레드라인 같은 무채색 테마도 단계가 보이게 바닥을 둠)
  const k = Math.max(0.35, Math.min(1.3, Ct / 0.11))

  const paper = dark ? X(0.2, 0.018 * k, ht) : pastel ? X(0.985, 0.009, ht) : X(0.99, 0.004, ht)
  const base = dark ? X(0.3, 0.01, ht) : pastel ? X(0.86, 0.006, ht) : X(0.87, 0.005, ht)

  // 단계색: 테마색 한 색상, 옅음 → 진함 (어두운 바탕이면 어둠 → 밝음)
  const seqL = dark ? [0.4, 0.51, 0.63, 0.75, 0.87] : pastel ? [0.93, 0.84, 0.75, 0.64, 0.51] : [0.93, 0.8, 0.66, 0.51, 0.36]
  const seqC = (dark ? [0.05, 0.075, 0.1, 0.11, 0.09] : pastel ? [0.045, 0.06, 0.075, 0.09, 0.09] : [0.045, 0.07, 0.1, 0.11, 0.1]).map((c) => c * Math.max(k, 0.6))
  const seq = seqL.map((L, i) => X(L, seqC[i], ht))

  // 대지 강조 = 포인트색 (종이 위 대비 3:1이 되도록 밝기만 조정)
  const pc = Math.max(Cp, 0.1)
  let accent = X(dark ? Math.max(0.7, Lp) : Math.min(0.62, Math.max(0.45, Lp)), pc, hp)
  for (let i = 0; i < 12 && contrast(accent, paper) < 3; i++) {
    const [L] = hexToOklch(accent)
    accent = X(dark ? L + 0.03 : L - 0.03, pc, hp)
  }

  // 양쪽 단계색: 따뜻한 쪽 = 더위·빠름. 두 색의 색상이 가까우면 테마색과 그 반대색
  let [hot, cold] = warmth(hp) >= warmth(ht) ? [hp, ht] : [ht, hp]
  if (hueGap(hp, ht) < 60) [hot, cold] = warmth(ht) >= 0 ? [ht, (ht + 180) % 360] : [(ht + 180) % 360, ht]
  const div = dark
    ? [X(0.75, 0.12, cold), X(0.48, 0.07, cold), X(0.34, 0.01, ht), X(0.52, 0.09, hot), X(0.78, 0.15, hot)]
    : pastel
      ? [X(0.62, 0.09, cold), X(0.8, 0.05, cold), X(0.96, 0.008, ht), X(0.82, 0.06, hot), X(0.64, 0.11, hot)]
      : [X(0.46, 0.12, cold), X(0.74, 0.07, cold), X(0.95, 0.008, ht), X(0.76, 0.09, hot), X(0.55, 0.15, hot)]

  // 범주색: 뜻을 지킨 칸 색상을 두 색 쪽으로 조금 기울이고, 가장 가까운 칸에 테마색·포인트색을 넣음
  const Ls = SLOT_L[tone]
  const Cs = SLOT_C[tone]
  const cat = SLOT_H.map((h, i) => {
    if (i === 6) return X(Ls[i], 0.012, ht)
    const pulled = towardHue(towardHue(h, ht, 0.12), hp, 0.08)
    return X(Ls[i], i === 7 ? Cs * 0.65 : Cs, pulled)
  })
  const nearest = (h: number, skip: number) => SLOT_H.map((s, i) => ({ i, g: i === 6 || i === skip ? 999 : hueGap(s, h) })).sort((a, b) => a.g - b.g)[0]
  const fixed = new Set<number>()
  const tSlot = Ct > 0.04 ? nearest(ht, -1) : null
  const tUsed = !!tSlot && tSlot.g < 45
  if (tSlot && tUsed) {
    cat[tSlot.i] = X(Ls[tSlot.i], Math.max(Ct, Cs * 0.8), ht)
    fixed.add(tSlot.i)
  }
  const pSlot = nearest(hp, tUsed && tSlot ? tSlot.i : -1)
  if (pSlot.g < 45) {
    cat[pSlot.i] = X(Ls[pSlot.i], Math.max(Cp, Cs), hp)
    fixed.add(pSlot.i)
  }

  return {
    id: 'theme',
    label: `테마색 ${theme} + 포인트색 ${point}`,
    group: '테마색',
    kind: 'color',
    dark,
    custom: true,
    paper,
    ink: dark ? X(0.94, 0.01, ht) : X(0.24, 0.02, ht),
    subtle: dark ? X(0.72, 0.015, ht) : X(0.5, 0.015, ht),
    base,
    unknown: dark ? X(0.42, 0.008, ht) : X(0.8, 0.006, ht),
    water: dark ? X(0.42, 0.07, 235) : pastel ? X(0.84, 0.05, 235) : X(0.78, 0.07, 235),
    green: dark ? X(0.45, 0.07, 145) : pastel ? X(0.87, 0.06, 145) : X(0.82, 0.08, 145),
    accent,
    cat: separate(cat, fixed),
    seq,
    div,
  }
}
