// Phase 9 계산을 도판과 사실 카드가 함께 쓴다: 길 그래프·도보권·가구, 가로 위요감, 링크별 속도.
// 같은 DiagramData에 대해 한 번만 계산해 둔다.

import type { LineString, MultiLineString } from 'geojson'
import { enclosureSamples, FLOOR_M, type EncSample } from '../lib/enclosure'
import { blocks, metricFromNodes, midpoint, nearestOnNetwork, networkFromEdges, type Face, type Network, type XY } from '../lib/network'
import { arealRings, lineToRingsDist, localProj, pointInRings, pointToRingsDist, ringCentroid, toXY, type LocalProj } from '../lib/xy'
import type { SpeedSnapshot } from '../sources/its'
import { WALK_SPEED, WALK_BANDS } from '../sources/network'
import type { DiagramData } from './data'

const memo = new WeakMap<DiagramData, Map<string, unknown>>()
function cached<T>(d: DiagramData, key: string, make: () => T): T {
  let m = memo.get(d)
  if (!m) memo.set(d, (m = new Map()))
  if (!m.has(key)) m.set(key, make())
  return m.get(key) as T
}

export function projOf(d: DiagramData): LocalProj {
  return cached(d, 'proj', () => localProj(d.center[0], d.center[1]))
}

export function siteRingsXY(d: DiagramData): XY[][] {
  return cached(d, 'site', () => arealRings(projOf(d), d.boundary))
}

const linePositions = (g: LineString | MultiLineString) => (g.type === 'LineString' ? [g.coordinates] : g.coordinates)

// ───────────────────────── 길 그래프 ─────────────────────────

export interface NetView {
  net: Network
  /** 길 그래프의 원점(저장할 때 대지 중심) → 지금 대지 중심 기준으로 옮긴 것 */
  shift: XY
  nachWalk: (number | null)[]
  nachWide: (number | null)[]
  /** 수집 반경 안(길 가운데 기준)인 길 */
  inDisplay: Uint8Array
  /** 대지에 붙은 길 (길 가장자리에서 8m 안) */
  adjacent: number[]
}

export function netView(d: DiagramData): NetView | null {
  return cached(d, 'net', () => {
    const r = d.network
    if (!r?.edges?.length) return null
    const p = projOf(d)
    const shift = toXY(p, r.center)
    const lines = r.edges.map((l) => l.map(([x, y]) => [x + shift[0], y + shift[1]] as XY))
    const net = networkFromEdges(lines)
    const site = siteRingsXY(d)
    const inDisplay = new Uint8Array(net.edges.length)
    const adjacent: number[] = []
    // 같은 도로중심선(속성 있는 반경 안 자료)에서 길 폭을 찾는다: 꼭짓점이 겹치면 같은 길
    const widthAt = new Map<string, number>()
    const vkey = ([x, y]: XY) => `${Math.round(x)},${Math.round(y)}`
    for (const r of d.roads)
      if (r.width)
        for (const l of r.geom.type === 'LineString' ? [r.geom.coordinates] : r.geom.coordinates) for (const c of l) widthAt.set(vkey(toXY(p, c)), r.width)
    net.edges.forEach((e, i) => {
      const m = midpoint(e)
      if (Math.hypot(m[0], m[1]) <= d.R) inDisplay[i] = 1
      if (Math.hypot(m[0], m[1]) > d.R + 200) return
      // 대지에 붙은 길: 길 가장자리에서 8m 안 (폭을 모르면 중심선에서 15m)
      const w = e.coords.map((c) => widthAt.get(vkey(c))).find((x) => x !== undefined)
      if (lineToRingsDist(e.coords, site) <= (w ? w / 2 + 8 : 15)) adjacent.push(i)
    })
    return { net, shift, nachWalk: r.nachWalk, nachWide: r.nachWide, inDisplay, adjacent }
  })
}

/** 반경 안 길 중 이 값 이상인 길의 비율 (상위 몇 %) */
export function topShare(values: (number | null)[], inDisplay: Uint8Array, v: number): number {
  let n = 0
  let above = 0
  values.forEach((x, i) => {
    if (!inDisplay[i] || x === null) return
    n++
    if (x >= v - 1e-9) above++
  })
  return n ? above / n : 1
}

// ───────────────────────── 도보권 ─────────────────────────

export interface Walkshed {
  /** 노드별 길 거리(m) */
  dist: Float64Array
  /** 출발점이 된 길 (대지에 붙은 길) */
  seeds: number
}

export function walkshed(d: DiagramData): Walkshed | null {
  return cached(d, 'walk', () => {
    const v = netView(d)
    if (!v) return null
    const site = siteRingsXY(d)
    const seeds: [number, number][] = []
    // 대지 경계에서 30m 안의 길: 그 길의 가장 가까운 점에서 출발
    v.net.edges.forEach((e, i) => {
      if (lineToRingsDist(e.coords, site) > 30) return
      let best = { s: 0, dd: Infinity }
      let along = 0
      for (let k = 0; k < e.coords.length; k++) {
        if (k > 0) along += Math.hypot(e.coords[k][0] - e.coords[k - 1][0], e.coords[k][1] - e.coords[k - 1][1])
        const dd = pointToRingsDist(e.coords[k], site)
        if (dd < best.dd) best = { s: along, dd }
      }
      seeds.push([e.a, best.s], [e.b, e.len - best.s])
      void i
    })
    if (!seeds.length) {
      // 길이 멀면 대지 중심에서 가장 가까운 길로
      const near = nearestOnNetwork(v.net, [0, 0], 300)
      if (!near) return null
      const e = v.net.edges[near[0]]
      seeds.push([e.a, near[1] + near[2]], [e.b, e.len - near[1] + near[2]])
    }
    const limit = WALK_SPEED * WALK_BANDS[WALK_BANDS.length - 1] + 100
    return { dist: metricFromNodes(v.net, seeds, limit), seeds: seeds.length / 2 }
  })
}

/** 길 위 점(길 번호, a 끝에서 거리)까지 걸어서 몇 m */
export function walkAt(v: NetView, w: Walkshed, edge: number, s: number): number {
  const e = v.net.edges[edge]
  return Math.min(w.dist[e.a] + s, w.dist[e.b] + (e.len - s))
}

/** 점(대지 중심 기준 미터)까지 걸어서 몇 m (가장 가까운 길 50m 안, 길에서 점까지 직선 거리 더함) */
export function walkToPoint(v: NetView, w: Walkshed, p: XY): number | null {
  const near = nearestOnNetwork(v.net, p, 50)
  if (!near) return null
  return walkAt(v, w, near[0], near[1]) + near[2]
}

// ───────────────────────── 가구 ─────────────────────────

export interface BlockView {
  faces: Face[]
  /** 대지 중심이 들어 있는 가구 */
  site: Face | null
}

export function blockView(d: DiagramData): BlockView | null {
  return cached(d, 'blocks', () => {
    const v = netView(d)
    if (!v) return null
    // 수집 반경 + 300m 안 길만으로 면을 만든다 (먼 곳의 큰 면 제외)
    const faces = blocks(v.net).filter((f) => f.area < 400000 && Math.hypot(...ringCentroid(f.ring)) <= d.R + 300)
    const site = faces.find((f) => pointInRings([0, 0], [f.ring])) ?? null
    return { faces, site }
  })
}

// ───────────────────────── 가로 위요감 ─────────────────────────

export interface EncView {
  roads: XY[][]
  widths: (number | null)[]
  samples: EncSample[]
  /** 대지 앞 길의 표본 */
  front: EncSample[]
}

export function encView(d: DiagramData): EncView | null {
  return cached(d, 'enc', () => {
    if (!d.roads.length || !d.buildings.length) return null
    const p = projOf(d)
    const roads: XY[][] = []
    const widths: (number | null)[] = []
    for (const r of d.roads)
      for (const l of linePositions(r.geom)) {
        roads.push(l.map((c) => toXY(p, c)))
        widths.push(r.width)
      }
    const blds = d.buildings.map((b) => ({ rings: arealRings(p, b.geom), h: b.floors && b.floors > 0 ? b.floors * FLOOR_M : null }))
    const samples = enclosureSamples(
      roads.map((coords, i) => ({ coords, width: widths[i] })),
      blds,
    )
    const site = siteRingsXY(d)
    const adjRoads = new Set<number>()
    roads.forEach((l, i) => {
      if (lineToRingsDist(l, site) <= (widths[i] ?? 4) / 2 + 3) adjRoads.add(i)
    })
    const front = samples.filter((s) => adjRoads.has(s.road) && pointToRingsDist(s.p, site) <= (widths[s.road] ?? 4) / 2 + 12)
    return { roads, widths, samples, front }
  })
}

// ───────────────────────── 실시간 속도 ─────────────────────────

export const SPEED_BINS = [
  { label: '시속 15km 미만 (막힘)', min: 0 },
  { label: '15~25km', min: 15 },
  { label: '25~40km', min: 25 },
  { label: '40~60km', min: 40 },
  { label: '60km 이상', min: 60 },
]

export function speedBin(v: number): number {
  return SPEED_BINS.filter((b) => v >= b.min).length - 1
}

export interface LinkSpeedView {
  /** 반경 안 링크: [링크 번호(d.links), 속도 또는 null] */
  inRadius: { i: number; v: number | null; len: number }[]
  /** 대지에 붙은 링크 (20m 안) */
  adjacent: { i: number; v: number | null }[]
}

export function linkSpeeds(d: DiagramData, snap: SpeedSnapshot): LinkSpeedView {
  return cached(d, `speed:${snap.at}`, () => {
    const p = projOf(d)
    const site = siteRingsXY(d)
    const inRadius: LinkSpeedView['inRadius'] = []
    const adjacent: LinkSpeedView['adjacent'] = []
    d.links.forEach((l, i) => {
      const parts = linePositions(l.geom).map((ls) => ls.map((c) => toXY(p, c)))
      let len = 0
      let mid: XY = parts[0]?.[0] ?? [0, 0]
      for (const pt of parts) for (let k = 1; k < pt.length; k++) len += Math.hypot(pt[k][0] - pt[k - 1][0], pt[k][1] - pt[k - 1][1])
      if (parts[0]?.length) mid = parts[0][Math.floor(parts[0].length / 2)]
      const v = l.id && snap.speeds[l.id] !== undefined ? snap.speeds[l.id] : null
      if (Math.hypot(mid[0], mid[1]) <= d.R) inRadius.push({ i, v, len })
      if (parts.some((pt) => lineToRingsDist(pt, site) <= 20)) adjacent.push({ i, v })
    })
    return { inRadius, adjacent }
  })
}

export { WALK_BANDS, WALK_SPEED }
