// 다리·고가 상판 (2026-11-16 사용자 결정: 상판·난간·교각까지).
// 자료: 수치지도 교량(A007: 명칭·종류 도로교/보도교/철교·연장·폭)·입체교차부(A009: 고가차도/지하차도, 높이는 대개 0 = 모름).
//  - 교량: 상판 높이는 상판 위 정밀도로지도 노면 높이와 상판 둘레 바로 밖에서 이어지는 도로 높이를 거리로 섞은 면(없으면 양 끝 너머 땅),
//    물 위는 상판 밑이 물에서 0.3m 뜨게 하고 물에서 멀어지면 8%로 내려옴 (둘 중 높은 값).
//    (2026-11-16 광천교: 바닥 모양이 217m로 속성 길이 77.6m보다 길어 — 하천을 따라 덮은 부분 — 양 끝만 이으면 가운데가 땅보다 낮았음)
//    두께 도로교 1.2m·보도교 0.5m·철교 1.5m, 난간(긴 변을 따라) 도로교 1.0m·보도교 1.1m, 교각 약 25m(보도교 20m) 간격 — 상판 밑이 땅에서 1.5m 넘게 뜬 곳만.
//  - 고가차도: 같은 이름 조각을 묶고(본선 + 연결로가 Y·L자로 갈라지기도 함 — 동운고가 11조각), 합친 바닥의 가지 끝(=램프 끝)에서
//    길을 따라 잰 거리 × 경사 6%로 올라 (높이 속성 또는 5m 밑 높이) + 상판 1.4m까지. 교각은 조각마다 긴 축을 따라 약 30m 간격.
//  - 지하차도는 그리지 않음 (땅 밑).

type XY = [number, number]
interface Poly {
  outer: XY[]
  holes: XY[][]
}

export interface DeckSrc {
  polys: Poly[]
  name: string
  kind: string
  deck: 'bridge' | 'overpass' | 'underpass'
  length: number | null
  height: number | null
}

export interface Deck {
  kind: 'bridge' | 'overpass'
  /** 도로교·보도교·철교·고가차도 */
  sub: string
  name: string
  polys: Poly[]
  /** 긴 축: 가운데 c, 방향 u(길이)·v(폭), 반 길이 L·반 폭 W */
  c: XY
  u: XY
  v: XY
  L: number
  W: number
  /** 상판 윗면 높이 (모형 높이) — zSpec과 땅 높이로 만든 함수 (deckZFn) */
  zTop: (x: number, y: number) => number
  /** 상판 높이 자료 (일꾼에 넘길 때 이것으로 zTop을 다시 만듦) */
  zSpec: DeckZSpec
  thick: number
  /** 난간 높이 (0 = 없음) */
  rail: number
  /** 교각: 가운데, 상판 방향(along), 폭 방향 반 길이, 두께 반 */
  piers: { c: XY; along: XY; half: number; th: number }[]
  /** 난간을 세울 변 (긴 축과 나란하고 바깥이 도로가 아닌 바깥 변, 반시계 고리 순서) */
  railSegs: [XY, XY][]
  bbox: [number, number, number, number]
}

function hull(pts: XY[]): XY[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: XY[] = []
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop()
    lo.push(q)
  }
  const up: XY[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop()
    up.push(q)
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)]
}

/** 가장 작은 둘레 사각형 (긴 축 = 속성 연장과 더 가까운 변) */
function axisOf(pts: XY[], length: number | null): { c: XY; u: XY; v: XY; L: number; W: number } | null {
  const h = hull(pts)
  if (h.length < 3) return null
  let best: { area: number; e: XY; a0: number; a1: number; b0: number; b1: number } | null = null
  for (let i = 0; i < h.length; i++) {
    const [ax, ay] = h[i]
    const [bx, by] = h[(i + 1) % h.length]
    const len = Math.hypot(bx - ax, by - ay)
    if (len < 1e-6) continue
    const e: XY = [(bx - ax) / len, (by - ay) / len]
    let a0 = Infinity
    let a1 = -Infinity
    let b0 = Infinity
    let b1 = -Infinity
    for (const [x, y] of h) {
      const a = x * e[0] + y * e[1]
      const b = -x * e[1] + y * e[0]
      a0 = Math.min(a0, a)
      a1 = Math.max(a1, a)
      b0 = Math.min(b0, b)
      b1 = Math.max(b1, b)
    }
    const area = (a1 - a0) * (b1 - b0)
    if (!best || area < best.area) best = { area, e, a0, a1, b0, b1 }
  }
  if (!best) return null
  const { e, a0, a1, b0, b1 } = best
  const ea = a1 - a0
  const eb = b1 - b0
  const along = (a0 + a1) / 2
  const acr = (b0 + b1) / 2
  const c: XY = [along * e[0] - acr * e[1], along * e[1] + acr * e[0]]
  let useE = ea >= eb
  if (length && length > 0 && Math.min(ea, eb) > 0.6 * Math.max(ea, eb)) useE = Math.abs(ea - length) <= Math.abs(eb - length)
  const u: XY = useE ? e : [-e[1], e[0]]
  const v: XY = [-u[1], u[0]]
  return { c, u, v, L: (useE ? ea : eb) / 2, W: (useE ? eb : ea) / 2 }
}

function bboxOf(polys: Poly[]): [number, number, number, number] {
  let a = Infinity
  let b = Infinity
  let c = -Infinity
  let d = -Infinity
  for (const p of polys)
    for (const [x, y] of p.outer) {
      a = Math.min(a, x)
      b = Math.min(b, y)
      c = Math.max(c, x)
      d = Math.max(d, y)
    }
  return [a, b, c, d]
}

function inRing([x, y]: XY, r: XY[]): boolean {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside
  return inside
}

export const inPoly = (p: XY, poly: Poly) => inRing(p, poly.outer) && !poly.holes.some((h) => inRing(p, h))

/** 다리 종류마다 상판 두께·난간 높이·교각 간격 */
function dims(sub: string, kind: 'bridge' | 'overpass'): { thick: number; rail: number; span: number } {
  if (kind === 'overpass') return { thick: 1.4, rail: 1.0, span: 30 }
  if (/보도/.test(sub)) return { thick: 0.5, rail: 1.1, span: 20 }
  if (/철/.test(sub)) return { thick: 1.5, rail: 0, span: 25 }
  return { thick: 1.2, rail: 1.0, span: 25 }
}

export interface DeckOpts {
  /** 도로 면 안인지 (상판 둘레에서 이어지는 도로 높이를 고를 때) */
  onRoad?: (x: number, y: number) => boolean
  /** 정밀도로지도 노면 높이 (모형 높이로 맞춘 것) */
  hd?: { x: number; y: number; z: number }[]
  /** 물 높이 */
  waterAt?: (x: number, y: number) => number | null
  /** 모형 범위 반쪽 (잘린 끝 알아보기) */
  half?: number
}

/** 점이 고리 변에서 r m 안인지 */
function nearRing([x, y]: XY, r: XY[], d: number): boolean {
  for (let i = 0; i < r.length; i++) {
    const [ax, ay] = r[i]
    const [bx, by] = r[(i + 1) % r.length]
    const dx = bx - ax
    const dy = by - ay
    const L2 = dx * dx + dy * dy
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0
    if (Math.hypot(x - ax - t * dx, y - ay - t * dy) <= d) return true
  }
  return false
}


/**
 * 고가 램프 높이장 (2026-11-16): 같은 이름 조각들을 2m 칸으로 합친 바닥에서 길을 따라 잰 거리로 가지 끝(램프 끝)을 찾고,
 * 가장 가까운 끝까지의 거리(길을 따라) × 경사로 높이를 정한다. 조각 이음매·나란한 상하행 조각에 흔들리지 않게.
 * 끝 = 한쪽 끝에서 가장 먼 칸 A + A에서 잰 거리가 둘레 25m 안에서 가장 큰 칸(가지 끝)들.
 */
/** 고가 바닥 격자와 가지 끝마다 길을 따라 잰 칸 거리 (칸 거리 2 = 칸 하나, 못 가는 칸 -1) */
export interface RampData {
  x0: number
  y0: number
  cell: number
  W: number
  H: number
  tips: XY[]
  Es: Int32Array[]
}

/** 가지 끝 k에서 길을 따라 잰 거리 (m) */
function rampDist(rd: RampData, k: number, x: number, y: number): number {
  const { x0, y0, cell, W, H } = rd
  const E = rd.Es[k]
  const c = Math.max(0, Math.min(W - 1, Math.floor((x - x0) / cell)))
  const r = Math.max(0, Math.min(H - 1, Math.floor((y - y0) / cell)))
  let best = Infinity
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr
      const cc = c + dc
      if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue
      const v = E[rr * W + cc]
      if (v >= 0) best = Math.min(best, (v / 2) * cell + Math.hypot(dr, dc) * cell)
    }
  return best
}

function rampField(polys: Poly[], cell = 2): RampData | null {
  const [x0, y0, x1, y1] = bboxOf(polys)
  const W = Math.ceil((x1 - x0) / cell) + 1
  const H = Math.ceil((y1 - y0) / cell) + 1
  if (W * H > 600000 || W < 2 || H < 2) return null
  const N = W * H
  const mask = new Uint8Array(N)
  let any = -1
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const p: XY = [x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell]
      if (polys.some((q) => inPoly(p, q))) {
        mask[r * W + c] = 1
        any = r * W + c
      }
    }
  if (any < 0) return null
  // 칸 사이 거리: 가로·세로 2, 대각선 3 (≈ 1 : 1.5) — 통 큐로 길을 따라 잰 거리
  const geo = (srcs: number[]): Int32Array => {
    const D = new Int32Array(N).fill(-1)
    const buckets: number[][] = [[]]
    for (const s of srcs) {
      D[s] = 0
      buckets[0].push(s)
    }
    for (let d = 0; d < buckets.length; d++) {
      const b = buckets[d]
      if (!b) continue
      for (let k = 0; k < b.length; k++) {
        const i = b[k]
        if (D[i] !== d) continue
        const r = Math.floor(i / W)
        const c = i - r * W
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue
            const rr = r + dr
            const cc = c + dc
            if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue
            const j = rr * W + cc
            if (!mask[j]) continue
            const nd = d + (dr && dc ? 3 : 2)
            if (D[j] >= 0 && D[j] <= nd) continue
            D[j] = nd
            ;(buckets[nd] ??= []).push(j)
          }
      }
    }
    return D
  }
  const far = (D: Int32Array) => {
    let best = -1
    for (let i = 0; i < N; i++) if (D[i] >= 0 && (best < 0 || D[i] > D[best])) best = i
    return best
  }
  const A = far(geo([any]))
  const DA = geo([A])
  // 가지 끝: 둘레 25m 안에서 DA가 가장 큰 칸 (A에서 15m 넘게)
  const R = Math.round(25 / cell)
  const tips = [A]
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const i = r * W + c
      if (!mask[i] || DA[i] < (15 / cell) * 2) continue
      let top = true
      for (let rr = Math.max(0, r - R); rr <= Math.min(H - 1, r + R) && top; rr++)
        for (let cc = Math.max(0, c - R); cc <= Math.min(W - 1, c + R); cc++) {
          const j = rr * W + cc
          if (mask[j] && (DA[j] > DA[i] || (DA[j] === DA[i] && j < i))) {
            top = false
            break
          }
        }
      if (top) tips.push(i)
    }
  // 끝마다 따로 잰 길 거리 (끝 높이가 다를 수 있어서 — 다리에 붙은 끝 등)
  const Es = tips.map((t) => geo([t]))
  const tipXY: XY[] = tips.map((t) => {
    const r = Math.floor(t / W)
    const c = t - r * W
    return [x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell]
  })
  return { x0, y0, cell, W, H, tips: tipXY, Es }
}

/** 상판 높이 자료: 다리 = 이어지는 도로 높이 점(거리 4제곱 반비례) + 물 위 여유 점, 고가 = 가지 끝에서 길을 따라 경사, 바닥 격자가 없으면 긴 축 양 끝에서 경사 */
export type DeckZSpec =
  | { t: 'idw'; conn: { x: number; y: number; z: number }[]; wet: { x: number; y: number; z: number }[] }
  | { t: 'ramp'; ramp: RampData; ends: { k: number; z: number }[]; hMax: number; g: number }
  | { t: 'line'; c: XY; u: XY; L: number; hMax: number; g: number }

/** 상판 윗면 높이 함수 (모형 높이) — 자료 + 땅 높이 */
export function deckZFn(s: DeckZSpec, zAt: (x: number, y: number) => number): (x: number, y: number) => number {
  if (s.t === 'idw') {
    const { conn, wet } = s
    return (x, y) => {
      let sw = 0
      let sz = 0
      for (const q of conn) {
        const d2 = (x - q.x) ** 2 + (y - q.y) ** 2
        if (d2 < 0.01) return Math.max(q.z, ...wet.map((w) => w.z - 0.08 * Math.hypot(x - w.x, y - w.y)))
        // 거리 4제곱에 반비례 — 끝에서는 바로 옆 도로 높이를 따름 (다리 위 실측 노면 점이 촘촘해도)
        const wt = 1 / (d2 * d2)
        sw += wt
        sz += wt * q.z
      }
      let z = sw ? sz / sw : zAt(x, y)
      for (const w of wet) {
        const c = w.z - 0.08 * Math.hypot(x - w.x, y - w.y)
        if (c > z) z = c
      }
      return z
    }
  }
  if (s.t === 'ramp') {
    const { ramp, ends, hMax, g } = s
    return (x, y) => {
      let h = hMax
      for (const e of ends) h = Math.min(h, e.z + g * rampDist(ramp, e.k, x, y))
      return zAt(x, y) + Math.max(0, h)
    }
  }
  const { c, u, L, hMax, g } = s
  return (x, y) => {
    const q = Math.max(-L, Math.min(L, (x - c[0]) * u[0] + (y - c[1]) * u[1]))
    return zAt(x, y) + Math.max(0, Math.min(hMax, g * (q + L), g * (L - q)))
  }
}

/**
 * @param zAt 다듬은 땅 높이 (도로는 매끈한 면)
 */
export function buildDecks(src: DeckSrc[], zAt: (x: number, y: number) => number, opts: DeckOpts = {}): Deck[] {
  const out: Deck[] = []
  // 고가차도는 같은 이름끼리 한 줄로
  const groups = new Map<string, DeckSrc[]>()
  const singles: DeckSrc[] = []
  for (const s of src) {
    if (s.deck === 'underpass' || !s.polys.length) continue
    if (s.deck === 'overpass' && s.name) groups.set(s.name, [...(groups.get(s.name) ?? []), s])
    else singles.push(s)
  }
  const items: DeckSrc[] = [...singles, ...[...groups.values()].map((g) => ({ ...g[0], polys: g.flatMap((s) => s.polys), length: Math.max(...g.map((s) => s.length ?? 0)) || null }))].sort(
    (a, b) => (a.deck === 'bridge' ? 0 : 1) - (b.deck === 'bridge' ? 0 : 1),
  )
  for (const s of items) {
    const kind = s.deck === 'overpass' ? 'overpass' : 'bridge'
    const ax = axisOf(
      s.polys.flatMap((p) => p.outer),
      s.length,
    )
    if (!ax || ax.L < 1) continue
    let { u, v, L, W } = ax
    const { c } = ax
    // 다리 축: 양 끝 너머가 도로인 쪽이 건너는 방향 — 2026-11-16 고침: 광천1교는 바닥 모양이 길이(65m)보다 폭(82m)이 넓어
    // 하천을 따라가는 쪽을 축으로 잡아 교각·난간 방향이 틀렸음
    if (s.deck === 'bridge' && opts.onRoad) {
      const ends = (uu: XY, vv: XY, LL: number, WW: number) => {
        let n = 0
        for (const sg of [-1, 1])
          for (const t of [-0.5, 0, 0.5])
            for (const e of [3, 8]) {
              const x = c[0] + uu[0] * sg * (LL + e) + vv[0] * t * WW
              const y = c[1] + uu[1] * sg * (LL + e) + vv[1] * t * WW
              if (!s.polys.some((q) => inPoly([x, y], q)) && opts.onRoad!(x, y)) n++
            }
        return n
      }
      if (ends(v, u, W, L) > ends(u, v, L, W)) {
        // 새 u = 옛 v, 새 v = 새 u를 왼쪽으로 90° 돌린 것 = -옛 u
        ;[u, v] = [v, [-u[0], -u[1]] as XY]
        ;[L, W] = [W, L]
      }
    }
    const at = (s2: number, t: number): XY => [c[0] + u[0] * s2 + v[0] * t, c[1] + u[1] * s2 + v[1] * t]
    const inside = (x: number, y: number) => s.polys.some((p) => inPoly([x, y], p))
    const d = dims(s.kind, kind)
    let zSpec: DeckZSpec
    if (kind === 'bridge') {
      // 상판 높이 (2026-11-16 고침: 직선 하나 + 통째로 올리기 → 길거나 굽은 상판의 땅 위 부분이 도로보다 떠 있었음):
      //  - 이어지는 높이: 상판 위 정밀도로지도 노면 높이 + 상판 둘레 바로 밖(3m) 도로 높이 — 거리 4제곱에 반비례해 섞음
      //    (둘레 도로 중 위쪽 80%보다 3m 넘게 낮은 것은 밑을 지나는 길로 보고 뺌)
      //  - 물 위 여유: 상판 안에서 물 위인 점마다 물 높이 + 0.3m + 두께(상판 밑이 물에서 0.3m), 물에서 멀어지면 8%로 낮아짐 — 둘 중 높은 값
      const conn: { x: number; y: number; z: number }[] = []
      for (const p of opts.hd ?? []) if (inside(p.x, p.y)) conn.push(p)
      if (opts.onRoad) {
        const ring: { x: number; y: number; z: number }[] = []
        for (const p of s.polys) {
          const o = p.outer
          for (let i = 0; i < o.length; i++) {
            const [ax2, ay2] = o[i]
            const [bx, by] = o[(i + 1) % o.length]
            const len = Math.hypot(bx - ax2, by - ay2)
            if (len < 1e-6) continue
            const nx = (by - ay2) / len
            const ny = -(bx - ax2) / len
            for (let t = 0; t <= len; t += 4) {
              const x = ax2 + ((bx - ax2) * t) / len + nx * 3
              const y = ay2 + ((by - ay2) * t) / len + ny * 3
              if (!inside(x, y) && opts.onRoad(x, y)) ring.push({ x, y, z: zAt(x, y) })
            }
          }
        }
        if (ring.length) {
          const zs = ring.map((q) => q.z).sort((a, b) => a - b)
          const p80 = zs[Math.min(zs.length - 1, Math.floor(zs.length * 0.8))]
          for (const q of ring) if (q.z >= p80 - 3) conn.push(q)
        }
      }
      if (conn.length < 2) {
        // 양 끝 너머 땅 중 높은 값 (하천 쪽 낮은 땅을 피함)
        for (const sign of [-1, 1]) {
          let best: { x: number; y: number; z: number } | null = null
          for (const ext of [2, 5, 8])
            for (const k of [-0.6, -0.3, 0, 0.3, 0.6]) {
              const [x, y] = at(sign * (L + ext), k * W)
              const z = zAt(x, y)
              if (!best || z > best.z) best = { x, y, z }
            }
          if (best) conn.push(best)
        }
      }
      // 물 위 점 (상판 안 격자)
      const wet: { x: number; y: number; z: number }[] = []
      if (opts.waterAt) {
        const step = Math.max(3, Math.min(8, Math.min(L, W) / 4))
        for (let a = -L; a <= L; a += step)
          for (let b = -W; b <= W; b += step) {
            const [x, y] = at(a, b)
            if (!inside(x, y)) continue
            const w = opts.waterAt(x, y)
            if (w !== null) wet.push({ x, y, z: w + 0.3 + d.thick })
          }
      }
      zSpec = { t: 'idw', conn, wet }
    } else {
      // 램프: 조각들을 합친 바닥에서 길을 따라 잰 가지 끝까지의 거리 × 6% (rampField)
      const g = 0.06
      const hMax = (s.height && s.height > 2 && s.height < 20 ? s.height : 5) + d.thick
      const ramp = rampField(s.polys)
      // 끝 높이: 다른 상판(다리)에 붙은 끝은 그 상판 높이, 모형 범위 가장자리에서 잘린 끝은 뺌, 나머지는 땅 (2026-11-16 고침:
      // 광암교에 이어지는 광암고가교 끝을 땅 높이로 잡아 다리와 만나는 곳에서 꺼졌다 다시 떴음)
      const ends: { k: number; z: number }[] = []
      if (ramp)
        ramp.tips.forEach(([tx, ty], k) => {
          if (opts.half && (Math.abs(tx) > opts.half - 4 || Math.abs(ty) > opts.half - 4)) return
          const near = out.find((o) => o.kind === 'bridge' && o.polys.some((q) => inPoly([tx, ty], q) || nearRing([tx, ty], q.outer, 20)))
          // 끝에서 땅 위 높이 (땅에 닿는 끝 0, 다리에 붙은 끝은 다리 상판이 땅에서 뜬 만큼)
          ends.push({ k, z: near ? Math.max(0, near.zTop(tx, ty) - zAt(tx, ty)) : 0 })
        })
      zSpec = ramp ? { t: 'ramp', ramp, ends, hMax, g } : { t: 'line', c, u, L, hMax, g }
    }
    const zTop = deckZFn(zSpec, zAt)
    // 교각: 조각마다 긴 축을 따라 (상판 밑이 땅에서 1.5m 넘게 뜬 곳만)
    const piers: Deck['piers'] = []
    const th = /보도/.test(s.kind) ? 0.3 : 0.6
    for (const p of kind === 'bridge' ? [null] : s.polys) {
      const pa = p ? axisOf(p.outer, null) : { c, u, v, L, W }
      // 다리는 20m 넘으면 항상(2026-11-16: 다리 밑이 낮게 나와 교각이 하나도 없던 다리가 많았음), 고가는 경간 1.2배 넘을 때
      if (!pa || (kind === 'bridge' ? 2 * pa.L < 20 : 2 * pa.L <= d.span * 1.2)) continue
      const n = Math.max(2, Math.round((2 * pa.L) / d.span))
      for (let i = 1; i < n; i++) {
        const sp = -pa.L + (i * 2 * pa.L) / n
        const pc: XY = [pa.c[0] + pa.u[0] * sp, pa.c[1] + pa.u[1] * sp]
        if (p && !inPoly(pc, p)) continue
        if (zTop(pc[0], pc[1]) - d.thick - zAt(pc[0], pc[1]) > (kind === 'bridge' ? 0.5 : 1.5)) piers.push({ c: pc, along: pa.u, half: kind === 'overpass' ? Math.min(pa.W * 0.5, 4) : pa.W * 0.75, th })
      }
    }
    // 난간: 조각의 긴 축과 나란한 바깥 변 — 바깥 3m가 1.5m 넘게 낮거나 도로가 아닌 곳 (다리 끝에서 옆길로 이어지는 곳은 막지 않음)
    const railSegs: [XY, XY][] = []
    if (d.rail > 0)
      for (const p of s.polys) {
        const pa = kind === 'bridge' ? { u } : axisOf(p.outer, null)
        if (!pa) continue
        const o = p.outer
        for (let i = 0; i < o.length; i++) {
          const a = o[i]
          const b = o[(i + 1) % o.length]
          const dx = b[0] - a[0]
          const dy = b[1] - a[1]
          const len = Math.hypot(dx, dy)
          if (len < 0.5 || Math.abs((dx * pa.u[0] + dy * pa.u[1]) / len) < 0.7) continue
          // 반시계 고리의 바깥 = 오른쪽
          const mx = (a[0] + b[0]) / 2 + (dy / len) * 3
          const my = (a[1] + b[1]) / 2 - (dx / len) * 3
          if (inside(mx, my)) continue
          // 바깥이 1.5m 넘게 낮으면(물·하천 바닥·고가 밑) 난간, 아니면 도로로 이어질 때만 뺌
          const drop = zTop((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) - zAt(mx, my)
          if (drop < 1.5 && opts.onRoad?.(mx, my)) continue
          railSegs.push([a, b])
        }
      }
    out.push({ kind, sub: kind === 'overpass' ? s.kind || '고가차도' : s.kind || '교량', name: s.name, polys: s.polys, c, u, v, L, W, zTop, zSpec, thick: d.thick, rail: d.rail, piers, railSegs, bbox: bboxOf(s.polys) })
  }
  return out
}

/** 이 점을 덮는 상판 */
export function deckAt(decks: Deck[], x: number, y: number): Deck | null {
  for (const d of decks) {
    const [a, b, c, e] = d.bbox
    if (x < a || x > c || y < b || y > e) continue
    if (d.polys.some((p) => inPoly([x, y], p))) return d
  }
  return null
}

/** 상판 위 높이 */
export const deckZ = (d: Deck, x: number, y: number) => d.zTop(x, y)

/** 도로 위 높이: 상판 위면 상판 윗면, 아니면 땅 */
export function roadAtFn(decks: Deck[], zAt: (x: number, y: number) => number): (x: number, y: number) => number {
  return (x, y) => {
    const dk = deckAt(decks, x, y)
    return dk ? dk.zTop(x, y) : zAt(x, y)
  }
}
