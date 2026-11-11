// Phase 10 도판: 일조시간(대지 주변·반경 전체), 개방감 지도, 대지 하늘 그림, 높이별 가시권, 수목, 바람 흐름 실험(여름·겨울), 여름 열쾌적 실험.
// 칸 자료는 env:result(압축)에서 풀어 캔버스로 칠한 뒤 그림으로 넣는다.

import { contours } from 'd3-contour'
import { rasterize, unpackGrid, type GridSpec, type UnpackedGrid } from '../lib/env/grid'
import type { XY } from '../lib/network'
import { sunAt, SUN_DAYS } from '../lib/sun'
import { FLOOR_M, windName, windRadius, type EnvResult } from '../sources/env'
import type { LegendItem, PanelLayer, PanelOutput } from './compose'
import { MAP_CX, MAP_CY, MAP_R } from './frame'
import { HEIGHT_SHORT, type DiagramData } from './data'
import { siteRingsXY } from './move'
import { mix, shades, steps } from './palette'
import type { PanelCtx, PanelDef } from './panels'

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })
const pctText = (x: number) => `${Math.round(x * 100)}%`
const DIR8 = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
const dir8 = (b: number) => DIR8[Math.round(b / 45) % 8]
const NEED = "공간정보에서 '환경 계산'을 수집하세요 ('주변 건물' 필요)."
const CALC = '계산값·참고용'

function median(v: number[]): number {
  if (!v.length) return NaN
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** 칸 값을 도판 크기 그림으로. toGrid로 좌표를 바꿀 수 있다 (바람 실험의 돌린 격자) */
function gridImage(c: PanelCtx, g: UnpackedGrid, color: (v: number) => string | null, toGrid?: (x: number, y: number) => XY): string {
  const S = MAP_R * 2
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(S, S)
  const cache = new Map<string, [number, number, number]>()
  const s = c.f.s
  for (let py = 0; py < S; py++) {
    const yM = (MAP_CY - (py + MAP_CY - MAP_R + 0.5)) / s
    for (let px = 0; px < S; px++) {
      const xM = (px + MAP_CX - MAP_R + 0.5 - MAP_CX) / s
      const [gx, gy] = toGrid ? toGrid(xM, yM) : [xM, yM]
      const col = Math.floor((gx - g.x0) / g.cell)
      const row = Math.floor((g.y0 - gy) / g.cell)
      if (col < 0 || row < 0 || col >= g.nx || row >= g.ny) continue
      const v = g.at(row * g.nx + col)
      if (!Number.isFinite(v)) continue
      const hex = color(v)
      if (!hex) continue
      let c3 = cache.get(hex)
      if (!c3) cache.set(hex, (c3 = rgb(hex)))
      const o = (py * S + px) * 4
      img.data[o] = c3[0]
      img.data[o + 1] = c3[1]
      img.data[o + 2] = c3[2]
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return `<image href="${canvas.toDataURL('image/png')}" x="${MAP_CX - MAP_R}" y="${MAP_CY - MAP_R}" width="${S}" height="${S}" preserveAspectRatio="none"/>`
}

/** 칸 값의 등치선 (d3-contour) → path */
function gridContour(c: PanelCtx, g: UnpackedGrid, level: number): string {
  const values = Array.from({ length: g.nx * g.ny }, (_, k) => (Number.isFinite(g.at(k)) ? g.at(k) : -1e9))
  const [mp] = contours().size([g.nx, g.ny]).thresholds([level])(values)
  if (!mp) return ''
  let d = ''
  for (const poly of mp.coordinates)
    for (const ring of poly) {
      ring.forEach(([gx, gy], i) => {
        const x = g.x0 + gx * g.cell
        const y = g.y0 - gy * g.cell
        d += `${i ? 'L' : 'M'}${(MAP_CX + x * c.f.s).toFixed(1)} ${(MAP_CY - y * c.f.s).toFixed(1)}`
      })
      d += 'Z'
    }
  return d
}

function buildingsLayer(c: PanelCtx, color = mix('#ffffff', c.pal.ink, 0.42)): PanelLayer {
  const d = c.d.buildings
    .filter((b) => !b.onSite && !b.underground)
    .map((b) => c.f.path(b.geom, false))
    .join('')
  return { id: '건물', svg: d ? `<path d="${d}" fill="${color}"/>` : '' }
}

function envOf(c: PanelCtx): EnvResult | null {
  return c.d.env && c.d.env.version === 1 ? c.d.env : null
}

/** 대지 주변 세밀 칸의 반 폭 (예전 결과는 200m) */
function fineHalfOf(d: DiagramData): number {
  const x0 = d.env?.fine?.winter?.x0
  return typeof x0 === 'number' && x0 < 0 ? -x0 : 200
}

function emptyOut(text: string): PanelOutput {
  return { layers: [], legend: [], summary: [], caption: '', empty: text }
}

/** 칸 중 대지 안 / 반경 안 */
function maskOf(c: PanelCtx, g: GridSpec, kind: 'site' | 'radius'): Uint8Array {
  const m = new Uint8Array(g.nx * g.ny)
  if (kind === 'site') rasterize(g, siteRingsXY(c.d), (k) => (m[k] = 1))
  else
    for (let r = 0; r < g.ny; r++)
      for (let col = 0; col < g.nx; col++) {
        const x = g.x0 + (col + 0.5) * g.cell
        const y = g.y0 - (r + 0.5) * g.cell
        if (Math.hypot(x, y) <= c.d.R) m[r * g.nx + col] = 1
      }
  return m
}

function envCaption(e: EnvResult, extra: string): string {
  const parts = [`건물: ${e.buildingSource ?? 'GIS건물통합정보'}(${HEIGHT_SHORT}${e.unknownHeights ? `, 층수 모름 ${fmt(e.unknownHeights)}동은 ${FLOOR_M}m로 봄` : ''}), 대지 안 기존 건물은 없다고 봄`]
  if (e.terrainSource) parts.push(`지형: ${e.terrainSource}`)
  parts.push(`${e.computedAt.slice(0, 10)} 계산 · ${CALC}`)
  return [extra, ...parts].filter(Boolean).join(' · ')
}

// ───────────────────────── 일조시간 ─────────────────────────

const SUN_BINS = [0, 1, 2, 3, 4, 6, 8, 10, 12]
const SUN_STOPS = ['#1f2a44', '#4a4f6e', '#7a6f80', '#b08d6e', '#d9a94f', '#f2cb3f', '#fbe38a']

function sunRamp(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / Math.max(1, n - 1)) * (SUN_STOPS.length - 1)
    const k = Math.min(Math.floor(t), SUN_STOPS.length - 2)
    return mix(SUN_STOPS[k], SUN_STOPS[k + 1], t - k)
  })
}

function sunPanel(scope: 'site' | 'wide'): PanelDef {
  return {
    id: scope === 'site' ? 'sunSite' : 'sunWide',
    title: scope === 'site' ? '일조시간 (대지 주변)' : '일조시간 (반경 전체)',
    group: '환경',
    needs: NEED,
    frameR: scope === 'site' ? fineHalfOf : undefined,
    render: (c): PanelOutput => {
      const e = envOf(c)
      if (!e) return emptyOut('환경 계산 결과가 없습니다')
      const day = SUN_DAYS.find((x) => x.key === c.st.sunDay) ?? SUN_DAYS[2]
      const set = scope === 'site' ? e.fine : e.coarse
      const g = unpackGrid(set[day.key])
      const bins = SUN_BINS.filter((b, i) => i === 0 || b < (day.key === 'winter' ? 10 : day.key === 'equinox' ? 12.5 : 15))
      // 해가 적을수록 어둡게, 많을수록 밝은 노랑
      const sunColors =
        c.pal.id === 'mono'
          ? shades('#111111', bins.length).reverse()
          : c.pal.id === 'cvd'
            ? [...steps(c.pal, bins.length)].reverse()
            : sunRamp(bins.length)
      const keyOf = (h: number) => bins.filter((b) => h >= b).length - 1
      const layers: PanelLayer[] = [{ id: '일조시간', svg: gridImage(c, g, (v) => sunColors[keyOf(v / 60)]) }, buildingsLayer(c)]
      const legend: LegendItem[] = bins.map((b, i) => ({ color: sunColors[i], label: i < bins.length - 1 ? `${b}~${bins[i + 1]}시간` : `${b}시간 이상` }))
      if (day.key === 'winter' && scope === 'site') {
        const cont = unpackGrid(set.cont)
        const total = unpackGrid(set.total)
        const c2 = gridContour(c, cont, 120)
        const t4 = gridContour(c, total, 240)
        layers.push({
          id: '참고선',
          svg:
            (t4 ? `<path d="${t4}" fill="none" stroke="#ffffff" stroke-width="3.2"/><path d="${t4}" fill="none" stroke="${c.pal.ink}" stroke-width="1.6" stroke-dasharray="6 4"/>` : '') +
            (c2 ? `<path d="${c2}" fill="none" stroke="#ffffff" stroke-width="3.6"/><path d="${c2}" fill="none" stroke="${c.pal.accent}" stroke-width="2"/>` : ''),
        })
        legend.push({ color: c.pal.accent, label: '안쪽: 09~15시 연속 2시간 이상', shape: 'line' }, { color: c.pal.ink, label: '안쪽: 08~16시 합계 4시간 이상', shape: 'line' })
      }
      // 대지 안 통계
      const site = maskOf(c, g, 'site')
      const inSite: number[] = []
      for (let k = 0; k < site.length; k++) if (site[k] && Number.isFinite(g.at(k))) inSite.push(g.at(k))
      const summary: string[] = []
      if (inSite.length) {
        summary.push(`${day.label} 대지 안 일조: 평균 ${fmt(inSite.reduce((a, b) => a + b, 0) / inSite.length / 60, 1)}시간 (가장 짧은 곳 ${fmt(Math.min(...inSite) / 60, 1)}시간, 가장 긴 곳 ${fmt(Math.max(...inSite) / 60, 1)}시간)`)
        if (day.key === 'winter') {
          const cont = unpackGrid(set.cont)
          const total = unpackGrid(set.total)
          let n2 = 0
          let n4 = 0
          let n = 0
          for (let k = 0; k < site.length; k++) {
            if (!site[k]) continue
            n++
            if (cont.at(k) >= 120) n2++
            if (total.at(k) >= 240) n4++
          }
          summary.push(`대지 안에서 동지 09~15시 연속 2시간 이상: ${pctText(n2 / n)}, 08~16시 합계 4시간 이상: ${pctText(n4 / n)} (판정용 아님)`)
        }
      }
      if (scope === 'wide') {
        const rad = maskOf(c, g, 'radius')
        let open = 0
        let dark = 0
        for (let k = 0; k < rad.length; k++) {
          if (!rad[k]) continue
          const v = g.at(k)
          if (!Number.isFinite(v)) continue
          open++
          if (v < 120) dark++
        }
        if (open) summary.push(`반경 안 땅(건물 지붕 포함) 중 ${day.label}에 해가 2시간도 안 드는 곳: ${pctText(dark / open)}`)
      }
      return {
        layers,
        legend,
        legendTitle: `${day.label} 하루 동안 해가 드는 시간 (10분 간격)`,
        summary,
        caption: envCaption(e, `${scope === 'site' ? '2m' : '4m'} 칸 · 건물 그림자 + 지형 그림자 · 날짜는 '그림자 날짜' 설정으로 바꿈 · 참고선은 판정용 아님`),
      }
    },
  }
}

// ───────────────────────── 개방감 ─────────────────────────

const skyDomePanel: PanelDef = {
  id: 'skyDome',
  title: '대지에서 올려다본 하늘',
  group: '환경',
  needs: NEED,
  render: (c): PanelOutput => {
    const e = envOf(c)
    if (!e) return emptyOut('환경 계산 결과가 없습니다')
    const Rd = MAP_R - 46
    const pt = (az: number, alt: number): XY => {
      const r = (Rd * (90 - Math.max(0, alt))) / 90
      const a = (az * Math.PI) / 180
      return [MAP_CX + r * Math.sin(a), MAP_CY - r * Math.cos(a)]
    }
    const skyColor = c.pal.id === 'mono' ? '#f2f2f2' : '#e4f0fb'
    const blockColor = mix('#ffffff', c.pal.ink, 0.55)
    // 가린 부분: 바깥 원(지평선 0°)과 가림선 사이
    let obstr = ''
    for (let a = 0; a < 360; a++) {
      const h0 = e.sky.horizon[a]
      const h1 = e.sky.horizon[(a + 1) % 360]
      if (h0 <= 0.2 && h1 <= 0.2) continue
      const p1 = pt(a, 0)
      const p2 = pt(a + 1, 0)
      const p3 = pt(a + 1, h1)
      const p4 = pt(a, h0)
      obstr += `M${p1[0].toFixed(1)} ${p1[1].toFixed(1)}L${p2[0].toFixed(1)} ${p2[1].toFixed(1)}L${p3[0].toFixed(1)} ${p3[1].toFixed(1)}L${p4[0].toFixed(1)} ${p4[1].toFixed(1)}Z`
    }
    let grid = ''
    for (const alt of [30, 60]) grid += `<circle cx="${MAP_CX}" cy="${MAP_CY}" r="${((Rd * (90 - alt)) / 90).toFixed(1)}" fill="none" stroke="${c.pal.subtle}" stroke-width="0.8" stroke-dasharray="3 5"/>`
    grid += `<text x="${MAP_CX + 4}" y="${(MAP_CY - (Rd * 60) / 90 - 4).toFixed(1)}" font-size="13" fill="${c.pal.subtle}">30°</text><text x="${MAP_CX + 4}" y="${(MAP_CY - (Rd * 30) / 90 - 4).toFixed(1)}" font-size="13" fill="${c.pal.subtle}">60°</text>`
    const pathColors = c.pal.id === 'mono' ? ['#222222', '#666666', '#999999'] : c.pal.id === 'cvd' ? ['#d55e00', '#e69f00', '#0072b2'] : ['#d6455d', '#e8a33b', '#3d7dca']
    let sun = ''
    SUN_DAYS.forEach((day, i) => {
      // sunPathFeatures는 지도용이라 각도만 다시 계산
      const pts: XY[] = []
      for (let m = 0; m < 24 * 60; m += 10) {
        const s = sunAtLocal(c, day.key, m / 60)
        if (s.altitude > 0) pts.push(pt(s.azimuth, s.altitude))
      }
      if (pts.length > 1) sun += `<path d="${pts.map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')}" fill="none" stroke="${pathColors[i]}" stroke-width="2.6"/>`
      for (let h = 6; h <= 18; h += 2) {
        const s = sunAtLocal(c, day.key, h)
        if (s.altitude <= 0) continue
        const [x, y] = pt(s.azimuth, s.altitude)
        sun += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${pathColors[i]}"/>`
        if (i === 1) sun += `<text x="${(x + 6).toFixed(1)}" y="${(y - 6).toFixed(1)}" font-size="13" fill="${c.pal.ink}" stroke="#ffffff" stroke-width="3" paint-order="stroke">${h}시</text>`
      }
    })
    const labels = ['북', '동', '남', '서']
      .map((t, i) => {
        const [x, y] = pt(i * 90, -12)
        return `<text x="${x.toFixed(1)}" y="${(y + 6).toFixed(1)}" font-size="18" font-weight="700" text-anchor="middle" fill="${c.pal.ink}">${t}</text>`
      })
      .join('')
    const maxA = e.sky.horizon.reduce((bi, v, i, arr) => (v > arr[bi] ? i : bi), 0)
    return {
      layers: [
        { id: '하늘', svg: `<circle cx="${MAP_CX}" cy="${MAP_CY}" r="${Rd}" fill="${skyColor}" stroke="${c.pal.subtle}" stroke-width="1"/>` },
        { id: '가린_부분', svg: obstr ? `<path d="${obstr}" fill="${blockColor}" stroke="${blockColor}" stroke-width="0.6"/>` : '' },
        { id: '눈금', svg: grid },
        { id: '태양_궤적', svg: sun },
        { id: '방위', svg: labels, noClip: true },
      ],
      legend: [
        { color: skyColor, label: '보이는 하늘' },
        { color: blockColor, label: '건물·지형이 가린 하늘' },
        ...SUN_DAYS.map((d, i) => ({ color: pathColors[i], label: `${d.label} 태양 궤적`, shape: 'line' as const })),
      ],
      legendTitle: '대지 가운데 눈높이(1.5m)에서 본 하늘 (가운데 = 바로 위, 점 = 2시간마다)',
      summary: [
        `하늘이 보이는 비율(개방감): ${pctText(e.sky.svf)}`,
        e.sky.horizon[maxA] > 1 ? `가장 높게 가린 곳: ${dir8(maxA)}쪽 ${fmt(e.sky.horizon[maxA])}°` : '주변이 거의 트여 있음',
      ],
      caption: envCaption(e, '1°마다 건물 도형·지형 지평선과 교차 · 원 둘레 = 지평선(0°)'),
      hideBase: true,
      noScale: true,
    }
  },
}

function sunAtLocal(c: PanelCtx, day: (typeof SUN_DAYS)[number]['key'], hour: number) {
  return sunAt(c.d.center[0], c.d.center[1], day, hour)
}

// ───────────────────────── 높이별 가시권 ─────────────────────────

const VIEW_HEIGHTS = [10, 20, 40, 80]

const viewPanel: PanelDef = {
  id: 'viewshed',
  title: '높이별 가시권',
  group: '주변 현황',
  needs: NEED,
  render: (c): PanelOutput => {
    const e = envOf(c)
    if (!e) return emptyOut('환경 계산 결과가 없습니다')
    const g = unpackGrid(e.coarse.view)
    const colors = c.pal.id === 'mono' ? shades('#111111', VIEW_HEIGHTS.length).reverse() : [...steps(c.pal, VIEW_HEIGHTS.length + 1)].reverse().slice(0, VIEW_HEIGHTS.length)
    const keyOf = (v: number) => VIEW_HEIGHTS.findIndex((h) => v <= h)
    const planH = Math.max(1, c.st.planFloors) * FLOOR_M
    const line = gridContour(c, g, planH)
    const rad = maskOf(c, g, 'radius')
    let n = 0
    const cnt = VIEW_HEIGHTS.map(() => 0)
    let nPlan = 0
    for (let k = 0; k < rad.length; k++) {
      if (!rad[k]) continue
      const v = g.at(k)
      if (!Number.isFinite(v)) continue
      n++
      VIEW_HEIGHTS.forEach((h, i) => v <= h && cnt[i]++)
      if (v <= planH) nPlan++
    }
    return {
      layers: [
        { id: '가시권', svg: gridImage(c, g, (v) => (keyOf(v) >= 0 ? colors[keyOf(v)] : null)) },
        buildingsLayer(c),
        { id: '계획_높이', svg: line ? `<path d="${line}" fill="none" stroke="${c.pal.accent}" stroke-width="1" stroke-opacity="0.85"/>` : '' },
      ],
      legend: [
        ...VIEW_HEIGHTS.map((h, i) => ({ color: colors[i], label: `${h}m(약 ${Math.round(h / FLOOR_M)}층)부터 보임` })),
        { color: c.pal.accent, label: `안쪽: 계획 ${c.st.planFloors}층(${planH}m)이면 보임`, shape: 'line' as const },
      ],
      legendTitle: '대지에 이 높이까지 지으면 그 꼭대기가 보이는 곳 (눈높이 1.5m)',
      summary: [
        ...VIEW_HEIGHTS.map((h, i) => `${h}m: 반경 안 건물 밖 땅의 ${pctText(n ? cnt[i] / n : 0)}에서 보임`).slice(0, 4),
        `계획 ${c.st.planFloors}층(${planH}m): ${pctText(n ? nPlan / n : 0)}에서 보임`,
      ],
      caption: envCaption(e, '4m 칸 · 각 칸에서 대지 가운데까지 건물·지형에 가리는지 계산 · 반경 밖에서 보이는 것은 빠짐 · 계획 층수는 도판 설정에서'),
    }
  },
}

function nearRings(x: number, y: number, rings: XY[][], d: number): boolean {
  for (const ring of rings)
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1]
      const [bx, by] = ring[i]
      const dx = bx - ax
      const dy = by - ay
      const L2 = dx * dx + dy * dy
      const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0
      if (Math.hypot(ax + dx * t - x, ay + dy * t - y) <= d) return true
    }
  return false
}

// ───────────────────────── 바람 흐름 (실험) ─────────────────────────

const WIND_BINS = [0, 0.3, 0.7, 1.1, 1.5]
const WIND_LABELS = ['0.3배 미만 (거의 멈춤)', '0.3~0.7배', '0.7~1.1배 (비슷)', '1.1~1.5배', '1.5배 이상 (빨라짐)']

/** 대지 중심에서 가장 먼 대지 꼭짓점까지(m) */
function siteFarOf(d: DiagramData): number {
  return Math.max(0, ...siteRingsXY(d).flat().map(([x, y]) => Math.hypot(x, y)))
}

/**
 * 바람 실험 도판 반경: 계산할 때 정한 반경(windR)을 쓰되, 대지가 잘리면 대지 끝 + 40m까지 넓힘 (계산한 격자가 덮는 데까지).
 * 예전 계산 결과(windR 없음 — 그땐 300m)도 대지가 다 보이게. (2026-11-12 사용자 보고: 유스퀘어가 300m 원에 잘림)
 */
export function windFrameR(d: DiagramData): number {
  const far = siteFarOf(d)
  const e = d.env
  if (!e) return windRadius(d.R, far)
  const grid = e.winds.find((w) => w.ratio)?.ratio
  const half = grid ? (grid.nx * grid.cell) / 2 : null
  let r = e.windR ?? Math.min(d.R, 300)
  if (r < far + 40) r = far + 40
  if (half) r = Math.min(r, half - 5)
  return Math.ceil(r / 10) * 10
}

/** 대지가 계산 범위를 넘어 잘리는지 */
function windClipsSite(d: DiagramData): boolean {
  return siteFarOf(d) > windFrameR(d) - 5
}

function windPanel(season: '여름' | '겨울'): PanelDef {
  return {
    id: season === '여름' ? 'windSummer' : 'windWinter',
    title: `바람 흐름 실험 (${season}, 보행 높이)`,
    group: '환경',
    needs: "공간정보에서 '환경 계산'과 '기후·바람'을 수집하세요.",
    // 계산한 범위 (대지 크기에 맞춤, 예전 결과도 대지가 잘리지 않게)
    frameR: (d) => windFrameR(d),
    render: (c): PanelOutput => {
      const e = envOf(c)
      if (!e) return emptyOut('환경 계산 결과가 없습니다')
      const w = e.winds.find((x) => x.season === season)
      if (!w) return emptyOut(`${season} 바람 자료가 없어 계산하지 못했습니다 ('기후·바람' 필요)`)
      if (!w.stable) return emptyOut('계산이 불안정해 결과를 내지 못했습니다')
      const g = unpackGrid(w.ratio)
      const colors = c.pal.id === 'mono' ? shades('#111111', 5) : c.pal.id === 'cvd' ? ['#2a788e', '#7fb3c8', '#e8e8e8', '#e6a54a', '#b35806'] : ['#3d6fb0', '#9cc0e3', '#efeee9', '#eea65a', '#c4442d']
      const keyOf = (v: number) => WIND_BINS.filter((b) => v >= b).length - 1
      const toGrid = (x: number, y: number): XY => [x * w.d[0] + y * w.d[1], x * w.l[0] + y * w.l[1]]
      // 바람 방향 화살표 (바람이 오는 쪽 가장자리에서 들어오게)
      const a = ((w.fromAz + 180) * Math.PI) / 180
      const ux = Math.sin(a)
      const uy = -Math.cos(a)
      let arrows = ''
      for (const off of [-200, 0, 200]) {
        const cx = MAP_CX - ux * (MAP_R - 70) + -uy * off
        const cy = MAP_CY - uy * (MAP_R - 70) + ux * off
        const x2 = cx + ux * 60
        const y2 = cy + uy * 60
        arrows += `<path d="M${cx.toFixed(1)} ${cy.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${c.pal.ink}" stroke-width="3"/><path d="M${(x2 + ux * 10).toFixed(1)} ${(y2 + uy * 10).toFixed(1)}L${(x2 - uy * 8).toFixed(1)} ${(y2 + ux * 8).toFixed(1)}L${(x2 + uy * 8).toFixed(1)} ${(y2 - ux * 8).toFixed(1)}Z" fill="${c.pal.ink}"/>`
      }
      // 대지 주변 30m 평균
      const site = siteRingsXY(c.d)
      const near: number[] = []
      let fast = 0
      let still = 0
      let n = 0
      for (let r = 0; r < g.ny; r++)
        for (let col = 0; col < g.nx; col++) {
          const v = g.at(r * g.nx + col)
          if (!Number.isFinite(v)) continue
          const s = g.x0 + (col + 0.5) * g.cell
          const t = g.y0 - (r + 0.5) * g.cell
          const x = s * w.d[0] + t * w.l[0]
          const y = s * w.d[1] + t * w.l[1]
          n++
          if (v >= 1.5) fast++
          if (v < 0.3) still++
          if (Math.abs(x) < 120 && Math.abs(y) < 120 && nearRings(x, y, site, 30)) near.push(v)
        }
      return {
        layers: [{ id: '바람_속도비', svg: gridImage(c, g, (v) => colors[keyOf(v)], toGrid) }, buildingsLayer(c, mix('#ffffff', c.pal.ink, 0.6)), { id: '바람_방향', svg: arrows }],
        legend: WIND_BINS.map((_, i) => ({ color: colors[i], label: WIND_LABELS[i] })),
        legendTitle: `보행 높이(지면 위 약 2m)에서 ${season}에 가장 잦은 ${windName(w.fromAz)}풍 대비 속도`,
        summary: [
          near.length ? `대지 주변 30m: 평균 ${fmt(near.reduce((x, y) => x + y, 0) / near.length, 2)}배` : '',
          `계산 영역 중 빨라지는 곳(1.5배 이상) ${pctText(n ? fast / n : 0)}, 거의 멈추는 곳(0.3배 미만) ${pctText(n ? still / n : 0)}`,
          windClipsSite(c.d) ? "대지가 계산한 범위보다 커서 일부가 잘림 — ④ 공간정보에서 '환경 계산'을 다시 하면 대지 크기에 맞춰 계산" : '',
          e.windR === undefined ? "예전에 계산한 결과 — ④ 공간정보에서 '환경 계산'을 다시 하면 대지 크기에 맞춘 범위로 계산" : '',
        ].filter(Boolean),
        caption: `실험 · 보행 높이(약 2m) 한 층의 평면 흐름, 2D 격자 볼츠만(D2Q9) · 도판보다 넓은 ${fmt(g.nx * g.cell)}m 정사각을 ${fmt(g.cell, 1)}m 칸으로 계산${(e.windR ?? 0) > c.d.R ? ` · 대지가 커서 수집 반경(${fmt(c.d.R)}m) 밖까지 그렸고, 그 바깥은 건물 자료가 없어 빈 땅으로 계산` : ""} · 높이 20m(약 7층) 이상 건물은 막고, 낮은 건물은 높이만큼 바람을 줄여 지나가게 함(지붕 위로 넘는 바람을 흉내) · 실제 풍속·돌풍 아님 · ${e.computedAt.slice(0, 10)} 계산`,
      }
    },
  }
}

// ───────────────────────── 여름 열쾌적 (실험) ─────────────────────────

const HEAT_STOPS = ['#fff3c4', '#fbd77a', '#f4a259', '#e8774a', '#d4504f', '#b02f4a', '#8c1f3d']

function heatRamp(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / Math.max(1, n - 1)) * (HEAT_STOPS.length - 1)
    const k = Math.min(Math.floor(t), HEAT_STOPS.length - 2)
    return mix(HEAT_STOPS[k], HEAT_STOPS[k + 1], t - k)
  })
}

/** UTCI 공식 단계 (더위 쪽) */
function heatCategory(v: number): string {
  if (v <= 26) return '스트레스 없음'
  if (v <= 32) return '보통'
  if (v <= 38) return '강함'
  if (v <= 46) return '매우 강함'
  return '극심'
}

const heatPanel: PanelDef = {
  id: 'heat',
  title: '여름 열쾌적 실험 (UTCI)',
  group: '환경',
  needs: "공간정보에서 '환경 계산'과 '기후·바람'을 수집하세요.",
  frameR: fineHalfOf,
  render: (c): PanelOutput => {
    const e = envOf(c)
    if (!e) return emptyOut('환경 계산 결과가 없습니다')
    const packed = e.fine.utci ?? e.coarse.utci
    if (!packed || !e.thermal) return emptyOut("여름 오후 기상 자료가 없어 계산하지 못했습니다 ('기후·바람'을 다시 수집)")
    const g = unpackGrid(packed)
    const all: number[] = []
    for (let k = 0; k < g.nx * g.ny; k++) {
      const v = g.at(k)
      if (Number.isFinite(v)) all.push(v)
    }
    if (!all.length) return emptyOut('계산된 값이 없습니다')
    all.sort((a, b) => a - b)
    const q = (p: number) => all[Math.min(all.length - 1, Math.floor(p * (all.length - 1)))]
    // 값에 맞춰 2℃ 간격 (많으면 넓힘)
    let step = 2
    let lo = Math.floor(q(0.01) / step) * step
    let hi = Math.ceil(q(0.99) / step) * step
    while ((hi - lo) / step > 9) {
      step += 1
      lo = Math.floor(q(0.01) / step) * step
      hi = Math.ceil(q(0.99) / step) * step
    }
    const n = Math.max(1, Math.round((hi - lo) / step))
    const colors = c.pal.id === 'mono' ? shades('#111111', n) : c.pal.id === 'cvd' ? steps(c.pal, n) : heatRamp(n)
    const keyOf = (v: number) => Math.max(0, Math.min(n - 1, Math.floor((v - lo) / step)))
    const site = siteRingsXY(c.d)
    const near: number[] = []
    let strong = 0
    for (let r = 0; r < g.ny; r++)
      for (let col = 0; col < g.nx; col++) {
        const v = g.at(r * g.nx + col)
        if (!Number.isFinite(v)) continue
        if (v > 38) strong++
        const x = g.x0 + (col + 0.5) * g.cell
        const y = g.y0 - (r + 0.5) * g.cell
        if (Math.abs(x) < 150 && Math.abs(y) < 150 && nearRings(x, y, site, 30)) near.push(v)
      }
    const t = e.thermal
    const legend: LegendItem[] = Array.from({ length: n }, (_, i) => {
      const a = lo + i * step
      const b = a + step
      const label = i === 0 ? `${b}℃ 이하` : i === n - 1 ? `${a}℃ 이상` : `${a}~${b}℃`
      return { color: colors[i], label: `${label} (${heatCategory(a + step / 2)})` }
    })
    return {
      layers: [{ id: '체감_더위', svg: gridImage(c, g, (v) => colors[keyOf(v)]) }, buildingsLayer(c, mix('#ffffff', c.pal.ink, 0.6))],
      legend,
      legendTitle: `체감 더위 UTCI · ${t.label} (기온 ${fmt(t.ta, 1)}℃, 습도 ${fmt(t.rh)}%, 관측 풍속 ${fmt(t.ws, 1)}m/s) · 괄호는 공식 단계`,
      summary: [
        near.length ? `대지 주변 30m: ${fmt(Math.min(...near), 1)}~${fmt(Math.max(...near), 1)}℃ (중앙 ${fmt(median(near), 1)}℃)` : '',
        `도판 안 건물 밖 땅 중 '매우 강함'(38℃ 초과) 이상: ${pctText(strong / all.length)}`,
        `조건: 최근 3년 7~8월 14~16시 중 더운 쪽 10% 날(${fmt(t.days)}일) 평균`,
      ].filter(Boolean),
      caption: `실험 · UTCI 다항식(jsthermalcomfort, MIT) · ${fmt(g.cell, 1)}m 칸 · 평균복사온도는 햇빛·그늘(건물·지형)·하늘 비율로 단순 어림, 바람은 관측 풍속 × 여름 바람 실험 속도비 · 나무 그늘·표면 재료는 반영 안 됨 · ${e.computedAt.slice(0, 10)} 계산`,
    }
  },
}

export const ENV_PANELS: PanelDef[] = [sunPanel('site'), sunPanel('wide'), skyDomePanel, viewPanel, windPanel('여름'), windPanel('겨울'), heatPanel]

export function envPanelIds(): string[] {
  return ENV_PANELS.map((p) => p.id)
}

