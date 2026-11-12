// 테마색 하나로 도판 색 묶음 전체를 만든다 (2026-11-12 사용자 요청: "테마색을 골라 테마색별로 색 조합").
// 사람 눈에 고르게 보이는 OKLCH(밝기·채도·색상)에서 짜고, sRGB 밖이면 채도를 줄여 맞춘다.
// - 단계색: 테마색의 밝은 쪽 → 진한 쪽 (어두운 바탕이면 반대로 어둠 → 밝음)
// - 범주색: 테마색에서 출발해 유사색(±30°씩)·보색(180°)·세 색(120°)으로 색상을 돌림, 7번째는 회색
// - 양쪽 단계색: 테마색과 보색 중 따뜻한 쪽을 '뜨거움'(더위·빠름) 쪽에
// - 강조색(대지): 보색 쪽 진한 색 — 대지가 도판에서 하나만 튀게
// - 물·녹지는 뜻을 지키려고 파랑·초록 색상을 유지하고 밝기만 맞춤

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

export function themePalette(spec: ThemeSpec): Palette {
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
