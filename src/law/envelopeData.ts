// 건축 가능 영역 공통 (2026-11-21 묶음 E5·E6): ⑪ 화면 · ⑥ 3D 도판 · ⑩ .3dm이 같은 입력으로 같은 덩어리를 만들도록.
//  - envelopeInputFrom: 대지 자료(도판 자료) + ⑪ 입력 → 계산 입력
//  - computeEnvelopeFor: 높이 제한이 없으면 검토서의 층수(넣은 값 또는 가정) × 층고에서 그림용으로 자름, 띄울 거리 칸이 비면 조례 별표 값
//  - envelopeSlabMeshes: 단(바닥~위 + 발자국)을 삼각형으로 (윗면·바닥면은 earcut, 벽은 변마다 두 삼각형) — ⑩ .3dm·미리보기

import { area, booleanIntersects, feature } from '@turf/turf'
import earcut from 'earcut'
import type { DiagramData } from '../diagrams/data'
import { projOf, siteRingsXY } from '../diagrams/move'
import { siteZones, zoneRule, type ZoneRule } from '../diagrams/panelsLaw'
import type { XY } from '../lib/network'
import { arealRings, toXY } from '../lib/xy'
import type { EnvelopeState, Project } from '../model/types'
import { siteKey } from '../model/project'
import { computeEnvelope, type EnvelopeInput, type EnvelopeResult, type EnvSlab } from './envelope'
import { loadOrdinances, regionIdOf, zoneKey, type OrdinanceTable, type RegionTable } from './ordinances'
import { planOf, type PlanInput } from './plan'
import { setbackFor, type SetbackAnswer } from './setback'
import { readScenicHeight, type ScenicHeight } from './ordinanceRules'

export type SiteZone = { name: string; share: number; rule: ZoneRule | null }

/** 도판·모형이 프로젝트 없이 받는 법규 입력 */
export interface LawCtx {
  env: EnvelopeState
  apartment: boolean
  edgesValid: boolean
  regionId: string | null
  /** 필지로 정한 대지의 토지대장 면적 합 (그린 경계면 null → 도형 넓이) */
  parcelArea: number | null
  /** 계획 값 (2026-11-21 묶음 F1): 띄울 거리를 조례 표에서 고를 때 주용도·연면적·층수 */
  plan: PlanInput
}

type EnvLaw = Pick<LawCtx, 'env' | 'apartment' | 'edgesValid' | 'plan'>

/** 필지로 정한 대지면 토지대장 면적 합, 그린 경계면 null (⑪과 도판·모형이 같은 면적을 쓰게) */
export function parcelAreaOf(project: Project): number | null {
  const s = project.site
  return s.parcels.length && s.boundaryMode !== 'drawn' ? s.parcels.reduce((sum, p) => sum + (p.areaM2 || 0), 0) : null
}

export function boundaryArea(d: DiagramData | null): number {
  try {
    return d ? area(feature(d.boundary)) : 0
  } catch {
    return 0
  }
}

export function lawCtxOf(project: Project): LawCtx | null {
  // ⑪에서 무엇이든 정했으면 (띄울 거리는 비워도 조례 값으로 — 묶음 F1)
  if (!project.law || (!project.law.envelope && !project.law.use)) return null
  const env = project.law.envelope ?? {}
  return {
    env,
    apartment: project.law?.use?.no === '2',
    edgesValid: !env.siteKey || env.siteKey === siteKey(project.site),
    regionId: regionIdOf(project),
    parcelArea: parcelAreaOf(project),
    plan: planInputOf(project),
  }
}

export function planInputOf(project: Project): PlanInput {
  const l = project.law ?? {}
  return { use: l.use ?? null, gfa: l.gfa, floors: l.floors, basement: l.basement, units: l.units }
}

/** 조례 표에서 고른 띄울 거리 (⑪ 칸을 비우면 이 값) — 넣은 값이 없을 때 가능 영역·도판·모형이 같이 씀 */
export function autoSetbackOf(zones: SiteZone[], siteArea: number, region: RegionTable | null, table: OrdinanceTable | null, plan: PlanInput): SetbackAnswer {
  return setbackForPlan(zones, region, table, planOf(plan, siteArea, zones, region))
}

function setbackForPlan(zones: SiteZone[], region: RegionTable | null, table: OrdinanceTable | null, p: ReturnType<typeof planOf>): SetbackAnswer {
  return setbackFor(region, table?.regions ?? [], {
    useNo: p.use?.no ?? null,
    sub: p.use?.sub,
    area: p.gfa?.v ?? 0,
    floors: p.floors?.v ?? 0,
    zone: zones[0]?.rule?.label ?? zones[0]?.name ?? '',
  })
}

/** 대지에 걸친 용도지구·구역 이름 (⑪·도판·모형이 같이 씀) */
export function siteOverlays(d: DiagramData | null): string[] {
  if (!d) return []
  const names = new Set<string>()
  for (const x of d.districts) {
    try {
      if (booleanIntersects(feature(x.geom), feature(d.boundary))) names.add(x.name)
    } catch {
      /* 계산 실패한 도형은 건너뜀 */
    }
  }
  return [...names]
}

export interface AutoHeight {
  /** 경관지구 조례로 정한 최고 높이 (m, 층수는 층고로 바꿈) — 없으면 null */
  m: number | null
  /** 최저 층수 ('2층 이상') */
  minFloors: number | null
  answers: ScenicHeight[]
  /** 걸친 경관지구 중 조례에서 높이 기준을 못 찾은 것 */
  unread: string[]
}

/** 걸친 경관지구마다 조례의 높이·층수 (묶음 F5) — 여럿이면 가장 낮은 쪽 */
export function autoHeightOf(region: RegionTable | null, zones: SiteZone[], overlays: string[], floorH: number): AutoHeight {
  const zone = zones[0] ? (zones[0].rule?.label ?? zones[0].name) : ''
  const answers: ScenicHeight[] = []
  const unread: string[] = []
  for (const o of overlays.filter((n) => /경관지구/.test(n))) {
    const a = readScenicHeight(region?.urban?.scenic, { district: o, zone })
    if (a) answers.push(a)
    else unread.push(o)
  }
  const caps = answers.map((a) => Math.min(a.maxM ?? Infinity, a.maxFloors ? a.maxFloors * floorH : Infinity)).filter((x) => Number.isFinite(x))
  const mins = answers.map((a) => a.minFloors).filter((x): x is number => x !== null)
  return { m: caps.length ? Math.min(...caps) : null, minFloors: mins.length ? Math.max(...mins) : null, answers, unread }
}

export function envelopeInputFrom(d: DiagramData, zones: SiteZone[], law: EnvLaw, auto: { road: number; side: number } = { road: 0, side: 0 }, autoMaxHeight: number | null = null): Omit<EnvelopeInput, 'displayCap'> {
  const { env } = law
  const p = projOf(d)
  const site = siteRingsXY(d)
  const xs = site.flat().map((q) => q[0])
  const ys = site.flat().map((q) => q[1])
  const pad = 150
  const bb = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad]
  const near = (q: XY) => q[0] >= bb[0] && q[0] <= bb[2] && q[1] >= bb[1] && q[1] <= bb[3]
  const roads = d.roads.flatMap((r) => {
    const lines = r.geom.type === 'LineString' ? [r.geom.coordinates] : r.geom.coordinates
    return lines.map((l) => ({ line: l.map((c) => toXY(p, c)), width: r.width })).filter((l) => l.line.some(near))
  })
  const zoneShapes = d.zoning
    .map((z) => ({ rings: arealRings(p, z.geom), residential: !!zoneRule(z.name)?.sunlight, name: z.name }))
    .filter((z) => z.rings.some((r) => r.some(near)))
  const opens = d.parks.map((a) => ({ rings: arealRings(p, a.geom), kind: a.extra.kind })).filter((o) => o.rings.some((r) => r.some(near)))
  return {
    site,
    roads,
    zones: zoneShapes,
    opens,
    siteResidentialFallback: !d.zoning.length && zones.some((z) => z.rule?.sunlight),
    // 칸을 비우면 조례 표에서 고른 값 (묶음 F1)
    setbackRoad: env.setbackRoad ?? auto.road,
    setbackSide: env.setbackSide ?? auto.side,
    edgeOverride: law.edgesValid ? env.edges : undefined,
    // 칸을 비우면 경관지구 조례의 높이 (묶음 F5)
    maxHeight: env.maxHeight ?? autoMaxHeight,
    apartment: law.apartment,
    step: env.step === 'meter' ? { kind: 'meter' } : { kind: 'floor', floorH: env.floorH ?? 3.5 },
  }
}

/** 대표 용도지역의 용적률 (조례 값, 없으면 법 상한) */
export function farOf(region: RegionTable | null, zones: SiteZone[]): number | undefined {
  const z = zones[0]
  if (!z) return undefined
  return region?.urban?.far?.[zoneKey(z.rule?.label ?? z.name)]?.pct ?? z.rule?.farMax
}

export function bcrOf(region: RegionTable | null, zones: SiteZone[]): number | undefined {
  const z = zones[0]
  if (!z) return undefined
  return region?.urban?.bcr?.[zoneKey(z.rule?.label ?? z.name)]?.pct ?? z.rule?.bcr
}

function capFor(region: RegionTable | null, zones: SiteZone[], siteArea: number, buildable: number, floorH: number): number {
  const far = farOf(region, zones)
  if (!far || !buildable) return 60
  return Math.max(10, Math.ceil(((far / 100) * siteArea) / buildable) * floorH)
}

export interface EnvelopeRun {
  result: EnvelopeResult | null
  cap: number | null
  /** 조례 표에서 고른 띄울 거리 (칸을 비웠을 때 쓴 값) */
  auto: SetbackAnswer
  /** 실제로 계산에 쓴 띄울 거리 */
  used: { road: number; side: number; roadFrom: 'input' | 'auto'; sideFrom: 'input' | 'auto'; height: number | null; heightFrom: 'input' | 'auto' | null }
  /** 경관지구 조례에서 읽은 높이 (묶음 F5) */
  height: AutoHeight
}

export function computeEnvelopeFor(d: DiagramData, zones: SiteZone[], siteArea: number, region: RegionTable | null, table: OrdinanceTable | null, law: EnvLaw): EnvelopeRun {
  const plan = planOf(law.plan, siteArea, zones, region)
  const auto = setbackForPlan(zones, region, table, plan)
  const floorH0 = law.env.floorH ?? 3.5
  const height = autoHeightOf(region, zones, siteOverlays(d), floorH0)
  const maxH = law.env.maxHeight ?? height.m
  const used = {
    road: law.env.setbackRoad ?? auto.road,
    side: law.env.setbackSide ?? auto.side,
    roadFrom: (law.env.setbackRoad !== undefined ? 'input' : 'auto') as 'input' | 'auto',
    sideFrom: (law.env.setbackSide !== undefined ? 'input' : 'auto') as 'input' | 'auto',
    height: maxH,
    heightFrom: (law.env.maxHeight !== undefined ? 'input' : height.m !== null ? 'auto' : null) as 'input' | 'auto' | null,
  }
  const base = envelopeInputFrom(d, zones, law, auto, height.m)
  const first = computeEnvelope({ ...base, displayCap: maxH ?? 60 })
  if (!first || !first.unlimited || maxH) return { result: first, cap: null, auto, used, height }
  // 높이 제한이 없으면 검토서와 같은 층수(넣은 값 또는 가정)에서 자름 — 층수를 모르면 용적률 상한 연면적을 가능 바닥에 쌓은 높이
  const floorH = law.env.floorH ?? 3.5
  const cap = plan.floors ? Math.max(floorH, plan.floors.v * floorH) : capFor(region, zones, siteArea || first.siteArea, first.buildableArea, floorH)
  return { result: computeEnvelope({ ...base, displayCap: cap }), cap, auto, used, height }
}

/** 도판·모형용: 프로젝트 없이 법규 입력 + 조례 표로 ⑪과 같은 덩어리 */
export function envelopeOf(d: DiagramData, law: LawCtx, table: OrdinanceTable | null) {
  const zones = siteZones(d)
  const region = (law.regionId && table?.regions.find((r) => r.id === law.regionId)) || null
  const siteArea = law.parcelArea ?? boundaryArea(d)
  return { ...computeEnvelopeFor(d, zones, siteArea, region, table, law), zones, region, siteArea }
}

// ───────────────────────── 삼각형 ─────────────────────────

/** 닫힌 고리 단순화 (더글러스–포이커, 칸 계단을 펴 줌) */
function simplifyRing(r: XY[], tol: number): XY[] {
  if (r.length <= 4) return r
  const keep = new Uint8Array(r.length)
  // 가장 먼 두 점으로 나눠 양쪽을 따로
  let far = 0
  for (let i = 1; i < r.length; i++) if (Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]) > Math.hypot(r[far][0] - r[0][0], r[far][1] - r[0][1])) far = i
  const rdp = (a: number, b: number) => {
    let idx = -1
    let dmax = tol
    const [ax, ay] = r[a]
    const [bx, by] = r[b % r.length]
    const L = Math.hypot(bx - ax, by - ay) || 1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = r[i]
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L
      if (d > dmax) {
        dmax = d
        idx = i
      }
    }
    if (idx >= 0) {
      keep[idx] = 1
      rdp(a, idx)
      rdp(idx, b)
    }
  }
  keep[0] = 1
  keep[far] = 1
  rdp(0, far)
  rdp(far, r.length)
  const out = r.filter((_, i) => keep[i])
  return out.length >= 3 ? out : r
}

function signedArea(r: XY[]): number {
  let a = 0
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i]
    const [x2, y2] = r[(i + 1) % r.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

/** 칸 계단을 편 단 (3D 도판·.3dm이 같이 씀). 너무 작은 고리는 뺌 */
export function simplifiedSlabs(r: EnvelopeResult): EnvSlab[] {
  const tol = r.cell * 1.2
  return r.slabs
    .map((s) => ({ ...s, rings: s.rings.map((ring) => simplifyRing(ring, tol)).filter((ring) => Math.abs(signedArea(ring)) > r.cell * r.cell * 0.5) }))
    .filter((s) => s.rings.length)
}

export interface EnvSlabMesh {
  bottom: number
  top: number
  /** 대지 중심 원점 동·북·위 (m) */
  positions: number[]
  indices: number[]
}

/** 단마다 닫힌 삼각형 덩어리: 바깥 고리 + 그 안의 구멍으로 윗면·바닥면(earcut), 고리 변마다 벽 두 삼각형 */
export function envelopeSlabMeshes(r: EnvelopeResult): EnvSlabMesh[] {
  const out: EnvSlabMesh[] = []
  for (const s of simplifiedSlabs(r)) {
    const positions: number[] = []
    const indices: number[] = []
    const add = (x: number, y: number, z: number) => {
      positions.push(x, y, z)
      return positions.length / 3 - 1
    }
    // 칸 추적은 안쪽을 왼쪽에: 바깥 고리 반시계(넓이 +), 구멍 시계(넓이 −)
    const outers = s.rings.filter((ring) => signedArea(ring) > 0)
    const holes = s.rings.filter((ring) => signedArea(ring) < 0)
    for (const outer of outers) {
      const mine = holes.filter((h) => inRing(h[0], outer))
      const flat: number[] = []
      const holeIdx: number[] = []
      for (const p of outer) flat.push(p[0], p[1])
      for (const h of mine) {
        holeIdx.push(flat.length / 2)
        for (const p of h) flat.push(p[0], p[1])
      }
      const tri = earcut(flat, holeIdx.length ? holeIdx : undefined, 2)
      const n = flat.length / 2
      const top: number[] = []
      const bot: number[] = []
      for (let i = 0; i < n; i++) {
        top.push(add(flat[2 * i], flat[2 * i + 1], s.top))
        bot.push(add(flat[2 * i], flat[2 * i + 1], s.bottom))
      }
      // earcut 결과의 감김을 넓이로 확인해 윗면은 위로, 바닥면은 아래로 향하게
      for (let t = 0; t < tri.length; t += 3) {
        const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]]
        const up = (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1]) - (flat[2 * c] - flat[2 * a]) * (flat[2 * b + 1] - flat[2 * a + 1]) > 0
        if (up) {
          indices.push(top[a], top[b], top[c], bot[a], bot[c], bot[b])
        } else {
          indices.push(top[a], top[c], top[b], bot[a], bot[b], bot[c])
        }
      }
      // 벽: 안쪽이 왼쪽이므로 (아래 a → 아래 b → 위 b) 감김이 바깥을 향함
      const walls = (start: number, len: number) => {
        for (let i = 0; i < len; i++) {
          const a = start + i
          const b = start + ((i + 1) % len)
          indices.push(bot[a], bot[b], top[b], bot[a], top[b], top[a])
        }
      }
      walls(0, outer.length)
      let at = outer.length
      for (const h of mine) {
        walls(at, h.length)
        at += h.length
      }
    }
    if (indices.length) out.push({ bottom: s.bottom, top: s.top, positions, indices })
  }
  return out
}

function inRing(p: XY, ring: XY[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** 모형(⑩ .3dm·미리보기)에 넣을 건축 가능 영역: ⑪과 같은 계산 → 단마다 삼각형 + 넣은 값 메모 */
export async function envelopeForModel(d: DiagramData, law: LawCtx): Promise<{ slabs: EnvSlabMesh[]; note: string } | null> {
  const table = await loadOrdinances()
  const { result: r, cap, used } = envelopeOf(d, law, table)
  if (!r) return null
  const slabs = envelopeSlabMeshes(r)
  if (!slabs.length) return null
  const env = law.env
  const note = [
    '참고용·확인 필요 (법적 판정 아님)',
    `건축선에서 ${used.road}m(${used.roadFrom === 'input' ? '넣은 값' : '조례'}) · 인접 대지에서 ${used.side}m(${used.sideFrom === 'input' ? '넣은 값' : '조례'})`,
    used.height ? `최고 높이 ${Math.round(used.height * 10) / 10}m(${used.heightFrom === 'input' ? '넣은 값' : '경관지구 조례'})` : `높이 제한 넣지 않음${cap ? ` — ${Math.round(cap * 10) / 10}m에서 자름` : ''}`,
    (env.step ?? 'floor') === 'floor' ? `층고 ${env.floorH ?? 3.5}m 계단` : '1m 계단',
    '정북 일조(건축법 제61조 ①) 반영',
  ].join(' · ')
  return { slabs, note }
}
