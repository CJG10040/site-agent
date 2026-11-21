// 건축 가능 영역 (2026-11-21 묶음 E5): 대지를 칸으로 나눠 칸마다 지을 수 있는 높이를 구하고, 같은 높이 이상인 칸끼리 묶어
// 층층이 쌓인 덩어리로 만든다. 참고용 — 법적 판정이 아님.
//  1) 대지 안의 공지: 건축선(도로에 접한 변)에서 setbackRoad, 인접 대지경계선에서 setbackSide m 안쪽은 뺌 (학생이 넣음 — 조례 별표)
//  2) 좁은 도로: 너비가 4m에 못 미치는 도로에 접한 변은 건축선이 (4 − 너비)/2 만큼 안으로 (건축법 제46조 ①)
//  3) 정북 일조(전용·일반주거지역, 건축법 제61조 ①): 정북 방향 인접 대지경계선까지 거리 d에서 높이 10m 이하 1.5m · 10~17m 5m ·
//     17m 초과 부분은 높이의 1/2 이상 띄움. 북쪽에 도로·공원·하천 등이 있으면 그 반대편 경계(공동주택은 가운데 선)부터 잼(시행령 제86조 ⑥),
//     북쪽 대지가 주거지역이 아니면 적용하지 않음(시행령 제86조 ② 1호)
//  4) 최고 높이: 학생이 넣은 값(지구·가로구역·지구단위계획)
//  계단: 층고 단위(층 꼭대기가 높이 안에 들어가는 층까지) 또는 1m 단위.
// 사용자 결정(2026-11-21): 띄울 거리·최고 높이는 직접 넣기, 도로변은 앱이 찾고 눌러 고침, 계단은 둘 다 고를 수 있게.

import { dropCollinear, traceCells } from '../lib/massing'
import type { XY } from '../lib/network'
import { pointInRings, segPointDist } from '../lib/xy'
import { sunlightHeight } from '../diagrams/panelsLaw'

export interface EnvRoad {
  line: XY[]
  width: number | null
}

export interface EnvZone {
  rings: XY[][]
  residential: boolean
  name: string
}

export interface EnvOpen {
  rings: XY[][]
  kind: string
}

export type EnvStep = { kind: 'floor'; floorH: number } | { kind: 'meter' }

export interface EnvelopeInput {
  /** 대지 고리 (대지 중심 원점 m, 바깥 + 구멍) */
  site: XY[][]
  roads: EnvRoad[]
  /** 둘레 용도지역 도형 */
  zones: EnvZone[]
  /** 공원·하천·광장 등 건축이 허용되지 않는 곳 */
  opens: EnvOpen[]
  /** 용도지역 도형이 대지를 덮지 않을 때 주거지역으로 볼지 (토지이용계획 이름으로) */
  siteResidentialFallback: boolean
  setbackRoad: number
  setbackSide: number
  /** 변 종류 고침: `${고리}:${변}` → road/side */
  edgeOverride?: Record<string, 'road' | 'side'>
  maxHeight: number | null
  apartment: boolean
  step: EnvStep
  /** 높이 제한이 없는 칸을 그림에서 자를 높이 */
  displayCap: number
}

export interface EnvEdge {
  key: string
  a: XY
  b: XY
  kind: 'road' | 'side'
  auto: 'road' | 'side'
  roadWidth: number | null
  /** 좁은 도로 건축선 후퇴 (m) */
  extra: number
}

export interface EnvSlab {
  bottom: number
  top: number
  /** 지역 좌표 m 고리들 */
  rings: XY[][]
  area: number
}

export interface EnvelopeResult {
  edges: EnvEdge[]
  cell: number
  grid: { nx: number; ny: number; x0: number; y0: number; h: Float32Array; inside: Uint8Array }
  slabs: EnvSlab[]
  /** 높이 0보다 큰 칸 넓이 (1층 바닥으로 쓸 수 있는 넓이) */
  buildableArea: number
  siteArea: number
  maxHeight: number
  /** 층고 단위일 때 칸마다 층수 × 칸 넓이의 합 (가능 영역을 꽉 채운 연면적) */
  fullGfa: number | null
  unlimited: boolean
  sunCells: number
  sunExemptCells: number
  sunUnknownNeighbor: number
  narrowRoads: number
  unknownWidthRoads: number
}

const RAY_MAX = 80
const RAY_STEP = 0.5

/** 점에서 정북으로 가며 처음 만나는 대지 경계의 y (없으면 null) */
function northCross(p: XY, rings: XY[][]): number | null {
  let best = Infinity
  for (const ring of rings)
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, ay] = ring[i]
      const [bx, by] = ring[i + 1]
      if ((ax <= p[0] && bx > p[0]) || (bx <= p[0] && ax > p[0])) {
        const y = ay + ((p[0] - ax) / (bx - ax)) * (by - ay)
        if (y > p[1] && y < best) best = y
      }
    }
  return Number.isFinite(best) ? best : null
}

function lineDist(p: XY, line: XY[]): number {
  let m = Infinity
  for (let i = 1; i < line.length; i++) m = Math.min(m, segPointDist(p, line[i - 1], line[i]))
  return m
}

/** 도로 띠(너비를 아는 도로만) 또는 공원·하천 등 건축이 허용되지 않는 곳인지 */
function isOpen(q: XY, inp: EnvelopeInput): boolean {
  if (inp.opens.some((o) => pointInRings(q, o.rings))) return true
  return inp.roads.some((r) => r.width !== null && r.width > 0 && lineDist(q, r.line) <= r.width / 2)
}

/** 변마다 도로에 접했는지 (변 위 세 점이 도로 중심선에서 너비/2 + 3m 안에 둘 이상) */
export function siteEdges(inp: Pick<EnvelopeInput, 'site' | 'roads' | 'edgeOverride'>): EnvEdge[] {
  const out: EnvEdge[] = []
  inp.site.forEach((ring, ri) => {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]
      const b = ring[i + 1]
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) continue
      let hits = 0
      let width: number | null = null
      let bestD = Infinity
      for (const t of [0.25, 0.5, 0.75]) {
        const p: XY = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        let hit = false
        for (const r of inp.roads) {
          const d = lineDist(p, r.line)
          if (d <= (r.width ?? 6) / 2 + 3) {
            hit = true
            if (d < bestD) {
              bestD = d
              width = r.width
            }
          }
        }
        if (hit) hits++
      }
      const key = `${ri}:${i}`
      const auto: 'road' | 'side' = hits >= 2 ? 'road' : 'side'
      const kind = inp.edgeOverride?.[key] ?? auto
      const extra = kind === 'road' && width !== null && width > 0 && width < 4 ? (4 - width) / 2 : 0
      out.push({ key, a, b, kind, auto, roadWidth: kind === 'road' ? width : null, extra })
    }
  })
  return out
}

export function computeEnvelope(inp: EnvelopeInput): EnvelopeResult | null {
  const pts = inp.site.flat()
  if (pts.length < 3) return null
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const w = Math.max(...xs) - x0
  const hgt = Math.max(...ys) - y0
  // 칸 크기: 대지가 클수록 크게 (칸 수 약 4만 개 안팎)
  const cell = Math.min(2, Math.max(0.5, Math.round(Math.sqrt((w * hgt) / 40000) * 4) / 4))
  const nx = Math.max(1, Math.ceil(w / cell))
  const ny = Math.max(1, Math.ceil(hgt / cell))
  const edges = siteEdges(inp)
  const h = new Float32Array(nx * ny)
  const inside = new Uint8Array(nx * ny)
  const cap = inp.maxHeight && inp.maxHeight > 0 ? inp.maxHeight : Infinity
  let unlimited = false
  let sunCells = 0
  let sunExemptCells = 0
  let sunUnknownNeighbor = 0
  const northCache = new Map<string, { gap: number; nz: EnvZone | null }>()

  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const p: XY = [x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell]
      if (!pointInRings(p, inp.site)) continue
      const k = j * nx + i
      inside[k] = 1
      // 1·2) 대지 안의 공지 + 좁은 도로 건축선
      let out = false
      for (const e of edges) {
        const d = segPointDist(p, e.a, e.b)
        if (e.kind === 'road' ? d < inp.setbackRoad + e.extra : d < inp.setbackSide) {
          out = true
          break
        }
      }
      if (out) continue
      let limit = cap
      // 3) 정북 일조
      const zone = inp.zones.find((z) => pointInRings(p, z.rings))
      const residential = zone ? zone.residential : inp.siteResidentialFallback
      if (residential) {
        const yc = northCross(p, inp.site)
        if (yc !== null) {
          // 북쪽 경계 밖으로 도로·공원 등이 이어지면 그 반대편까지 (같은 열·같은 경계점은 한 번만 셈)
          const ck = `${i}:${yc.toFixed(2)}`
          let hit = northCache.get(ck)
          if (!hit) {
            let gap = 0
            while (gap < RAY_MAX && isOpen([p[0], yc + gap + RAY_STEP / 2], inp)) gap += RAY_STEP
            const beyond: XY = [p[0], yc + gap + 1]
            hit = { gap, nz: inp.zones.find((z) => pointInRings(beyond, z.rings)) ?? null }
            northCache.set(ck, hit)
          }
          const { gap, nz } = hit
          if (nz && !nz.residential) {
            sunExemptCells++
          } else {
            if (!nz) sunUnknownNeighbor++
            sunCells++
            const dist = yc + (inp.apartment ? gap / 2 : gap) - p[1]
            limit = Math.min(limit, sunlightHeight(dist))
          }
        }
      }
      if (!Number.isFinite(limit)) {
        unlimited = true
        limit = inp.displayCap
      }
      // 계단
      const stepped = inp.step.kind === 'floor' ? Math.floor((limit + 1e-6) / inp.step.floorH) * inp.step.floorH : Math.floor(limit + 1e-6)
      h[k] = Math.max(0, stepped)
    }

  // 덩어리: 서로 다른 높이마다 그 높이 이상인 칸의 발자국을 한 단으로
  const levels = [...new Set(Array.from(h).filter((v) => v > 0))].sort((a, b) => a - b)
  const slabs: EnvSlab[] = []
  let prev = 0
  for (const top of levels) {
    const raw = traceCells((i, j) => i >= 0 && j >= 0 && i < nx && j < ny && h[j * nx + i] >= top - 1e-6, nx, ny)
    const rings = raw.map((r) => dropCollinear(r).map(([i, j]) => [x0 + i * cell, y0 + j * cell] as XY)).filter((r) => r.length >= 3)
    let cnt = 0
    for (let k = 0; k < h.length; k++) if (h[k] >= top - 1e-6) cnt++
    slabs.push({ bottom: prev, top, rings, area: cnt * cell * cell })
    prev = top
  }
  let buildable = 0
  let insideCnt = 0
  let floorsSum = 0
  for (let k = 0; k < h.length; k++) {
    if (inside[k]) insideCnt++
    if (h[k] > 0) {
      buildable++
      if (inp.step.kind === 'floor') floorsSum += Math.round(h[k] / inp.step.floorH)
    }
  }
  const narrow = edges.filter((e) => e.extra > 0).length
  const unknownW = edges.filter((e) => e.kind === 'road' && e.roadWidth === null).length
  return {
    edges,
    cell,
    grid: { nx, ny, x0, y0, h, inside },
    slabs,
    buildableArea: buildable * cell * cell,
    siteArea: insideCnt * cell * cell,
    maxHeight: levels.length ? levels[levels.length - 1] : 0,
    fullGfa: inp.step.kind === 'floor' ? floorsSum * cell * cell : null,
    unlimited,
    sunCells,
    sunExemptCells,
    sunUnknownNeighbor,
    narrowRoads: narrow,
    unknownWidthRoads: unknownW,
  }
}
