// Phase 9 도판: 바람장미, 실시간 도로 속도, 선택도(걷는 규모·넓은 규모), 도보권, 가구, 가로 위요감.
// panels.ts의 도우미를 가져오지 않는다 (panels.ts가 이 파일을 불러 순서를 정하므로 서로 부르지 않게).

import type { LineString, MultiLineString } from 'geojson'
import { ENC_CLASSES, STEP } from '../lib/enclosure'
import { sliceLine, type XY } from '../lib/network'
import { bearingOf, ringArea, ringCentroid, toXY } from '../lib/xy'
import { snapshotLabel, timeBand } from '../sources/its'
import { WALK_R } from '../sources/network'
import { CALM_MS, DIR16, prevailing, SEASONS, WIND_BINS } from '../sources/wind'
import { esc, type LegendItem, type PanelLayer, type PanelOutput } from './compose'
import { MAP_CX, MAP_CY, MAP_R } from './frame'
import { blockView, encView, linkSpeeds, netView, projOf, siteRingsXY, topShare, walkAt, walkshed, walkToPoint, WALK_BANDS, WALK_SPEED } from './move'
import type { DiagramData } from './data'
import { mix, shades, steps } from './palette'
import type { PanelCtx, PanelDef } from './panels'

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })
const pctText = (x: number) => `${Math.round(x * 100)}%`
const DIR8 = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
const dir8 = (b: number) => DIR8[Math.round(b / 45) % 8]

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** 대지 중심 기준 미터 → 도판 픽셀 path */
function xyPath(c: PanelCtx, coords: XY[], close = false): string {
  if (coords.length < 2) return ''
  let d = ''
  coords.forEach(([x, y], i) => {
    d += `${i ? 'L' : 'M'}${(MAP_CX + x * c.f.s).toFixed(1)} ${(MAP_CY - y * c.f.s).toFixed(1)}`
  })
  return close ? `${d}Z` : d
}

function faintBuildings(c: PanelCtx, t = 0.55): PanelLayer {
  const d = c.d.buildings.map((b) => c.f.path(b.geom, false)).join('')
  return { id: '바탕_건물', svg: d ? `<path d="${d}" fill="${mix('#ffffff', c.pal.base, t)}"/>` : '' }
}

function strokes(id: string, items: { d: string; color: string; width: number; opacity?: number }[]): PanelLayer {
  // 같은 색·굵기끼리 묶는다
  const groups = new Map<string, string[]>()
  for (const it of items) {
    if (!it.d) continue
    const k = `${it.color}|${it.width.toFixed(1)}|${it.opacity ?? 1}`
    const l = groups.get(k)
    if (l) l.push(it.d)
    else groups.set(k, [it.d])
  }
  let svg = ''
  for (const [k, ds] of groups) {
    const [color, width, op] = k.split('|')
    svg += `<path d="${ds.join('')}" fill="none" stroke="${color}" stroke-width="${width}"${op !== '1' ? ` stroke-opacity="${op}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>`
  }
  return { id, svg }
}

const linePositions = (g: LineString | MultiLineString) => (g.type === 'LineString' ? [g.coordinates] : g.coordinates)

/** 진행 방향 오른쪽으로 px만큼 옮긴 선 (양방향 링크가 겹치지 않게) */
function offsetPath(pts: [number, number][], px: number): string {
  if (pts.length < 2) return ''
  const out: [number, number][] = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const L = Math.hypot(dx, dy) || 1
    // 화면 좌표(y 아래)에서 진행 방향 오른쪽 = (-dy, dx)
    return [p[0] - (dy / L) * px, p[1] + (dx / L) * px]
  })
  return out.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')
}

/** 거시: 실제 속도 ÷ 제한속도 */
const CONGESTION_BINS = [
  { label: '제한속도의 30% 미만 (정체)', min: 0 },
  { label: '30~50% (서행)', min: 0.3 },
  { label: '50~70%', min: 0.5 },
  { label: '70~90%', min: 0.7 },
  { label: '90% 이상 (원활)', min: 0.9 },
]
function congestionBin(r: number): number {
  return CONGESTION_BINS.filter((b) => r >= b.min).length - 1
}

/** 미시: 보행자가 느끼는 차량 속도 (안전속도 5030 기준) */
const PED_BINS = [
  { label: '시속 20km 미만 (아주 느림)', short: '아주 느림', min: 0 },
  { label: '20~30km (이면도로 수준)', short: '이면도로 수준', min: 20 },
  { label: '30~40km', short: '보통', min: 30 },
  { label: '40~50km', short: '빠름', min: 40 },
  { label: '50km 이상 (빠름·소음)', short: '아주 빠름', min: 50 },
]
function pedBin(v: number): number {
  return PED_BINS.filter((b) => v >= b.min).length - 1
}

/** 대지가 다 보이는 주변 (대지 꼭짓점 중 가장 먼 곳 + 60m, 최소 200m) */
function localFrameR(d: DiagramData): number {
  const far = Math.max(0, ...siteRingsXY(d).flat().map(([x, y]) => Math.hypot(x, y)))
  return Math.min(d.R, Math.max(200, Math.ceil((far + 60) / 10) * 10))
}

/** 순위 구간 (선택도) */
const RANK_BINS = [
  { label: '하위 50%', top: 1 },
  { label: '상위 50~25%', top: 0.5 },
  { label: '상위 25~10%', top: 0.25 },
  { label: '상위 10~3%', top: 0.1 },
  { label: '상위 3%', top: 0.03 },
]

function choicePanel(scale: 'walk' | 'wide'): PanelDef {
  return {
    id: scale === 'walk' ? 'choiceWalk' : 'choiceWide',
    title: scale === 'walk' ? `선택도 (걷는 규모 ${WALK_R}m)` : '선택도 (넓은 규모)',
    group: '연계와 접근',
    needs: "공간정보에서 '길의 연결'을 수집하세요.",
    render: (c): PanelOutput => {
      const v = netView(c.d)
      const r = c.d.network
      if (!v || !r) return { layers: [faintBuildings(c)], legend: [], summary: [], caption: '', empty: '길의 연결 계산 결과가 없습니다' }
      const vals = scale === 'walk' ? v.nachWalk : v.nachWide
      // 반경 안 값으로 순위 경계
      const shown = vals.map((x, i) => (v.inDisplay[i] && x !== null ? x : null)).filter((x): x is number => x !== null).sort((a, b) => b - a)
      const cut = RANK_BINS.map((b) => (shown.length ? shown[Math.min(shown.length - 1, Math.floor(b.top * shown.length) - 1)] ?? shown[shown.length - 1] : Infinity))
      const binOf = (x: number) => {
        let k = 0
        for (let i = 1; i < RANK_BINS.length; i++) if (x >= cut[i]) k = i
        return k
      }
      const colors = c.pal.id === 'mono' ? shades('#111111', RANK_BINS.length) : steps(c.pal, RANK_BINS.length + 1).slice(1)
      const widths = [1.2, 2, 3, 4.5, 6.5]
      const items: { d: string; color: string; width: number }[] = []
      const frameM = c.f.R + 100
      const order = v.net.edges
        .map((_, i) => i)
        .filter((i) => {
          const m = v.net.edges[i].coords[Math.floor(v.net.edges[i].coords.length / 2)]
          return Math.hypot(m[0], m[1]) <= frameM
        })
        .sort((a, b) => (vals[a] ?? -1) - (vals[b] ?? -1))
      for (const i of order) {
        const x = vals[i]
        const d = xyPath(c, v.net.edges[i].coords)
        if (x === null) items.push({ d, color: c.pal.unknown, width: 1 })
        else {
          const k = binOf(x)
          items.push({ d, color: colors[k], width: widths[k] })
        }
      }
      const adj = v.adjacent.map((i) => vals[i]).filter((x): x is number => x !== null)
      const bestAdj = adj.length ? Math.max(...adj) : null
      const top = v.net.edges
        .map((e, i) => ({ i, x: vals[i], m: e.coords[Math.floor(e.coords.length / 2)] }))
        .filter((t) => v.inDisplay[t.i] && t.x !== null)
        .sort((a, b) => (b.x as number) - (a.x as number))
        .slice(0, Math.max(1, Math.ceil(shown.length * 0.03)))
      const dirs = [...new Set(top.map((t) => dir8(bearingOf(t.m))))]
      const origins = scale === 'walk' ? r.originsWalk : r.originsWide
      const total = scale === 'walk' ? r.edges.length : r.wideEdges
      return {
        layers: [faintBuildings(c, 0.4), strokes('선택도', items)],
        legend: RANK_BINS.map((b, i) => ({ color: colors[i], label: b.label, shape: 'line' as const })),
        legendTitle: '반경 안 길 중 순위',
        summary: [
          bestAdj !== null ? `대지에 붙은 길 중 가장 높은 길: 반경 안 길의 상위 ${pctText(topShare(vals, v.inDisplay, bestAdj))}` : '대지에 붙은 도로중심선이 없음 (골목·통로는 현장 확인)',
          `가장 높은 길(상위 3%)은 대지 ${dirs.slice(0, 3).join('·')}쪽에 있음`,
          scale === 'walk'
            ? `각 길에서 길을 따라 ${WALK_R}m 안의 모든 길로 오갈 때를 셈 (걸어 다니는 동네 규모)`
            : `수집 반경 ${fmt(r.displayR)}m에 여유 ${fmt(r.wideBuffer)}m를 더한 범위 안 길 사이의 모든 이동을 셈 (큰길 위계)`,
        ],
        caption: `공간구문론 각도 선택도(정규화, NACH) · 국토지리정보원 도로중심선(브이월드) ${c.date} 수집 → 앱에서 계산${origins < total ? ` (출발 길 ${fmt(origins)}개를 뽑아 환산)` : ''} · 길의 배치만으로 계산한 값이며 실제 사람·차의 수가 아님`,
      }
    },
  }
}

export const MOVE_PANELS: PanelDef[] = [
  // ───────────────────────── 가구 ─────────────────────────
  {
    id: 'blocks',
    title: '가구 (길로 둘러싸인 블록)',
    group: '땅의 조건',
    needs: "공간정보에서 '길의 연결'을 수집하세요.",
    render: (c): PanelOutput => {
      const b = blockView(c.d)
      const v = netView(c.d)
      if (!b || !v || !b.faces.length) return { layers: [faintBuildings(c)], legend: [], summary: [], caption: '', empty: '길로 둘러싸인 가구를 만들지 못했습니다' }
      const bins = [
        { label: '2천㎡ 미만', min: 0 },
        { label: '2천~5천㎡', min: 2000 },
        { label: '5천㎡~1만㎡', min: 5000 },
        { label: '1만~2만㎡', min: 10000 },
        { label: '2만㎡ 이상', min: 20000 },
      ]
      const colors = steps(c.pal, bins.length)
      const keyOf = (a: number) => bins.filter((x) => a >= x.min).length - 1
      const byKey = new Map<number, string[]>()
      for (const f of b.faces) {
        const k = keyOf(f.area)
        const l = byKey.get(k)
        const d = xyPath(c, f.ring, true)
        if (l) l.push(d)
        else byKey.set(k, [d])
      }
      let fill = ''
      for (const [k, ds] of byKey) fill += `<g id="${esc(bins[k].label)}"><path d="${ds.join('')}" fill="${colors[k]}" stroke="#ffffff" stroke-width="1.2"/></g>`
      const roadD = v.net.edges
        .filter((e) => Math.hypot(...e.coords[0]) <= c.f.R + 150)
        .map((e) => xyPath(c, e.coords))
        .join('')
      const inR = b.faces.filter((f) => Math.hypot(...ringCentroid(f.ring)) <= c.d.R)
      const siteOutline = b.site ? `<path d="${xyPath(c, b.site.ring, true)}" fill="none" stroke="${c.pal.ink}" stroke-width="2.5" stroke-dasharray="7 5"/>` : ''
      return {
        layers: [
          { id: '가구', svg: fill },
          { id: '도로중심선', svg: `<path d="${roadD}" fill="none" stroke="${mix('#ffffff', c.pal.ink, 0.35)}" stroke-width="0.8"/>` },
          { id: '대지가_속한_가구', svg: siteOutline },
        ],
        legend: [...bins.map((x, i) => ({ color: colors[i], label: x.label })), ...(b.site ? [{ color: c.pal.ink, label: '대지가 속한 가구', shape: 'outline' as const }] : [])],
        summary: [
          b.site ? `대지가 속한 가구: 약 ${fmt(Math.round(ringArea(b.site.ring) / 10) * 10)}㎡` : '대지 중심이 길 위에 있거나 가구가 닫히지 않아 대지 가구를 정하지 못함',
          inR.length ? `반경 안 가구 ${fmt(inR.length)}개 · 면적 중앙값 약 ${fmt(Math.round(median(inR.map((f) => f.area)) / 10) * 10)}㎡` : '',
        ].filter(Boolean),
        caption: `국토지리정보원 도로중심선(브이월드) ${c.date} 수집 → 길로 둘러싸인 면을 계산 · 면적은 도로 중심선까지 넣은 값 · 보행 전용 거리(차 없는 상가 거리 등)는 자료에 없어 가구가 실제보다 클 수 있음`,
      }
    },
  },

  // ───────────────────────── 가로 위요감 ─────────────────────────
  {
    id: 'enclosure',
    title: '가로 위요감 (D/H)',
    group: '주변 현황',
    needs: "공간정보에서 '도로'와 '주변 건물'을 수집하세요.",
    render: (c): PanelOutput => {
      const e = encView(c.d)
      if (!e || !e.samples.length) return { layers: [faintBuildings(c)], legend: [], summary: [], caption: '', empty: '도로중심선·건물 자료가 없습니다' }
      const colors = c.pal.id === 'mono' ? shades('#111111', ENC_CLASSES.length).reverse() : [...steps(c.pal, ENC_CLASSES.length + 1)].reverse().slice(0, ENC_CLASSES.length)
      const items = e.samples.map((s) => ({
        d: xyPath(c, sliceLine(e.roads[s.road], s.s - STEP / 2, s.s + STEP / 2)),
        color: s.cls < 0 ? c.pal.unknown : colors[s.cls],
        width: 5,
      }))
      const n = e.samples.length
      const share = ENC_CLASSES.map((_, i) => e.samples.filter((s) => s.cls === i).length / n)
      const fin = e.front.filter((s) => s.ratio !== null && Number.isFinite(s.ratio))
      const frontTxt = !e.front.length
        ? '대지 앞을 지나는 도로중심선을 찾지 못함'
        : fin.length < e.front.length / 2
          ? `대지 앞 길: 잰 자리의 ${pctText(1 - fin.length / e.front.length)}가 한쪽·양쪽이 트임`
          : `대지 앞 길: D 약 ${fmt(median(fin.map((s) => s.D as number)))}m ÷ H 약 ${fmt(median(fin.map((s) => s.H as number)))}m = D/H 약 ${fmt(median(fin.map((s) => s.ratio as number)), 1)}`
      return {
        layers: [{ id: '바탕_건물', svg: `<path d="${c.d.buildings.map((b) => c.f.path(b.geom, false)).join('')}" fill="${c.pal.base}"/>` }, strokes('위요감', items)],
        legend: [...ENC_CLASSES.map((x, i) => ({ color: colors[i], label: x.label, shape: 'line' as const })), { color: c.pal.unknown, label: '높이 미상', shape: 'line' as const }],
        legendTitle: 'D = 양옆 건물 사이 거리, H = 건물 높이',
        summary: [frontTxt, `반경 안 길(10m 간격 ${fmt(n)}곳): ${ENC_CLASSES.map((x, i) => `${x.label.replace(/ \(.*\)$/, '')} ${pctText(share[i])}`).join(', ')}`],
        caption: `도로중심선·GIS건물통합정보(브이월드) ${c.date} 수집 → 길 가운데에서 직각으로 첫 건물까지 잼 · 높이는 실측 높이 또는 층수×용도별 층고 · 담장·가로수·저층부 후퇴는 반영 안 함`,
      }
    },
  },

  choicePanel('walk'),
  choicePanel('wide'),

  // ───────────────────────── 도보권 ─────────────────────────
  {
    id: 'walkshed',
    title: '도보권 (5·10·15분)',
    group: '연계와 접근',
    needs: "공간정보에서 '길의 연결'을 수집하세요.",
    frameR: () => WALK_SPEED * WALK_BANDS[WALK_BANDS.length - 1] + 150,
    render: (c): PanelOutput => {
      const v = netView(c.d)
      const w = walkshed(c.d)
      if (!v || !w) return { layers: [], legend: [], summary: [], caption: '', empty: '길의 연결 계산 결과가 없습니다' }
      const lim = WALK_BANDS.map((m) => m * WALK_SPEED)
      const colors = c.pal.id === 'mono' ? ['#333333', '#777777', '#b0b0b0'] : steps(c.pal, 4).slice(1).reverse()
      const halo: { d: string; color: string; width: number; opacity?: number }[] = []
      const core: { d: string; color: string; width: number }[] = []
      const base: { d: string; color: string; width: number }[] = []
      const frameM = c.f.R + 100
      v.net.edges.forEach((e, i) => {
        const mid = e.coords[Math.floor(e.coords.length / 2)]
        if (Math.hypot(mid[0], mid[1]) > frameM) return
        base.push({ d: xyPath(c, e.coords), color: mix('#ffffff', c.pal.ink, 0.22), width: 0.8 })
        // 걷는 거리는 길 위에서 직선적으로 변하므로, 시간 경계가 바뀌는 자리에서만 자른다
        const da = w.dist[e.a]
        const db = w.dist[e.b]
        const cuts = [0, e.len]
        for (const L of lim) cuts.push(L - da, e.len - (L - db))
        const ss = [...new Set(cuts.filter((s) => s >= 0 && s <= e.len).map((s) => Math.round(s * 10) / 10))].sort((a, b) => a - b)
        for (let k = 1; k < ss.length; k++) {
          if (ss[k] - ss[k - 1] < 0.5) continue
          const m = walkAt(v, w, i, (ss[k - 1] + ss[k]) / 2)
          const band = lim.findIndex((L) => m <= L)
          if (band < 0) continue
          const d = xyPath(c, sliceLine(e.coords, ss[k - 1], ss[k]))
          halo.push({ d, color: colors[band], width: Math.max(6, 40 * c.f.s), opacity: 0.28 })
          core.push({ d, color: colors[band], width: 2.2 })
        }
      })
      const reach = (pts: { lon: number; lat: number; name: string }[]) => {
        const p = projOf(c.d)
        return pts.map((pt) => ({ pt, m: walkToPoint(v, w, toXY(p, [pt.lon, pt.lat])) }))
      }
      const st = reach(c.d.stations)
      const sp = reach(c.d.stops)
      const bandCount = (list: { m: number | null }[], L: number) => list.filter((x) => x.m !== null && x.m <= L).length
      const stopsSvg = sp
        .filter((x) => x.m !== null && x.m <= lim[2])
        .map((x) => {
          const [px, py] = c.f.pt(x.pt.lon, x.pt.lat)
          return `<rect x="${(px - 3.5).toFixed(1)}" y="${(py - 3.5).toFixed(1)}" width="7" height="7" fill="${c.pal.ink}" stroke="#ffffff" stroke-width="1"/>`
        })
        .join('')
      const stSvg = st
        .filter((x) => c.f.inside(x.pt.lon, x.pt.lat))
        .map((x) => {
          const [px, py] = c.f.pt(x.pt.lon, x.pt.lat)
          return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="8" fill="${c.pal.ink}" stroke="#ffffff" stroke-width="2"/><text x="${(px + 12).toFixed(1)}" y="${(py + 5).toFixed(1)}" font-size="15" font-weight="700" fill="${c.pal.ink}" stroke="#ffffff" stroke-width="4" paint-order="stroke">${esc(x.pt.name.replace(/\s.*$/, ''))}</text>`
        })
        .join('')
      const ring = (m: number) => `<circle cx="${MAP_CX}" cy="${MAP_CY}" r="${(m * c.f.s).toFixed(1)}" fill="none" stroke="${c.pal.subtle}" stroke-width="1" stroke-dasharray="4 6"/>`
      const legend: LegendItem[] = [
        ...WALK_BANDS.map((m, i) => ({ color: colors[i], label: `${m}분 (${fmt(m * WALK_SPEED)}m)`, shape: 'line' as const })),
        { color: c.pal.ink, label: '버스정류소', shape: 'square' },
      ]
      if (st.length) legend.push({ color: c.pal.ink, label: '지하철역', shape: 'dot' })
      return {
        layers: [
          strokes('길', base),
          strokes('도보권_넓게', halo),
          strokes('도보권', core),
          { id: '직선거리_원', svg: WALK_BANDS.map((m) => ring(m * WALK_SPEED)).join('') },
          { id: '버스정류소', svg: stopsSvg },
          { id: '지하철역', svg: stSvg },
        ],
        legend,
        legendTitle: '대지에서 길을 따라 걷는 시간 (분당 80m)',
        summary: WALK_BANDS.map((m, i) => {
          const L = lim[i]
          const ns = bandCount(st, L)
          return `${m}분 안: 버스정류소 ${bandCount(sp, L)}곳${c.d.stations.length ? `, 지하철역 ${ns}곳` : ''}`
        }).concat(c.d.stops.length ? ['버스정류소는 대지 중심 약 500m 안 자료만 있어 10·15분 수는 실제보다 적음'] : ['버스정류소 자료가 없음 (대중교통을 함께 수집하면 표시)']),
        caption: `국토지리정보원 도로중심선(브이월드) ${c.date} 수집 → 대지에 붙은 길에서 길을 따라 잰 거리 · 점선 원은 같은 거리의 직선 · 횡단보도·신호·언덕·보행 전용 길은 반영 안 함 · 정류소: TAGO(대지 중심 약 500m만)`,
      }
    },
  },

  // ───────────────────────── 실시간 도로 속도 ─────────────────────────
  {
    id: 'speed',
    title: '도로 혼잡 (거시, 제한속도 대비)',
    group: '연계와 접근',
    needs: "공간정보에서 '실시간 도로 속도'를 수집하세요 (국가교통정보센터 키).",
    render: (c): PanelOutput => {
      const snaps = c.d.speedSnaps
      if (!snaps.length) return { layers: [faintBuildings(c)], legend: [], summary: [], caption: '', empty: '받은 속도 장면이 없습니다' }
      if (!c.d.links.length) return { layers: [faintBuildings(c)], legend: [], summary: [], caption: '', empty: '표준노드링크(도로망) 도형이 없어 그릴 수 없습니다' }
      const idx = c.st.speedSnap >= 0 && c.st.speedSnap < snaps.length ? c.st.speedSnap : snaps.length - 1
      const snap = snaps[idx]
      const colors = c.pal.id === 'mono' ? ['#111111', '#555555', '#8a8a8a', '#b5b5b5', '#d9d9d9'] : c.pal.id === 'cvd' ? ['#d55e00', '#e69f00', '#f0e442', '#56b4e9', '#0072b2'] : ['#d7301f', '#f2862e', '#f2c94c', '#8cc084', '#3a8f5c']
      const items: { d: string; color: string; width: number }[] = []
      let lenAll = 0
      let lenJam = 0
      const jamNames = new Set<string>()
      c.d.links.forEach((l) => {
        const val = l.id ? snap.speeds[l.id] : undefined
        const r = val !== undefined && l.maxSpd ? val / l.maxSpd : null
        for (const ls of linePositions(l.geom)) {
          const pts = ls.map(([lon, lat]) => c.f.pt(lon, lat))
          items.push({ d: offsetPath(pts, 2.6), color: r === null ? c.pal.unknown : colors[congestionBin(r)], width: r === null ? 1.6 : 3.6 })
          if (r !== null && c.f.inside(ls[0][0], ls[0][1])) {
            const len = pts.slice(1).reduce((acc, q, i) => acc + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0) / c.f.s
            lenAll += len
            if (r < 0.3) {
              lenJam += len
              if (l.name) jamNames.add(l.name)
            }
          }
        }
      })
      return {
        layers: [faintBuildings(c, 0.45), strokes('혼잡', items)],
        legend: [...CONGESTION_BINS.map((b, i) => ({ color: colors[i], label: b.label, shape: 'line' as const })), { color: c.pal.unknown, label: '자료 없음·제한속도 모름', shape: 'line' as const }],
        legendTitle: `${snapshotLabel(snap)} (${timeBand(snap)}) · 실제 속도 ÷ 제한속도`,
        summary: [
          `${snapshotLabel(snap)} ${timeBand(snap)} 장면${snaps.length > 1 ? ` (받은 장면 ${snaps.length}개 중 ${idx + 1}번째)` : ''}`,
          lenAll ? `반경 안 차도 중 제한속도의 30%도 못 내는 구간(정체): 길이로 ${pctText(lenJam / lenAll)}${jamNames.size ? ` — ${[...jamNames].slice(0, 4).join(', ')}` : ''}` : '반경 안 차도에 속도 자료가 없음',
        ],
        caption: `국가교통정보센터 교통소통정보(민간 내비·공공 자료 융합 추정 속도) ÷ 표준노드링크 제한속도 · 좁은 길이 원래 느린 것은 막힘으로 치지 않도록 제한속도 대비로 봄 · 교통량(차 수)이 아니며 받은 순간의 장면`,
      }
    },
  },
  {
    id: 'speedLocal',
    title: '대지 주변 차량 속도 (미시, 보행 체감)',
    group: '연계와 접근',
    needs: "공간정보에서 '실시간 도로 속도'를 수집하세요 (국가교통정보센터 키).",
    frameR: localFrameR,
    render: (c): PanelOutput => {
      const snaps = c.d.speedSnaps
      if (!snaps.length) return { layers: [faintBuildings(c)], legend: [], summary: [], caption: '', empty: '받은 속도 장면이 없습니다' }
      const idx = c.st.speedSnap >= 0 && c.st.speedSnap < snaps.length ? c.st.speedSnap : snaps.length - 1
      const snap = snaps[idx]
      const colors = c.pal.id === 'mono' ? ['#d9d9d9', '#b5b5b5', '#8a8a8a', '#555555', '#111111'] : c.pal.id === 'cvd' ? ['#0072b2', '#56b4e9', '#f0e442', '#e69f00', '#d55e00'] : ['#3a8f5c', '#8cc084', '#f2c94c', '#f2862e', '#d7301f']
      // 바탕: 실제 폭으로 그린 도로 면
      const roadBase = c.d.roads
        .map((r) => ({ d: c.f.path(r.geom), w: Math.max(1.5, (r.width ?? 4) * c.f.s) }))
        .map((x) => `<path d="${x.d}" fill="none" stroke="${mix('#ffffff', c.pal.ink, 0.12)}" stroke-width="${x.w.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`)
        .join('')
      const items: { d: string; color: string; width: number }[] = []
      for (const l of c.d.links) {
        const val = l.id ? snap.speeds[l.id] : undefined
        for (const ls of linePositions(l.geom)) {
          const pts = ls.map(([lon, lat]) => c.f.pt(lon, lat))
          items.push({ d: offsetPath(pts, 4), color: val === undefined ? mix('#ffffff', c.pal.ink, 0.42) : colors[pedBin(val)], width: val === undefined ? 1.6 : 5 })
        }
      }
      const v = linkSpeeds(c.d, snap)
      const adj = new Map<string, number[]>()
      for (const a of v.adjacent) {
        if (a.v === null) continue
        const n = c.d.links[a.i].name || '이름 없는 도로'
        const list = adj.get(n)
        if (list) list.push(a.v)
        else adj.set(n, [a.v])
      }
      return {
        layers: [{ id: '도로_면', svg: roadBase }, faintBuildings(c, 0.5), strokes('차량_속도', items)],
        legend: [...PED_BINS.map((b, i) => ({ color: colors[i], label: b.label, shape: 'line' as const })), { color: mix('#ffffff', c.pal.ink, 0.42), label: '속도 자료 없음', shape: 'line' as const }],
        legendTitle: `${snapshotLabel(snap)} (${timeBand(snap)}) · 차가 실제로 달리는 속도 — 느릴수록 걷기 편함`,
        summary: [
          adj.size
            ? `대지에 붙은 차도: ${[...adj.entries()].map(([n, vs]) => { const m = vs.reduce((a, b) => a + b, 0) / vs.length; return `${n} 시속 ${fmt(m)}km(${PED_BINS[pedBin(m)].short})` }).join(', ')}`
            : '대지에 붙은 차도에 속도 자료가 없음 (이면도로·골목이면 대체로 느린 길)',
          '회색 바탕 폭 = 도로중심선의 실제 도로 폭',
        ],
        caption: `국가교통정보센터 교통소통정보 · 표준노드링크(브이월드) · 도로 폭: 국토지리정보원 도로중심선 · 기준: 안전속도 5030(이면도로 30km/h, 간선 50km/h) · 방향별로 진행 방향 오른쪽 · 받은 순간의 장면`,
      }
    },
  },

  // ───────────────────────── 바람장미 ─────────────────────────
  {
    id: 'wind',
    title: '바람장미',
    group: '환경',
    needs: "공간정보에서 '기후·바람'을 수집하세요 (ASOS 시간자료 활용신청 필요).",
    render: (c): PanelOutput => {
      const r = c.d.wind
      if (!r) return { layers: [faintBuildings(c)], legend: [], summary: [], caption: '', empty: '바람장미 자료가 없습니다' }
      const si = Math.max(0, Math.min(SEASONS.length - 1, c.st.windSeason))
      const t = r.tables[si]
      if (!t?.hours) return { layers: [faintBuildings(c)], legend: [], summary: [], caption: '', empty: `${SEASONS[si]} 자료가 없습니다` }
      const totals = t.counts.map((row) => row.reduce((a, b) => a + b, 0) / t.hours)
      const maxShare = Math.max(...totals)
      const gridStep = maxShare > 0.2 ? 0.05 : maxShare > 0.1 ? 0.04 : 0.02
      const top = Math.max(gridStep, Math.ceil(maxShare / gridStep) * gridStep)
      const r0 = 46
      const R1 = MAP_R - 70
      const rad = (share: number) => r0 + (share / top) * (R1 - r0)
      const colors = c.pal.id === 'mono' ? shades('#111111', WIND_BINS.length) : steps(c.pal, WIND_BINS.length + 1).slice(1)
      const wedge = (dirI: number, a: number, b: number) => {
        const th0 = ((dirI * 22.5 - 9) * Math.PI) / 180
        const th1 = ((dirI * 22.5 + 9) * Math.PI) / 180
        const p = (rr: number, th: number) => `${(MAP_CX + rr * Math.sin(th)).toFixed(1)} ${(MAP_CY - rr * Math.cos(th)).toFixed(1)}`
        return `M${p(a, th0)}L${p(b, th0)}A${b.toFixed(1)} ${b.toFixed(1)} 0 0 1 ${p(b, th1)}L${p(a, th1)}A${a.toFixed(1)} ${a.toFixed(1)} 0 0 0 ${p(a, th0)}Z`
      }
      let petals = ''
      WIND_BINS.forEach((_, k) => {
        let d = ''
        t.counts.forEach((row, i) => {
          const below = row.slice(0, k).reduce((a, b) => a + b, 0) / t.hours
          const upto = below + row[k] / t.hours
          if (row[k] > 0) d += wedge(i, rad(below), rad(upto))
        })
        petals += `<g id="${esc(`${WIND_BINS[k]}ms_이상`)}"><path d="${d}" fill="${colors[k]}" fill-opacity="0.9" stroke="#ffffff" stroke-width="0.8"/></g>`
      })
      let grid = ''
      let gridText = ''
      for (let g = gridStep; g <= top + 1e-9; g += gridStep) {
        grid += `<circle cx="${MAP_CX}" cy="${MAP_CY}" r="${rad(g).toFixed(1)}" fill="none" stroke="${c.pal.subtle}" stroke-width="0.8" stroke-dasharray="3 5"/>`
        // 꽃잎이 적은 남남동 쪽(157.5°)에 눈금 글자
        const th = (157.5 * Math.PI) / 180
        gridText += `<text x="${(MAP_CX + rad(g) * Math.sin(th)).toFixed(1)}" y="${(MAP_CY - rad(g) * Math.cos(th) + 4).toFixed(1)}" font-size="13" text-anchor="middle" fill="${c.pal.ink}" stroke="#ffffff" stroke-width="3.5" paint-order="stroke">${Math.round(g * 100)}%</text>`
      }
      grid += `<circle cx="${MAP_CX}" cy="${MAP_CY}" r="${r0}" fill="#ffffff" fill-opacity="0.75" stroke="${c.pal.subtle}" stroke-width="0.8"/>`
      const labels = DIR16.map((name, i) => {
        if (i % 2) return ''
        const th = (i * 22.5 * Math.PI) / 180
        const rr = R1 + 34
        return `<text x="${(MAP_CX + rr * Math.sin(th)).toFixed(1)}" y="${(MAP_CY - rr * Math.cos(th) + 6).toFixed(1)}" font-size="${i % 4 ? 15 : 19}" font-weight="${i % 4 ? 500 : 700}" text-anchor="middle" fill="${c.pal.ink}">${name}</text>`
      }).join('')
      const pv = prevailing(t)
      const seasonTop = SEASONS.slice(1)
        .map((name, i) => {
          const tt = r.tables[i + 1]
          return tt?.hours ? `${name} ${DIR16[prevailing(tt).dir]}` : ''
        })
        .filter(Boolean)
      return {
        layers: [faintBuildings(c, 0.35), { id: '눈금', svg: grid }, { id: '바람장미', svg: petals }, { id: '눈금_글자', svg: gridText }, { id: '방위', svg: labels, noClip: true }],
        legend: WIND_BINS.map((b, k) => ({ color: colors[k], label: k < WIND_BINS.length - 1 ? `${b}~${WIND_BINS[k + 1]}m/s` : `${b}m/s 이상` })),
        legendTitle: `${SEASONS[si]} · 꽃잎 길이 = 그 방향에서 불어온 시간 비율`,
        summary: [
          `${SEASONS[si]} 가장 잦은 바람: ${DIR16[pv.dir]}풍 ${pctText(pv.share)}, 다음 ${DIR16[pv.second]}풍 ${pctText(pv.secondShare)}`,
          `바람 거의 없음(${CALM_MS}m/s 미만) ${pctText(t.calm / t.hours)} · 평균 풍속 ${fmt(t.meanSpeed, 1)}m/s`,
          si === 0 ? `계절별 가장 잦은 바람: ${seasonTop.join(', ')}` : '',
        ].filter(Boolean),
        caption: `기상청 ASOS ${r.station.name} 관측소(대지에서 약 ${r.distanceKm.toFixed(1)}km) ${r.years[0]}~${r.years.at(-1)}년 매시 자료 ${fmt(t.hours)}시간 · 관측소는 트인 곳의 바람이라 대지 주변 건물 사이 바람과 다름 · 배경 지도는 방향 참고용`,
      }
    },
  },
]
