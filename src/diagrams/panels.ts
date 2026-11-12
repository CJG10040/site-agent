// 도판 정의. 도판 하나 = 사실 하나 (주제색 한 계열 + 회색 바탕, 모르는 값은 회색 '미상').
// 각 도판은 그림(레이어)·범례·읽은 수치(summary)·출처와 한계(caption)를 돌려준다.

import { contours } from 'd3-contour'
import { area, booleanPointInPolygon, feature, featureCollection, intersect, point } from '@turf/turf'
import type { Position } from 'geojson'
import { geometryToAreaDistanceM, lineToAreaDistanceM, overlapsSite, pointToAreaDistanceM, radiusCircle, type Areal } from '../lib/geo'
import { wgs84ToUtmk } from '../lib/proj'
import { sunAt, sunPathFeatures, SUN_DAYS } from '../lib/sun'
import { contourInterval, contourLines, rangeText, type TerrainAnalysis } from '../lib/terrainSite'
import type { DiagramSettings } from '../model/types'
import { ALL_LAYERS } from '../sources/vworldLayers'
import { aerialImage } from './aerial'
import { esc, type PanelLayer, type PanelOutput } from './compose'
import { bldHeight, bldSourceText, type Bld, type DiagramData, type Pt } from './data'
import { centroidOf, dir8, MAP_CX, MAP_CY, MAP_R, type Frame } from './frame'
import { isStock, mix, monoShades, steps, sunPathColors, themeColor, zoningColor, type Palette } from './palette'
import { projOf } from './move'
import { arealRings, pointInRings, pointToRingsDist, toXY } from '../lib/xy'
import { ENV_PANELS } from './panelsEnv'
import { LIFE_PANELS } from './panelsLife'
import { MOVE_PANELS } from './panelsMove'
import { SECTION_PANELS } from './panelsSection'
import { SYNTH_PANEL, type SynthCtx } from './synth'

export interface PanelCtx {
  d: DiagramData
  f: Frame
  pal: Palette
  st: DiagramSettings
  vworldKey: string
  /** 수집일 (YYYY-MM-DD) */
  date: string
  /** 지형 분석 (없으면 null) */
  t: TerrainAnalysis | null
  /** 종합 다이어그램 (종합 도판에만) */
  synth?: SynthCtx | null
  /** 다른 도판의 그림을 바탕으로 쓸 때 (종합 도판) */
  basePanel?: (id: string) => Promise<PanelOutput | null>
  /** 도판 id → '도판 12 바람장미' (종합 도판의 근거 표기) */
  panelLabel?: (id: string) => string
}

export type PanelGroup = '위치' | '땅의 조건' | '지형' | '주변 현황' | '연계와 접근' | '환경' | '사회·경제' | '현장' | '종합'

export interface PanelDef {
  id: string
  title: string
  group: PanelGroup
  /** 자료가 없을 때 안내 */
  needs: string
  /** 도판 틀 반경(m)을 수집 반경과 다르게 (예: 도보권 15분) */
  frameR?: (d: DiagramData, extra?: { synth?: SynthCtx | null }) => number
  render: (c: PanelCtx) => PanelOutput | Promise<PanelOutput>
}

// ───────────────────────── 도우미 ─────────────────────────

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
const dist = (m: number) => (m < 1000 ? `약 ${fmt(Math.max(10, Math.round(m / 10) * 10))}m` : `약 ${fmt(m / 1000, 1)}km`)

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function frameArea(f: Frame): number {
  return f.shape === 'circle' ? Math.PI * f.R * f.R : 4 * f.R * f.R
}

/**
 * 같은 범례끼리 그룹으로 (일러스트레이터에서 항목별로 고르기 쉬움).
 * 도형마다 따로 칠하고(구멍만 짝홀 규칙) 투명도는 그룹 전체에 준다 — 같은 범례 도형이 겹쳐도 비거나 진해지지 않음.
 */
function grouped(items: { d: string; key: string }[], styles: Record<string, { fill?: string; stroke?: string; width?: number; opacity?: number; label: string }>): string {
  const byKey = new Map<string, string[]>()
  for (const it of items) {
    if (!it.d) continue
    const list = byKey.get(it.key)
    if (list) list.push(it.d)
    else byKey.set(it.key, [it.d])
  }
  let out = ''
  for (const [key, ds] of byKey) {
    const st = styles[key]
    if (!st) continue
    const fill = st.fill ?? 'none'
    const fills =
      fill === 'none'
        ? ''
        : `<g${st.opacity !== undefined ? ` opacity="${st.opacity}"` : ''}>${ds.map((d) => `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`).join('')}</g>`
    const strokes = st.stroke
      ? `<path d="${ds.join('')}" fill="none" stroke="${st.stroke}" stroke-width="${st.width ?? 1}" stroke-linejoin="round" stroke-linecap="round"/>`
      : ''
    out += `<g id="${esc(st.label.replace(/\s+/g, '_'))}">${fills}${strokes}</g>`
  }
  return out
}

function inFrame(c: PanelCtx, g: Areal): boolean {
  const ct = centroidOf(g)
  return !!ct && c.f.inside(ct[0], ct[1])
}

function baseBuildings(c: PanelCtx, color = c.pal.base): PanelLayer {
  const d = c.d.buildings.map((b) => c.f.path(b.geom, false)).join('')
  return { id: '바탕_건물', svg: d ? `<path d="${d}" fill="${color}"/>` : '' }
}

function baseRoads(c: PanelCtx, color = mix(c.pal.paper, c.pal.ink, 0.18)): PanelLayer {
  const d = c.d.roads.map((r) => c.f.path(r.geom)).join('')
  return { id: '바탕_도로', svg: d ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="1" stroke-linecap="round"/>` : '' }
}

function ptSvg(c: PanelCtx, p: { lon: number; lat: number }, r: number, fill: string, shape: 'dot' | 'square' = 'dot'): string {
  const [x, y] = c.f.pt(p.lon, p.lat)
  if (shape === 'square') return `<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" fill="${fill}" stroke="${c.pal.paper}" stroke-width="1.2"/>`
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" stroke="${c.pal.paper}" stroke-width="1.2"/>`
}

function where(c: PanelCtx, lon: number, lat: number): string {
  const p = c.f.polar(lon, lat)
  return `대지 중심 ${dir8(p.bearing)}쪽 ${dist(p.d)}`
}

function bldCaption(c: PanelCtx): string {
  const add = c.d.addedFromAddr ? `, 도로명주소 건물로 ${fmt(c.d.addedFromAddr)}동 보강` : ''
  return c.d.ngii
    ? `건물: ${bldSourceText(c.d)}${add} · ${c.date} 수집 · 무벽건물(지붕만)·가건물은 뺌`
    : `건물: 국토교통부 GIS건물통합정보(브이월드)${add} · ${c.date} 수집 · 최근 지은 건물이 빠지거나 값이 비어 있을 수 있음`
}

function catColor(pal: Palette, i: number): string {
  return pal.cat[i % pal.cat.length]
}

const layerLabel = (id: string) => ALL_LAYERS.find((l) => l.id === id)?.label ?? id

// ───────────────────────── 건축물 용도 ─────────────────────────

const USE_CLASSES: { id: string; label: string; codes: string[]; color: string }[] = [
  { id: 'house', label: '단독주택', codes: ['01000'], color: '#f6d36b' },
  { id: 'apt', label: '공동주택', codes: ['02000'], color: '#e9a23b' },
  { id: 'nbhd', label: '근린생활시설', codes: ['03000', '04000'], color: '#e8743b' },
  { id: 'biz', label: '판매·업무·숙박', codes: ['07000', '14000', '15000', '16000'], color: '#c8435a' },
  { id: 'public', label: '문화·교육·의료·복지', codes: ['05000', '06000', '09000', '10000', '11000', '12000', '13000', '23000', '24000', '27000', '28000'], color: '#3d7dca' },
  { id: 'industry', label: '공장·창고·교통', codes: ['08000', '17000', '18000', '19000', '20000', '21000', '22000', '25000', '26000', '29000'], color: '#8c6bb1' },
]

function useClass(code: string): string {
  if (!code) return 'unknown'
  return USE_CLASSES.find((u) => u.codes.includes(code))?.id ?? 'other'
}

function useColor(pal: Palette, id: string): string {
  if (id === 'unknown') return pal.unknown
  if (id === 'other') return isStock(pal, 'default') ? '#7a8b99' : catColor(pal, 6)
  const i = USE_CLASSES.findIndex((u) => u.id === id)
  return isStock(pal, 'default') ? USE_CLASSES[i].color : catColor(pal, i)
}

// ───────────────────────── 층수 ─────────────────────────

const FLOOR_BINS = [
  { label: '1~2층', test: (n: number) => n <= 2 },
  { label: '3~5층', test: (n: number) => n >= 3 && n <= 5 },
  { label: '6~10층', test: (n: number) => n >= 6 && n <= 10 },
  { label: '11~20층', test: (n: number) => n >= 11 && n <= 20 },
  { label: '21층 이상', test: (n: number) => n >= 21 },
]

// ───────────────────────── 그림자 (볼록 껍질) ─────────────────────────

function hull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: [number, number][] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

function insideConvex(poly: [number, number][], x: number, y: number): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]
    const [bx, by] = poly[(i + 1) % poly.length]
    const cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
    if (cr !== 0) {
      if (sign === 0) sign = Math.sign(cr)
      else if (Math.sign(cr) !== sign) return false
    }
  }
  return true
}

function outerRings(g: Areal): Position[][] {
  return g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0])
}

/** 대지 안을 고르게 찍은 점 (경위도) */
function sitePoints(c: PanelCtx, n = 24): [number, number][] {
  const rings = outerRings(c.d.boundary)
  let [a, b, cc, dd] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const r of rings)
    for (const [x, y] of r) {
      a = Math.min(a, x)
      b = Math.min(b, y)
      cc = Math.max(cc, x)
      dd = Math.max(dd, y)
    }
  const out: [number, number][] = []
  const poly = feature(c.d.boundary)
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const lon = a + ((i + 0.5) / n) * (cc - a)
      const lat = b + ((j + 0.5) / n) * (dd - b)
      if (booleanPointInPolygon(point([lon, lat]), poly)) out.push([lon, lat])
    }
  return out
}

// ───────────────────────── 도판들 ─────────────────────────

export const PANELS: PanelDef[] = [
  {
    id: 'aerial',
    title: '항공사진',
    group: '위치',
    needs: '브이월드 인증키가 있어야 그려집니다.',
    render: async (c) => {
      const img = await aerialImage(c.f, c.vworldKey)
      if (!img) return { layers: [], legend: [], summary: [], caption: '배경 © 브이월드 위성영상(국토교통부)', empty: '항공사진을 받지 못했습니다' }
      return {
        layers: [{ id: '항공사진', svg: `<image href="${img.href}" x="${img.x}" y="${img.y}" width="${img.size}" height="${img.size}" preserveAspectRatio="none"/>` }],
        legend: [],
        summary: ['다이어그램에서 생략한 지붕 재질·주차장·공사장·나무를 확인하는 기준 도판', '촬영 시기는 지점마다 다르고 화면에 나오지 않음'],
        caption: `배경 © 브이월드 위성영상(국토교통부) · 촬영 시기 알 수 없음${img.failed ? ` · 타일 ${img.failed}장 받지 못함` : ''}`,
      }
    },
  },
  {
    id: 'zoning',
    title: '용도지역',
    group: '땅의 조건',
    needs: "공간정보에서 '규제·계획'을 수집하세요.",
    render: (c) => {
      if (!c.d.zoning.length) return { layers: [], legend: [], summary: [], caption: '', empty: '용도지역 자료가 없습니다' }
      const names = [...new Set(c.d.zoning.map((z) => z.name))]
      const styles: Record<string, { fill: string; stroke: string; width: number; label: string }> = {}
      for (const n of names) styles[n] = { fill: zoningColor(n, c.pal), stroke: c.pal.paper, width: 1.5, label: n }
      const circle = radiusCircle(c.d.center, c.f.R)
      const areaBy = new Map<string, number>()
      for (const z of c.d.zoning) {
        try {
          const inter = intersect(featureCollection([feature(z.geom), feature(circle)]))
          if (inter) areaBy.set(z.name, (areaBy.get(z.name) ?? 0) + area(inter))
        } catch {
          /* 계산 실패한 조각은 비율에서 뺀다 */
        }
      }
      const total = [...areaBy.values()].reduce((a, b) => a + b, 0)
      const site = [...new Set(c.d.zoning.filter((z) => overlapsSite(z.geom, c.d.boundary)).map((z) => z.name))]
      const order = [...areaBy.entries()].sort((a, b) => b[1] - a[1])
      return {
        layers: [{ id: '용도지역', svg: grouped(c.d.zoning.map((z) => ({ d: c.f.path(z.geom), key: z.name })), styles) }, baseBuildings(c, 'rgba(255,255,255,0.35)')],
        legend: order.map(([n]) => ({ color: styles[n].fill, label: n })),
        summary: [
          site.length ? `대지는 ${site.join('·')}에 속함` : '대지에 걸친 용도지역을 찾지 못함',
          `반경 안 면적 비율: ${order.slice(0, 5).map(([n, a]) => `${n} ${pct(a, total)}%`).join(', ')}`,
        ],
        caption: `국토교통부 용도지역(브이월드) · ${c.date} 수집 · 도시계획 정보는 참고용이며 법적 효력은 토지이음에서 확인`,
      }
    },
  },
  {
    id: 'districts',
    title: '구역·지구',
    group: '땅의 조건',
    needs: "공간정보에서 '규제·계획'을 수집하세요.",
    render: (c) => {
      const items = c.d.districts
      const layers = [...new Set(items.map((x) => x.layer))]
      const styles: Record<string, { fill: string; stroke: string; width: number; opacity: number; label: string }> = {}
      layers.forEach((l, i) => (styles[l] = { fill: catColor(c.pal, i), stroke: catColor(c.pal, i), width: 2.5, opacity: 0.22, label: layerLabel(l) }))
      const onSite = [...new Set(items.filter((x) => overlapsSite(x.geom, c.d.boundary)).map((x) => x.name))]
      const names = [...new Set(items.map((x) => x.name))]
      return {
        layers: [baseBuildings(c), { id: '구역·지구', svg: grouped(items.map((x) => ({ d: c.f.path(x.geom), key: x.layer })), styles) }],
        legend: layers.map((l) => ({ color: styles[l].fill, label: layerLabel(l), shape: 'outline' as const })),
        summary: items.length
          ? [onSite.length ? `대지에 걸친 것: ${onSite.join(', ')}` : '대지에 걸친 구역·지구 없음', `반경 안: ${names.slice(0, 8).join(', ')}`]
          : ['반경 안에 지정된 용도지구·구역·보호구역·재해구역이 없음 (빈 도판 자체가 "지정 없음"의 근거)'],
        caption: `용도지구·지구단위계획구역·개발제한구역·보호구역·재해위험지구 등(브이월드) · ${c.date} 수집 · 법적 효력은 토지이음에서 확인`,
        empty: items.length ? undefined : '반경 안에 지정된 구역·지구 없음',
      }
    },
  },
  {
    id: 'facilities',
    title: '도시계획시설',
    group: '땅의 조건',
    needs: "공간정보에서 '도시계획시설'과 '공공·문화·복지·교육'을 수집하세요.",
    render: (c) => {
      const items = c.d.facilities
      if (!items.length) return { layers: [baseBuildings(c)], legend: [], summary: ['반경 안에 도시계획시설 자료 없음'], caption: '', empty: '도시계획시설 자료가 없습니다' }
      const layers = [...new Set(items.map((x) => x.layer))]
      const styles: Record<string, { fill: string; stroke: string; width: number; opacity: number; label: string }> = {}
      layers.forEach((l, i) => (styles[l] = { fill: catColor(c.pal, i), stroke: c.pal.paper, width: 1, opacity: 0.8, label: layerLabel(l).replace('도시계획시설', '').replace(/[()]/g, '') }))
      const near = items
        .map((x) => ({ x, d: geometryToAreaDistanceM(x.geom, c.d.boundary) ?? Infinity }))
        .sort((a, b) => a.d - b.d)
      const uniqNear: string[] = []
      for (const n of near) {
        const label = `${n.x.name}(${n.d === 0 ? '대지에 걸침' : dist(n.d)})`
        if (!uniqNear.some((u) => u.startsWith(n.x.name))) uniqNear.push(label)
        if (uniqNear.length >= 5) break
      }
      return {
        layers: [baseBuildings(c), { id: '도시계획시설', svg: grouped(items.map((x) => ({ d: c.f.path(x.geom), key: x.layer })), styles) }],
        legend: layers.map((l) => ({ color: styles[l].fill, label: styles[l].label })),
        summary: [`반경 안 도시계획시설 ${fmt(items.length)}곳 (${layers.map((l) => styles[l].label).join(', ')})`, `대지에서 가까운 것: ${uniqNear.join(', ')}`],
        caption: `도시계획시설(브이월드 도시계획 정보) · ${c.date} 수집 · 결정된 시설 부지이며 실제 조성 여부는 현장 확인`,
      }
    },
  },
  {
    id: 'cadastral',
    title: '지적',
    group: '땅의 조건',
    needs: "공간정보에서 '토지'를 수집하세요.",
    render: (c) => {
      const ps = c.d.parcels
      if (!ps.length) return { layers: [], legend: [], summary: [], caption: '', empty: '반경 안 지적 자료가 없습니다' }
      const lots = ps.filter((p) => !['도', '천', '구', '제', '철', '유'].includes(p.jimok) && inFrame(c, p.geom))
      const d = ps.map((p) => c.f.path(p.geom, false)).join('')
      return {
        layers: [{ id: '필지선', svg: `<path d="${d}" fill="none" stroke="${c.pal.ink}" stroke-opacity="0.55" stroke-width="0.7"/>` }],
        legend: [{ color: c.pal.ink, label: '필지 경계', shape: 'outline' }],
        summary: [
          `반경 안 필지 ${fmt(ps.length)}개 (도로·하천 등 제외 ${fmt(lots.length)}개)`,
          lots.length ? `필지 면적 중앙값 ${fmt(median(lots.map((p) => p.area)))}㎡` : '',
          `대지는 ${c.d.parcels.filter((p) => p.onSite).length || '?'}필지`,
        ].filter(Boolean),
        caption: `연속지적도(브이월드) · ${c.date} 수집 · 지적도를 이어 붙인 참고 도면으로 실제 측량 경계와 다를 수 있음`,
      }
    },
  },
  {
    id: 'plotsize',
    title: '필지 규모',
    group: '땅의 조건',
    needs: "공간정보에서 '토지'를 수집하세요.",
    render: (c) => {
      const ps = c.d.parcels
      if (!ps.length) return { layers: [], legend: [], summary: [], caption: '', empty: '반경 안 지적 자료가 없습니다' }
      const bins = [
        { label: '100㎡ 미만', max: 100 },
        { label: '100~200㎡', max: 200 },
        { label: '200~500㎡', max: 500 },
        { label: '500~1,000㎡', max: 1000 },
        { label: '1,000~3,000㎡', max: 3000 },
        { label: '3,000㎡ 이상', max: Infinity },
      ]
      const colors = steps(c.pal, bins.length)
      const styles: Record<string, { fill: string; stroke: string; width: number; label: string }> = { infra: { fill: mix(c.pal.paper, c.pal.unknown, 0.6), stroke: c.pal.paper, width: 0.6, label: '도로·하천 등' } }
      bins.forEach((b, i) => (styles[`b${i}`] = { fill: colors[i], stroke: c.pal.paper, width: 0.6, label: b.label }))
      const isInfra = (j: string) => ['도', '천', '구', '제', '철', '유'].includes(j)
      const items = ps.map((p) => ({ d: c.f.path(p.geom, false), key: isInfra(p.jimok) ? 'infra' : `b${bins.findIndex((b) => p.area < b.max)}` }))
      const lots = ps.filter((p) => !isInfra(p.jimok) && inFrame(c, p.geom))
      const small = lots.filter((p) => p.area < 200).length
      const siteArea = c.d.parcels.filter((p) => p.onSite).reduce((a, p) => a + p.area, 0)
      const bigger = lots.filter((p) => p.area > siteArea).length
      return {
        layers: [{ id: '필지_규모', svg: grouped(items, styles) }],
        legend: [...bins.map((b, i) => ({ color: colors[i], label: b.label })), { color: styles.infra.fill, label: '도로·하천 등' }],
        summary: [
          `필지 면적 중앙값 ${fmt(median(lots.map((p) => p.area)))}㎡, 200㎡ 미만 세필지 ${pct(small, lots.length)}%`,
          siteArea ? `대지 필지 합계 약 ${fmt(siteArea)}㎡ — 반경 안 필지 중 이보다 큰 것 ${pct(bigger, lots.length)}%` : '',
        ].filter(Boolean),
        caption: `연속지적도(브이월드) 도형으로 계산한 면적 · ${c.date} 수집 · 도로·하천·구거 등 지목은 회색`,
      }
    },
  },
  {
    id: 'figure',
    title: '건물 (피겨-그라운드)',
    group: '주변 현황',
    needs: "공간정보에서 '주변 건물'을 수집하세요.",
    render: (c) => {
      const bs = c.d.buildings
      if (!bs.length) return { layers: [], legend: [], summary: [], caption: '', empty: '건물 자료가 없습니다' }
      const inside = bs.filter((b) => inFrame(c, b.geom))
      const cover = inside.reduce((a, b) => a + b.area, 0)
      return {
        layers: [{ id: '건물', svg: `<path d="${bs.map((b) => c.f.path(b.geom, false)).join('')}" fill="${c.pal.ink}"/>` }],
        legend: [{ color: c.pal.ink, label: '건물' }],
        summary: [
          `반경 안 건물 ${fmt(inside.length)}동`,
          `건물이 땅을 덮은 비율 약 ${pct(cover, frameArea(c.f))}% (건물 바닥 면적 합 ÷ 도판 면적)`,
          `건물 바닥 면적 중앙값 ${fmt(median(inside.map((b) => b.area)))}㎡`,
        ],
        caption: bldCaption(c),
      }
    },
  },
  {
    id: 'use',
    title: '건축물 용도',
    group: '주변 현황',
    needs: "공간정보에서 '주변 건물'을 수집하세요.",
    render: (c) => {
      const bs = c.d.buildings
      if (!bs.length) return { layers: [], legend: [], summary: [], caption: '', empty: '건물 자료가 없습니다' }
      const ids = [...USE_CLASSES.map((u) => u.id), 'other', 'unknown']
      const label = (id: string) => (id === 'other' ? '기타' : id === 'unknown' ? '미상' : USE_CLASSES.find((u) => u.id === id)!.label)
      const styles: Record<string, { fill: string; label: string }> = {}
      for (const id of ids) styles[id] = { fill: useColor(c.pal, id), label: label(id) }
      const inside = bs.filter((b) => inFrame(c, b.geom))
      const counts = new Map<string, number>()
      for (const b of inside) counts.set(useClass(b.use), (counts.get(useClass(b.use)) ?? 0) + 1)
      const known = inside.length - (counts.get('unknown') ?? 0)
      const ranked = ids.filter((id) => id !== 'unknown' && counts.get(id)).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
      // 대지 경계 20m 안 건물
      const near = bs.filter((b) => !b.onSite && c.f.polar(...(centroidOf(b.geom) ?? c.d.center)).d < c.f.R * 0.4 && (geometryToAreaDistanceM(b.geom, c.d.boundary) ?? 99) <= 20)
      const nearCounts = new Map<string, number>()
      for (const b of near) if (useClass(b.use) !== 'unknown') nearCounts.set(useClass(b.use), (nearCounts.get(useClass(b.use)) ?? 0) + 1)
      const nearRank = [...nearCounts.entries()].sort((a, b) => b[1] - a[1])
      return {
        layers: [{ id: '건축물_용도', svg: grouped(bs.map((b) => ({ d: c.f.path(b.geom, false), key: useClass(b.use) })), styles) }],
        legend: ids.filter((id) => counts.get(id)).map((id) => ({ color: styles[id].fill, label: `${styles[id].label}` })),
        summary: [
          `용도가 확인되는 ${fmt(known)}동 중 ${ranked.slice(0, 3).map((id) => `${label(id)} ${pct(counts.get(id) ?? 0, known)}%`).join(', ')}`,
          `용도 미상 ${pct(counts.get('unknown') ?? 0, inside.length)}% (최근 건물·미등재 건물일 수 있어 현장 확인 대상)`,
          nearRank.length ? `대지 경계 20m 안 건물: ${nearRank.slice(0, 3).map(([id, n]) => `${label(id)} ${n}동`).join(', ')}` : '',
        ].filter(Boolean),
        caption: `${bldCaption(c)} · 용도는 건축물대장의 주용도`,
      }
    },
  },
  {
    id: 'age',
    title: '준공 연대',
    group: '주변 현황',
    needs: "공간정보에서 '주변 건물'을 수집하세요.",
    render: (c) => {
      const bs = c.d.buildings
      if (!bs.length) return { layers: [], legend: [], summary: [], caption: '', empty: '건물 자료가 없습니다' }
      const bins = [
        { label: '1970년 이전', test: (y: number) => y < 1970 },
        { label: '1970년대', test: (y: number) => y >= 1970 && y < 1980 },
        { label: '1980년대', test: (y: number) => y >= 1980 && y < 1990 },
        { label: '1990년대', test: (y: number) => y >= 1990 && y < 2000 },
        { label: '2000년대', test: (y: number) => y >= 2000 && y < 2010 },
        { label: '2010년대', test: (y: number) => y >= 2010 && y < 2020 },
        { label: '2020년 이후', test: (y: number) => y >= 2020 },
      ]
      const colors = steps(c.pal, bins.length).reverse() // 오래될수록 진하게
      const styles: Record<string, { fill: string; label: string }> = { unknown: { fill: c.pal.unknown, label: '미상' } }
      bins.forEach((b, i) => (styles[`b${i}`] = { fill: colors[i], label: b.label }))
      const keyOf = (b: Bld) => (b.year === null ? 'unknown' : `b${bins.findIndex((x) => x.test(b.year!))}`)
      const inside = bs.filter((b) => inFrame(c, b.geom))
      const years = inside.map((b) => b.year).filter((y): y is number => y !== null)
      const cut = new Date().getFullYear() - 30
      const decade = bins.map((b) => [b.label, years.filter(b.test).length] as const).sort((a, b) => b[1] - a[1])[0]
      return {
        layers: [{ id: '준공_연대', svg: grouped(bs.map((b) => ({ d: c.f.path(b.geom, false), key: keyOf(b) })), styles) }],
        legend: [...bins.map((b, i) => ({ color: colors[i], label: b.label })), { color: c.pal.unknown, label: '미상' }],
        summary: years.length
          ? [
              `사용승인 연도가 확인되는 ${fmt(years.length)}동 중 30년 넘은(${cut}년 이전) 건물 ${pct(years.filter((y) => y < cut).length, years.length)}%`,
              `사용승인 연도 중앙값 ${Math.round(median(years))}년, 가장 많은 연대 ${decade[0]}`,
              `연도 미상 ${pct(inside.length - years.length, inside.length)}%`,
            ]
          : ['사용승인 연도가 있는 건물이 없음'],
        caption: `${bldCaption(c)} · 사용승인일 기준, 미상은 추정하지 않음`,
      }
    },
  },
  {
    id: 'height',
    title: '건축물 높이 (층수)',
    group: '주변 현황',
    needs: "공간정보에서 '주변 건물'을 수집하세요.",
    render: (c) => {
      const bs = c.d.buildings
      if (!bs.length) return { layers: [], legend: [], summary: [], caption: '', empty: '건물 자료가 없습니다' }
      const colors = steps(c.pal, FLOOR_BINS.length)
      const styles: Record<string, { fill: string; label: string }> = { unknown: { fill: c.pal.unknown, label: '미상' } }
      FLOOR_BINS.forEach((b, i) => (styles[`b${i}`] = { fill: colors[i], label: b.label }))
      const keyOf = (b: Bld) => (b.floors === null ? 'unknown' : `b${FLOOR_BINS.findIndex((x) => x.test(b.floors!))}`)
      const inside = bs.filter((b) => inFrame(c, b.geom))
      const fl = inside.map((b) => b.floors).filter((n): n is number => n !== null)
      const top = inside.filter((b) => b.floors !== null).sort((a, b) => b.floors! - a.floors!)[0]
      const tc = top ? centroidOf(top.geom) : null
      const fromAddr = inside.filter((b) => b.floorsFromAddr).length
      return {
        layers: [{ id: '층수', svg: grouped(bs.map((b) => ({ d: c.f.path(b.geom, false), key: keyOf(b) })), styles) }],
        legend: [...FLOOR_BINS.map((b, i) => ({ color: colors[i], label: b.label })), { color: c.pal.unknown, label: '미상' }],
        summary: fl.length
          ? [
              `층수가 확인되는 ${fmt(fl.length)}동: 1~2층 ${pct(fl.filter((n) => n <= 2).length, fl.length)}%, 3~5층 ${pct(fl.filter((n) => n >= 3 && n <= 5).length, fl.length)}%, 6층 이상 ${pct(fl.filter((n) => n >= 6).length, fl.length)}%`,
              `층수 중앙값 ${fmt(median(fl), 1)}층, 가장 높은 건물 지상 ${top?.floors}층${tc ? ` (${where(c, tc[0], tc[1])})` : ''}`,
              `층수 미상 ${pct(inside.length - fl.length, inside.length)}%`,
            ]
          : ['층수가 있는 건물이 없음'],
        caption: `${bldCaption(c)} · 지상층수 기준${fromAddr ? ` (${fmt(fromAddr)}동은 도로명주소 건물의 층수로 보강)` : ''}`,
      }
    },
  },
  {
    id: 'high',
    title: '고층',
    group: '주변 현황',
    needs: "공간정보에서 '주변 건물'을 수집하세요.",
    render: (c) => {
      const th = c.st.highFloors
      const bs = c.d.buildings
      if (!bs.length) return { layers: [], legend: [], summary: [], caption: '', empty: '건물 자료가 없습니다' }
      const hot = themeColor(c.pal, { default: '#2f6fd6', cvd: '#0072b2', mono: '#2a2a2a' }, c.pal.cat[3])
      const styles = { hi: { fill: hot, label: `${th}층 이상` }, lo: { fill: c.pal.base, label: `${th}층 미만` }, unknown: { fill: mix(c.pal.paper, c.pal.unknown, 0.5), label: '미상' } }
      const keyOf = (b: Bld) => (b.floors === null ? 'unknown' : b.floors >= th ? 'hi' : 'lo')
      const inside = bs.filter((b) => inFrame(c, b.geom))
      const highs = inside.filter((b) => b.floors !== null && b.floors >= th)
      const nearest = highs
        .filter((b) => !b.onSite)
        .map((b) => ({ b, d: geometryToAreaDistanceM(b.geom, c.d.boundary) ?? Infinity }))
        .sort((a, b) => a.d - b.d)[0]
      const nc = nearest ? centroidOf(nearest.b.geom) : null
      return {
        layers: [{ id: '고층', svg: grouped(bs.map((b) => ({ d: c.f.path(b.geom, false), key: keyOf(b) })), styles) }],
        legend: [{ color: hot, label: `지상 ${th}층 이상 (약 ${th * 3}m)` }, { color: c.pal.base, label: `${th}층 미만` }, { color: styles.unknown.fill, label: '층수 미상' }],
        summary: [
          `지상 ${th}층 이상 ${fmt(highs.length)}동 (층수 확인 건물의 ${pct(highs.length, inside.filter((b) => b.floors !== null).length)}%)`,
          nearest && nc ? `대지에서 가장 가까운 고층: ${nearest.b.floors}층, 대지 경계에서 ${dist(nearest.d)} (${dir8(c.f.polar(nc[0], nc[1]).bearing)}쪽)` : '반경 안에 고층 건물 없음',
        ],
        caption: `${bldCaption(c)} · 고층 기준은 도판 설정에서 바꿀 수 있음 (층당 약 3m로 환산)`,
      }
    },
  },
  {
    id: 'low',
    title: '저층',
    group: '주변 현황',
    needs: "공간정보에서 '주변 건물'을 수집하세요.",
    render: (c) => {
      const th = c.st.lowFloors
      const bs = c.d.buildings
      if (!bs.length) return { layers: [], legend: [], summary: [], caption: '', empty: '건물 자료가 없습니다' }
      const hot = themeColor(c.pal, { default: '#d9822b', cvd: '#e69f00', mono: '#4a4a4a' }, c.pal.cat[1])
      const styles = { lo: { fill: hot, label: `${th}층 이하` }, hi: { fill: c.pal.base, label: `${th}층 초과` }, unknown: { fill: mix(c.pal.paper, c.pal.unknown, 0.5), label: '미상' } }
      const keyOf = (b: Bld) => (b.floors === null ? 'unknown' : b.floors <= th ? 'lo' : 'hi')
      const inside = bs.filter((b) => inFrame(c, b.geom) && b.floors !== null)
      const lows = inside.filter((b) => b.floors! <= th)
      const near = c.d.buildings.filter((b) => !b.onSite && b.floors !== null && (geometryToAreaDistanceM(b.geom, c.d.boundary) ?? 99) <= 50)
      return {
        layers: [{ id: '저층', svg: grouped(bs.map((b) => ({ d: c.f.path(b.geom, false), key: keyOf(b) })), styles) }],
        legend: [{ color: hot, label: `지상 ${th}층 이하 (약 ${th * 3}m)` }, { color: c.pal.base, label: `${th}층 초과` }, { color: styles.unknown.fill, label: '층수 미상' }],
        summary: [
          `층수가 확인되는 건물 중 지상 ${th}층 이하 ${pct(lows.length, inside.length)}% (${fmt(lows.length)}동)`,
          near.length ? `대지 경계 50m 안 건물 중 ${th}층 이하 ${pct(near.filter((b) => b.floors! <= th).length, near.length)}%` : '',
        ].filter(Boolean),
        caption: `${bldCaption(c)} · 저층 기준은 도판 설정에서 바꿀 수 있음`,
      }
    },
  },
  {
    id: 'density',
    title: '밀도 (연면적)',
    group: '주변 현황',
    needs: "공간정보에서 '주변 건물'을 수집하세요.",
    render: (c) => {
      const bs = c.d.buildings
      if (!bs.length) return { layers: [], legend: [], summary: [], caption: '', empty: '건물 자료가 없습니다' }
      const N = 100
      const cell = (MAP_R * 2) / N
      const left = MAP_CX - MAP_R
      const top = MAP_CY - MAP_R
      const h = Math.max(c.f.R / 7, 40) * c.f.s // 퍼짐 반경(px)
      const reach = Math.ceil((3 * h) / cell)
      const grid = new Float64Array(N * N)
      for (const b of bs) {
        const ct = centroidOf(b.geom)
        if (!ct) continue
        const [x, y] = c.f.pt(ct[0], ct[1])
        const gx = (x - left) / cell
        const gy = (y - top) / cell
        const w = b.area * (b.floors ?? 1)
        for (let i = Math.max(0, Math.floor(gx - reach)); i <= Math.min(N - 1, Math.ceil(gx + reach)); i++)
          for (let j = Math.max(0, Math.floor(gy - reach)); j <= Math.min(N - 1, Math.ceil(gy + reach)); j++) {
            const dx = (i + 0.5 - gx) * cell
            const dy = (j + 0.5 - gy) * cell
            grid[j * N + i] += w * Math.exp(-(dx * dx + dy * dy) / (2 * h * h))
          }
      }
      let max = 0
      for (const v of grid) if (v > max) max = v
      if (max <= 0) return { layers: [], legend: [], summary: [], caption: '', empty: '밀도를 계산할 건물이 없습니다' }
      const levels = [0.15, 0.3, 0.45, 0.6, 0.8].map((t) => t * max)
      const bands = contours().size([N, N]).thresholds(levels)(Array.from(grid))
      const colors = steps(c.pal, levels.length)
      const toPx = (ring: number[][]) => ring.map(([gx, gy], k) => `${k === 0 ? 'M' : 'L'}${(left + gx * cell).toFixed(1)} ${(top + gy * cell).toFixed(1)}`).join('') + 'Z'
      const bandSvg = bands
        .map((b, i) => `<g id="밀도_${i + 1}단계"><path d="${b.coordinates.map((poly) => poly.map(toPx).join('')).join('')}" fill="${colors[i]}" fill-opacity="0.85" fill-rule="evenodd"/></g>`)
        .join('')
      // 대지가 몇 단계인지, 가장 높은 곳은 어디인지
      const [sx, sy] = c.f.pt(c.d.center[0], c.d.center[1])
      const sv = grid[Math.min(N - 1, Math.max(0, Math.floor((sy - top) / cell))) * N + Math.min(N - 1, Math.max(0, Math.floor((sx - left) / cell)))]
      const siteLevel = levels.filter((l) => sv >= l).length
      let pk = 0
      for (let k = 1; k < grid.length; k++) if (grid[k] > grid[pk]) pk = k
      const [plon, plat] = c.f.inv(left + ((pk % N) + 0.5) * cell, top + (Math.floor(pk / N) + 0.5) * cell)
      return {
        layers: [{ id: '밀도', svg: bandSvg }, { id: '바탕_건물', svg: `<path d="${bs.map((b) => c.f.path(b.geom, false)).join('')}" fill="none" stroke="${c.pal.ink}" stroke-opacity="0.25" stroke-width="0.5"/>` }],
        legend: colors.map((col, i) => ({ color: col, label: `${i + 1}단계${i === 0 ? ' (낮음)' : i === colors.length - 1 ? ' (높음)' : ''}` })),
        summary: [
          `연면적이 가장 몰린 곳: ${where(c, plon, plat)}`,
          `대지 중심은 5단계 중 ${siteLevel === 0 ? '가장 낮은 단계 밖' : `${siteLevel}단계`}`,
        ],
        caption: `건물 바닥 면적 × 지상층수(층수 미상은 1층으로 계산)를 약 ${fmt(Math.max(c.f.R / 7, 40))}m 반경으로 부드럽게 퍼뜨린 상대값 · ${bldCaption(c)}`,
      }
    },
  },
  {
    id: 'green',
    title: '공원·녹지·하천',
    group: '연계와 접근',
    needs: "공간정보에서 '도시계획시설'과 '재해·하천'을 수집하세요.",
    render: (c) => {
      const parks = c.d.parks.filter((p) => p.extra.kind === 'park')
      const rivers = c.d.parks.filter((p) => p.extra.kind === 'river')
      const styles = { park: { fill: c.pal.green, label: '공원·녹지·광장' }, river: { fill: c.pal.water, label: '하천' } }
      const near = (list: typeof parks) =>
        list
          .map((p) => ({ p, d: geometryToAreaDistanceM(p.geom, c.d.boundary) ?? Infinity }))
          .sort((a, b) => a.d - b.d)[0]
      const np = near(parks)
      const nr = near(rivers)
      return {
        layers: [baseBuildings(c), { id: '공원·녹지·하천', svg: grouped([...parks.map((p) => ({ d: c.f.path(p.geom), key: 'park' })), ...rivers.map((p) => ({ d: c.f.path(p.geom), key: 'river' }))], styles) }],
        legend: [
          { color: c.pal.green, label: '공원·녹지·광장 (도시계획)' },
          { color: c.pal.water, label: '하천' },
        ],
        summary: [
          np ? `가장 가까운 공원·녹지: ${np.p.name} (대지 경계에서 ${np.d === 0 ? '대지에 걸침' : dist(np.d)})` : '반경 안에 도시계획 공원·녹지 없음',
          nr ? `가장 가까운 하천: ${nr.p.name} (${dist(nr.d)})` : '반경 안에 하천 없음',
        ],
        caption: `도시계획시설 공원·녹지·광장, 하천망(브이월드) · ${c.date} 수집 · 지정된 녹지만 표시 (단지 조경·가로수는 없음)`,
      }
    },
  },
  {
    id: 'roads',
    title: '도로 위계 (폭)',
    group: '연계와 접근',
    needs: "공간정보에서 '도로'를 수집하세요 (도로중심선).",
    render: (c) => {
      const rs = c.d.roads
      if (!rs.length) return { layers: [baseBuildings(c)], legend: [], summary: [], caption: '', empty: '도로중심선 자료가 없습니다' }
      const bins = [
        { label: '세로 (8m 미만)', min: 0 },
        { label: '소로 (8~12m)', min: 8 },
        { label: '중로 (12~25m)', min: 12 },
        { label: '대로 (25~40m)', min: 25 },
        { label: '광로 (40m 이상)', min: 40 },
      ]
      const colors = monoShades(c.pal, bins.length)
      const keyOf = (w: number | null) => (w === null ? -1 : bins.filter((b) => w >= b.min).length - 1)
      const sorted = [...rs].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
      const lines = sorted
        .map((r) => {
          const k = keyOf(r.width)
          const w = Math.max(1, Math.min(18, (r.width ?? 3) * c.f.s))
          return `<path d="${c.f.path(r.geom)}" fill="none" stroke="${k < 0 ? c.pal.unknown : colors[k]}" stroke-width="${w.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`
        })
        .join('')
      const adj = rs
        .filter((r) => {
          try {
            return lineToAreaDistanceM(r.geom, c.d.boundary) <= (r.width ?? 4) / 2 + 8
          } catch {
            return false
          }
        })
        .map((r) => r.width)
        .filter((w): w is number => w !== null)
      const adjText = [...new Set(adj.map((w) => Math.round(w)))].sort((a, b) => b - a)
      const count = bins.map((_, i) => rs.filter((r) => keyOf(r.width) === i).length)
      // 수치지도를 올렸으면 실제 도로 면(인도 포함)을 바탕에 옅게
      const areaSvg = c.d.ngii?.roads.length
        ? `<path d="${c.d.ngii.roads.map((g) => c.f.path(g)).join('')}" fill="${mix(c.pal.paper, c.pal.ink, 0.14)}" stroke="none"/>`
        : ''
      return {
        layers: [
          baseBuildings(c, mix(c.pal.paper, c.pal.base, 0.6)),
          ...(areaSvg ? [{ id: '도로_면_수치지도', svg: areaSvg }] : []),
          { id: '도로', svg: lines },
        ],
        legend: [
          ...bins.map((b, i) => ({ color: colors[i], label: b.label, shape: 'line' as const })),
          ...(areaSvg ? [{ color: mix(c.pal.paper, c.pal.ink, 0.14), label: '도로 면 (수치지도, 인도 포함)' }] : []),
        ],
        summary: [
          adjText.length ? `대지에 접한 길의 폭: ${adjText.map((w) => `${w}m`).join(', ')} (도로중심선 기준)` : '대지 경계에 바로 붙은 도로중심선을 찾지 못함 (골목·사유 통로일 수 있어 현장 확인)',
          `반경 안 도로 구간: ${bins.map((b, i) => (count[i] ? `${b.label.split(' ')[0]} ${count[i]}` : '')).filter(Boolean).join(', ')}`,
        ],
        caption: `국토지리정보원 도로중심선(브이월드) · ${c.date} 수집 · 선 굵기는 실제 도로 폭 비율, 폭은 지형도 기준이라 실제와 다를 수 있음`,
      }
    },
  },
  {
    id: 'transit',
    title: '지하철·버스',
    group: '연계와 접근',
    needs: "공간정보에서 '대중교통'·'주변 생활 시설'을 수집하세요.",
    render: (c) => {
      const st = c.d.stations
      const sp = c.d.stops
      if (!st.length && !sp.length) return { layers: [baseBuildings(c)], legend: [], summary: [], caption: '', empty: '정류소·역 자료가 없습니다' }
      const stationColor = c.pal.kind === 'mono' ? c.pal.ink : catColor(c.pal, 3)
      const stopColor = c.pal.kind === 'mono' ? mix(c.pal.paper, c.pal.ink, 0.55) : catColor(c.pal, 0)
      const near = (list: Pt[]) => list.map((p) => ({ p, d: c.f.polar(p.lon, p.lat).d })).sort((a, b) => a.d - b.d)
      const ns = near(st)
      const nb = near(sp)
      const labels = ns
        .filter((x) => c.f.inside(x.p.lon, x.p.lat))
        .slice(0, 3)
        .map((x) => {
          const [px, py] = c.f.pt(x.p.lon, x.p.lat)
          return `<text x="${(px + 14).toFixed(1)}" y="${(py + 5).toFixed(1)}" font-size="16" font-weight="700" fill="${c.pal.ink}" stroke="${c.pal.paper}" stroke-width="4" paint-order="stroke">${esc(x.p.name.replace(/\s.*$/, ''))}</text>`
        })
        .join('')
      return {
        layers: [
          baseBuildings(c),
          baseRoads(c),
          { id: '버스정류소', svg: sp.map((p) => ptSvg(c, p, 5, stopColor, 'square')).join('') },
          { id: '지하철역', svg: st.map((p) => ptSvg(c, p, 10, stationColor)).join('') + labels },
        ],
        legend: [
          { color: stationColor, label: '지하철역 (카카오)', shape: 'dot' },
          { color: stopColor, label: '버스정류소 (TAGO)', shape: 'square' },
        ],
        summary: [
          ns.length ? `가장 가까운 지하철역: ${ns[0].p.name} (대지 중심에서 ${dist(ns[0].d)})` : '반경 안에 지하철역 없음',
          `대지 중심 200m 안 버스정류소 ${nb.filter((x) => x.d <= 200).length}곳, 500m 안 ${nb.filter((x) => x.d <= 500).length}곳`,
        ],
        caption: `지하철역: 카카오 로컬 · 버스정류소: 국토교통부 TAGO(대지 중심 약 500m, 정류소 번호 0·노선 없는 터미널 자체 기록은 뺌) · ${c.date} 수집 · 거리는 직선거리`,
      }
    },
  },
  {
    id: 'sun',
    title: '태양 궤적·그림자',
    group: '환경',
    needs: '대지를 정하면 그려집니다.',
    render: (c) => {
      const day = SUN_DAYS.find((x) => x.key === c.st.sunDay) ?? SUN_DAYS[2]
      const hour = c.st.sunHour
      const sun = sunAt(c.d.center[0], c.d.center[1], c.st.sunDay, hour)
      const pathColors = sunPathColors(c.pal)
      const sunPaths = sunPathFeatures(c.d.center[0], c.d.center[1], c.f.R * 0.92)
      let pathSvg = ''
      for (const sf of sunPaths) {
        const kind = sf.properties.kind
        if (kind === 'sunring') pathSvg += `<path d="${c.f.path(sf.geometry, false)}" fill="none" stroke="${c.pal.subtle}" stroke-width="1" stroke-dasharray="4 6"/>`
        else if (kind === 'sunpath') pathSvg += `<path d="${c.f.path(sf.geometry, false)}" fill="none" stroke="${pathColors[sf.properties.day as 'summer']}" stroke-width="3"/>`
        else if (kind === 'sunhour' && sf.geometry.type === 'Point') {
          const [x, y] = c.f.pt(sf.geometry.coordinates[0], sf.geometry.coordinates[1])
          const col = pathColors[sf.properties.day as 'summer']
          pathSvg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${col}"/>`
          if (sf.properties.label) pathSvg += `<text x="${x.toFixed(1)}" y="${(y - 9).toFixed(1)}" font-size="13" text-anchor="middle" fill="${col}" stroke="${c.pal.paper}" stroke-width="3" paint-order="stroke">${esc(String(sf.properties.label))}</text>`
        }
      }
      const layers: PanelLayer[] = [baseBuildings(c, c.pal.base)]
      const summary: string[] = []
      if (sun.altitude <= 0) {
        summary.push(`${day.label} ${hour}시에는 해가 지평선 아래`)
      } else {
        const tanA = Math.tan((sun.altitude * Math.PI) / 180)
        const dirRad = (((sun.azimuth + 180) % 360) * Math.PI) / 180
        const hulls: { poly: [number, number][]; onSite: boolean; box: number[] }[] = []
        for (const b of c.d.buildings) {
          const bh = bldHeight(b)
          if (bh === null) continue
          const L = Math.min(bh / tanA, c.f.R * 1.5) * c.f.s
          const dx = L * Math.sin(dirRad)
          const dy = -L * Math.cos(dirRad)
          const pts: [number, number][] = []
          for (const r of outerRings(b.geom))
            for (const [lon, lat] of r) {
              const [x, y] = c.f.pt(lon, lat)
              pts.push([x, y], [x + dx, y + dy])
            }
          const poly = hull(pts)
          if (poly.length < 3) continue
          const xs = poly.map((p) => p[0])
          const ys = poly.map((p) => p[1])
          hulls.push({ poly, onSite: b.onSite, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] })
        }
        const d = hulls.map((h) => `M${h.poly.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`).join('')
        layers.push({ id: '그림자', svg: `<path d="${d}" fill="${c.pal.ink}" fill-opacity="0.28"/>` })
        // 대지 밖 건물 그림자가 대지를 얼마나 덮는지
        const pts = sitePoints(c).map(([lon, lat]) => c.f.pt(lon, lat))
        const outside = hulls.filter((h) => !h.onSite)
        const shaded = pts.filter(([x, y]) => outside.some((h) => x >= h.box[0] && x <= h.box[2] && y >= h.box[1] && y <= h.box[3] && insideConvex(h.poly, x, y))).length
        summary.push(`${day.label} ${hour}시 태양 고도 ${fmt(sun.altitude, 1)}°, 방위 ${fmt(sun.azimuth)}° (${dir8(sun.azimuth)})`)
        if (pts.length) summary.push(`이 시각 대지 밖 건물 그림자가 대지의 약 ${pct(shaded, pts.length)}%를 덮음 (대지 위 기존 건물 제외)`)
      }
      layers.push({ id: '태양_궤적', svg: pathSvg })
      return {
        layers,
        legend: [
          { color: pathColors.summer, label: '하지 궤적', shape: 'line' },
          { color: pathColors.equinox, label: '춘·추분 궤적', shape: 'line' },
          { color: pathColors.winter, label: '동지 궤적', shape: 'line' },
          { color: mix(c.pal.paper, c.pal.ink, 0.28), label: `그림자 (${day.label} ${hour}시)` },
        ],
        summary,
        caption: `태양 위치는 SunCalc 계산(한국 표준시) · 바깥 원이 지평선, 중심에 가까울수록 높은 태양 · 그림자는 건물 높이(실측 높이 또는 층수×용도별 층고)로 그린 어림값이며 지형·나무는 반영하지 않음`,
      }
    },
  },
  {
    id: 'population',
    title: '집계구 인구밀도',
    group: '사회·경제',
    needs: "공간정보에서 '인구·가구'를 수집하세요.",
    render: (c) => {
      const sa = c.d.statsAreas
      if (!sa.length) return { layers: [baseBuildings(c)], legend: [], summary: [], caption: '', empty: '집계구 자료가 없습니다' }
      const bins = [5000, 10000, 20000, 30000]
      const labels = ['5천 미만', '5천~1만', '1만~2만', '2만~3만', '3만 이상']
      const colors = steps(c.pal, labels.length)
      const keyOf = (v: number | null) => (v === null ? 'unknown' : `b${bins.filter((b) => v >= b).length}`)
      const styles: Record<string, { fill: string; stroke: string; width: number; label: string }> = { unknown: { fill: c.pal.unknown, stroke: c.pal.paper, width: 1, label: '값 가려짐' } }
      labels.forEach((l, i) => (styles[`b${i}`] = { fill: colors[i], stroke: c.pal.paper, width: 1, label: l }))
      const siteArea = sa.find((s) => {
        try {
          return booleanPointInPolygon(point(c.d.center), feature(s.geom))
        } catch {
          return false
        }
      })
      const vals = sa.map((s) => s.extra.density).filter((v): v is number => v !== null)
      return {
        layers: [{ id: '인구밀도', svg: grouped(sa.map((s) => ({ d: c.f.path(s.geom), key: keyOf(s.extra.density) })), styles) }, baseBuildings(c, 'rgba(255,255,255,0.45)')],
        legend: [...labels.map((l, i) => ({ color: colors[i], label: `${l} 명/㎢` })), { color: c.pal.unknown, label: '값 가려짐' }],
        summary: [
          siteArea?.extra.density !== null && siteArea?.extra.density !== undefined ? `대지가 속한 집계구 인구밀도 약 ${fmt(siteArea.extra.density)}명/㎢` : '대지가 속한 집계구 값 없음',
          vals.length ? `반경 안 집계구 ${sa.length}곳: ${fmt(Math.min(...vals))}~${fmt(Math.max(...vals))}명/㎢` : '',
        ].filter(Boolean),
        caption: `통계청 SGIS 집계구 인구(${sa[0]?.extra.year ?? ''}년) · 사는 사람 기준이며 낮에 머무는 사람(생활인구)과 다름 · 인원이 적은 곳은 값이 가려짐`,
      }
    },
  },
  {
    id: 'stores',
    title: '상가 업종',
    group: '사회·경제',
    needs: "공간정보에서 '상가 업종 구성'을 수집하세요.",
    render: (c) => {
      const ss = c.d.stores
      if (!ss.length) return { layers: [baseBuildings(c)], legend: [], summary: [], caption: '', empty: '상가업소 자료가 없습니다' }
      const counts = new Map<string, number>()
      for (const st of ss) counts.set(st.kind, (counts.get(st.kind) ?? 0) + 1)
      const kinds = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
      const top = kinds.slice(0, 7)
      const other = mix(c.pal.paper, c.pal.ink, 0.45)
      const colorOf = (k: string) => (top.includes(k) ? catColor(c.pal, top.indexOf(k)) : other)
      // 상가를 건물에 담는다: 건물 안이면 그 건물, 아니면 8m 안 가장 가까운 건물
      const p = projOf(c.d)
      const blds = c.d.buildings.map((b) => ({ b, rings: arealRings(p, b.geom) }))
      const CELL = 25
      const grid = new Map<string, number[]>()
      blds.forEach((x, i) => {
        let x0 = Infinity
        let y0 = Infinity
        let x1 = -Infinity
        let y1 = -Infinity
        for (const [px, py] of x.rings[0] ?? []) {
          x0 = Math.min(x0, px)
          y0 = Math.min(y0, py)
          x1 = Math.max(x1, px)
          y1 = Math.max(y1, py)
        }
        for (let gx = Math.floor((x0 - 8) / CELL); gx <= Math.floor((x1 + 8) / CELL); gx++)
          for (let gy = Math.floor((y0 - 8) / CELL); gy <= Math.floor((y1 + 8) / CELL); gy++) {
            const k = `${gx},${gy}`
            const l = grid.get(k)
            if (l) l.push(i)
            else grid.set(k, [i])
          }
      })
      const per = new Map<number, Map<string, number>>()
      const loose: Pt[] = []
      for (const st of ss) {
        const q = toXY(p, [st.lon, st.lat])
        const cand = grid.get(`${Math.floor(q[0] / CELL)},${Math.floor(q[1] / CELL)}`) ?? []
        let hit = cand.find((i) => pointInRings(q, blds[i].rings))
        if (hit === undefined) {
          let best = 8
          for (const i of cand) {
            const dd = pointToRingsDist(q, blds[i].rings)
            if (dd < best) {
              best = dd
              hit = i
            }
          }
        }
        if (hit === undefined) {
          loose.push(st)
          continue
        }
        const m = per.get(hit) ?? new Map<string, number>()
        m.set(st.kind, (m.get(st.kind) ?? 0) + 1)
        per.set(hit, m)
      }
      const byColor = new Map<string, string[]>()
      const withStores = new Set(per.keys())
      const domCount = new Map<string, number>()
      for (const [i, m] of per) {
        const dom = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]
        const col = colorOf(dom)
        domCount.set(dom, (domCount.get(dom) ?? 0) + 1)
        const l = byColor.get(col)
        const d = c.f.path(blds[i].b.geom, false)
        if (l) l.push(d)
        else byColor.set(col, [d])
      }
      const basePath = blds
        .filter((_, i) => !withStores.has(i))
        .map((x) => c.f.path(x.b.geom, false))
        .join('')
      let shops = ''
      for (const [col, ds] of byColor) shops += `<path d="${ds.join('')}" fill="${col}" stroke="${c.pal.paper}" stroke-width="0.6"/>`
      const near = ss.filter((st) => pointToAreaDistanceM([st.lon, st.lat], c.d.boundary) <= 50)
      const domTop = [...domCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      return {
        layers: [
          { id: '바탕_건물', svg: basePath ? `<path d="${basePath}" fill="${c.pal.base}"/>` : '' },
          { id: '상가_건물', svg: shops },
          { id: '건물_밖_상가', svg: loose.map((st) => ptSvg(c, st, 2.6, colorOf(st.kind))).join('') },
        ],
        legend: [...top.map((k) => ({ color: colorOf(k), label: k })), ...(kinds.length > 7 ? [{ color: other, label: '그 밖의 업종' }] : []), { color: c.pal.base, label: '상가 자료 없는 건물' }],
        legendTitle: '건물마다 가장 많은 상가 업종으로 칠함',
        summary: [
          `상가업소 ${fmt(ss.length)}곳: ${kinds.slice(0, 3).map((k) => `${k} ${pct(counts.get(k) ?? 0, ss.length)}%`).join(', ')}`,
          `상가가 있는 건물 ${fmt(withStores.size)}동${domTop.length ? ` — ${domTop.map(([k, n]) => `${k} 위주 ${fmt(n)}동`).join(', ')}` : ''}`,
          `대지 경계 50m 안 상가 ${near.length}곳`,
        ],
        caption: `소상공인시장진흥공단 상가(상권)정보 · 상가 좌표가 들어 있는(또는 8m 안) 건물에 담음${loose.length ? `, 건물을 못 찾은 ${fmt(loose.length)}곳은 점` : ''} · ${c.date} 수집 · 분기 갱신 자료로 최근 개·폐업이 빠졌을 수 있음`,
      }
    },
  },
  {
    id: 'observations',
    title: '현장 관찰 위치',
    group: '현장',
    needs: '현장 관찰에 위치를 넣으면 그려집니다.',
    render: (c) => {
      const os = c.d.observations
      if (!os.length) return { layers: [baseBuildings(c)], legend: [], summary: [], caption: '', empty: '위치가 있는 현장 관찰이 없습니다' }
      const colors = {
        normal: c.pal.ink,
        differ: c.pal.kind === 'mono' ? mix(c.pal.paper, c.pal.ink, 0.6) : c.pal.custom || !['default', 'cvd'].includes(c.pal.id) ? c.pal.cat[2] : '#c92a2a',
        discovery: c.pal.kind === 'mono' ? mix(c.pal.paper, c.pal.ink, 0.4) : c.pal.custom || !['default', 'cvd'].includes(c.pal.id) ? c.pal.cat[4] : '#0c8599',
      }
      const marks = os
        .map((o) => {
          const [x, y] = c.f.pt(o.lon, o.lat)
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="${colors[o.kind as 'normal']}" stroke="${c.pal.paper}" stroke-width="2"/><text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" font-size="13" font-weight="700" text-anchor="middle" fill="${c.pal.paper}">${esc(o.label ?? '')}</text>`
        })
        .join('')
      const far = Math.max(...os.map((o) => c.f.polar(o.lon, o.lat).d))
      return {
        layers: [baseBuildings(c), baseRoads(c), { id: '현장_관찰', svg: marks, noClip: true }],
        legend: [
          { color: colors.normal, label: '관찰', shape: 'dot' },
          { color: colors.differ, label: '자료와 다름', shape: 'dot' },
          { color: colors.discovery, label: '새로운 발견', shape: 'dot' },
        ],
        summary: [
          `위치가 있는 관찰 ${os.length}개 (자료와 다름 ${os.filter((o) => o.kind === 'differ').length}, 새로운 발견 ${os.filter((o) => o.kind === 'discovery').length})`,
          `가장 먼 관찰은 대지 중심에서 ${dist(far)}`,
        ],
        caption: '학생이 현장에서 기록한 관찰 (번호는 관찰 카드 O-번호)',
      }
    },
  },
]


// ───────────────────────── 지형 (Phase 8) ─────────────────────────

/** 도판 픽셀 ↔ EPSG:5179 (반경 1km 안에서는 1차 변환으로 충분히 정확) */
function frameAffine(c: PanelCtx) {
  const P = (px: number, py: number) => {
    const [lon, lat] = c.f.inv(px, py)
    return wgs84ToUtmk(lon, lat)
  }
  const p0 = P(MAP_CX, MAP_CY)
  const pe = P(MAP_CX + 100, MAP_CY)
  const ps = P(MAP_CX, MAP_CY + 100)
  const ax = (pe[0] - p0[0]) / 100
  const bx = (ps[0] - p0[0]) / 100
  const ay = (pe[1] - p0[1]) / 100
  const by = (ps[1] - p0[1]) / 100
  const det = ax * by - bx * ay
  return {
    toUtmk: (px: number, py: number): [number, number] => [p0[0] + ax * (px - MAP_CX) + bx * (py - MAP_CY), p0[1] + ay * (px - MAP_CX) + by * (py - MAP_CY)],
    toPx: (x: number, y: number): [number, number] => {
      const dx = x - p0[0]
      const dy = y - p0[1]
      return [MAP_CX + (by * dx - bx * dy) / det, MAP_CY + (-ay * dx + ax * dy) / det]
    },
  }
}

/** 격자 값마다 색을 칠한 그림 (도판 틀 크기) */
function terrainRaster(c: PanelCtx, t: TerrainAnalysis, colorAt: (k: number) => string | null): string {
  const S = MAP_R * 2
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const g = canvas.getContext('2d')
  if (!g) return ''
  const img = g.createImageData(S, S)
  const A = frameAffine(c)
  const grid = t.grid
  const cache = new Map<string, number[]>()
  const rgb = (hex: string) => {
    let v = cache.get(hex)
    if (!v) {
      const h = hex.replace('#', '')
      v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
      cache.set(hex, v)
    }
    return v
  }
  for (let py = 0; py < S; py++)
    for (let px = 0; px < S; px++) {
      const [x, y] = A.toUtmk(px + MAP_CX - MAP_R + 0.5, py + MAP_CY - MAP_R + 0.5)
      const col = Math.floor((x - grid.x0) / grid.cell)
      const row = Math.floor((grid.y0 - y) / grid.cell)
      if (col < 0 || row < 0 || col >= grid.nx || row >= grid.ny) continue
      const color = colorAt(row * grid.nx + col)
      if (!color) continue
      const [r, gg, b] = rgb(color)
      const o = (py * S + px) * 4
      img.data[o] = r
      img.data[o + 1] = gg
      img.data[o + 2] = b
      img.data[o + 3] = 255
    }
  g.putImageData(img, 0, 0)
  return `<image href="${canvas.toDataURL('image/png')}" x="${MAP_CX - MAP_R}" y="${MAP_CY - MAP_R}" width="${S}" height="${S}" preserveAspectRatio="none"/>`
}

function contourSvg(c: PanelCtx, t: TerrainAnalysis, interval?: number): { svg: string; step: number | null } {
  const lines = contourLines(t, interval)
  if (!lines.length) return { svg: '', step: null }
  const A = frameAffine(c)
  const ring = (r: Position[]) => r.map(([x, y], i) => {
    const [px, py] = A.toPx(x, y)
    return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`
  }).join('')
  const minor = lines.filter((l) => !l.major).map((l) => l.rings.map(ring).join('')).join('')
  const major = lines.filter((l) => l.major).map((l) => l.rings.map(ring).join('')).join('')
  const step = lines.length > 1 ? Math.abs(lines[1].level - lines[0].level) : null
  return {
    svg: `<g id="등고선"><path d="${minor}" fill="none" stroke="${c.pal.ink}" stroke-opacity="0.45" stroke-width="0.8"/><path d="${major}" fill="none" stroke="${c.pal.ink}" stroke-opacity="0.75" stroke-width="1.6"/></g>`,
    step,
  }
}

function terrainCaption(t: TerrainAnalysis, extra = ''): string {
  if (t.grid.source === 'map')
    return `국토지리정보원 수치지도${t.grid.version ? `(${t.grid.version}년)` : ''} 등고선·표고점으로 만든 대지 주변 2m 지형에 옹벽·석축 높이를 단차로 넣음(낮은 쪽은 선 방향 규칙), 그 밖은 10m 격자 · 도판은 5m 칸 · 높이는 대지 중심 = 0m 상대값${extra} · 등고선 사이 1m 안팎은 정확하지 않음 · 참고용`
  return t.grid.source === 'ngii'
    ? `국토지리정보원 연속수치지형도 등고선·표고점으로 만든 10m 격자(${t.grid.version ?? ''}) · 높이는 대지 중심 = 0m 상대값${extra} · 옹벽·계단처럼 10m보다 작은 지형은 나타나지 않음 · 참고용`
    : `대체 자료(AWS Terrain Tiles) — 광주·전남·전북 밖이라 국토지리정보원 격자가 없음, 도심에서는 건물 높이가 섞여 오차가 큼 · 높이는 대지 중심 = 0m 상대값${extra}`
}

const signed = (v: number) => `${v > 0 ? '+' : ''}${fmt(v, 0)}`


export const TERRAIN_PANELS: PanelDef[] = [
  {
    id: 'terrain',
    title: '지형·등고선',
    group: '지형',
    needs: "공간정보에서 '지형'을 수집하거나 대지를 정하면 그려집니다.",
    render: (c) => {
      const t = c.t
      if (!t) return { layers: [], legend: [], summary: [], caption: '', empty: '지형 자료를 받지 못했습니다' }
      // 높이 범위는 반경 안 값으로 (격자는 반경보다 조금 넓게 받는다)
      const lo = t.low?.rel ?? 0
      const hi = t.high?.rel ?? 0
      const relief = hi - lo
      const iv = contourInterval(relief)
      const bandStep = Math.max(iv, Math.ceil(relief / 7 / iv) * iv)
      const start = Math.floor(lo / bandStep) * bandStep
      const nb = Math.max(1, Math.ceil((hi - start) / bandStep))
      const colors = steps(c.pal, Math.max(2, nb))
      const raster = terrainRaster(c, t, (k) => {
        const v = t.rel[k]
        if (Number.isNaN(v)) return null
        return colors[Math.min(nb - 1, Math.max(0, Math.floor((v - start) / bandStep)))]
      })
      const cont = relief >= 3 ? contourSvg(c, t, iv) : { svg: '', step: null }
      const hb = t.high ? c.f.polar(t.high.lon, t.high.lat) : null
      const lb = t.low ? c.f.polar(t.low.lon, t.low.lat) : null
      // 수치지도 옹벽·석축·제방 (상단 선)
      const walls = (c.d.ngii?.walls ?? []).filter((w) => w.top && c.f.inside(...(centroidOf(w.geom) ?? [0, 0])))
      const wallSvg = walls.length
        ? `<path d="${walls.map((w) => c.f.path(w.geom, false)).join('')}" fill="none" stroke="${c.pal.ink}" stroke-width="2.2" stroke-linecap="round"/>`
        : ''
      return {
        layers: [
          { id: '높이_단계', svg: raster },
          { id: '등고선', svg: cont.svg },
          { id: '바탕_건물', svg: `<path d="${c.d.buildings.map((b) => c.f.path(b.geom, false)).join('')}" fill="none" stroke="${c.pal.ink}" stroke-opacity="0.18" stroke-width="0.5"/>` },
          ...(wallSvg ? [{ id: '옹벽_석축', svg: wallSvg }] : []),
        ],
        legendTitle: '대지 중심 = 0m',
        legend: [
          ...Array.from({ length: nb }, (_, i) => ({ color: colors[i], label: `${signed(start + i * bandStep)} ~ ${signed(start + (i + 1) * bandStep)}m` })),
          ...(wallSvg ? [{ color: c.pal.ink, label: '옹벽·석축·제방 (수치지도)', shape: 'line' as const }] : []),
        ],
        summary: [
          `대지 중심을 0m로 하면 반경 안 높이는 ${signed(lo)} ~ ${signed(hi)}m (기복 약 ${fmt(relief, 0)}m)`,
          t.high && hb ? `가장 높은 곳: ${dir8(hb.bearing)}쪽 ${dist(hb.d)}, ${signed(t.high.rel)}m / 가장 낮은 곳: ${lb ? `${dir8(lb.bearing)}쪽 ${dist(lb.d)}, ${signed(t.low!.rel)}m` : '—'}` : '',
          relief >= 3 ? `등고선 간격 ${iv}m (굵은 선은 ${iv * 5}m마다)` : '기복이 3m 미만인 평지라 등고선을 그리지 않음 (레벨 계획 부담이 적다는 근거)',
          `대지 안 높낮이 차 ${rangeText(t.site.range, !!t.fine)}`,
          walls.length ? `옹벽·석축·제방 ${fmt(walls.length)}곳 (높이 ${(() => { const hs = walls.map((w) => w.h ?? 0).filter((h) => h > 0); return hs.length ? `${fmt(Math.min(...hs), 1)}~${fmt(Math.max(...hs), 1)}m` : '미상' })()})` : '',
        ].filter(Boolean),
        caption: terrainCaption(t),
      }
    },
  },
]

export const PANEL_GROUP_ORDER: PanelGroup[] = ['위치', '땅의 조건', '지형', '주변 현황', '연계와 접근', '환경', '사회·경제', '현장', '종합']

/** 보고서 배치 순서 (위치 → 땅의 조건 → 지형 → 주변 현황 → 연계와 접근 → 환경 → 사회·현장) */
export const ORDERED_PANELS: PanelDef[] = PANEL_GROUP_ORDER.flatMap((g) => [...PANELS, ...TERRAIN_PANELS, ...SECTION_PANELS, ...MOVE_PANELS, ...ENV_PANELS, ...LIFE_PANELS, SYNTH_PANEL].filter((p) => p.group === g))

export function panelNumber(id: string): number {
  return ORDERED_PANELS.findIndex((p) => p.id === id) + 1
}

