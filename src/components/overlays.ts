// 수집한 Phase 6 자료를 지도에 그릴 수 있게 색·모양을 붙인다.
// MapView는 속성 _c(색), _shape('square'|'circle'), _r(점 반지름)만 보고 그린다.
// _name·_sub는 지도에서 눌렀을 때 보여 줄 이름과 설명.

import type { Project } from '../model/types'
import { isPlaceholderStop } from '../sources/transit'
import type { GeoFeature } from '../sources/vworld'
import { ALL_LAYERS } from '../sources/vworldLayers'

export type OverlayId = 'hazard' | 'civic' | 'commerce' | 'bus' | 'stores' | 'poi'

export interface LegendEntry {
  color: string
  label: string
  shape?: 'square' | 'circle' | 'area'
}

export interface Overlay {
  id: OverlayId
  label: string
  areas: GeoFeature[]
  points: GeoFeature[]
  legend: LegendEntry[]
  count: number
}

interface LayerStyle {
  id: string
  label: string
  color: string
}

const HAZARD: LayerStyle[] = [
  { id: 'LT_C_WKMSTRM', label: '하천', color: '#1c7ed6' },
  { id: 'LT_C_UP201', label: '재해위험지구', color: '#e03131' },
  { id: 'LT_C_UP401', label: '급경사재해예방지역', color: '#f76707' },
  { id: 'LT_C_UPISUQ156', label: '방재시설', color: '#0ca678' },
]
const CIVIC: LayerStyle[] = [
  { id: 'LT_C_UPISUQ155', label: '공공문화체육시설', color: '#2f9e44' },
  { id: 'LT_C_UPISUQ157', label: '보건위생시설', color: '#74b816' },
  { id: 'LT_P_DGMUSEUMART', label: '박물관·미술관', color: '#ae3ec9' },
  { id: 'LT_P_SMALLLIBRARY', label: '작은도서관', color: '#1098ad' },
  { id: 'LT_P_MGPRTFB', label: '노인복지시설', color: '#f08c00' },
  { id: 'LT_P_MGPRTFC', label: '아동복지시설', color: '#e64980' },
]
const COMMERCE: LayerStyle[] = [
  { id: 'LT_C_DGMAINBIZ', label: '주요상권', color: '#7048e8' },
  { id: 'LT_C_UB901', label: '시장정비구역', color: '#9c36b5' },
  { id: 'LT_C_UD601', label: '주거환경개선지구', color: '#868e96' },
  { id: 'LT_P_TRADSIJANG', label: '전통시장', color: '#d6336c' },
  { id: 'LT_P_BUSIINCUBATOR', label: '창업보육센터', color: '#495057' },
]

/** 상가 대분류 색 (2023년 개편 분류 기준, 없으면 회색) */
const STORE_COLORS: Record<string, string> = {
  음식: '#e8590c',
  소매: '#1c7ed6',
  '수리·개인': '#2f9e44',
  교육: '#ae3ec9',
  '보건의료': '#e03131',
  '예술·스포츠': '#0ca678',
  '과학·기술': '#5c7cfa',
  '시설관리·임대': '#868e96',
  부동산: '#f59f00',
  숙박: '#d6336c',
}
const STORE_OTHER = '#adb5bd'

const POI_COLORS: Record<string, string> = {
  SW8: '#1864ab',
  SC4: '#7048e8',
  PS3: '#be4bdb',
  AC5: '#9775fa',
  HP8: '#e03131',
  PM9: '#ff8787',
  PO3: '#2b8a3e',
  CT1: '#0ca678',
  AT4: '#f59f00',
  MT1: '#1c7ed6',
  CS2: '#74c0fc',
  CE7: '#a0522d',
  FD6: '#e8590c',
  PK6: '#495057',
}

const isPoint = (f: GeoFeature) => f.geometry?.type === 'Point' || f.geometry?.type === 'MultiPoint'

function deco(features: GeoFeature[], props: Record<string, unknown>): GeoFeature[] {
  return features.filter((f) => f.geometry).map((f) => ({ ...f, properties: { ...f.properties, ...props } }))
}

function layered(project: Project, id: OverlayId, label: string, styles: LayerStyle[]): Overlay {
  const areas: GeoFeature[] = []
  const points: GeoFeature[] = []
  const legend: LegendEntry[] = []
  for (const st of styles) {
    const fs = (project.collected[st.id]?.features ?? []) as GeoFeature[]
    if (fs.length === 0) continue
    const def = ALL_LAYERS.find((l) => l.id === st.id)
    const named = fs.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        _name: String(f.properties[def?.nameField ?? 'name'] ?? '') || st.label,
        _sub: [st.label, def?.typeField ? String(f.properties[def.typeField] ?? '') : ''].filter(Boolean).join(' · '),
      },
    }))
    const pts = named.filter(isPoint)
    const ars = named.filter((f) => f.geometry && !isPoint(f))
    points.push(...deco(pts, { _c: st.color }))
    areas.push(...deco(ars, { _c: st.color }))
    legend.push({ color: st.color, label: st.label, shape: pts.length > 0 ? 'circle' : 'area' })
  }
  return { id, label, areas, points, legend, count: areas.length + points.length }
}

export function buildOverlays(project: Project): Overlay[] {
  const out: Overlay[] = [
    layered(project, 'hazard', '재해·하천', HAZARD),
    layered(project, 'civic', '공공·문화·복지 시설', CIVIC),
    layered(project, 'commerce', '상권·전통시장', COMMERCE),
  ]

  const stops = ((project.collected['tago:stops']?.features ?? []) as GeoFeature[]).filter((f) => !isPlaceholderStop(f.properties.nodeno, f.properties.routes))
  out.push({
    id: 'bus',
    label: '버스정류소',
    areas: [],
    points: stops.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        _c: '#1864ab',
        _shape: 'square',
        _name: String(f.properties.nodenm ?? ''),
        _sub: ['버스정류소', f.properties.routes ? `노선 ${f.properties.routes}` : ''].filter(Boolean).join(' · '),
      },
    })),
    legend: stops.length ? [{ color: '#1864ab', label: '버스정류소', shape: 'square' }] : [],
    count: stops.length,
  })

  const stores = (project.collected['sbiz:stores']?.features ?? []) as GeoFeature[]
  const storeCounts = new Map<string, number>()
  for (const f of stores) {
    const k = String(f.properties.lcls ?? '')
    storeCounts.set(k, (storeCounts.get(k) ?? 0) + 1)
  }
  const storeLegend = [...storeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => ({ color: STORE_COLORS[k] ?? STORE_OTHER, label: k || '분류 없음', shape: 'circle' as const }))
  out.push({
    id: 'stores',
    label: '상가 (업종별 색)',
    areas: [],
    points: stores.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        _c: STORE_COLORS[String(f.properties.lcls ?? '')] ?? STORE_OTHER,
        _r: 3,
        _name: String(f.properties.name ?? ''),
        _sub: [f.properties.scls || f.properties.mcls, f.properties.floor ? `${f.properties.floor}층` : ''].filter(Boolean).join(' · '),
      },
    })),
    legend: storeLegend.slice(0, 8),
    count: stores.length,
  })

  const pois = (project.collected['kakao:poi']?.features ?? []) as GeoFeature[]
  const poiCodes = new Map<string, string>()
  for (const f of pois) poiCodes.set(String(f.properties.code), String(f.properties.label))
  out.push({
    id: 'poi',
    label: '주변 생활 시설 (카카오)',
    areas: [],
    points: pois.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        _c: POI_COLORS[String(f.properties.code)] ?? STORE_OTHER,
        _name: String(f.properties.name ?? ''),
        _sub: String(f.properties.category ?? f.properties.label ?? ''),
      },
    })),
    legend: [...poiCodes.entries()].map(([code, label]) => ({ color: POI_COLORS[code] ?? STORE_OTHER, label, shape: 'circle' as const })),
    count: pois.length,
  })
  return out
}
