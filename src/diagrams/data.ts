// 도판에 쓸 자료를 프로젝트의 수집 결과에서 한 번에 꺼낸다.

import { area, booleanPointInPolygon, feature, point } from '@turf/turf'
import type { Geometry, LineString, MultiLineString } from 'geojson'
import { centerOf, isAreal, isLinear, siteBoundary, type Areal } from '../lib/geo'
import { jimokOf } from '../model/codes'
import { observationsOf } from '../model/observations'
import type { Project } from '../model/types'
import type { EnvResult } from '../sources/env'
import type { SpeedSnapshot } from '../sources/its'
import type { NetworkResult } from '../sources/network'
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
  /** 'bldg' GIS건물통합정보, 'addr' 도로명주소 건물로 보강 */
  src: 'bldg' | 'addr'
  /** 층수를 도로명주소 건물에서 채웠는지 */
  floorsFromAddr: boolean
  onSite: boolean
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
  /** 어떤 자료가 수집되었는지 */
  has: Record<string, boolean>
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
  constructor(private size: number) {}
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
      onSite: inside(c[0], c[1], boundary),
    })
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

  const zoning = areas(['LT_C_UQ111', 'LT_C_UQ112', 'LT_C_UQ113', 'LT_C_UQ114'], (p) => str(p.uname) || '용도지역 미상')
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
      return c ? { lon: c[0], lat: c[1], name: str(f.properties.name), kind: str(f.properties.lcls) || '분류 없음', label: str(f.properties.mcls) } : null
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

  const observations: Pt[] = observationsOf(project)
    .filter((o) => o.observation?.location)
    .map((o) => {
      const d = o.observation!
      const kind = d.links.some((l) => l.relation === 'differ') ? 'differ' : d.discovery ? 'discovery' : 'normal'
      return { lon: d.location!.lon, lat: d.location!.lat, name: o.text.trim().slice(0, 40), kind, label: o.id.replace('O-', '') }
    })

  return {
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
    has,
  }
}
