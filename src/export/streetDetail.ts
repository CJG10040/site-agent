// 거리 디테일 (2026-11-13 사용자 요청: "횡단보도가 흰 면으로만 — 이런 부분도 디테일을"): 횡단보도 줄무늬, 안전지대 노란 빗금,
// 차선·연석 띠(면), 정류장 쉘터·가로등 모양, 인도·교통섬 단차. 라이노 파일과 3D 미리보기가 같은 모양을 쓰게 여기서 만든다.
// 치수는 도로교통 규격·흔한 시설 크기의 어림 (화면·파일 설명에 '어림'으로 적음).

import type { Poly, XY } from './siteModel'

export const STREET = {
  /** 도로 면을 지형 위로 띄우는 높이 (m) */
  roadLift: 0.08,
  /** 인도·교통섬·연석이 차도보다 높은 만큼 */
  curbH: 0.15,
  /** 횡단보도 줄 폭·간격 */
  zebraBar: 0.45,
  zebraGap: 0.45,
  /** 차선 폭 */
  laneW: 0.15,
  /** 연석 폭 */
  curbW: 0.2,
  /** 안전지대 빗금 폭·간격, 테두리 폭 */
  hatchW: 0.3,
  hatchGap: 1.2,
  hatchEdge: 0.15,
}

const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1]
const unit = (v: XY): XY => {
  const L = Math.hypot(v[0], v[1]) || 1
  return [v[0] / L, v[1] / L]
}

// ───────────────────────── 도로 방향 (가까운 도로중심선) ─────────────────────────

export interface RoadDirs {
  /** 가장 가까운 중심선의 방향(단위)과 그 위의 가장 가까운 점, 거리 (maxD 안에 없으면 null) */
  near(x: number, y: number, maxD: number): { dir: XY; foot: XY; d: number } | null
}

export function roadDirs(lines: XY[][]): RoadDirs {
  const segs: number[] = []
  for (const l of lines) for (let i = 0; i + 1 < l.length; i++) segs.push(l[i][0], l[i][1], l[i + 1][0], l[i + 1][1])
  const S = Float64Array.from(segs)
  return {
    near(x, y, maxD) {
      let best: { dir: XY; foot: XY; d: number } | null = null
      let bd = maxD
      for (let i = 0; i < S.length; i += 4) {
        const ax = S[i]
        const ay = S[i + 1]
        const bx = S[i + 2]
        const by = S[i + 3]
        if ((x < ax - bd && x < bx - bd) || (x > ax + bd && x > bx + bd) || (y < ay - bd && y < by - bd) || (y > ay + bd && y > by + bd)) continue
        const dx = bx - ax
        const dy = by - ay
        const L2 = dx * dx + dy * dy
        if (!L2) continue
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2))
        const fx = ax + t * dx
        const fy = ay + t * dy
        const d = Math.hypot(x - fx, y - fy)
        if (d < bd) {
          bd = d
          best = { dir: unit([dx, dy]), foot: [fx, fy], d }
        }
      }
      return best
    },
  }
}

// ───────────────────────── 다각형 자르기 ─────────────────────────

/** n·p ≥ c 쪽만 남김 (서덜랜드–호지먼, 볼록한 띠로 자를 때) */
function clipHalf(pts: XY[], n: XY, c: number): XY[] {
  const out: XY[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const da = dot(n, a) - c
    const db = dot(n, b) - c
    if (da >= 0) out.push(a)
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out
}

const ringArea = (r: XY[]) => {
  let s = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]
  return s / 2
}

/** 다각형을 방향 a를 따라 [s0, s1] 띠로 잘라 낸 조각 */
function band(o: XY[], a: XY, s0: number, s1: number): XY[] | null {
  const r = clipHalf(clipHalf(o, a, s0), [-a[0], -a[1]], -s1)
  return r.length >= 3 && Math.abs(ringArea(r)) > 0.01 ? r : null
}

/** 가장 작은 경계 상자의 축 (변 방향 중 넓이가 가장 작은 것): u = 긴 쪽 */
function mainAxes(o: XY[]): { u: XY; v: XY; lenU: number; lenV: number } {
  let best = { u: [1, 0] as XY, v: [0, 1] as XY, lenU: 0, lenV: 0, area: Infinity }
  for (let i = 0; i < o.length; i++) {
    const e = unit([o[(i + 1) % o.length][0] - o[i][0], o[(i + 1) % o.length][1] - o[i][1]])
    const p: XY = [-e[1], e[0]]
    let a0 = Infinity
    let a1 = -Infinity
    let b0 = Infinity
    let b1 = -Infinity
    for (const q of o) {
      const s = dot(q, e)
      const t = dot(q, p)
      a0 = Math.min(a0, s)
      a1 = Math.max(a1, s)
      b0 = Math.min(b0, t)
      b1 = Math.max(b1, t)
    }
    const area = (a1 - a0) * (b1 - b0)
    if (area < best.area) best = a1 - a0 >= b1 - b0 ? { u: e, v: p, lenU: a1 - a0, lenV: b1 - b0, area } : { u: p, v: e, lenU: b1 - b0, lenV: a1 - a0, area }
  }
  return best
}

const span = (o: XY[], a: XY) => {
  let s0 = Infinity
  let s1 = -Infinity
  for (const q of o) {
    const s = dot(q, a)
    s0 = Math.min(s0, s)
    s1 = Math.max(s1, s)
  }
  return [s0, s1]
}

// ───────────────────────── 횡단보도 줄무늬 ─────────────────────────

/**
 * 횡단보도 줄무늬: 줄은 차가 다니는 방향(도로 방향)으로 길고, 건너는 방향을 따라 45cm 칠·45cm 빔으로 늘어섬 (가운데 맞춤).
 * 도로 방향을 모르면 횡단보도의 짧은 변을 줄 방향으로 봄.
 */
export function zebraStripes(cw: Poly, roadDir: XY | null): Poly[] {
  const o = cw.outer
  if (o.length < 3) return []
  const { u, v, lenU, lenV } = mainAxes(o)
  // 길쭉한 횡단보도는 건너는 길이가 긴 쪽 → 줄은 짧은 변 방향 (교차로에서는 가장 가까운 중심선이 다른 도로일 수 있음).
  // 정사각형에 가까울 때만 도로 방향으로 정함
  const barAlongU = lenU < lenV * 1.6 && roadDir ? Math.abs(dot(roadDir, u)) >= Math.abs(dot(roadDir, v)) : false
  // 줄이 늘어서는 방향 a (줄의 긴 방향과 수직)
  const a = barAlongU ? v : u
  const [s0, s1] = span(o, a)
  const L = s1 - s0
  const { zebraBar: bar, zebraGap: gap } = STREET
  const n = Math.floor((L + gap) / (bar + gap))
  if (n < 1) return []
  const start = s0 + (L - (n * bar + (n - 1) * gap)) / 2
  const out: Poly[] = []
  for (let i = 0; i < n; i++) {
    const s = start + i * (bar + gap)
    const r = band(o, a, s, s + bar)
    if (r) out.push({ outer: ringArea(r) > 0 ? r : [...r].reverse(), holes: [] })
  }
  return out
}

// ───────────────────────── 안전지대 빗금 ─────────────────────────

/** 칠한 안전지대: 긴 축에 45°로 기운 노란 빗금 (테두리는 띠로 따로) */
export function hatchStripes(p: Poly): Poly[] {
  const o = p.outer
  if (o.length < 3) return []
  const { u, v } = mainAxes(o)
  const a = unit([u[0] + v[0], u[1] + v[1]])
  const [s0, s1] = span(o, a)
  const { hatchW: w, hatchGap: gap } = STREET
  const out: Poly[] = []
  for (let s = s0 + gap / 2; s + w <= s1; s += w + gap) {
    const r = band(o, a, s, s + w)
    if (r) out.push({ outer: ringArea(r) > 0 ? r : [...r].reverse(), holes: [] })
  }
  return out
}

// ───────────────────────── 선 → 띠 (차선·연석·테두리) ─────────────────────────

/** 선을 step 간격으로 잘게 (지형을 따라 얹기 위해) */
export function densifyLine(pts: XY[], step: number, closed = false): XY[] {
  const src = closed && pts.length ? [...pts, pts[0]] : pts
  const out: XY[] = []
  for (let i = 0; i + 1 < src.length; i++) {
    const [ax, ay] = src[i]
    const [bx, by] = src[i + 1]
    const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let j = 0; j < k; j++) out.push([ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k])
  }
  if (src.length) out.push(src[src.length - 1])
  return out
}

/** 선 양옆으로 w/2씩 (꼭짓점마다 앞뒤 방향의 평균 법선) */
export function ribbon(pts: XY[], w: number): { left: XY[]; right: XY[] } {
  const left: XY[] = []
  const right: XY[] = []
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const [nx, ny] = unit([-(b[1] - a[1]), b[0] - a[0]])
    left.push([p[0] + (nx * w) / 2, p[1] + (ny * w) / 2])
    right.push([p[0] - (nx * w) / 2, p[1] - (ny * w) / 2])
  })
  return { left, right }
}

// ───────────────────────── 정류장 쉘터·가로등 (상자 모음) ─────────────────────────

export interface Box {
  /** 가운데 (m) */
  c: XY
  /** 상자의 x축 방향 (단위) */
  ux: XY
  hx: number
  hy: number
  /** 땅에서부터 높이 (m) */
  z0: number
  z1: number
  part: 'frame' | 'roof' | 'glass' | 'bench' | 'pole' | 'head' | 'sign'
}

/** 정류장 쉘터 (어림 3.6 × 1.5 × 2.55m): 지붕판, 뒷벽·옆벽 유리, 뒤 기둥 둘, 의자, 정류장 표지. 앞(열린 쪽)이 도로를 봄 */
export function shelterBoxes(x: number, y: number, along: XY, toRoad: XY): Box[] {
  const ux = along
  const uy = toRoad
  const at = (lx: number, ly: number): XY => [x + ux[0] * lx + uy[0] * ly, y + ux[1] * lx + uy[1] * ly]
  return [
    { c: at(0, 0.05), ux, hx: 1.85, hy: 0.8, z0: 2.45, z1: 2.55, part: 'roof' },
    { c: at(0, -0.65), ux, hx: 1.75, hy: 0.02, z0: 0.15, z1: 2.4, part: 'glass' },
    { c: at(-1.75, -0.3), ux, hx: 0.02, hy: 0.35, z0: 0.15, z1: 2.4, part: 'glass' },
    { c: at(-1.8, -0.7), ux, hx: 0.05, hy: 0.05, z0: 0, z1: 2.45, part: 'frame' },
    { c: at(1.8, -0.7), ux, hx: 0.05, hy: 0.05, z0: 0, z1: 2.45, part: 'frame' },
    { c: at(0.2, -0.42), ux, hx: 1.0, hy: 0.18, z0: 0.42, z1: 0.47, part: 'bench' },
    { c: at(-0.6, -0.42), ux, hx: 0.03, hy: 0.15, z0: 0, z1: 0.42, part: 'frame' },
    { c: at(1.0, -0.42), ux, hx: 0.03, hy: 0.15, z0: 0, z1: 0.42, part: 'frame' },
    { c: at(2.4, 0.45), ux, hx: 0.04, hy: 0.04, z0: 0, z1: 2.9, part: 'frame' },
    { c: at(2.4, 0.45), ux, hx: 0.3, hy: 0.02, z0: 2.3, z1: 2.85, part: 'sign' },
  ]
}

/** 가로등 (어림 높이 8m): 기둥, 도로 쪽으로 뻗은 팔 1.6m, 등 머리. 도로 방향을 모르면 기둥 위에 등만 */
export function lampBoxes(x: number, y: number, toRoad: XY | null): Box[] {
  const ux: XY = toRoad ?? [1, 0]
  const at = (l: number): XY => [x + ux[0] * l, y + ux[1] * l]
  const H = 8
  return toRoad
    ? [
        { c: [x, y], ux, hx: 0.09, hy: 0.09, z0: 0, z1: H, part: 'pole' },
        { c: at(0.8), ux, hx: 0.8, hy: 0.04, z0: H - 0.12, z1: H - 0.04, part: 'pole' },
        { c: at(1.55), ux, hx: 0.35, hy: 0.14, z0: H - 0.22, z1: H - 0.08, part: 'head' },
      ]
    : [
        { c: [x, y], ux, hx: 0.09, hy: 0.09, z0: 0, z1: H, part: 'pole' },
        { c: [x, y], ux, hx: 0.25, hy: 0.25, z0: H, z1: H + 0.2, part: 'head' },
      ]
}

/** 상자의 꼭짓점 8개(아래 4 → 위 4, 땅 높이 z 더함)와 면 6개(바깥을 향하게) */
export function boxMesh(b: Box, ground: number): { v: number[][]; f: number[][] } {
  const uy: XY = [-b.ux[1], b.ux[0]]
  const corner = (sx: number, sy: number): XY => [b.c[0] + b.ux[0] * sx * b.hx + uy[0] * sy * b.hy, b.c[1] + b.ux[1] * sx * b.hx + uy[1] * sy * b.hy]
  const ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
  const v = [...ring.map(([x, y]) => [x, y, ground + b.z0]), ...ring.map(([x, y]) => [x, y, ground + b.z1])]
  const f = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ]
  return { v, f }
}
