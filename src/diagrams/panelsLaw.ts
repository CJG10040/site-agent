// 14-C 법규 개요 (2026-11-12 사용자 결정, archiMap·Landform의 '법규 개요' 참고).
// 용도지역 → 건폐율·용적률 법 상한(국토계획법 시행령 제84·85조), 대지 면적 기준 최대 건축면적·연면적,
// 정북 일조 사선(건축법 시행령 제86조: 전용·일반주거지역, 높이 10m 이하 1.5m 이상, 10m 초과 부분은 높이의 1/2 이상 띄움)을 대지 안 높이 단계로.
// 실제 값은 시·군 도시계획조례와 지구단위계획으로 더 낮을 수 있어 '조례 확인 필요'를 늘 함께 적는다.

import { area, feature, featureCollection, intersect } from '@turf/turf'
import type { XY } from '../lib/network'
import { arealRings, pointInRings } from '../lib/xy'
import type { LegendItem, PanelOutput } from './compose'
import type { DiagramData } from './data'
import { MAP_CX, MAP_CY, MAP_R } from './frame'
import { projOf, siteRingsXY } from './move'
import { mix, monoShades, steps, zoningColor } from './palette'
import type { PanelDef } from './panels'

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })

/** 건폐율 상한(%), 용적률 범위(%) — 국토의 계획 및 이용에 관한 법률 시행령 제84조·제85조 */
const ZONE_RULES: [RegExp, string, number, number, number][] = [
  [/제1종전용주거/, '제1종전용주거지역', 50, 50, 100],
  [/제2종전용주거/, '제2종전용주거지역', 50, 50, 150],
  [/제1종일반주거/, '제1종일반주거지역', 60, 100, 200],
  [/제2종일반주거/, '제2종일반주거지역', 60, 100, 250],
  [/제3종일반주거/, '제3종일반주거지역', 50, 100, 300],
  [/준주거/, '준주거지역', 70, 200, 500],
  [/중심상업/, '중심상업지역', 90, 200, 1500],
  [/일반상업/, '일반상업지역', 80, 200, 1300],
  [/근린상업/, '근린상업지역', 70, 200, 900],
  [/유통상업/, '유통상업지역', 80, 200, 1100],
  [/전용공업/, '전용공업지역', 70, 150, 300],
  [/일반공업/, '일반공업지역', 70, 150, 350],
  [/준공업/, '준공업지역', 70, 150, 400],
  [/보전녹지/, '보전녹지지역', 20, 50, 80],
  [/생산녹지/, '생산녹지지역', 20, 50, 100],
  [/자연녹지/, '자연녹지지역', 20, 50, 100],
  [/보전관리/, '보전관리지역', 20, 50, 80],
  [/생산관리/, '생산관리지역', 20, 50, 80],
  [/계획관리/, '계획관리지역', 40, 50, 100],
  [/농림/, '농림지역', 20, 50, 80],
  [/자연환경보전/, '자연환경보전지역', 20, 50, 80],
]

export interface ZoneRule {
  label: string
  bcr: number
  farMin: number
  farMax: number
  /** 정북 일조 사선 대상 (전용·일반주거) */
  sunlight: boolean
}

export function zoneRule(name: string): ZoneRule | null {
  const n = name.replace(/\s+/g, '')
  const hit = ZONE_RULES.find(([re]) => re.test(n))
  if (!hit) return null
  return { label: hit[1], bcr: hit[2], farMin: hit[3], farMax: hit[4], sunlight: /전용주거|일반주거/.test(hit[1]) }
}

/** 대지가 걸친 용도지역과 면적 비율 (용도지역 도형이 없으면 토지이용계획 이름으로) */
export function siteZones(d: DiagramData): { name: string; share: number; rule: ZoneRule | null }[] {
  const by = new Map<string, number>()
  for (const z of d.zoning) {
    try {
      const inter = intersect(featureCollection([feature(z.geom), feature(d.boundary)]))
      if (inter) by.set(z.name, (by.get(z.name) ?? 0) + area(inter))
    } catch {
      /* 계산 실패한 조각은 뺀다 */
    }
  }
  const total = [...by.values()].reduce((a, b) => a + b, 0)
  let zones = [...by.entries()]
    .filter(([, a]) => total > 0 && a / total >= 0.01)
    .map(([name, a]) => ({ name, share: a / total, rule: zoneRule(name) }))
    .sort((a, b) => b.share - a.share)
  if (!zones.length) {
    const named = d.landUse.map((l) => l.name).filter((n) => zoneRule(n))
    const uniq = [...new Set(named.map((n) => zoneRule(n)!.label))]
    zones = uniq.map((label) => ({ name: label, share: 1 / uniq.length, rule: zoneRule(label) }))
  }
  return zones
}

/** (x,y)에서 정북으로 가며 만나는 대지 경계까지 거리(m). 없으면 null */
function northDist(x: number, y: number, rings: XY[][]): number | null {
  let best = Infinity
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i]
      const [bx, by] = ring[(i + 1) % ring.length]
      if ((ax <= x && bx > x) || (bx <= x && ax > x)) {
        const t = (x - ax) / (bx - ax)
        const yy = ay + t * (by - ay)
        if (yy > y && yy - y < best) best = yy - y
      }
    }
  return Number.isFinite(best) ? best : null
}

/** 정북 일조로 지을 수 있는 높이(m): 1.5m 안 = 0, 1.5~5m = 10m, 그 밖 = 거리 × 2 */
export function sunlightHeight(dist: number): number {
  if (dist < 1.5) return 0
  return Math.max(10, dist * 2)
}

const H_BANDS = [10, 20, 30, 45]
const H_LABELS = ['10m까지 (약 3층)', '10~20m', '20~30m', '30~45m', '45m 넘게']

function siteFar(d: DiagramData): number {
  return Math.max(0, ...siteRingsXY(d).flat().map(([x, y]) => Math.hypot(x, y)))
}

export const LAW_PANEL: PanelDef = {
  id: 'law',
  title: '법규 개요 (건폐율·용적률·정북 일조)',
  group: '땅의 조건',
  needs: "공간정보에서 '규제·계획'(또는 토지이용계획)을 수집하세요.",
  // 대지를 크게 (대지 끝 × 1.5 + 25m, 60m 이상)
  frameR: (d) => Math.min(d.R, Math.max(60, Math.ceil((siteFar(d) * 1.5 + 25) / 10) * 10)),
  render: (c): PanelOutput => {
    const d = c.d
    const zones = siteZones(d)
    if (!zones.length) return { layers: [], legend: [], summary: [], caption: '', empty: '대지의 용도지역 자료가 없습니다' }
    const A = area(feature(d.boundary))
    const ruled = zones.filter((z) => z.rule)
    const maxBA = ruled.reduce((s, z) => s + A * z.share * (z.rule!.bcr / 100), 0)
    const maxGFA = ruled.reduce((s, z) => s + A * z.share * (z.rule!.farMax / 100), 0)
    const sunZones = zones.filter((z) => z.rule?.sunlight)

    // ── 정북 일조: 대지 안 높이 단계 (주거지역 부분만)
    const rings = siteRingsXY(d)
    const p = projOf(d)
    const resRings = d.zoning.filter((z) => zoneRule(z.name)?.sunlight).map((z) => arealRings(p, z.geom))
    const useAllSite = !d.zoning.length && sunZones.length === zones.length
    const bandColors = c.pal.kind === 'mono' ? [...monoShades(c.pal, 5)].reverse() : [...steps(c.pal, 5)].reverse()
    const setbackColor = mix(c.pal.paper, c.pal.accent, 0.55)
    let sunSvg = ''
    let maxH = 0
    let usedBands = new Set<number>()
    let hasSetback = false
    if (sunZones.length) {
      const S = MAP_R * 2
      const canvas = document.createElement('canvas')
      canvas.width = S
      canvas.height = S
      const g = canvas.getContext('2d')
      if (g) {
        const img = g.createImageData(S, S)
        const xs = rings.flat().map((q) => q[0])
        const ys = rings.flat().map((q) => q[1])
        const s = c.f.s
        const px0 = Math.max(0, Math.floor(MAP_CX + Math.min(...xs) * s - (MAP_CX - MAP_R)))
        const px1 = Math.min(S - 1, Math.ceil(MAP_CX + Math.max(...xs) * s - (MAP_CX - MAP_R)))
        const py0 = Math.max(0, Math.floor(MAP_CY - Math.max(...ys) * s - (MAP_CY - MAP_R)))
        const py1 = Math.min(S - 1, Math.ceil(MAP_CY - Math.min(...ys) * s - (MAP_CY - MAP_R)))
        const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
        const cols = bandColors.map(rgb)
        const sb = rgb(setbackColor)
        for (let py = py0; py <= py1; py++)
          for (let px = px0; px <= px1; px++) {
            const x = (px + MAP_CX - MAP_R + 0.5 - MAP_CX) / s
            const y = (MAP_CY - (py + MAP_CY - MAP_R + 0.5)) / s
            if (!pointInRings([x, y], rings)) continue
            if (!useAllSite && !resRings.some((r) => pointInRings([x, y], r))) continue
            const dist = northDist(x, y, rings)
            if (dist === null) continue
            const h = sunlightHeight(dist)
            const o = (py * S + px) * 4
            let col: number[]
            if (h === 0) {
              // 띄울 곳: 줄무늬
              hasSetback = true
              col = (px + py) % 6 < 3 ? sb : rgb(c.pal.paper)
            } else {
              const k = H_BANDS.filter((b) => h > b).length
              usedBands.add(k)
              col = cols[k]
              if (h > maxH) maxH = h
            }
            img.data[o] = col[0]
            img.data[o + 1] = col[1]
            img.data[o + 2] = col[2]
            img.data[o + 3] = 235
          }
        g.putImageData(img, 0, 0)
        sunSvg = `<image href="${canvas.toDataURL('image/png')}" x="${MAP_CX - MAP_R}" y="${MAP_CY - MAP_R}" width="${S}" height="${S}" preserveAspectRatio="none"/>`
      }
    }
    usedBands = new Set([...usedBands].sort((a, b) => a - b))

    // ── 바탕: 용도지역(연하게) + 건물 윤곽 + 북쪽 화살표 글
    const names = [...new Set(d.zoning.map((z) => z.name))]
    const zoneSvg = d.zoning.map((z) => `<path d="${c.f.path(z.geom)}" fill="${zoningColor(z.name, c.pal)}" fill-opacity="0.45" stroke="${c.pal.paper}" stroke-width="1.2"/>`).join('')
    const bld = d.buildings.filter((b) => !b.onSite).map((b) => c.f.path(b.geom, false)).join('')
    const north = sunSvg ? `<text x="${MAP_CX}" y="${MAP_CY - MAP_R + 40}" font-size="15" text-anchor="middle" fill="${c.pal.ink}" stroke="${c.pal.paper}" stroke-width="4" paint-order="stroke">↑ 정북 — 북쪽 경계에서 띄움</text>` : ''

    const legend: LegendItem[] = [
      ...names.filter((n) => zones.some((z) => z.name === n) || names.length <= 4).map((n) => ({ color: zoningColor(n, c.pal), label: n })),
      ...(hasSetback ? [{ color: setbackColor, label: '정북 경계에서 1.5m 띄울 곳' }] : []),
      ...[...usedBands].map((k) => ({ color: bandColors[k], label: `정북 일조로 ${H_LABELS[k]}` })),
    ]

    const warn: string[] = []
    const lu = d.landUse.map((l) => l.name)
    const dist = d.districts.filter((x) => {
      try {
        return !!intersect(featureCollection([feature(x.geom), feature(d.boundary)]))
      } catch {
        return false
      }
    })
    const names2 = [...new Set([...lu, ...dist.map((x) => x.name)])]
    if (names2.some((n) => /지구단위계획/.test(n))) warn.push('지구단위계획구역 — 건폐율·용적률·높이·배치는 지구단위계획이 우선 (결정도·시행지침 확인)')
    if (names2.some((n) => /고도지구|높이|최고고도/.test(n))) warn.push('높이를 제한하는 지구·구역이 있음 — 고시된 최고 높이 확인')
    if (names2.some((n) => /경관지구|역사문화|문화재|국가유산/.test(n))) warn.push('경관·역사문화(국가유산) 관련 지정이 있음 — 높이·형태 심의 가능')
    if (d.zoning.length && zones.length > 1) warn.push(`대지가 용도지역 ${zones.length}곳에 걸침 — 면적 비율로 나눠 계산(건축법 제54조, 걸친 부분이 큰 쪽 기준 등 예외 있음)`)

    return {
      layers: [
        { id: '용도지역', svg: zoneSvg },
        { id: '건물', svg: bld ? `<path d="${bld}" fill="none" stroke="${c.pal.ink}" stroke-opacity="0.25" stroke-width="0.8"/>` : '' },
        { id: '정북_일조', svg: sunSvg },
        { id: '정북', svg: north, noClip: true },
      ],
      legendTitle: '용도지역 · 정북 일조 사선으로 지을 수 있는 높이',
      legend,
      summary: [
        `대지 면적 약 ${fmt(A)}㎡ (경계 도형으로 계산)${d.officialArea ? ` · 토지대장 합계 ${fmt(d.officialArea, 1)}㎡ (설계 기준은 토지대장)` : ''}`,
        ...zones.map((z) =>
          z.rule
            ? `${z.name}${zones.length > 1 ? ` (대지의 ${Math.round(z.share * 100)}%)` : ''}: 건폐율 ${z.rule.bcr}% 이하, 용적률 ${z.rule.farMin}~${z.rule.farMax}% 범위에서 조례로 정함`
            : `${z.name}: 건폐율·용적률 표를 찾지 못함 — 토지이음에서 확인`,
        ),
        ruled.length ? `법 상한으로 보면 최대 건축면적 약 ${fmt(maxBA)}㎡, 최대 연면적(지상) 약 ${fmt(maxGFA)}㎡ — 조례·지구단위계획으로 더 작을 수 있음` : '',
        sunZones.length
          ? `정북 일조: 북쪽 경계에서 1.5m 띄우고, 10m를 넘는 부분은 그 높이의 절반만큼 띄움 → 대지 안에서 가장 높이 지을 수 있는 곳 약 ${fmt(maxH)}m`
          : '정북 일조 사선 대상 아님 (전용·일반주거지역이 아님)',
        ...warn,
      ].filter(Boolean),
      caption:
        '국토의 계획 및 이용에 관한 법률 시행령 제84조(건폐율)·제85조(용적률), 건축법 시행령 제86조(정북 일조, 높이 10m 이하 1.5m·초과 부분은 높이의 1/2) · 실제 값은 시·군 도시계획조례·지구단위계획으로 더 낮을 수 있음 · 북쪽이 도로·공원·하천이면 완화, 공동주택은 채광 기준이 따로 있음 · 토지이음에서 확인 · 참고용',
    }
  },
}
