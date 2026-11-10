// 길의 연결 계산 (도로중심선 → 길 그래프).
// - 선택도: 공간구문론의 각도 선택도(angular choice). 길을 '꺾는 각도'가 가장 적은 경로를 최단 경로로 보고,
//   모든 출발·도착 쌍의 최단 경로가 그 길을 몇 번 지나는지 센다. 정규화 선택도(NACH, Hillier 외 2012)로 비교.
// - 도보권: 길을 따라 잰 거리(분당 80m).
// - 가구: 길로 둘러싸인 블록 (평면 그래프의 면).
// 좌표는 모두 대지 중심 기준 미터(동쪽 x, 북쪽 y). 브라우저 Web Worker에서도 그대로 쓴다.

export type XY = [number, number]

export interface NetEdge {
  a: number
  b: number
  len: number
  /** a에서 출발할 때 방향(°, 수학 각도: 동=0, 반시계) */
  hA: number
  /** b에 도착할 때 방향 */
  hB: number
  /** 선 안쪽 꺾임 합(°) */
  inner: number
  coords: XY[]
}

export interface Network {
  nodes: XY[]
  edges: NetEdge[]
  /** 노드별 붙은 (간선, 이 노드가 a면 0 / b면 1) */
  adj: [number, number][][]
}

const SNAP = 1.0 // m — 끝점이 이 안이면 같은 교차점

function heading(p: XY, q: XY): number {
  return (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI
}

function turn(h1: number, h2: number): number {
  let d = Math.abs(h2 - h1) % 360
  if (d > 180) d = 360 - d
  return d
}

class NodeIndex {
  private cells = new Map<string, number[]>()
  nodes: XY[] = []
  private key(i: number, j: number) {
    return `${i},${j}`
  }
  find(p: XY): number {
    const i = Math.floor(p[0] / SNAP)
    const j = Math.floor(p[1] / SNAP)
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (const n of this.cells.get(this.key(i + di, j + dj)) ?? []) {
          const q = this.nodes[n]
          if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= SNAP) return n
        }
    return -1
  }
  add(p: XY): number {
    const f = this.find(p)
    if (f >= 0) return f
    const n = this.nodes.length
    this.nodes.push(p)
    const k = this.key(Math.floor(p[0] / SNAP), Math.floor(p[1] / SNAP))
    const list = this.cells.get(k)
    if (list) list.push(n)
    else this.cells.set(k, [n])
    return n
  }
}

function makeEdge(a: number, b: number, coords: XY[]): NetEdge | null {
  if (coords.length < 2) return null
  let len = 0
  let inner = 0
  for (let i = 1; i < coords.length; i++) {
    len += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1])
    if (i >= 2) inner += turn(heading(coords[i - 2], coords[i - 1]), heading(coords[i - 1], coords[i]))
  }
  if (len < 0.5) return null
  return { a, b, len, hA: heading(coords[0], coords[1]), hB: heading(coords[coords.length - 2], coords[coords.length - 1]), inner, coords }
}

/** 겹친 꼭짓점 제거 */
function clean(line: XY[]): XY[] {
  const out: XY[] = []
  for (const p of line) {
    const q = out[out.length - 1]
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p)
  }
  return out
}

/** 선 목록 → 길 그래프. 다른 선의 끝점이 이 선의 꺾인 점과 겹치면(T자 교차) 그 자리에서 나눈다. */
export function buildNetwork(lines: XY[][]): Network {
  const idx = new NodeIndex()
  const ls = lines.map(clean).filter((l) => l.length >= 2)
  for (const l of ls) {
    idx.add(l[0])
    idx.add(l[l.length - 1])
  }
  // 두 선 이상이 같은 꺾인 점을 지나면(나뉘지 않은 네거리) 그 점도 교차점
  const shared = new Map<string, Set<number>>()
  ls.forEach((l, li) => {
    for (let i = 1; i < l.length - 1; i++) {
      const k = `${Math.round(l[i][0] * 2)},${Math.round(l[i][1] * 2)}`
      const set = shared.get(k)
      if (set) set.add(li)
      else shared.set(k, new Set([li]))
    }
  })
  ls.forEach((l) => {
    for (let i = 1; i < l.length - 1; i++) {
      const k = `${Math.round(l[i][0] * 2)},${Math.round(l[i][1] * 2)}`
      if ((shared.get(k)?.size ?? 0) >= 2) idx.add(l[i])
    }
  })
  const edges: NetEdge[] = []
  const seen = new Set<string>()
  for (const l of ls) {
    let start = idx.find(l[0])
    let cur: XY[] = [l[0]]
    for (let i = 1; i < l.length; i++) {
      cur.push(l[i])
      const n = idx.find(l[i])
      if (n >= 0) {
        const e = makeEdge(start, n, cur)
        if (e && !(e.a === e.b && e.len < 5)) {
          // 같은 두 점을 같은 길이로 잇는 중복 선은 하나만
          const k = `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}-${Math.round(e.len)}`
          if (!seen.has(k)) {
            seen.add(k)
            edges.push(e)
          }
        }
        start = n
        cur = [l[i]]
      }
    }
  }
  const adj: [number, number][][] = idx.nodes.map(() => [])
  edges.forEach((e, i) => {
    adj[e.a].push([i, 0])
    adj[e.b].push([i, 1])
  })
  return { nodes: idx.nodes, edges, adj }
}

/** 저장해 둔 (이미 나뉜) 길로 그래프를 다시 만든다. 길 순서·개수를 그대로 지킨다. */
export function networkFromEdges(lines: XY[][]): Network {
  const idx = new NodeIndex()
  const edges: NetEdge[] = lines.map((l) => {
    const a = idx.add(l[0])
    const b = idx.add(l[l.length - 1])
    return makeEdge(a, b, l) ?? { a, b, len: 0.5, hA: 0, hB: 0, inner: 0, coords: l }
  })
  const adj: [number, number][][] = idx.nodes.map(() => [])
  edges.forEach((e, i) => {
    adj[e.a].push([i, 0])
    adj[e.b].push([i, 1])
  })
  return { nodes: idx.nodes, edges, adj }
}

/** 점에서 가장 가까운 길 위의 점: [길 번호, a 끝에서 잰 거리, 점까지 거리] */
export function nearestOnNetwork(net: Network, p: XY, maxD = Infinity): [number, number, number] | null {
  let best: [number, number, number] | null = null
  net.edges.forEach((e, i) => {
    let along = 0
    for (let k = 1; k < e.coords.length; k++) {
      const a = e.coords[k - 1]
      const b = e.coords[k]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const L2 = dx * dx + dy * dy
      const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0
      const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1])
      if (d <= maxD && (!best || d < best[2])) best = [i, along + Math.sqrt(L2) * t, d]
      along += Math.sqrt(L2)
    }
  })
  return best
}

/** 선의 s0~s1 구간 (a 끝에서 잰 거리) */
export function sliceLine(coords: XY[], s0: number, s1: number): XY[] {
  const out: XY[] = []
  let along = 0
  for (let k = 1; k < coords.length; k++) {
    const a = coords[k - 1]
    const b = coords[k]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const t0 = (s0 - along) / (L || 1)
    const t1 = (s1 - along) / (L || 1)
    if (t1 >= 0 && t0 <= 1) {
      const u0 = Math.max(0, t0)
      const u1 = Math.min(1, t1)
      const p0: XY = [a[0] + (b[0] - a[0]) * u0, a[1] + (b[1] - a[1]) * u0]
      const p1: XY = [a[0] + (b[0] - a[0]) * u1, a[1] + (b[1] - a[1]) * u1]
      if (!out.length) out.push(p0)
      out.push(p1)
    }
    along += L
  }
  return out
}

export function midpoint(e: NetEdge): XY {
  let half = e.len / 2
  for (let i = 1; i < e.coords.length; i++) {
    const p = e.coords[i - 1]
    const q = e.coords[i]
    const s = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (s >= half) {
      const t = s ? half / s : 0
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
    }
    half -= s
  }
  return e.coords[e.coords.length - 1]
}

// ───────────────────────── 우선순위 큐 ─────────────────────────

class Heap {
  private k: number[] = []
  private v: number[] = []
  get size() {
    return this.k.length
  }
  push(key: number, val: number) {
    const k = this.k
    const v = this.v
    let i = k.length
    k.push(key)
    v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= key) break
      k[i] = k[p]
      v[i] = v[p]
      i = p
    }
    k[i] = key
    v[i] = val
  }
  pop(): [number, number] {
    const k = this.k
    const v = this.v
    const topK = k[0]
    const topV = v[0]
    const lastK = k.pop() as number
    const lastV = v.pop() as number
    const n = k.length
    if (n > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && k[r] < k[l] ? r : l
        if (k[c] >= lastK) break
        k[i] = k[c]
        v[i] = v[c]
        i = c
      }
      k[i] = lastK
      v[i] = lastV
    }
    return [topK, topV]
  }
}

// ───────────────────────── 거리 (미터) ─────────────────────────

/** 노드까지 길을 따라 잰 거리. seeds: [노드, 시작 거리] */
export function metricFromNodes(net: Network, seeds: [number, number][], limit: number): Float64Array {
  const dist = new Float64Array(net.nodes.length).fill(Infinity)
  const h = new Heap()
  for (const [n, d] of seeds) {
    if (d < dist[n]) {
      dist[n] = d
      h.push(d, n)
    }
  }
  while (h.size) {
    const [d, n] = h.pop()
    if (d > dist[n] || d > limit) continue
    for (const [ei, side] of net.adj[n]) {
      const e = net.edges[ei]
      const m = side === 0 ? e.b : e.a
      const nd = d + e.len
      if (nd < dist[m]) {
        dist[m] = nd
        h.push(nd, m)
      }
    }
  }
  return dist
}

// ───────────────────────── 각도 선택도 ─────────────────────────

export interface ChoiceResult {
  /** 간선별 선택도 (출발 표본이면 전체로 환산) */
  choice: Float64Array
  /** 간선별 전체 각도 깊이 */
  depth: Float64Array
  /** 정규화 선택도 log(선택도+1)/log(깊이+3), 계산 안 된 간선은 NaN */
  nach: Float64Array
  origins: number
}

export interface ChoiceOptions {
  /** 미터 반경 (null = 제한 없음) */
  radius: number | null
  /** 이 간선들만 그래프에 넣는다 (없으면 전체) */
  include?: Uint8Array
  /** 출발 간선 최대 수 (넘으면 고르게 뽑아 환산) */
  maxOrigins?: number
  onProgress?: (done: number, total: number) => void
}

const EPS = 1e-9

/**
 * 상태 = (간선, 방향) 2E개. 상태 s의 비용 = 출발 간선에서 그 간선을 그 방향으로 다 지날 때까지 꺾은 각도 합 / 90.
 * Brandes 방식으로 최단 경로 수(σ)를 세고 거꾸로 의존도를 모은다.
 */
export function angularChoice(net: Network, opt: ChoiceOptions): ChoiceResult {
  const E = net.edges.length
  const S = E * 2
  const inc = opt.include ?? new Uint8Array(E).fill(1)
  const choice = new Float64Array(E)
  const depth = new Float64Array(E)
  const counted = new Uint8Array(E)
  const all: number[] = []
  for (let i = 0; i < E; i++) if (inc[i]) all.push(i)
  let origins = all
  const maxO = opt.maxOrigins ?? Infinity
  if (all.length > maxO) {
    const step = all.length / maxO
    origins = Array.from({ length: maxO }, (_, i) => all[Math.floor(i * step)])
  }
  const scale = all.length / origins.length

  // 상태별 출발 노드·도착 노드·방향
  const endNode = new Int32Array(S)
  const hStart = new Float64Array(S)
  const hEnd = new Float64Array(S)
  for (let i = 0; i < E; i++) {
    const e = net.edges[i]
    endNode[2 * i] = e.b
    endNode[2 * i + 1] = e.a
    hStart[2 * i] = e.hA
    hEnd[2 * i] = e.hB
    hStart[2 * i + 1] = e.hB + 180
    hEnd[2 * i + 1] = e.hA + 180
  }
  // 노드에서 떠나는 상태 목록
  const leaving: number[][] = net.nodes.map(() => [])
  for (let i = 0; i < E; i++) {
    if (!inc[i]) continue
    leaving[net.edges[i].a].push(2 * i)
    leaving[net.edges[i].b].push(2 * i + 1)
  }

  const dist = new Float64Array(S).fill(Infinity)
  const sigma = new Float64Array(S)
  const delta = new Float64Array(S)
  const preds: number[][] = Array.from({ length: S }, () => [])
  const order: number[] = []
  const mdist = new Float64Array(net.nodes.length).fill(Infinity)
  const inRange = new Uint8Array(E)
  const touched: number[] = []
  const touchedNodes: number[] = []
  const heap = new Heap()

  for (let oi = 0; oi < origins.length; oi++) {
    const o = origins[oi]
    const oe = net.edges[o]
    // 1) 미터 반경 안 간선 (간선 가운데까지 길 거리)
    if (opt.radius !== null) {
      const h = new Heap()
      for (const n of [oe.a, oe.b]) {
        if (oe.len / 2 < mdist[n]) {
          if (mdist[n] === Infinity) touchedNodes.push(n)
          mdist[n] = oe.len / 2
          h.push(oe.len / 2, n)
        }
      }
      while (h.size) {
        const [d, n] = h.pop()
        if (d > mdist[n] || d > opt.radius) continue
        for (const [ei, side] of net.adj[n]) {
          if (!inc[ei]) continue
          const e = net.edges[ei]
          if (d + e.len / 2 <= opt.radius) inRange[ei] = 1
          const m = side === 0 ? e.b : e.a
          const nd = d + e.len
          if (nd < mdist[m]) {
            if (mdist[m] === Infinity) touchedNodes.push(m)
            mdist[m] = nd
            h.push(nd, m)
          }
        }
      }
      inRange[o] = 1
    }
    const ok = (ei: number) => (opt.radius === null ? inc[ei] === 1 : inRange[ei] === 1)

    // 2) 각도 최단 경로
    for (const s of [2 * o, 2 * o + 1]) {
      dist[s] = 0
      sigma[s] = 1
      touched.push(s)
      heap.push(0, s)
    }
    while (heap.size) {
      const [d, s] = heap.pop()
      if (d > dist[s] + EPS) continue
      order.push(s)
      const node = endNode[s]
      const hIn = hEnd[s]
      for (const t of leaving[node]) {
        const ti = t >> 1
        if (ti === s >> 1 || !ok(ti)) continue
        const nd = d + (turn(hIn, hStart[t]) + net.edges[ti].inner) / 90
        if (nd < dist[t] - EPS) {
          if (dist[t] === Infinity) touched.push(t)
          dist[t] = nd
          sigma[t] = sigma[s]
          preds[t].length = 0
          preds[t].push(s)
          heap.push(nd, t)
        } else if (Math.abs(nd - dist[t]) <= EPS) {
          sigma[t] += sigma[s]
          preds[t].push(s)
        }
      }
    }
    // 간선별 도착 상태 (두 방향 중 가까운 쪽, 같으면 σ 비율로 나눔)
    const target = (s: number): number => {
      const e = s >> 1
      if (e === o) return 0
      const a = dist[2 * e]
      const b = dist[2 * e + 1]
      if (Math.abs(a - b) <= EPS) {
        const tot = sigma[2 * e] + sigma[2 * e + 1]
        return tot ? sigma[s] / tot : 0
      }
      return (s & 1) === 0 ? (a < b ? 1 : 0) : b < a ? 1 : 0
    }
    for (let i = order.length - 1; i >= 0; i--) {
      const w = order[i]
      const coeff = (target(w) + delta[w]) / sigma[w]
      for (const v of preds[w]) delta[v] += sigma[v] * coeff
      const e = w >> 1
      if (e !== o) choice[e] += delta[w] * scale
    }
    // 깊이 합 (출발 간선 기준)
    let td = 0
    for (const s of order) {
      if (s >> 1 === o) continue
      const other = dist[s ^ 1]
      // 간선마다 한 번만: 가까운 방향 (같으면 짝수 상태)
      if (dist[s] < other - EPS || (Math.abs(dist[s] - other) <= EPS && (s & 1) === 0)) td += dist[s]
    }
    depth[o] = td
    counted[o] = 1

    // 초기화
    for (const s of touched) {
      dist[s] = Infinity
      sigma[s] = 0
      delta[s] = 0
      preds[s].length = 0
    }
    touched.length = 0
    order.length = 0
    if (opt.radius !== null) {
      for (const n of touchedNodes) mdist[n] = Infinity
      touchedNodes.length = 0
      inRange.fill(0)
    }
    if (opt.onProgress && (oi % 50 === 0 || oi === origins.length - 1)) opt.onProgress(oi + 1, origins.length)
  }
  // 반경 안에서 서로 지나는 쌍은 양방향으로 두 번 세었으므로 반으로
  for (let i = 0; i < E; i++) choice[i] /= 2

  // 출발 표본에 없던 간선의 깊이는 이웃 평균으로 채운다
  const nach = new Float64Array(E).fill(NaN)
  for (let i = 0; i < E; i++) {
    if (!inc[i]) continue
    let td = depth[i]
    if (!counted[i]) {
      const e = net.edges[i]
      const near = [...net.adj[e.a], ...net.adj[e.b]].map(([j]) => j).filter((j) => counted[j])
      td = near.length ? near.reduce((s, j) => s + depth[j], 0) / near.length : NaN
    }
    if (Number.isFinite(td)) nach[i] = Math.log(choice[i] + 1) / Math.log(td + 3)
  }
  return { choice, depth, nach, origins: origins.length }
}

// ───────────────────────── 가구 (길로 둘러싸인 면) ─────────────────────────

export interface Face {
  ring: XY[]
  area: number
}

/** 평면 그래프의 면을 따라 돈다. 반시계(넓이 +)인 면이 가구, 시계 방향은 바깥 면. */
export function blocks(net: Network, minArea = 30): Face[] {
  const E = net.edges.length
  // 반-간선: 2i = a→b, 2i+1 = b→a
  const out: { h: number; ang: number }[][] = net.nodes.map(() => [])
  for (let i = 0; i < E; i++) {
    const e = net.edges[i]
    if (e.a === e.b) continue
    out[e.a].push({ h: 2 * i, ang: e.hA })
    out[e.b].push({ h: 2 * i + 1, ang: e.hB + 180 })
  }
  const norm = (a: number) => ((a % 360) + 360) % 360
  const pos = new Int32Array(2 * E).fill(-1)
  out.forEach((list) => {
    list.sort((x, y) => norm(x.ang) - norm(y.ang))
    list.forEach((x, k) => (pos[x.h] = k))
  })
  const fromNode = (h: number) => (h & 1 ? net.edges[h >> 1].b : net.edges[h >> 1].a)
  const toNode = (h: number) => (h & 1 ? net.edges[h >> 1].a : net.edges[h >> 1].b)
  const coordsOf = (h: number): XY[] => (h & 1 ? [...net.edges[h >> 1].coords].reverse() : net.edges[h >> 1].coords)
  const used = new Uint8Array(2 * E)
  const faces: Face[] = []
  for (let start = 0; start < 2 * E; start++) {
    if (used[start] || pos[start] < 0) continue
    const ring: XY[] = []
    let h = start
    let guard = 0
    while (!used[h] && guard++ < 100000) {
      used[h] = 1
      const cs = coordsOf(h)
      for (let i = 0; i < cs.length - 1; i++) ring.push(cs[i])
      const v = toNode(h)
      const twin = h ^ 1
      const list = out[v]
      const k = pos[twin]
      if (k < 0 || !list.length) break
      h = list[(k - 1 + list.length) % list.length].h
      if (fromNode(h) !== v) break
    }
    if (ring.length < 3) continue
    let a = 0
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]
      const q = ring[(i + 1) % ring.length]
      a += p[0] * q[1] - q[0] * p[1]
    }
    a /= 2
    if (a > minArea) faces.push({ ring, area: a })
  }
  return faces
}
