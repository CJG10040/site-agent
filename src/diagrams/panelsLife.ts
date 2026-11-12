// 상가·생활 시설 도판 (사용자 검토 2026-11-11):
// - 상가 낮·밤 성격 (건물을 시간 성격으로 칠함)
// - 대지 주변 vs 동네 업종 비교 (막대 그림)
// - 생활 시설 지도 (분류별 아이콘 + 분류마다 가장 가까운 곳까지 걸어서 몇 분)
// - 생활권 다이어그램 (대지에서 5·10·15분 안에 무엇이 몇 곳)

import { pointToAreaDistanceM } from '../lib/geo'
import { arealRings, pointInRings, pointToRingsDist, toXY } from '../lib/xy'
import { mclsLabel, storeGroup, STORE_GROUP_NOTE, storeTime, STORE_TIME_LABEL, type StoreTime } from '../model/storeClass'
import { esc, type LegendItem, type PanelOutput } from './compose'
import type { DiagramData, Pt } from './data'
import { MAP_CX, MAP_CY, MAP_R } from './frame'
import { groupOf, iconSvg, poiGroups } from './icons'
import { netView, projOf, walkshed, walkToPoint, WALK_SPEED } from './move'
import { isStock, mix } from './palette'
import type { PanelCtx, PanelDef } from './panels'

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })
const pctText = (x: number) => `${Math.round(x * 100)}%`
const NEAR_M = 100

// ───────────────────────── 상가를 건물에 담기 ─────────────────────────

interface StoreBld {
  /** d.buildings 번호 → 그 건물의 상가 */
  per: Map<number, Pt[]>
  loose: Pt[]
}

const memo = new WeakMap<DiagramData, StoreBld>()

/** 상가 좌표가 든 건물(없으면 8m 안 가장 가까운 건물)에 담는다 */
export function storesByBuilding(d: DiagramData): StoreBld {
  const hit = memo.get(d)
  if (hit) return hit
  const p = projOf(d)
  const rings = d.buildings.map((b) => arealRings(p, b.geom))
  const CELL = 25
  const grid = new Map<string, number[]>()
  rings.forEach((r, i) => {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const [x, y] of r[0] ?? []) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
    for (let gx = Math.floor((x0 - 8) / CELL); gx <= Math.floor((x1 + 8) / CELL); gx++)
      for (let gy = Math.floor((y0 - 8) / CELL); gy <= Math.floor((y1 + 8) / CELL); gy++) {
        const k = `${gx},${gy}`
        const l = grid.get(k)
        if (l) l.push(i)
        else grid.set(k, [i])
      }
  })
  const per = new Map<number, Pt[]>()
  const loose: Pt[] = []
  for (const st of d.stores) {
    const q = toXY(p, [st.lon, st.lat])
    const cand = grid.get(`${Math.floor(q[0] / CELL)},${Math.floor(q[1] / CELL)}`) ?? []
    let found = cand.find((i) => pointInRings(q, rings[i]))
    if (found === undefined) {
      let best = 8
      for (const i of cand) {
        const dd = pointToRingsDist(q, rings[i])
        if (dd < best) {
          best = dd
          found = i
        }
      }
    }
    if (found === undefined) loose.push(st)
    else {
      const l = per.get(found)
      if (l) l.push(st)
      else per.set(found, [st])
    }
  }
  const out = { per, loose }
  memo.set(d, out)
  return out
}

function timeOf(st: Pt): StoreTime {
  return storeTime(st.kind, st.label ?? '', st.detail ?? '')
}

function timeColors(c: PanelCtx): Record<StoreTime | 'mixed', string> {
  if (c.pal.kind === 'mono') return { day: mix(c.pal.paper, c.pal.ink, 0.18), allday: mix(c.pal.paper, c.pal.ink, 0.5), night: mix(c.pal.paper, c.pal.ink, 0.88), mixed: mix(c.pal.paper, c.pal.ink, 0.32) }
  if (isStock(c.pal, 'cvd')) return { day: '#f0e442', allday: '#e69f00', night: '#0072b2', mixed: '#bdbdbd' }
  if (isStock(c.pal, 'default')) return { day: '#f2c94c', allday: '#e8743b', night: '#4b3591', mixed: '#c9c3d6' }
  return { day: c.pal.cat[0], allday: c.pal.cat[1], night: c.pal.cat[5], mixed: c.pal.unknown }
}

function near100(c: PanelCtx, st: Pt): boolean {
  return pointToAreaDistanceM([st.lon, st.lat], c.d.boundary) <= NEAR_M
}

const storesTimePanel: PanelDef = {
  id: 'storesTime',
  title: '상가 낮·밤 성격',
  group: '사회·경제',
  needs: "공간정보에서 '상가 업종 구성'을 수집하세요.",
  render: (c): PanelOutput => {
    const ss = c.d.stores
    if (!ss.length) return { layers: [], legend: [], summary: [], caption: '', empty: '상가업소 자료가 없습니다' }
    const col = timeColors(c)
    const { per, loose } = storesByBuilding(c.d)
    const byColor = new Map<string, string[]>()
    const bldCount = { day: 0, allday: 0, night: 0, mixed: 0 }
    for (const [i, list] of per) {
      const n = { day: 0, allday: 0, night: 0 }
      for (const st of list) n[timeOf(st)]++
      const top = (Object.entries(n) as [StoreTime, number][]).sort((a, b) => b[1] - a[1])[0]
      const key: StoreTime | 'mixed' = top[1] / list.length > 0.5 ? top[0] : 'mixed'
      bldCount[key]++
      const d = c.f.path(c.d.buildings[i].geom, false)
      const l = byColor.get(col[key])
      if (l) l.push(d)
      else byColor.set(col[key], [d])
    }
    const base = c.d.buildings
      .filter((_, i) => !per.has(i))
      .map((b) => c.f.path(b.geom, false))
      .join('')
    let fills = ''
    for (const [color, ds] of byColor) fills += `<path d="${ds.join('')}" fill="${color}" stroke="${c.pal.paper}" stroke-width="0.6"/>`
    const dots = loose
      .map((st) => {
        const [x, y] = c.f.pt(st.lon, st.lat)
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${col[timeOf(st)]}" stroke="${c.pal.paper}" stroke-width="0.8"/>`
      })
      .join('')
    const share = (list: Pt[]) => {
      const n = { day: 0, allday: 0, night: 0 }
      for (const st of list) n[timeOf(st)]++
      return { n, total: list.length }
    }
    const all = share(ss)
    const nearList = ss.filter((st) => near100(c, st))
    const near = share(nearList)
    const nightNames = [...new Set(nearList.filter((st) => timeOf(st) === 'night').map((st) => mclsLabel(st.label ?? '')))].filter(Boolean)
    return {
      layers: [{ id: '바탕_건물', svg: base ? `<path d="${base}" fill="${c.pal.base}"/>` : '' }, { id: '시간_성격', svg: fills }, { id: '건물_밖_상가', svg: dots }],
      legend: [
        { color: col.day, label: STORE_TIME_LABEL.day },
        { color: col.allday, label: STORE_TIME_LABEL.allday },
        { color: col.night, label: STORE_TIME_LABEL.night },
        { color: col.mixed, label: '섞임 (절반 넘는 쪽 없음)' },
      ],
      legendTitle: '건물마다 상가 업종의 시간 성격 (절반 넘는 쪽)',
      summary: [
        `반경 안 상가 ${fmt(all.total)}곳: 낮 ${pctText(all.n.day / all.total)} · 종일 ${pctText(all.n.allday / all.total)} · 밤 ${pctText(all.n.night / all.total)}`,
        near.total
          ? `대지 경계 ${NEAR_M}m 안 ${fmt(near.total)}곳: 낮 ${pctText(near.n.day / near.total)} · 종일 ${pctText(near.n.allday / near.total)} · 밤 ${pctText(near.n.night / near.total)}${nightNames.length ? ` (밤 업종: ${nightNames.slice(0, 3).join(', ')})` : ''}`
          : `대지 경계 ${NEAR_M}m 안 상가 없음`,
        `밤 업종 위주 건물 ${fmt(bldCount.night)}동, 종일 ${fmt(bldCount.allday)}동, 낮 ${fmt(bldCount.day)}동, 섞임 ${fmt(bldCount.mixed)}동`,
      ],
      caption: `소상공인시장진흥공단 상가(상권)정보 업종(대·중·소분류)으로 나눔 — 실제 영업시간이 아니라 업종으로 어림한 것 · 상가를 좌표가 든(또는 8m 안) 건물에 담음 · ${c.date} 수집`,
    }
  },
}

// ───────────────────────── 대지 주변 vs 동네 ─────────────────────────

const storesComparePanel: PanelDef = {
  id: 'storesCompare',
  title: '대지 주변 vs 동네 업종',
  group: '사회·경제',
  needs: "공간정보에서 '상가 업종 구성'을 수집하세요.",
  render: (c): PanelOutput => {
    const ss = c.d.stores
    if (!ss.length) return { layers: [], legend: [], summary: [], caption: '', empty: '상가업소 자료가 없습니다', noFrame: true, hideBase: true }
    // 비슷한 중분류는 12묶음으로 (한식·일식·서양식 → 음식점 등)
    const keyOf = (st: Pt) => storeGroup(st.kind ?? '', st.label ?? '')
    const allC = new Map<string, number>()
    const nearC = new Map<string, number>()
    /** 묶음 안 대지 주변 중분류 구성 (요약에) */
    const nearSub = new Map<string, Map<string, number>>()
    let nearN = 0
    for (const st of ss) {
      const k = keyOf(st)
      allC.set(k, (allC.get(k) ?? 0) + 1)
      if (near100(c, st)) {
        nearN++
        nearC.set(k, (nearC.get(k) ?? 0) + 1)
        const sub = nearSub.get(k) ?? new Map<string, number>()
        const sk = mclsLabel(st.label || '분류 없음')
        sub.set(sk, (sub.get(sk) ?? 0) + 1)
        nearSub.set(k, sub)
      }
    }
    const allN = ss.length
    const lq = (k: string) => (nearN && allC.get(k) ? (nearC.get(k) ?? 0) / nearN / ((allC.get(k) as number) / allN) : 0)
    const subText = (k: string) =>
      [...(nearSub.get(k) ?? new Map<string, number>()).entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([s, n]) => `${s} ${n}`)
        .join('·')
    const rows = [...new Set([...allC.keys(), ...nearC.keys()])].slice(0, 13)
    rows.sort((a, b) => ((nearC.get(b) ?? 0) / Math.max(1, nearN) + (allC.get(b) ?? 0) / allN) - ((nearC.get(a) ?? 0) / Math.max(1, nearN) + (allC.get(a) ?? 0) / allN))
    const maxShare = Math.max(...rows.map((k) => Math.max((allC.get(k) ?? 0) / allN, nearN ? (nearC.get(k) ?? 0) / nearN : 0)), 0.01)
    const nearColor = c.pal.kind === 'mono' ? c.pal.ink : c.pal.accent
    const allColor = mix(c.pal.paper, c.pal.ink, 0.35)
    const X0 = 300
    const X1 = 800
    const top = 110
    const rowH = Math.min(62, Math.floor(760 / Math.max(1, rows.length)))
    const bx = (v: number) => X0 + (v / maxShare) * (X1 - X0)
    let svg = `<text x="${X0}" y="${top - 30}" font-size="15" fill="${c.pal.subtle}">업종이 차지하는 비율</text>`
    svg += `<line x1="${X0}" y1="${top - 12}" x2="${X0}" y2="${top + rows.length * rowH}" stroke="${c.pal.subtle}" stroke-width="1"/>`
    rows.forEach((k, i) => {
      const y = top + i * rowH
      const a = (allC.get(k) ?? 0) / allN
      const nShare = nearN ? (nearC.get(k) ?? 0) / nearN : 0
      const q = lq(k)
      const tag = nearN >= 5 && (nearC.get(k) ?? 0) >= 3 && q >= 1.5 ? `×${fmt(q, 1)} 많음` : nearN >= 5 && !(nearC.get(k) ?? 0) && a >= 0.03 ? '대지 주변엔 없음' : ''
      svg += `<text x="${X0 - 14}" y="${(y + rowH * 0.48).toFixed(1)}" font-size="16" font-weight="${tag ? 700 : 500}" text-anchor="end" fill="${c.pal.ink}">${esc(k)}</text>`
      svg += `<rect x="${X0}" y="${(y + 6).toFixed(1)}" width="${(bx(nShare) - X0).toFixed(1)}" height="${(rowH * 0.32).toFixed(1)}" fill="${nearColor}"/>`
      svg += `<rect x="${X0}" y="${(y + 6 + rowH * 0.36).toFixed(1)}" width="${(bx(a) - X0).toFixed(1)}" height="${(rowH * 0.32).toFixed(1)}" fill="${allColor}"/>`
      svg += `<text x="${(Math.max(bx(nShare), bx(a)) + 8).toFixed(1)}" y="${(y + rowH * 0.48).toFixed(1)}" font-size="13" fill="${c.pal.subtle}">${pctText(nShare)} / ${pctText(a)}${tag ? `  <tspan font-weight="700" fill="${nearColor}">${tag}</tspan>` : ''}</text>`
    })
    const more = rows.filter((k) => nearN >= 5 && (nearC.get(k) ?? 0) >= 3 && lq(k) >= 1.5).map((k) => `${k}(×${fmt(lq(k), 1)}${subText(k) ? `: ${subText(k)}` : ''})`)
    const none = rows.filter((k) => nearN >= 5 && !(nearC.get(k) ?? 0) && (allC.get(k) ?? 0) / allN >= 0.03)
    return {
      layers: [{ id: '비교', svg }],
      legend: [
        { color: nearColor, label: `대지 경계 ${NEAR_M}m 안 (${fmt(nearN)}곳)` },
        { color: allColor, label: `반경 ${fmt(c.d.R)}m 전체 (${fmt(allN)}곳)` },
      ],
      legendTitle: '업종 묶음별 비율 (비슷한 중분류를 12묶음으로) — ×는 동네 대비 대지 주변에 몇 배 많은지',
      summary: [
        more.length ? `대지 주변에 동네보다 많은 업종: ${more.slice(0, 4).join(', ')}` : '대지 주변에 동네보다 눈에 띄게 많은 업종 없음',
        none.length ? `동네엔 흔하지만 대지 주변엔 없는 업종: ${none.slice(0, 4).join(', ')}` : '',
        nearN < 10 ? `대지 주변 상가가 ${nearN}곳뿐이라 비율이 크게 흔들릴 수 있음` : '',
      ].filter(Boolean),
      caption: `소상공인시장진흥공단 상가(상권)정보 중분류를 묶음: ${STORE_GROUP_NOTE} · 대지 경계에서 ${NEAR_M}m 안 vs 수집 반경 전체 · 비율은 상가 수 기준(면적·매출 아님) · ${c.date} 수집`,
      noFrame: true,
      hideBase: true,
    }
  },
}

// ───────────────────────── 생활 시설 ─────────────────────────

const LIFE_CODES = ['SW8', 'PK6', 'SC4', 'PS3', 'AC5', 'HP8', 'PM9', 'MT1', 'CS2', 'CT1', 'AT4', 'PO3']

/** 대지에서 걸어서 몇 분 — 길의 연결을 받았으면 길 따라, 아니면 직선 × 1.3 */
function walkMin(c: PanelCtx, p: Pt): { min: number; byNet: boolean } {
  const v = netView(c.d)
  const w = v ? walkshed(c.d) : null
  if (v && w) {
    const m = walkToPoint(v, w, toXY(projOf(c.d), [p.lon, p.lat]))
    if (m !== null && Number.isFinite(m)) return { min: m / WALK_SPEED, byNet: true }
  }
  return { min: (pointToAreaDistanceM([p.lon, p.lat], c.d.boundary) * 1.3) / WALK_SPEED, byNet: false }
}

interface PoiWalk {
  p: Pt
  min: number
  byNet: boolean
}

const poiMemo = new WeakMap<DiagramData, PoiWalk[]>()
function poiWalks(c: PanelCtx): PoiWalk[] {
  let l = poiMemo.get(c.d)
  if (!l) {
    l = c.d.pois.filter((p) => LIFE_CODES.includes(p.kind)).map((p) => ({ p, ...walkMin(c, p) }))
    poiMemo.set(c.d, l)
  }
  return l
}

function nearestBy(list: PoiWalk[]): Map<string, PoiWalk> {
  const m = new Map<string, PoiWalk>()
  for (const x of list) {
    const cur = m.get(x.p.kind)
    if (!cur || x.min < cur.min) m.set(x.p.kind, x)
  }
  return m
}

const minText = (m: number) => (m < 1 ? '1분 안' : `${Math.round(m)}분`)

const poiMapPanel: PanelDef = {
  id: 'poi',
  title: '생활 시설 (걸어서 가장 가까운 곳)',
  group: '사회·경제',
  needs: "공간정보에서 '주변 생활 시설'을 수집하세요.",
  render: (c): PanelOutput => {
    const list = poiWalks(c)
    if (!list.length) return { layers: [], legend: [], summary: [], caption: '', empty: '생활 시설 자료가 없습니다' }
    const groups = poiGroups(c.pal)
    const near = nearestBy(list)
    const nearSet = new Set([...near.values()].map((x) => x.p))
    const base = c.d.buildings.map((b) => c.f.path(b.geom, false)).join('')
    const roads = c.d.roads.map((r) => c.f.path(r.geom)).join('')
    let lines = ''
    let labels = ''
    const edge = MAP_R - 14
    const boxes: { x0: number; x1: number; y0: number; y1: number }[] = []
    const place = (x: number, y: number, w: number, anchor: 'start' | 'end'): number => {
      const x0 = anchor === 'start' ? x : x - w
      const x1 = anchor === 'start' ? x + w : x
      for (const dy of [0, 18, -18, 36, -36, 54, -54]) {
        const y0 = y + dy - 14
        const y1 = y + dy + 4
        if (!boxes.some((b) => b.x0 < x1 && x0 < b.x1 && b.y0 < y1 && y0 < b.y1)) {
          boxes.push({ x0, x1, y0, y1 })
          return y + dy
        }
      }
      boxes.push({ x0, x1, y0: y - 14, y1: y + 4 })
      return y
    }
    for (const x of near.values()) {
      const g = groupOf(groups, x.p.kind)
      if (!g) continue
      let [px, py] = c.f.pt(x.p.lon, x.p.lat)
      const dx = px - MAP_CX
      const dy = py - MAP_CY
      const r = Math.hypot(dx, dy)
      const out = c.f.shape === 'circle' ? r > edge : Math.max(Math.abs(dx), Math.abs(dy)) > edge
      if (out) {
        const k = edge / (c.f.shape === 'circle' ? r : Math.max(Math.abs(dx), Math.abs(dy)))
        px = MAP_CX + dx * k
        py = MAP_CY + dy * k
      }
      lines += `<path d="M${MAP_CX} ${MAP_CY}L${px.toFixed(1)} ${py.toFixed(1)}" stroke="${g.color}" stroke-width="2" stroke-dasharray="5 4" fill="none"/>`
      const lx = px + (px >= MAP_CX ? 14 : -14)
      const anchor = px >= MAP_CX ? 'start' : 'end'
      const text = `${x.p.label ?? x.p.kind} ${minText(x.min)}${out ? ' (도판 밖)' : ''}`
      const ly = place(lx, py + 5, text.length * 13, anchor)
      labels += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="14" font-weight="700" text-anchor="${anchor}" fill="${g.color}" stroke="${c.pal.paper}" stroke-width="4" paint-order="stroke">${esc(text)}</text>`
      if (out) labels += iconSvg(x.p.kind, px, py, 11, g.color)
    }
    let icons = ''
    for (const x of list) {
      if (nearSet.has(x.p) || !c.f.inside(x.p.lon, x.p.lat)) continue
      const g = groupOf(groups, x.p.kind)
      if (!g) continue
      const [px, py] = c.f.pt(x.p.lon, x.p.lat)
      icons += iconSvg(x.p.kind, px, py, 7.5, mix(c.pal.paper, g.color, 0.75))
    }
    for (const x of near.values()) {
      if (!c.f.inside(x.p.lon, x.p.lat)) continue
      const g = groupOf(groups, x.p.kind)
      if (!g) continue
      const [px, py] = c.f.pt(x.p.lon, x.p.lat)
      icons += iconSvg(x.p.kind, px, py, 11, g.color)
    }
    const byNet = list.some((x) => x.byNet)
    const groupMins = groups
      .map((g) => {
        const xs = [...near.values()].filter((x) => g.codes.includes(x.p.kind)).sort((a, b) => a.min - b.min)
        return xs.length ? `${g.label}: ${xs.map((x) => `${x.p.label} ${minText(x.min)}`).join(', ')}` : ''
      })
      .filter(Boolean)
    const legend: LegendItem[] = groups.map((g) => ({ color: g.color, label: `${g.label} (${g.codes.map((k) => list.find((x) => x.p.kind === k)?.p.label ?? '').filter(Boolean).join('·') || '자료 없음'})`, shape: 'dot' as const }))
    return {
      layers: [
        { id: '바탕_건물', svg: base ? `<path d="${base}" fill="${mix(c.pal.paper, c.pal.base, 0.6)}"/>` : '' },
        { id: '바탕_도로', svg: roads ? `<path d="${roads}" fill="none" stroke="${mix(c.pal.paper, c.pal.ink, 0.15)}" stroke-width="1"/>` : '' },
        { id: '가장_가까운_곳_선', svg: lines },
        { id: '생활_시설', svg: icons },
        { id: '걸어서_몇_분', svg: labels, noClip: true },
      ],
      legend,
      legendTitle: `분류마다 가장 가까운 곳 = 진한 아이콘·점선 (걸어서 분당 ${WALK_SPEED}m)`,
      summary: groupMins.slice(0, 6),
      caption: `카카오 로컬 카테고리 검색(분류마다 가까운 15곳까지) · 걷는 시간: ${byNet ? '길의 연결(도로중심선)을 따라 잰 거리' : "직선거리 × 1.3으로 어림 ('길의 연결'을 수집하면 길 따라)"} · 음식점·카페는 상가 업종 도판에서 · ${c.date} 수집`,
    }
  },
}

const BANDS = [5, 10, 15]

const poiReachPanel: PanelDef = {
  id: 'poiReach',
  title: '생활권 (걸어서 5·10·15분 안)',
  group: '사회·경제',
  needs: "공간정보에서 '주변 생활 시설'을 수집하세요.",
  render: (c): PanelOutput => {
    const list = poiWalks(c)
    if (!list.length) return { layers: [], legend: [], summary: [], caption: '', empty: '생활 시설 자료가 없습니다', noFrame: true, hideBase: true }
    const groups = poiGroups(c.pal)
    const near = nearestBy(list)
    const rows = groups.flatMap((g) => g.codes.map((code) => ({ g, code, label: list.find((x) => x.p.kind === code)?.p.label ?? '' }))).filter((r) => r.label)
    const top = 120
    const rowH = Math.min(62, Math.floor(780 / Math.max(1, rows.length)))
    const COLS = [300, 465, 630]
    const NEAREST_X = 945
    let svg = ''
    BANDS.forEach((b, i) => {
      svg += `<text x="${COLS[i]}" y="${top - 40}" font-size="17" font-weight="700" fill="${c.pal.ink}">${b}분 안</text><text x="${COLS[i]}" y="${top - 20}" font-size="13" fill="${c.pal.subtle}">${fmt(b * WALK_SPEED)}m</text>`
    })
    svg += `<text x="${NEAREST_X}" y="${top - 40}" font-size="17" font-weight="700" text-anchor="end" fill="${c.pal.ink}">가장 가까운 곳</text>`
    let prevGroup = ''
    rows.forEach((r, i) => {
      const y = top + i * rowH
      const cy = y + rowH / 2
      if (r.g.id !== prevGroup) {
        svg += `<line x1="50" y1="${y}" x2="950" y2="${y}" stroke="${mix(c.pal.paper, c.pal.ink, 0.15)}" stroke-width="1"/>`
        svg += `<text x="56" y="${(y + 18).toFixed(1)}" font-size="12" font-weight="700" fill="${r.g.color}">${esc(r.g.label)}</text>`
        prevGroup = r.g.id
      }
      svg += iconSvg(r.code, 120, cy, 12, r.g.color)
      svg += `<text x="142" y="${(cy + 6).toFixed(1)}" font-size="17" fill="${c.pal.ink}">${esc(r.label)}</text>`
      const mins = list.filter((x) => x.p.kind === r.code).map((x) => x.min)
      BANDS.forEach((b, bi) => {
        const n = mins.filter((m) => m <= b).length
        const x0 = COLS[bi]
        if (!n) {
          svg += `<text x="${x0}" y="${(cy + 6).toFixed(1)}" font-size="16" fill="${c.pal.subtle}">–</text>`
          return
        }
        const show = Math.min(n, 7)
        for (let k = 0; k < show; k++) svg += `<circle cx="${(x0 + 7 + k * 17).toFixed(1)}" cy="${cy.toFixed(1)}" r="6.5" fill="${r.g.color}"/>`
        if (n > show || n >= 15) svg += `<text x="${(x0 + 7 + show * 17 + 2).toFixed(1)}" y="${(cy + 5).toFixed(1)}" font-size="14" font-weight="700" fill="${r.g.color}">${n >= 15 ? `${n}+` : `+${n - show}`}</text>`
      })
      const nn = near.get(r.code)
      svg += `<text x="${NEAREST_X}" y="${(cy + 6).toFixed(1)}" font-size="17" font-weight="700" text-anchor="end" fill="${nn && nn.min <= 15 ? c.pal.ink : c.pal.subtle}">${nn ? minText(nn.min) : '–'}</text>`
    })
    svg += `<line x1="50" y1="${top + rows.length * rowH}" x2="950" y2="${top + rows.length * rowH}" stroke="${mix(c.pal.paper, c.pal.ink, 0.15)}" stroke-width="1"/>`
    const in10 = rows.filter((r) => (near.get(r.code)?.min ?? Infinity) <= 10).map((r) => r.label)
    const far = rows.filter((r) => (near.get(r.code)?.min ?? Infinity) > 15).map((r) => r.label)
    const byNet = list.some((x) => x.byNet)
    return {
      layers: [{ id: '생활권', svg }],
      legend: groups.map((g) => ({ color: g.color, label: g.label, shape: 'dot' as const })),
      legendTitle: '점 하나 = 시설 한 곳 (7곳 넘으면 +수)',
      summary: [in10.length ? `걸어서 10분 안: ${in10.join(', ')}` : '걸어서 10분 안에 있는 생활 시설 없음', far.length ? `15분 넘게 걸리는 것: ${far.join(', ')}` : ''].filter(Boolean),
      caption: `카카오 로컬(분류마다 가까운 15곳까지만 받아 15곳 이상은 '15+') · 걷는 시간: ${byNet ? '길의 연결(도로중심선)을 따라 잰 거리' : '직선거리 × 1.3으로 어림'} · 분당 ${WALK_SPEED}m · ${c.date} 수집`,
      noFrame: true,
      hideBase: true,
    }
  },
}

export const LIFE_PANELS: PanelDef[] = [storesTimePanel, storesComparePanel, poiMapPanel, poiReachPanel]

