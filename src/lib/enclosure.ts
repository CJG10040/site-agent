// 가로 위요감: 길 가운데에서 양옆으로 직각 선을 그어 처음 닿는 건물까지의 거리(D = 왼쪽 + 오른쪽)와
// 그 건물 높이(H = 양쪽 평균, 층수 × 3m로 어림)의 비 D/H. 아시하라 요시노부의 기준으로 나눈다.
// 좌표는 대지 중심 기준 미터.

import type { XY } from './network'

export const FLOOR_M = 3
export const STEP = 10 // m 간격으로 잰다
export const ENC_CLASSES = [
  { label: 'D/H 1 미만 (깊게 둘러싸임)', max: 1 },
  { label: 'D/H 1~2 (알맞게 둘러싸임)', max: 2 },
  { label: 'D/H 2~4 (열림)', max: 4 },
  { label: 'D/H 4 이상·한쪽이 트임', max: Infinity },
] as const

export interface EncBuilding {
  rings: XY[][]
  /** 높이(m), 모르면 null */
  h: number | null
}

export interface EncRoad {
  coords: XY[]
  width: number | null
}

export interface EncSample {
  road: number
  /** 길 시작점에서 잰 거리 */
  s: number
  p: XY
  D: number | null
  H: number | null
  ratio: number | null
  /** ENC_CLASSES 번호, -1 = 높이 모름 */
  cls: number
}

interface Seg {
  a: XY
  b: XY
  bi: number
}

class SegGrid {
  private cells = new Map<string, Seg[]>()
  private size: number
  constructor(size: number) {
    this.size = size
  }
  add(s: Seg) {
    const x0 = Math.floor(Math.min(s.a[0], s.b[0]) / this.size)
    const x1 = Math.floor(Math.max(s.a[0], s.b[0]) / this.size)
    const y0 = Math.floor(Math.min(s.a[1], s.b[1]) / this.size)
    const y1 = Math.floor(Math.max(s.a[1], s.b[1]) / this.size)
    for (let i = x0; i <= x1; i++)
      for (let j = y0; j <= y1; j++) {
        const k = `${i},${j}`
        const l = this.cells.get(k)
        if (l) l.push(s)
        else this.cells.set(k, [s])
      }
  }
  query(x0: number, y0: number, x1: number, y1: number): Set<Seg> {
    const out = new Set<Seg>()
    for (let i = Math.floor(Math.min(x0, x1) / this.size); i <= Math.floor(Math.max(x0, x1) / this.size); i++)
      for (let j = Math.floor(Math.min(y0, y1) / this.size); j <= Math.floor(Math.max(y0, y1) / this.size); j++)
        for (const s of this.cells.get(`${i},${j}`) ?? []) out.add(s)
    return out
  }
}

/** 반직선 p + t·d (0 ≤ t ≤ maxT)와 선분 ab가 만나는 t */
function hit(p: XY, d: XY, maxT: number, a: XY, b: XY): number | null {
  const ex = b[0] - a[0]
  const ey = b[1] - a[1]
  const den = d[0] * ey - d[1] * ex
  if (Math.abs(den) < 1e-12) return null
  const wx = a[0] - p[0]
  const wy = a[1] - p[1]
  const t = (wx * ey - wy * ex) / den
  const u = (wx * d[1] - wy * d[0]) / den
  if (t < 0 || t > maxT || u < 0 || u > 1) return null
  return t
}

function classOf(ratio: number | null): number {
  if (ratio === null) return -1
  if (!Number.isFinite(ratio)) return ENC_CLASSES.length - 1
  return ENC_CLASSES.findIndex((c) => ratio < c.max)
}

export function enclosureSamples(roads: EncRoad[], buildings: EncBuilding[]): EncSample[] {
  const grid = new SegGrid(20)
  buildings.forEach((b, bi) => {
    for (const ring of b.rings) for (let i = 1; i < ring.length; i++) grid.add({ a: ring[i - 1], b: ring[i], bi })
  })
  const out: EncSample[] = []
  roads.forEach((r, ri) => {
    const half = (r.width ?? 6) / 2
    const cap = Math.max(30, half + 22)
    let along = 0
    let next = STEP / 2
    for (let k = 1; k < r.coords.length; k++) {
      const a = r.coords[k - 1]
      const b = r.coords[k]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 1e-6) continue
      const tx = (b[0] - a[0]) / L
      const ty = (b[1] - a[1]) / L
      while (next <= along + L) {
        const t = next - along
        const p: XY = [a[0] + tx * t, a[1] + ty * t]
        const sides = ([[-ty, tx], [ty, -tx]] as XY[]).map((d) => {
          const cand = grid.query(p[0], p[1], p[0] + d[0] * cap, p[1] + d[1] * cap)
          let best: { t: number; bi: number } | null = null
          for (const s of cand) {
            const tt = hit(p, d, cap, s.a, s.b)
            if (tt !== null && tt > 0.5 && (!best || tt < best.t)) best = { t: tt, bi: s.bi }
          }
          return best
        })
        const [l, rr] = sides
        let D: number | null = null
        let H: number | null = null
        let ratio: number | null = null
        if (l && rr) {
          D = l.t + rr.t
          const hs = [buildings[l.bi].h, buildings[rr.bi].h].filter((h): h is number => h !== null && h > 0)
          H = hs.length ? hs.reduce((x, y) => x + y, 0) / hs.length : null
          ratio = H ? D / H : null
        } else {
          // 한쪽이라도 트이면 '트임'
          const one = l ?? rr
          D = null
          H = one ? buildings[one.bi].h : null
          ratio = Infinity
        }
        out.push({ road: ri, s: next, p, D, H, ratio, cls: classOf(ratio) })
        next += STEP
      }
      along += L
    }
  })
  return out
}

/** 반경 안 길이 비율 (클래스별), 미상 포함 */
export function classShares(samples: EncSample[]): { shares: number[]; unknown: number } {
  const n = samples.length
  const shares = ENC_CLASSES.map((_, i) => (n ? samples.filter((s) => s.cls === i).length / n : 0))
  return { shares, unknown: n ? samples.filter((s) => s.cls < 0).length / n : 0 }
}
