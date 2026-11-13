// ④ 공간정보 › 항목별로 쓸 자료 고르기 (사용자 결정 2026-11-13).
// 1:1,000(예: 2019 촬영·2020 조사)과 1:5,000(예: 2025)을 함께 올리면 예전에는 1:1,000 도엽 안을 모두 1:1,000으로 바꿨으나,
// 1:1,000이 오래돼 지금과 다른 곳이 많아(같은 범위에서 땅 높이가 1m 넘게 다른 곳 34%, 2020에만 있는 건물 약 220동) 항목마다 고르게 한다.
//  - 기본: 새 1:5,000이 있으면 지형(등고선·표고점·옹벽·절성토)·건물·도로경계·인도·도로중심선·하천은 1:5,000,
//          1:5,000에 없거나 훨씬 덜 자세한 것(횡단보도·정류장·가로수·가로등·담장·교통섬)은 1:1,000, 횡단보도는 정밀도로지도가 있으면 정밀도로지도.
//  - 바뀐 곳 자동(기본 켬): 1:1,000을 고른 항목도 '바뀐 곳'(lib/sourceChange) 안은 1:1,000을 빼고 1:5,000으로 바꿔 넣는다(1:5,000에 없는 항목은 빼기만).
//    선(등고선·옹벽·담장·도로중심선 등)은 바뀐 곳 경계에서 잘라 나눈다. 5,000m²가 넘는 면(도로경계처럼 큰 면)은 바꾸지 않는다.
//  - 1:1,000 도엽 밖은 지금처럼 1:5,000 (안 씀을 고르면 빼기). 1:5,000 도엽이 없는 1:1,000 범위는 1:5,000을 골라도 1:1,000.

import type { Geometry, Position } from 'geojson'
import { findChanges, inChange, interiorPoint, splitByChange, type Bounds, type ChangeAreas } from '../lib/sourceChange'
import { NGII5_READER_V, NGII_LABEL, ngiiLayer, type Feat, type NgiiKey } from '../sources/ngiiMap'
import type { Project, SourceId } from './types'

export type PickKey = Exclude<NgiiKey, 'walkline'>

export const PICK_GROUPS: { title: string; keys: PickKey[] }[] = [
  { title: '지형', keys: ['contour', 'spot', 'wall', 'cutfill'] },
  { title: '건물', keys: ['bldg'] },
  { title: '도로', keys: ['road', 'walk', 'center', 'crosswalk', 'safety'] },
  { title: '가로 시설', keys: ['stop', 'tree', 'lamp', 'fence'] },
  { title: '물', keys: ['water'] },
]
export const PICK_KEYS: PickKey[] = PICK_GROUPS.flatMap((g) => g.keys)
export const PICK_LABEL: Record<PickKey, string> = { ...NGII_LABEL, walk: '인도 (면·보도 중심선)' }

/** 1:5,000에서 처음부터 읽은 항목 */
const BASE5000: PickKey[] = ['contour', 'spot', 'wall', 'cutfill', 'bldg', 'road', 'walk']
/** 1:5,000에서 2026-11-13부터 읽는 항목 (그 전에 올린 1:5,000에는 없음 — 다시 올려야) */
export const NEW5000: PickKey[] = ['center', 'safety', 'fence', 'water']
/** 새 1:5,000이 있으면 기본으로 1:5,000 */
const PREFER_NEW: PickKey[] = ['contour', 'spot', 'wall', 'cutfill', 'bldg', 'road', 'walk', 'center', 'water']
/** 이보다 큰 면은 바뀐 곳이라도 바꾸지 않음 (도로경계처럼 여러 블록에 걸친 면) */
const BIG_AREA = 5000

export interface PickCtx {
  scaleOf: Map<string, number>
  cover1000: Bounds[]
  cover5000: Bounds[]
  year1000: string | null
  year5000: string | null
  /** 1:5,000이 1:1,000보다 새 것 */
  newer5000: boolean
  /** 1:5,000을 새 읽기(판 4)로 올림 → 도로중심선·교통섬·담장·하천도 있음 */
  v5000: boolean
  /** 예전에 올린 1:5,000이 있음 (다시 올리면 도로중심선 등이 더 들어감) */
  old5000: boolean
  hasHd: boolean
}

const yearsOf = (ps: Record<string, unknown>[]) => [...new Set(ps.map((p) => String(p.year ?? '')).filter(Boolean))].sort()

export function pickCtx(project: Project): PickCtx {
  const sheets = (project.collected[ngiiLayer('sheets')]?.features ?? []).map((f) => f.properties)
  const s1 = sheets.filter((p) => Number(p.scale) === 1000)
  const s5 = sheets.filter((p) => Number(p.scale) !== 1000)
  const y1 = yearsOf(s1)
  const y5 = yearsOf(s5)
  const max1 = y1.length ? Number(y1[y1.length - 1]) : NaN
  const min5 = y5.length ? Number(y5[0]) : NaN
  return {
    scaleOf: new Map(sheets.map((p) => [String(p.code), Number(p.scale) || 5000])),
    cover1000: s1.map((p) => p.bounds as Bounds).filter(Boolean),
    cover5000: s5.map((p) => p.bounds as Bounds).filter(Boolean),
    year1000: y1.join('·') || null,
    year5000: y5.join('·') || null,
    newer5000: Number.isFinite(max1) && Number.isFinite(min5) && min5 > max1,
    v5000: s5.some((p) => Number(p.v ?? 0) >= NGII5_READER_V),
    old5000: s5.some((p) => Number(p.v ?? 0) < NGII5_READER_V),
    hasHd: (project.collected['hd:files']?.features.length ?? 0) > 0,
  }
}

/** 이 항목에 고를 수 있는 자료 (안 씀 포함) */
export function sourcesFor(key: PickKey, ctx: PickCtx): SourceId[] {
  const out: SourceId[] = []
  if (ctx.cover1000.length) out.push('1000')
  if (ctx.cover5000.length && (BASE5000.includes(key) || (NEW5000.includes(key) && ctx.v5000))) out.push('5000')
  if (key === 'crosswalk' && ctx.hasHd) out.push('hd')
  out.push(key === 'bldg' ? 'vworld' : 'off')
  return out
}

export function defaultPick(key: PickKey, ctx: PickCtx): SourceId {
  const s = sourcesFor(key, ctx)
  if (key === 'crosswalk' && s.includes('hd')) return 'hd'
  if (s.includes('1000') && s.includes('5000')) return ctx.newer5000 && PREFER_NEW.includes(key) ? '5000' : '1000'
  return s.find((x) => x === '1000' || x === '5000') ?? (key === 'bldg' ? 'vworld' : 'off')
}

export type Picks = Record<PickKey, SourceId>

export function effectivePicks(project: Project, ctx: PickCtx): Picks {
  const out = {} as Picks
  for (const k of PICK_KEYS) {
    const want = project.sourcePick?.[k]
    out[k] = want && sourcesFor(k, ctx).includes(want) ? want : defaultPick(k, ctx)
  }
  return out
}

/** 바뀐 곳 자동을 쓸 수 있는지 (두 축척이 다 있고 1:5,000이 새 것) */
export const autoAvailable = (ctx: PickCtx) => ctx.cover1000.length > 0 && ctx.cover5000.length > 0 && ctx.newer5000
export const autoOn = (project: Project, ctx: PickCtx) => autoAvailable(ctx) && project.sourceAuto !== false

/** 자료 그리기·캐시용 서명 */
export function pickSig(project: Project): string {
  const p = project.sourcePick ?? {}
  return `${Object.keys(p)
    .sort()
    .map((k) => `${k}=${p[k]}`)
    .join(',')}|${project.sourceAuto === false ? 'm' : 'a'}`
}

// ───────────────────────── 바뀐 곳 (두 축척 비교, 올린 파일이 같으면 다시 계산하지 않음) ─────────────────────────

let changeCache: { key: string; val: ChangeAreas | null } | null = null

export function changeAreasFor(project: Project, ctx: PickCtx): ChangeAreas | null {
  if (!autoAvailable(ctx)) return null
  const col = project.collected
  const key = `${col[ngiiLayer('sheets')]?.retrieved_at ?? ''}|${(['contour', 'spot', 'bldg'] as const).map((k) => col[ngiiLayer(k)]?.features.length ?? 0).join(',')}|${ctx.cover1000.length},${ctx.cover5000.length}`
  if (changeCache?.key === key) return changeCache.val
  const side = (scale: number) => {
    const is = (f: Feat) => (ctx.scaleOf.get(String(f.properties.sheet)) ?? 5000) === scale
    const fs = (k: NgiiKey) => (col[ngiiLayer(k)]?.features ?? []).filter(is)
    return {
      contours: fs('contour')
        .filter((f) => f.geometry && /LineString/.test(f.geometry.type))
        .map((f) => ({ geom: f.geometry as Geometry, z: Number(f.properties.z) })),
      spots: fs('spot')
        .filter((f) => f.geometry?.type === 'Point')
        .map((f) => {
          const c = (f.geometry as { coordinates: number[] }).coordinates
          return { lon: c[0], lat: c[1], z: Number(f.properties.z) }
        }),
      bldgs: fs('bldg')
        .filter((f) => f.geometry && /Polygon/.test(f.geometry.type))
        .map((f) => ({ geom: f.geometry as Geometry, kind: String(f.properties.kind ?? '') })),
    }
  }
  const val = findChanges(ctx.cover1000, ctx.cover5000, side(1000), side(5000))
  changeCache = { key, val }
  return val
}

// ───────────────────────── 항목별로 고른 도형 ─────────────────────────

const inAny = (bs: Bounds[], p: Position) => bs.some((b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3])

function outer(g: Geometry): Position[] | null {
  if (g.type === 'Polygon') return g.coordinates[0] ?? null
  if (g.type === 'MultiPolygon') return g.coordinates.reduce<Position[] | null>((m, p) => (!m || (p[0]?.length ?? 0) > m.length ? p[0] : m), null)
  return null
}

/** 대표점: 점은 그대로, 면은 안쪽 점, 선은 꼭짓점 평균 */
export function repPoint(g: Geometry | null): Position | null {
  if (!g) return null
  if (g.type === 'Point') return g.coordinates
  const o = outer(g)
  if (o && o.length >= 3) return interiorPoint(o.map((p) => [p[0], p[1]] as [number, number]))
  const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
  const pts = lines.flat()
  if (!pts.length) return null
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
}

function areaM2(g: Geometry, ca: ChangeAreas): number {
  const o = outer(g)
  if (!o) return 0
  let s = 0
  for (let i = 0; i < o.length; i++) {
    const a = o[i]
    const b = o[(i + 1) % o.length]
    s += a[0] * ca.kx * (b[1] * ca.ky) - b[0] * ca.kx * (a[1] * ca.ky)
  }
  return Math.abs(s / 2)
}

const linesOf = (g: Geometry): Position[][] | null => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : null)

/** 선을 바뀐 곳 안(inside=true) 또는 밖 조각만 남긴 도형 (없으면 null) */
function clipLine(f: Feat, ca: ChangeAreas, inside: boolean): Feat | null {
  const ls = linesOf(f.geometry as Geometry)
  if (!ls) return null
  const parts: Position[][] = []
  for (const l of ls) {
    const r = splitByChange(ca, l)
    parts.push(...(inside ? r.inside : r.outside))
  }
  if (!parts.length) return null
  return { ...f, geometry: parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts } }
}

export interface PickState {
  ctx: PickCtx
  picks: Picks
  change: ChangeAreas | null
}

export function pickState(project: Project): PickState {
  const ctx = pickCtx(project)
  const picks = effectivePicks(project, ctx)
  return { ctx, picks, change: autoOn(project, ctx) ? changeAreasFor(project, ctx) : null }
}

/**
 * 한 항목의 수치지도 도형 중 고른 자료만 (바뀐 곳은 바꿔 넣음).
 * 정밀도로지도 횡단보도('hd')는 여기서 1:1,000을 그대로 두고 data.ts에서 정밀도로지도가 덮는 곳만 뺀다.
 */
export function selectNgii(project: Project, st: PickState, key: NgiiKey): Feat[] {
  const { ctx, picks, change } = st
  const pick = picks[key === 'walkline' ? 'walk' : key]
  if (pick === 'off' || pick === 'vworld') return []
  const feats = (project.collected[ngiiLayer(key)]?.features ?? []) as Feat[]
  const out: Feat[] = []
  const keep1000 = pick === '1000' || pick === 'hd'
  for (const f of feats) {
    const g = f.geometry as Geometry | null
    if (!g) continue
    const scale = ctx.scaleOf.get(String(f.properties.sheet)) ?? 5000
    const rep = repPoint(g)
    if (!rep) continue
    const isLine = /LineString/.test(g.type)
    const swappable = !!change && (isLine || g.type === 'Point' || areaM2(g, change) <= BIG_AREA)
    if (scale === 1000) {
      // 새 자료를 고른 항목: 1:5,000이 덮는 곳의 1:1,000은 뺌
      if (!keep1000 && inAny(ctx.cover5000, rep)) continue
      if (swappable && change) {
        if (isLine) {
          const c = clipLine(f, change, false)
          if (c) out.push(c)
          continue
        }
        if (inChange(change, rep[0], rep[1])) continue
      }
      out.push(f)
      continue
    }
    // 1:5,000: 1:1,000 도엽 밖은 그대로
    if (!inAny(ctx.cover1000, rep) || pick === '5000') {
      out.push(f)
      continue
    }
    // 1:1,000을 고른 항목: 바뀐 곳 안만 1:5,000으로
    if (swappable && change) {
      if (isLine) {
        const c = clipLine(f, change, true)
        if (c) out.push(c)
        continue
      }
      if (inChange(change, rep[0], rep[1])) out.push(f)
    }
  }
  return out
}

// ───────────────────────── 글 ─────────────────────────

export const SOURCE_SHORT: Record<SourceId, string> = { '1000': '1:1,000', '5000': '1:5,000', hd: '정밀도로지도', vworld: '브이월드', off: '안 씀' }

/** '1:5,000(2025년)' · '1:1,000(2020년, 바뀐 곳은 1:5,000 2025년)' 같은 글 */
export function pickText(st: PickState, key: PickKey): string {
  const { ctx, picks, change } = st
  const p = picks[key]
  const y = (s: '1000' | '5000') => {
    const v = s === '1000' ? ctx.year1000 : ctx.year5000
    return v ? `${v}년` : ''
  }
  if (p === '1000') {
    const swap = change && sourcesFor(key, ctx).includes('5000') ? `, 바뀐 곳은 1:5,000 ${y('5000')}` : change ? ', 바뀐 곳은 뺌' : ''
    return `1:1,000(${y('1000')}${swap})`
  }
  if (p === '5000') return `1:5,000(${y('5000')})`
  if (p === 'hd') return `정밀도로지도${ctx.cover1000.length ? ` + 정밀도로지도가 없는 곳은 1:1,000(${y('1000')})` : ''}`
  return SOURCE_SHORT[p]
}

/** 출처 기록에 남길 한 줄 */
export function pickSummary(project: Project): string {
  const st = pickState(project)
  if (!st.ctx.cover1000.length || !(st.ctx.cover5000.length || st.ctx.hasHd)) return ''
  const parts = PICK_GROUPS.map((g) => {
    const byText = new Map<string, string[]>()
    for (const k of g.keys) {
      const t = pickText(st, k)
      byText.set(t, [...(byText.get(t) ?? []), PICK_LABEL[k]])
    }
    return [...byText.entries()].map(([t, ls]) => `${ls.join(', ')} ${t}`).join('; ')
  })
  return `항목별 자료(1:1,000 도엽 안) — ${parts.join(' / ')}.`
}
