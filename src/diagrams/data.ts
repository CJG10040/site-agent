// 도판에 쓸 자료를 프로젝트의 수집 결과에서 한 번에 꺼낸다.

import { area, booleanPointInPolygon, feature, point } from '@turf/turf'
import type { Geometry, LineString, MultiLineString } from 'geojson'
import { centerOf, isAreal, isLinear, siteBoundary, type Areal } from '../lib/geo'
import { jimokOf } from '../model/codes'
import { observationsOf } from '../model/observations'
import type { HideEdit, HideLayer, Project } from '../model/types'
import type { EnvResult } from '../sources/env'
import type { SpeedSnapshot } from '../sources/its'
import type { NetworkResult } from '../sources/network'
import { isPlaceholderStop } from '../sources/transit'
import type { WindResult } from '../sources/wind'
import { centroidOf } from './frame'

export interface Bld {
  geom: Areal
  floors: number | null
  use: string
  year: number | null
  /** 바닥 면적(㎡, 도형 계산) */
  area: number
  name: string
  /** 'bldg' GIS건물통합정보, 'addr' 도로명주소 건물로 보강, 'ngii' 국토지리정보원 수치지도(올린 도엽 안) */
  src: 'bldg' | 'addr' | 'ngii'
  /** 층수를 도로명주소 건물에서 채웠는지 */
  floorsFromAddr: boolean
  /** 지하만 있는 시설 (지하상가·지하철역 등: 지상층 없음 + 지하층 있음 + 건축면적 0) */
  underground?: boolean
  onSite: boolean
  /** GIS건물통합정보의 높이(m) — 값이 있고 층수와 어긋나지 않을 때만 */
  heightM?: number | null
}

// ───────────────────────── 건물 높이 ─────────────────────────
// 사용자 결정(2026-11-12): '실측 높이 우선 + 용도별 층고'. 단면·일조·하늘·가시권·바람·위요감·3D가 모두 이 값을 쓴다.

/** 층수를 모를 때 (1층으로 봄) */
export const UNKNOWN_H = 3

/** 용도별 층고(m): 주거(단독·공동주택) 3.0, 공장·창고 5.0, 그 밖 비주거 4.0, 용도 모름 3.3 */
export function floorHeightOf(use: string): number {
  const u = use.trim()
  if (!u) return 3.3
  if (u.startsWith('01') || u.startsWith('02')) return 3.0
  if (u.startsWith('17') || u.startsWith('18')) return 5.0
  return 4.0
}

export const HEIGHT_RULE = '높이는 자료의 실측 높이가 있으면 그 값, 없으면 층수 × 용도별 층고(주거 3m·비주거 4m·공장·창고 5m·용도 모름 3.3m)'
export const HEIGHT_SHORT = '실측 높이 또는 층수×용도별 층고'

/** 실측 높이가 층수와 어울리는지 (층당 2.2~8m) */
export function plausibleHeight(h: number | null, floors: number | null): number | null {
  if (!h || !(h > 0)) return null
  if (floors && floors > 0) {
    const per = h / floors
    if (per < 2.2 || per > 8) return null
  } else if (h > 300) return null
  return h
}

/** 건물 높이(m). 층수도 높이도 모르면 null */
export function bldHeight(b: Pick<Bld, 'floors' | 'use' | 'heightM'>): number | null {
  if (b.heightM && b.heightM > 0) return b.heightM
  if (b.floors && b.floors > 0) return Math.round(b.floors * floorHeightOf(b.use) * 10) / 10
  return null
}

export interface Parcel {
  geom: Areal
  pnu: string
  jibun: string
  jimok: string
  area: number
  onSite: boolean
  hg: string
  road: string
}

export interface Road {
  geom: LineString | MultiLineString
  width: number | null
  lanes: number | null
  oneway: boolean
}

/** 표준노드링크 (실시간 속도와 같은 링크 ID) */
export interface Link {
  geom: LineString | MultiLineString
  id: string
  name: string
  maxSpd: number | null
}

export interface Area<T = Record<string, never>> {
  geom: Areal
  name: string
  layer: string
  extra: T
}

export interface Pt {
  lon: number
  lat: number
  name: string
  kind: string
  label?: string
  /** 더 자세한 분류 (상가 소분류 등) */
  detail?: string
}

type Lines = LineString | MultiLineString

/** 국토지리정보원 1:5,000 수치지도 2.0 (④에서 올린 도엽) */
export interface NgiiData {
  sheets: { code: string; year: string | null; bounds: [number, number, number, number] }[]
  year: string | null
  /** 건물을 수치지도로 바꾼 수 (지붕 구조물·가건물 제외) */
  buildings: number
  /** 무벽건물(지붕만)·가건물 — 건물 통계·계산에서는 빼고 3D·DXF에만 */
  minor: Areal[]
  /** 도로경계 면 (인도 포함 도로 전체) */
  roads: Areal[]
  walks: Areal[]
  contours: { geom: Lines; z: number; major: boolean }[]
  spots: { lon: number; lat: number; z: number; benchmark?: string }[]
  /** 옹벽·석축·제방: '상단' 선은 그린 방향의 오른쪽이 낮은 쪽 */
  walls: { geom: Lines; kind: string; top: boolean; h: number | null }[]
  cutfill: { geom: Lines; kind: string; top: boolean }[]
}

/** 올린 수치지도 도엽 안의 점인지 */
export function inNgii(n: NgiiData | null, lon: number, lat: number): boolean {
  return !!n && n.sheets.some(({ bounds: b }) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3])
}

/** 도판 출처 글: 건물 */
export function bldSourceText(d: { ngii: NgiiData | null }): string {
  return d.ngii
    ? `국토지리정보원 1:5,000 수치지도${d.ngii.year ? `(${d.ngii.year}년)` : ''} 건물(올린 도엽 안) + 브이월드 GIS건물통합정보(사용승인연도·용도, 도엽 밖)`
    : '국토교통부 GIS건물통합정보(브이월드)'
}

// 수치지도 용도 → 건물 용도 코드 (브이월드에서 짝을 못 찾을 때만)
const NGII_USE: [RegExp, string][] = [
  [/문화및집회/, '05000'],
  [/종교/, '06000'],
  [/판매/, '07000'],
  [/운수/, '08000'],
  [/의료/, '09000'],
  [/교육연구/, '10000'],
  [/노유자/, '11000'],
  [/수련/, '12000'],
  [/운동/, '13000'],
  [/업무/, '14000'],
  [/숙박/, '15000'],
  [/위락/, '16000'],
  [/공장/, '17000'],
  [/창고/, '18000'],
  [/위험물/, '19000'],
  [/자동차/, '20000'],
  [/동물|식물/, '21000'],
  [/분뇨|쓰레기|자원순환/, '22000'],
  [/교정|군사/, '23000'],
  [/방송|통신/, '24000'],
  [/발전/, '25000'],
  [/묘지/, '26000'],
  [/관광휴게/, '27000'],
  [/장례/, '28000'],
  [/근린생활/, '03000'],
]

function ngiiUse(kind: string, use: string): string {
  if (/주택/.test(use)) return /아파트|연립|다세대/.test(kind) ? '02000' : '01000'
  return NGII_USE.find(([re]) => re.test(use))?.[1] ?? ''
}

export interface DiagramData {
  center: [number, number]
  R: number
  boundary: Areal
  collectedAt: string | null
  buildings: Bld[]
  /** 건물 자료에서 보강한 건물 수 */
  addedFromAddr: number
  parcels: Parcel[]
  roads: Road[]
  zoning: Area[]
  districts: Area[]
  facilities: Area<{ type: string }>[]
  parks: Area<{ kind: 'park' | 'river' }>[]
  stations: Pt[]
  stops: Pt[]
  statsAreas: Area<{ density: number | null; year: number | null }>[]
  stores: Pt[]
  pois: Pt[]
  observations: Pt[]
  links: Link[]
  /** 실시간 도로 속도 장면들 (받은 순서) */
  speedSnaps: SpeedSnapshot[]
  /** 길의 연결 계산 결과 */
  network: NetworkResult | null
  /** 바람장미 집계 */
  wind: WindResult | null
  /** 환경 계산 결과 (일조·개방감·가시권·수목·바람·열쾌적) */
  env: EnvResult | null
  /** 올린 수치지도 (없으면 null) */
  ngii: NgiiData | null
  /** 대지 필지의 토지이용계획 (지역·지구 이름, 포함/저촉/접합) — 법규 개요 도판 (14-C) */
  landUse: { name: string; kind: string }[]
  /** 토지대장 면적 합계(㎡) — 대지 필지 전체, 직접 그린 경계면 경계 안 면적과 다름 */
  officialArea: number | null
  /** 어떤 자료가 수집되었는지 */
  has: Record<string, boolean>
  /** 학생이 뺀 자료: 이번에 찾아 뺀 수와 못 찾은 기록 */
  hidden: { applied: number; missing: HideEdit[] }
}

/**
 * 지하만 있는 시설(지하상가·지하철역 등): 지상층이 없고, 이름에 '지하'가 있거나 '역'으로 끝나거나,
 * 지하층은 있는데 건축면적이 0. (예: 금남지하상가·충금지하상가·문화전당역 — 건물통합정보와 도로명주소 건물 양쪽에 있음)
 */
export function isUnderground(floors: number | null, name: string, ugrnd: number | null, archarea: number | null): boolean {
  if (floors && floors > 0) return false
  if (/지하/.test(name) || /역$/.test(name.trim())) return true
  return (ugrnd ?? 0) > 0 && !((archarea ?? 0) > 0)
}

/** 표준노드링크 링크 ID 속성 (브이월드 소문자) */
export function linkIdOf(p: Record<string, unknown>): string {
  return String(p.link_id ?? p.linkid ?? p.LINK_ID ?? '').trim()
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())
const num = (v: unknown): number | null => {
  const n = Number(str(v))
  return str(v) !== '' && Number.isFinite(n) ? n : null
}

/** 겹침 판정을 빠르게 하려고 건물 도형을 격자 칸에 나눠 담는다 */
class GridIndex<T extends { geom: Areal }> {
  private cells = new Map<string, T[]>()
  private size: number
  constructor(size: number) {
    this.size = size
  }
  private key(i: number, j: number) {
    return `${i}:${j}`
  }
  add(item: T, bbox: [number, number, number, number]) {
    for (let i = Math.floor(bbox[0] / this.size); i <= Math.floor(bbox[2] / this.size); i++)
      for (let j = Math.floor(bbox[1] / this.size); j <= Math.floor(bbox[3] / this.size); j++) {
        const k = this.key(i, j)
        const list = this.cells.get(k)
        if (list) list.push(item)
        else this.cells.set(k, [item])
      }
  }
  at(x: number, y: number): T[] {
    return this.cells.get(this.key(Math.floor(x / this.size), Math.floor(y / this.size))) ?? []
  }
}

function bboxOf(g: Areal): [number, number, number, number] {
  let a = Infinity
  let b = Infinity
  let c = -Infinity
  let d = -Infinity
  const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0])
  for (const r of rings)
    for (const [x, y] of r) {
      if (x < a) a = x
      if (y < b) b = y
      if (x > c) c = x
      if (y > d) d = y
    }
  return [a, b, c, d]
}

function safeArea(g: Areal): number {
  try {
    return area(feature(g))
  } catch {
    return 0
  }
}

function inside(lon: number, lat: number, g: Areal): boolean {
  try {
    return booleanPointInPolygon(point([lon, lat]), feature(g))
  } catch {
    return false
  }
}

export function buildDiagramData(project: Project): DiagramData | null {
  const boundary = siteBoundary(project.site)
  if (!boundary) return null
  const center = centerOf(boundary)
  const R = project.collectedRadiusM ?? project.site.radiusM
  const col = project.collected
  const feats = (id: string) => col[id]?.features ?? []
  const has: Record<string, boolean> = {}
  for (const k of Object.keys(col)) has[k] = (col[k]?.features.length ?? 0) > 0

  // ── 건물: GIS건물통합정보 + 도로명주소 건물 보강
  const buildings: Bld[] = []
  const index = new GridIndex<Bld>(0.0006)
  for (const f of feats('LT_C_BLDGINFO')) {
    if (!isAreal(f.geometry)) continue
    const p = f.properties
    const floors = num(p.grnd_flr)
    const yr = Number(str(p.useapr_day).slice(0, 4))
    const c = centroidOf(f.geometry)
    const b: Bld = {
      geom: f.geometry,
      floors: floors && floors > 0 ? floors : null,
      heightM: plausibleHeight(num(p.height), floors && floors > 0 ? floors : null),
      underground: isUnderground(floors, str(p.bld_nm), num(p.ugrnd_flr), num(p.archarea)),
      use: str(p.usability),
      year: Number.isInteger(yr) && yr >= 1900 && yr <= new Date().getFullYear() ? yr : null,
      area: safeArea(f.geometry),
      name: str(p.bld_nm),
      src: 'bldg',
      floorsFromAddr: false,
      onSite: c ? inside(c[0], c[1], boundary) : false,
    }
    buildings.push(b)
    index.add(b, bboxOf(f.geometry))
  }
  let addedFromAddr = 0
  for (const f of feats('LT_C_SPBD')) {
    if (!isAreal(f.geometry)) continue
    const c = centroidOf(f.geometry)
    if (!c) continue
    const floors = num(f.properties.gro_flo_co)
    const host = index.at(c[0], c[1]).find((b) => inside(c[0], c[1], b.geom))
    if (host) {
      // 같은 건물: 층수가 비어 있으면 도로명주소 건물의 지상층수로 채운다
      if (host.floors === null && floors && floors > 0) {
        host.floors = floors
        host.floorsFromAddr = true
      }
      continue
    }
    addedFromAddr++
    buildings.push({
      geom: f.geometry,
      floors: floors && floors > 0 ? floors : null,
      use: '',
      year: null,
      area: safeArea(f.geometry),
      name: str(f.properties.buld_nm),
      src: 'addr',
      floorsFromAddr: !!floors,
      underground: isUnderground(floors, str(f.properties.buld_nm), null, null),
      onSite: inside(c[0], c[1], boundary),
    })
  }

  // ── 수치지도를 올렸으면 그 도엽 안 건물은 수치지도(2025 측량 도형·층수)로 바꾸고,
  //    사용승인연도·용도는 겹치는 브이월드 건물에서 가져온다 (못 찾으면 수치지도 용도로)
  let ngii: NgiiData | null = null
  const sheetFeats = feats('ngii:sheets')
  if (sheetFeats.length) {
    const lines = (id: string) => feats(id).filter((f) => isLinear(f.geometry))
    ngii = {
      sheets: sheetFeats.map((f) => ({
        code: str(f.properties.code),
        year: str(f.properties.year) || null,
        bounds: f.properties.bounds as [number, number, number, number],
      })),
      year: [...new Set(sheetFeats.map((f) => str(f.properties.year)).filter(Boolean))].sort().join('·') || null,
      buildings: 0,
      minor: [],
      roads: feats('ngii:road').filter((f) => isAreal(f.geometry)).map((f) => f.geometry as Areal),
      walks: feats('ngii:walk').filter((f) => isAreal(f.geometry)).map((f) => f.geometry as Areal),
      contours: lines('ngii:contour').map((f) => ({ geom: f.geometry as Lines, z: Number(f.properties.z), major: !!f.properties.major })),
      spots: feats('ngii:spot')
        .filter((f) => f.geometry?.type === 'Point')
        .map((f) => {
          const c = (f.geometry as { coordinates: number[] }).coordinates
          return { lon: c[0], lat: c[1], z: Number(f.properties.z), ...(f.properties.benchmark ? { benchmark: str(f.properties.benchmark) } : {}) }
        }),
      walls: lines('ngii:wall').map((f) => ({ geom: f.geometry as Lines, kind: str(f.properties.kind), top: f.properties.top !== false, h: num(f.properties.h) })),
      cutfill: lines('ngii:cutfill').map((f) => ({ geom: f.geometry as Lines, kind: str(f.properties.kind), top: f.properties.top !== false })),
    }
    const n = ngii
    const kept = buildings.filter((b) => {
      const c = centroidOf(b.geom)
      return !c || !inNgii(n, c[0], c[1])
    })
    const added: Bld[] = []
    for (const f of feats('ngii:bldg')) {
      if (!isAreal(f.geometry)) continue
      const c = centroidOf(f.geometry)
      if (!c || !inNgii(n, c[0], c[1])) continue
      const kind = str(f.properties.kind)
      // 무벽건물(지붕만 있는 차양·주차장 지붕 등)·가건물은 건축물이 아니라 통계·계산에서 뺀다
      if (/무벽|가건물/.test(kind)) {
        n.minor.push(f.geometry)
        continue
      }
      const host = index.at(c[0], c[1]).find((b) => inside(c[0], c[1], b.geom))
      const floors = num(f.properties.floors)
      const name = str(f.properties.name) || str(f.properties.note).replace(/^\d+동$/, '') || host?.name || ''
      const fl = floors && floors > 0 ? floors : (host?.floors ?? null)
      added.push({
        geom: f.geometry,
        floors: fl,
        // 브이월드 건물의 실측 높이는 층수가 같을 때만 (단지 전체 도형의 최고 높이를 동마다 씌우지 않게)
        heightM: host?.heightM && host.floors === fl ? host.heightM : null,
        use: host?.use || ngiiUse(kind, str(f.properties.use)),
        year: host?.year ?? null,
        area: safeArea(f.geometry),
        name,
        src: 'ngii',
        floorsFromAddr: false,
        underground: false,
        onSite: inside(c[0], c[1], boundary),
      })
    }
    n.buildings = added.length
    buildings.length = 0
    buildings.push(...kept, ...added)
  }

  // ── 필지: 연속지적도 + 토지특성
  const landChar = new Map<string, Record<string, unknown>>()
  for (const f of feats('ned:landCharArea')) landChar.set(str(f.properties.pnu), f.properties)
  const sitePnus = new Set(project.site.parcels.map((p) => p.pnu))
  const parcels: Parcel[] = []
  for (const f of feats('LP_PA_CBND_BUBUN')) {
    if (!isAreal(f.geometry)) continue
    const pnu = str(f.properties.pnu)
    const jibun = str(f.properties.jibun)
    const lc = landChar.get(pnu)
    parcels.push({
      geom: f.geometry,
      pnu,
      jibun,
      jimok: jimokOf(jibun),
      area: safeArea(f.geometry),
      onSite: sitePnus.has(pnu),
      hg: str(lc?.hg),
      road: str(lc?.road),
    })
  }

  // ── 도로중심선
  const roads: Road[] = []
  for (const f of feats('LT_L_N3A0020000')) {
    if (!isLinear(f.geometry)) continue
    const w = num(f.properties.rvwd)
    const l = num(f.properties.rdln)
    roads.push({ geom: f.geometry, width: w && w > 0 ? w : null, lanes: l && l > 0 ? l : null, oneway: str(f.properties.onsd) === 'ITH001' })
  }

  const areas = (ids: string[], nameOf: (p: Record<string, unknown>) => string) =>
    ids.flatMap((id) =>
      feats(id)
        .filter((f) => isAreal(f.geometry))
        .map((f) => ({ geom: f.geometry as Areal, name: nameOf(f.properties), layer: id, extra: {} as Record<string, never> })),
    )

  // 이름(uname) 없는 용도지역 도형은 도시지역 전체 윤곽(예: 광주 서구 일대 4,600ha, 결정연도·번호 '0000')이라
  // 이름 있는 용도지역이 있으면 뺀다 (안 빼면 반경 전체가 '미상'으로 덮임)
  const zoningAll = areas(['LT_C_UQ111', 'LT_C_UQ112', 'LT_C_UQ113', 'LT_C_UQ114'], (p) => str(p.uname))
  const zoningNamed = zoningAll.filter((z) => z.name)
  const zoning = zoningNamed.length ? zoningNamed : zoningAll.map((z) => ({ ...z, name: '용도지역 미상' }))
  const districts = areas(
    [
      'LT_C_UQ121',
      'LT_C_UQ123',
      'LT_C_UQ124',
      'LT_C_UQ125',
      'LT_C_UQ126',
      'LT_C_UQ128',
      'LT_C_UQ129',
      'LT_C_UQ130',
      'LT_C_UQ141',
      'LT_C_UD801',
      'LT_C_UPISUQ171',
      'LT_C_UO101',
      'LT_C_UO301',
      'LT_C_UO501',
      'LT_C_UO601',
      'LT_C_UP201',
      'LT_C_UP401',
      'LT_C_UB901',
      'LT_C_UD601',
    ],
    (p) => str(p.uname) || str(p.dgm_nm) || '이름 없음',
  )
  const facilityIds = ['LT_C_UPISUQ152', 'LT_C_UPISUQ153', 'LT_C_UPISUQ154', 'LT_C_UPISUQ155', 'LT_C_UPISUQ156', 'LT_C_UPISUQ157', 'LT_C_UPISUQ158', 'LT_C_UPISUQ159']
  const facilities = facilityIds.flatMap((id) =>
    feats(id)
      .filter((f) => isAreal(f.geometry))
      .map((f) => ({
        geom: f.geometry as Areal,
        name: str(f.properties.dgm_nm) || '이름 없음',
        layer: id,
        extra: { type: str(f.properties.mls_nam) || str(f.properties.lcl_nam) || '' },
      })),
  )

  const parks: DiagramData['parks'] = []
  for (const f of [...feats('LT_C_UQ162'), ...feats('LT_C_UPISUQ153')]) {
    if (!isAreal(f.geometry)) continue
    const name = str(f.properties.uname) || str(f.properties.dgm_nm)
    // 공간시설 중 공원·녹지·광장·유원지만 (공공공지 등도 열린 땅이라 함께)
    if (f.properties.dgm_nm !== undefined && !/공원|녹지|광장|유원지|공지/.test(`${name}${str(f.properties.mls_nam)}`)) continue
    parks.push({ geom: f.geometry, name: name || '공원·녹지', layer: 'park', extra: { kind: 'park' } })
  }
  for (const f of feats('LT_C_WKMSTRM')) {
    if (isAreal(f.geometry)) parks.push({ geom: f.geometry, name: str(f.properties.riv_nm) || '하천', layer: 'river', extra: { kind: 'river' } })
  }
  for (const f of feats('LT_C_UPISUQ156')) {
    const name = str(f.properties.dgm_nm)
    if (isAreal(f.geometry) && /하천|천$|강$/.test(name)) parks.push({ geom: f.geometry, name, layer: 'river', extra: { kind: 'river' } })
  }

  const pointOf = (g: Geometry | null) => (g && g.type === 'Point' ? g.coordinates : null)
  const stations: Pt[] = feats('kakao:poi')
    .filter((f) => f.properties.code === 'SW8')
    .map((f) => {
      const c = pointOf(f.geometry)!
      return { lon: c[0], lat: c[1], name: str(f.properties.name), kind: 'SW8' }
    })
  const stops: Pt[] = feats('tago:stops')
    // 터미널 자체 기록(정류소 번호 0, 노선 없음)은 정류소가 아님 — 예전에 수집한 자료에도
    .filter((f) => !isPlaceholderStop(f.properties.nodeno, f.properties.routes))
    .map((f): Pt | null => {
      const c = pointOf(f.geometry)
      return c ? { lon: c[0], lat: c[1], name: str(f.properties.nodenm), kind: 'bus', label: str(f.properties.routes) } : null
    })
    .filter((x): x is Pt => !!x)
  const statsAreas = feats('sgis:statsarea')
    .filter((f) => isAreal(f.geometry))
    .map((f) => ({
      geom: f.geometry as Areal,
      name: str(f.properties.adm_cd),
      layer: 'sgis',
      extra: { density: num(f.properties.ppltn_dnsty), year: num(f.properties.year) },
    }))
  const stores: Pt[] = feats('sbiz:stores')
    .map((f): Pt | null => {
      const c = pointOf(f.geometry)
      return c ? { lon: c[0], lat: c[1], name: str(f.properties.name), kind: str(f.properties.lcls) || '분류 없음', label: str(f.properties.mcls), detail: str(f.properties.scls) } : null
    })
    .filter((x): x is Pt => !!x)
  const pois: Pt[] = feats('kakao:poi')
    .map((f): Pt | null => {
      const c = pointOf(f.geometry)
      return c ? { lon: c[0], lat: c[1], name: str(f.properties.name), kind: str(f.properties.code), label: str(f.properties.label) } : null
    })
    .filter((x): x is Pt => !!x)

  const links: Link[] = feats('LT_L_MOCTLINK')
    .filter((f) => isLinear(f.geometry))
    .map((f) => ({ geom: f.geometry as LineString | MultiLineString, id: linkIdOf(f.properties), name: str(f.properties.road_name), maxSpd: num(f.properties.max_spd) }))
  const speedSnaps = feats('its:speed').map((f) => f.properties as unknown as SpeedSnapshot)
  const network = (feats('network:graph')[0]?.properties as unknown as NetworkResult | undefined) ?? null
  const wind = (feats('kma:wind')[0]?.properties as unknown as WindResult | undefined) ?? null
  const env = (feats('env:result')[0]?.properties as unknown as EnvResult | undefined) ?? null
  // 토지이용계획·토지대장 (대지 필지)
  const luSeen = new Map<string, string>()
  for (const f of feats('ned:landUse')) {
    const name = str(f.properties.prposAreaDstrcCodeNm)
    if (!name) continue
    const kind = str(f.properties.cnflcAtNm) || '포함'
    const prev = luSeen.get(name)
    if (!prev || (prev !== '포함' && kind === '포함')) luSeen.set(name, kind)
  }
  const landUse = [...luSeen.entries()].map(([name, kind]) => ({ name, kind }))
  const lad = feats('ned:ladfrl')
  const ladPnu = new Map<string, number>()
  for (const f of lad) {
    const a = num(f.properties.lndpclAr)
    if (a && a > 0) ladPnu.set(str(f.properties._pnu) || String(ladPnu.size), a)
  }
  const officialArea = ladPnu.size ? [...ladPnu.values()].reduce((a, b) => a + b, 0) : null

  const observations: Pt[] = observationsOf(project)
    .filter((o) => o.observation?.location)
    .map((o) => {
      const d = o.observation!
      const kind = d.links.some((l) => l.relation === 'differ') ? 'differ' : d.discovery ? 'discovery' : 'normal'
      return { lon: d.location!.lon, lat: d.location!.lat, name: o.text.trim().slice(0, 40), kind, label: o.id.replace('O-', '') }
    })

  const out: DiagramData = {
    center,
    R,
    boundary,
    collectedAt: project.collectedAt ?? null,
    buildings,
    addedFromAddr,
    parcels,
    roads,
    zoning,
    districts,
    facilities,
    parks,
    stations,
    stops,
    statsAreas,
    stores,
    pois,
    observations,
    links,
    speedSnaps,
    network,
    wind,
    env,
    ngii,
    landUse,
    officialArea,
    has,
    hidden: { applied: 0, missing: [] },
  }
  // 학생이 뺀 자료 (다시 수집해도 위치·이름으로 다시 찾아 뺌)
  out.hidden = applyHides(out, project.edits?.hides ?? [])
  return out
}

// ───────────────────────── 학생이 뺀 자료 (2026-11-12) ─────────────────────────

/** 대략 거리(m) — 반경 수백 m 안에서 충분 */
function metersBetween(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const kx = 111320 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * 110574)
}

/** 도판에서 누른 곳의 자료 (빼기 후보) */
export interface HitCandidate {
  layer: HideLayer
  lon: number
  lat: number
  name: string
  desc: string
  /** 누른 곳에서 거리(m) — 가까운 것부터 */
  dist: number
}

const LAYER_LABEL: Record<HideLayer, string> = { building: '건물', stop: '버스정류소', station: '지하철역', store: '상가', poi: '생활 시설', park: '공원·녹지·하천', facility: '도시계획시설' }

export function hideLayerLabel(l: HideLayer): string {
  return LAYER_LABEL[l]
}

function bldDesc(b: Bld): string {
  const h = bldHeight(b)
  return `건물 · ${b.name || '이름 없음'} · ${b.floors ? `${b.floors}층` : '층수 모름'}${h ? ` (약 ${Math.round(h)}m)` : ''}`
}

/** 누른 곳(경위도)에서 tolM 안의 점과, 누른 곳을 품은 도형 */
export function featuresAt(d: DiagramData, lon: number, lat: number, tolM: number): HitCandidate[] {
  const out: HitCandidate[] = []
  const pts: [HideLayer, Pt[]][] = [
    ['stop', d.stops],
    ['station', d.stations],
    ['store', d.stores],
    ['poi', d.pois],
  ]
  for (const [layer, list] of pts)
    for (const p of list) {
      const dist = metersBetween(lon, lat, p.lon, p.lat)
      if (dist > tolM) continue
      const extra = layer === 'store' && p.label ? ` (${p.label})` : ''
      out.push({ layer, lon: p.lon, lat: p.lat, name: p.name, desc: `${LAYER_LABEL[layer]} · ${p.name || '이름 없음'}${extra}`, dist })
    }
  for (const b of d.buildings) {
    if (!inside(lon, lat, b.geom)) continue
    const c = centroidOf(b.geom)
    if (c) out.push({ layer: 'building', lon: c[0], lat: c[1], name: b.name, desc: bldDesc(b), dist: tolM + 1 })
  }
  const areas: [HideLayer, Area<Record<string, unknown>>[]][] = [
    ['park', d.parks as Area<Record<string, unknown>>[]],
    ['facility', d.facilities as Area<Record<string, unknown>>[]],
  ]
  for (const [layer, list] of areas)
    for (const a of list) {
      if (!inside(lon, lat, a.geom)) continue
      const c = centroidOf(a.geom)
      if (c) out.push({ layer, lon: c[0], lat: c[1], name: a.name, desc: `${LAYER_LABEL[layer]} · ${a.name || '이름 없음'}`, dist: tolM + 2 })
    }
  return out.sort((a, b) => a.dist - b.dist).slice(0, 12)
}

/** 뺀 자료를 지금 자료에서 찾아 뺀다. 못 찾은 것은 missing (다시 수집으로 자료가 바뀐 경우 등) */
function applyHides(d: DiagramData, hides: HideEdit[]): { applied: number; missing: HideEdit[] } {
  if (!hides.length) return { applied: 0, missing: [] }
  let applied = 0
  const missing: HideEdit[] = []
  const byLayer = (layer: HideLayer) => hides.filter((h) => h.layer === layer)
  // 점: 3m 안에서 가장 가까운 것 (이름이 같으면 6m까지)
  const dropPoints = (layer: HideLayer, list: Pt[]): Pt[] => {
    const hs = byLayer(layer)
    if (!hs.length) return list
    const drop = new Set<Pt>()
    for (const h of hs) {
      let best: Pt | null = null
      let bd = Infinity
      for (const p of list) {
        if (drop.has(p)) continue
        const dist = metersBetween(h.lon, h.lat, p.lon, p.lat)
        if ((dist <= 3 || (dist <= 6 && h.name && p.name === h.name)) && dist < bd) {
          best = p
          bd = dist
        }
      }
      if (best) {
        drop.add(best)
        applied++
      } else missing.push(h)
    }
    return list.filter((p) => !drop.has(p))
  }
  // 도형: 가운데 점이 6m 안 (또는 기억한 점을 품은 도형 중 이름이 같은 것)
  const dropAreas = <T extends { geom: Areal; name: string }>(layer: HideLayer, list: T[]): T[] => {
    const hs = byLayer(layer)
    if (!hs.length) return list
    const drop = new Set<T>()
    for (const h of hs) {
      let best: T | null = null
      let bd = Infinity
      for (const a of list) {
        if (drop.has(a)) continue
        const c = centroidOf(a.geom)
        if (!c) continue
        const dist = metersBetween(h.lon, h.lat, c[0], c[1])
        const ok = dist <= 6 || (h.name && a.name === h.name && inside(h.lon, h.lat, a.geom))
        if (ok && dist < bd) {
          best = a
          bd = dist
        }
      }
      if (best) {
        drop.add(best)
        applied++
      } else missing.push(h)
    }
    return list.filter((a) => !drop.has(a))
  }
  d.stops = dropPoints('stop', d.stops)
  d.stations = dropPoints('station', d.stations)
  d.stores = dropPoints('store', d.stores)
  d.pois = dropPoints('poi', d.pois)
  d.buildings = dropAreas('building', d.buildings)
  d.parks = dropAreas('park', d.parks)
  d.facilities = dropAreas('facility', d.facilities)
  return { applied, missing }
}
