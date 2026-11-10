// 도판 정의. 도판 하나 = 사실 하나 (주제색 한 계열 + 회색 바탕, 모르는 값은 회색 '미상').
// 각 도판은 그림(레이어)·범례·읽은 수치(summary)·출처와 한계(caption)를 돌려준다.

import { contours } from 'd3-contour'
import { area, booleanPointInPolygon, feature, featureCollection, intersect, point } from '@turf/turf'
import type { Position } from 'geojson'
import { geometryToAreaDistanceM, lineToAreaDistanceM, overlapsSite, pointToAreaDistanceM, radiusCircle, type Areal } from '../lib/geo'
import { wgs84ToUtmk } from '../lib/proj'
import { sunAt, sunPathFeatures, SUN_DAYS } from '../lib/sun'
import { contourInterval, contourLines, FLAT_DEG, rangeText, SLOPE_BINS, type TerrainAnalysis } from '../lib/terrainSite'
import type { DiagramSettings } from '../model/types'
import { ALL_LAYERS } from '../sources/vworldLayers'
import { aerialImage } from './aerial'
import { esc, type PanelLayer, type PanelOutput } from './compose'
import type { Bld, DiagramData, Pt } from './data'
import { centroidOf, dir8, MAP_CX, MAP_CY, MAP_R, type Frame } from './frame'
import { mix, shades, steps, zoningColor, type Palette } from './palette'

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
}

export type PanelGroup = '위치' | '땅의 조건' | '지형' | '주변 현황' | '연계와 접근' | '환경' | '사회·경제' | '현장'

export interface PanelDef {
  id: string
  title: string
  group: PanelGroup
  /** 자료가 없을 때 안내 */
  needs: string
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

/** 같은 색끼리 path 하나로 묶어 그룹으로 (파일이 작아지고 일러스트레이터에서 항목별로 고르기 쉬움) */
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
    const stroke = st.stroke ? ` stroke="${st.stroke}" stroke-width="${st.width ?? 1}" stroke-linejoin="round" stroke-linecap="round"` : ''
    const op = st.opacity !== undefined ? ` fill-opacity="${st.opacity}"` : ''
    out += `<g id="${esc(st.label.replace(/\s+/g, '_'))}"><path d="${ds.join('')}" fill="${fill}"${op}${stroke} fill-rule="evenodd"/></g>`
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

function baseRoads(c: PanelCtx, color = mix('#ffffff', c.pal.ink, 0.18)): PanelLayer {
  const d = c.d.roads.map((r) => c.f.path(r.geom)).join('')
  return { id: '바탕_도로', svg: d ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="1" stroke-linecap="round"/>` : '' }
}

function ptSvg(c: PanelCtx, p: { lon: number; lat: number }, r: number, fill: string, shape: 'dot' | 'square' = 'dot'): string {
  const [x, y] = c.f.pt(p.lon, p.lat)
  if (shape === 'square') return `<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" fill="${fill}" stroke="#ffffff" stroke-width="1.2"/>`
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${fill}" stroke="#ffffff" stroke-width="1.2"/>`
}

function where(c: PanelCtx, lon: number, lat: number): string {
  const p = c.f.polar(lon, lat)
  return `대지 중심 ${dir8(p.bearing)}쪽 ${dist(p.d)}`
}

function bldCaption(c: PanelCtx): string {
  const add = c.d.addedFromAddr ? `, 도로명주소 건물로 ${fmt(c.d.addedFromAddr)}동 보강` : ''
  return `건물: 국토교통부 GIS건물통합정보(브이월드)${add} · ${c.date} 수집 · 최근 지은 건물이 빠지거나 값이 비어 있을 수 있음`
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
  if (id === 'other') return pal.id === 'default' ? '#7a8b99' : catColor(pal, 6)
  const i = USE_CLASSES.findIndex((u) => u.id === id)
  return pal.id === 'default' ? USE_CLASSES[i].color : catColor(pal, i)
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
      for (const n of names) styles[n] = { fill: zoningColor(n, c.pal), stroke: '#ffffff', width: 1.5, label: n }
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
      layers.forEach((l, i) => (styles[l] = { fill: catColor(c.pal, i), stroke: '#ffffff', width: 1, opacity: 0.8, label: layerLabel(l).replace('도시계획시설', '').replace(/[()]/g, '') }))
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
      const styles: Record<string, { fill: string; stroke: string; width: number; label: string }> = { infra: { fill: mix('#ffffff', c.pal.unknown, 0.6), stroke: '#ffffff', width: 0.6, label: '도로·하천 등' } }
      bins.forEach((b, i) => (styles[`b${i}`] = { fill: colors[i], stroke: '#ffffff', width: 0.6, label: b.label }))
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
    id: 'terrainClass',
    title: '필지 지형등급',
    group: '지형',
    needs: "공간정보에서 '토지'를 수집하세요 (반경 안 필지의 토지특성).",
    render: (c) => {
      const ps = c.d.parcels
      if (!ps.some((p) => p.hg)) return { layers: [], legend: [], summary: [], caption: '', empty: '필지별 토지특성 자료가 없습니다' }
      const order = ['저지', '평지', '완경사', '급경사', '고지']
      const def = { 저지: '#9ec5e8', 평지: '#ece6d3', 완경사: '#d9b26f', 급경사: '#b5651d', 고지: '#7a3b10' } as Record<string, string>
      const seq = steps(c.pal, order.length)
      const color = (k: string, i: number) => (c.pal.id === 'default' ? def[k] : seq[i])
      const styles: Record<string, { fill: string; stroke: string; width: number; label: string }> = { unknown: { fill: c.pal.unknown, stroke: '#ffffff', width: 0.6, label: '미상' } }
      order.forEach((k, i) => (styles[k] = { fill: color(k, i), stroke: '#ffffff', width: 0.6, label: k }))
      const keyOf = (hg: string) => order.find((k) => hg.startsWith(k)) ?? 'unknown'
      const items = ps.map((p) => ({ d: c.f.path(p.geom, false), key: keyOf(p.hg) }))
      const known = ps.filter((p) => keyOf(p.hg) !== 'unknown')
      const share = order.map((k) => [k, known.filter((p) => keyOf(p.hg) === k).length] as const).filter(([, n]) => n > 0)
      const siteK = [...new Set(ps.filter((p) => p.onSite).map((p) => keyOf(p.hg)).filter((k) => k !== 'unknown'))]
      return {
        layers: [{ id: '지형등급', svg: grouped(items, styles) }],
        legend: [...order.map((k, i) => ({ color: color(k, i), label: k })), { color: c.pal.unknown, label: '미상' }],
        summary: [
          `반경 안 필지 ${fmt(known.length)}곳의 지형높이 등급: ${share.map(([k, n]) => (pct(n, known.length) >= 1 ? `${k} ${pct(n, known.length)}%` : `${k} ${fmt(n)}필지`)).join(', ')}`,
          siteK.length ? `대지 필지는 ${siteK.join('·')}` : '',
        ].filter(Boolean),
        caption: `국토교통부 토지특성(개별공시지가 조사, 브이월드) · ${c.date} 수집 · 주변과 비교한 등급이며 실제 경사도(°)가 아님`,
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
      const hot = c.pal.id === 'default' ? '#2f6fd6' : c.pal.id === 'cvd' ? '#0072b2' : '#2a2a2a'
      const styles = { hi: { fill: hot, label: `${th}층 이상` }, lo: { fill: c.pal.base, label: `${th}층 미만` }, unknown: { fill: mix('#ffffff', c.pal.unknown, 0.5), label: '미상' } }
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
      const hot = c.pal.id === 'default' ? '#d9822b' : c.pal.id === 'cvd' ? '#e69f00' : '#4a4a4a'
      const styles = { lo: { fill: hot, label: `${th}층 이하` }, hi: { fill: c.pal.base, label: `${th}층 초과` }, unknown: { fill: mix('#ffffff', c.pal.unknown, 0.5), label: '미상' } }
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
      const colors = shades(c.pal.ink, bins.length)
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
            return lineToAreaDistanceM(r.geom, c.d.boundary) <= (r.width ?? 4) / 2 + 3
          } catch {
            return false
          }
        })
        .map((r) => r.width)
        .filter((w): w is number => w !== null)
      const adjText = [...new Set(adj.map((w) => Math.round(w)))].sort((a, b) => b - a)
      const count = bins.map((_, i) => rs.filter((r) => keyOf(r.width) === i).length)
      return {
        layers: [baseBuildings(c, mix('#ffffff', c.pal.base, 0.6)), { id: '도로', svg: lines }],
        legend: bins.map((b, i) => ({ color: colors[i], label: b.label, shape: 'line' as const })),
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
      const stationColor = c.pal.id === 'mono' ? '#111111' : catColor(c.pal, 3)
      const stopColor = c.pal.id === 'mono' ? '#777777' : catColor(c.pal, 0)
      const near = (list: Pt[]) => list.map((p) => ({ p, d: c.f.polar(p.lon, p.lat).d })).sort((a, b) => a.d - b.d)
      const ns = near(st)
      const nb = near(sp)
      const labels = ns
        .filter((x) => c.f.inside(x.p.lon, x.p.lat))
        .slice(0, 3)
        .map((x) => {
          const [px, py] = c.f.pt(x.p.lon, x.p.lat)
          return `<text x="${(px + 14).toFixed(1)}" y="${(py + 5).toFixed(1)}" font-size="16" font-weight="700" fill="${c.pal.ink}" stroke="#ffffff" stroke-width="4" paint-order="stroke">${esc(x.p.name.replace(/\s.*$/, ''))}</text>`
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
        caption: `지하철역: 카카오 로컬 · 버스정류소: 국토교통부 TAGO(대지 중심 약 500m) · ${c.date} 수집 · 거리는 직선거리`,
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
      const pathColors =
        c.pal.id === 'mono'
          ? { summer: '#222222', equinox: '#666666', winter: '#999999' }
          : c.pal.id === 'cvd'
            ? { summer: '#d55e00', equinox: '#e69f00', winter: '#0072b2' }
            : { summer: '#e8590c', equinox: '#e0a100', winter: '#1c7ed6' }
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
          if (sf.properties.label) pathSvg += `<text x="${x.toFixed(1)}" y="${(y - 9).toFixed(1)}" font-size="13" text-anchor="middle" fill="${col}" stroke="#ffffff" stroke-width="3" paint-order="stroke">${esc(String(sf.properties.label))}</text>`
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
          if (b.floors === null) continue
          const L = Math.min((b.floors * 3) / tanA, c.f.R * 1.5) * c.f.s
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
          { color: mix('#ffffff', c.pal.ink, 0.28), label: `그림자 (${day.label} ${hour}시)` },
        ],
        summary,
        caption: `태양 위치는 SunCalc 계산(한국 표준시) · 바깥 원이 지평선, 중심에 가까울수록 높은 태양 · 그림자는 층당 3m로 환산한 건물 높이로 그린 어림값이며 지형·나무는 반영하지 않음`,
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
      const styles: Record<string, { fill: string; stroke: string; width: number; label: string }> = { unknown: { fill: c.pal.unknown, stroke: '#ffffff', width: 1, label: '값 가려짐' } }
      labels.forEach((l, i) => (styles[`b${i}`] = { fill: colors[i], stroke: '#ffffff', width: 1, label: l }))
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
      for (const s of ss) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1)
      const kinds = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
      const top = kinds.slice(0, 7)
      const colorOf = (k: string) => (top.includes(k) ? catColor(c.pal, top.indexOf(k)) : c.pal.unknown)
      const near = ss.filter((s) => pointToAreaDistanceM([s.lon, s.lat], c.d.boundary) <= 50)
      return {
        layers: [baseBuildings(c), { id: '상가', svg: ss.map((s) => ptSvg(c, s, 3.4, colorOf(s.kind))).join('') }],
        legend: [...top.map((k) => ({ color: colorOf(k), label: k, shape: 'dot' as const })), ...(kinds.length > 7 ? [{ color: c.pal.unknown, label: '그 밖의 업종', shape: 'dot' as const }] : [])],
        summary: [
          `상가업소 ${fmt(ss.length)}곳: ${kinds.slice(0, 3).map((k) => `${k} ${pct(counts.get(k) ?? 0, ss.length)}%`).join(', ')}`,
          `대지 경계 50m 안 ${near.length}곳`,
        ],
        caption: `소상공인시장진흥공단 상가(상권)정보 · ${c.date} 수집 · 분기 갱신 자료로 최근 개·폐업이 빠졌을 수 있음`,
      }
    },
  },
  {
    id: 'poi',
    title: '생활 시설',
    group: '사회·경제',
    needs: "공간정보에서 '주변 생활 시설'을 수집하세요.",
    render: (c) => {
      const ps = c.d.pois.filter((p) => !['FD6', 'CE7'].includes(p.kind))
      if (!ps.length) return { layers: [baseBuildings(c)], legend: [], summary: [], caption: '', empty: '생활 시설 자료가 없습니다' }
      const kinds = [...new Map(ps.map((p) => [p.kind, p.label ?? p.kind])).entries()]
      const colorOf = (k: string) => catColor(c.pal, kinds.findIndex(([x]) => x === k))
      const nearest = kinds
        .map(([k, label]) => {
          const n = ps.filter((p) => p.kind === k).map((p) => ({ p, d: c.f.polar(p.lon, p.lat).d })).sort((a, b) => a.d - b.d)[0]
          return n ? `${label} ${dist(n.d)}` : ''
        })
        .filter(Boolean)
      return {
        layers: [baseBuildings(c), { id: '생활시설', svg: ps.map((p) => ptSvg(c, p, 5, colorOf(p.kind))).join('') }],
        legend: kinds.map(([k, label]) => ({ color: colorOf(k), label, shape: 'dot' as const })),
        summary: [`분류별 가장 가까운 곳(대지 중심 직선거리): ${nearest.slice(0, 8).join(', ')}`, '분류마다 가까운 15곳까지만 표시 (음식점·카페는 상가 업종 도판에서)'],
        caption: `카카오 로컬 카테고리 검색 · ${c.date} 수집 · 카카오맵에 등록된 장소 기준`,
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
      const colors = { normal: c.pal.ink, differ: c.pal.id === 'mono' ? '#666666' : '#c92a2a', discovery: c.pal.id === 'mono' ? '#999999' : '#0c8599' }
      const marks = os
        .map((o) => {
          const [x, y] = c.f.pt(o.lon, o.lat)
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="${colors[o.kind as 'normal']}" stroke="#ffffff" stroke-width="2"/><text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" font-size="13" font-weight="700" text-anchor="middle" fill="#ffffff">${esc(o.label ?? '')}</text>`
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
  return t.grid.source === 'ngii'
    ? `국토지리정보원 연속수치지형도 등고선·표고점으로 만든 10m 격자(${t.grid.version ?? ''}) · 높이는 대지 중심 = 0m 상대값${extra} · 옹벽·계단처럼 10m보다 작은 지형은 나타나지 않음 · 참고용`
    : `대체 자료(AWS Terrain Tiles) — 광주·전남·전북 밖이라 국토지리정보원 격자가 없음, 도심에서는 건물 높이가 섞여 오차가 큼 · 높이는 대지 중심 = 0m 상대값${extra}`
}

const signed = (v: number) => `${v > 0 ? '+' : ''}${fmt(v, 0)}`

const ASPECT_COLORS = ['#4c78a8', '#72b7b2', '#54a24b', '#eeca3b', '#f58518', '#e45756', '#b279a2', '#9d755d']
const ASPECT_NAMES = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']

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
      return {
        layers: [{ id: '높이_단계', svg: raster }, { id: '등고선', svg: cont.svg }, { id: '바탕_건물', svg: `<path d="${c.d.buildings.map((b) => c.f.path(b.geom, false)).join('')}" fill="none" stroke="${c.pal.ink}" stroke-opacity="0.18" stroke-width="0.5"/>` }],
        legendTitle: '대지 중심 = 0m',
        legend: Array.from({ length: nb }, (_, i) => ({ color: colors[i], label: `${signed(start + i * bandStep)} ~ ${signed(start + (i + 1) * bandStep)}m` })),
        summary: [
          `대지 중심을 0m로 하면 반경 안 높이는 ${signed(lo)} ~ ${signed(hi)}m (기복 약 ${fmt(relief, 0)}m)`,
          t.high && hb ? `가장 높은 곳: ${dir8(hb.bearing)}쪽 ${dist(hb.d)}, ${signed(t.high.rel)}m / 가장 낮은 곳: ${lb ? `${dir8(lb.bearing)}쪽 ${dist(lb.d)}, ${signed(t.low!.rel)}m` : '—'}` : '',
          relief >= 3 ? `등고선 간격 ${iv}m (굵은 선은 ${iv * 5}m마다)` : '기복이 3m 미만인 평지라 등고선을 그리지 않음 (레벨 계획 부담이 적다는 근거)',
          `대지 안 높낮이 차 ${rangeText(t.site.range)}`,
        ].filter(Boolean),
        caption: terrainCaption(t),
      }
    },
  },
  {
    id: 'slope',
    title: '경사도',
    group: '지형',
    needs: "공간정보에서 '지형'을 수집하거나 대지를 정하면 그려집니다.",
    render: (c) => {
      const t = c.t
      if (!t) return { layers: [], legend: [], summary: [], caption: '', empty: '지형 자료를 받지 못했습니다' }
      const labels = ['5° 미만', '5~10°', '10~15°', '15~20°', '20° 이상']
      const colors = steps(c.pal, labels.length)
      const raster = terrainRaster(c, t, (k) => {
        const s = t.slope[k]
        if (Number.isNaN(s)) return null
        return colors[SLOPE_BINS.filter((b) => s >= b).length]
      })
      return {
        layers: [{ id: '경사도', svg: raster }, { id: '바탕_건물', svg: `<path d="${c.d.buildings.map((b) => c.f.path(b.geom, false)).join('')}" fill="none" stroke="${c.pal.ink}" stroke-opacity="0.18" stroke-width="0.5"/>` }],
        legend: labels.map((l, i) => ({ color: colors[i], label: l })),
        summary: [
          `반경 안 땅의 경사도: ${labels.map((l, i) => [l, Math.round(t.slopeShare[i] * 100)] as const).filter(([, p]) => p > 0).map(([l, p]) => `${l} ${p}%`).join(', ')}`,
          `대지 평균 경사 약 ${fmt(t.site.meanSlope, 1)}°`,
        ],
        caption: terrainCaption(t, ' · 경사는 50m 평활 (조례의 평균경사도 산정과 다름)'),
      }
    },
  },
  {
    id: 'aspect',
    title: '경사 방향',
    group: '지형',
    needs: "공간정보에서 '지형'을 수집하거나 대지를 정하면 그려집니다.",
    render: (c) => {
      const t = c.t
      if (!t) return { layers: [], legend: [], summary: [], caption: '', empty: '지형 자료를 받지 못했습니다' }
      const base = c.pal.id === 'default' ? ASPECT_COLORS : c.pal.id === 'cvd' ? c.pal.cat : shades(c.pal.ink, 8)
      const counts = new Array(8).fill(0)
      let sloped = 0
      const raster = terrainRaster(c, t, (k) => {
        const s = t.slope[k]
        const a = t.aspect[k]
        if (Number.isNaN(s) || Number.isNaN(a) || s < FLAT_DEG) return null
        const i = Math.round(a / 45) % 8
        return mix('#ffffff', base[i], Math.min(1, 0.35 + (s - FLAT_DEG) / 20))
      })
      for (let k = 0; k < t.slope.length; k++) {
        const s = t.slope[k]
        if (Number.isNaN(s) || s < FLAT_DEG) continue
        sloped++
        counts[Math.round(t.aspect[k] / 45) % 8]++
      }
      const top = counts.map((n, i) => [ASPECT_NAMES[i], n] as const).sort((a, b) => b[1] - a[1])[0]
      return {
        layers: [{ id: '경사_방향', svg: raster }, { id: '바탕_건물', svg: `<path d="${c.d.buildings.map((b) => c.f.path(b.geom, false)).join('')}" fill="none" stroke="${c.pal.ink}" stroke-opacity="0.18" stroke-width="0.5"/>` }],
        legend: ASPECT_NAMES.map((n, i) => ({ color: base[i], label: `${n}향` })),
        summary: [
          sloped ? `경사(${FLAT_DEG}° 이상)가 있는 땅에서 가장 많은 비탈 방향: ${top[0]}향 (${pct(top[1], sloped)}%)` : `반경 안이 거의 평지 (${FLAT_DEG}° 미만)`,
          t.site.aspect === null ? '대지는 평지에 가까워 비탈 방향이 뚜렷하지 않음' : `대지는 ${dir8(t.site.aspect)}향 비탈 (남향은 볕, 북향은 그늘 쪽)`,
        ],
        caption: terrainCaption(t, ` · 경사 ${FLAT_DEG}° 미만은 칠하지 않음, 진할수록 가파름 · 50m 평활`),
      }
    },
  },
]

export const PANEL_GROUP_ORDER: PanelGroup[] = ['위치', '땅의 조건', '지형', '주변 현황', '연계와 접근', '환경', '사회·경제', '현장']

/** 보고서 배치 순서 (위치 → 땅의 조건 → 지형 → 주변 현황 → 연계와 접근 → 환경 → 사회·현장) */
export const ORDERED_PANELS: PanelDef[] = PANEL_GROUP_ORDER.flatMap((g) => [...PANELS, ...TERRAIN_PANELS].filter((p) => p.group === g))

export function panelNumber(id: string): number {
  return ORDERED_PANELS.findIndex((p) => p.id === id) + 1
}

