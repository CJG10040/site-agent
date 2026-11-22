// 14-E 평면/3D 전환 (2026-11-12 사용자 결정: 도판마다 '평면 · 3D', 보는 방향·기울기·높이 과장은 설정에서).
// 3D = 비스듬히 내려다본 평행 투영(축측). 새 라이브러리 없이 SVG로:
//  - 바닥: 평면 도판의 그림을 그대로 기울인 바닥 판에 붙임 (SVG 변환 행렬) + 판 두께
//  - 건물: 높이(실측 또는 층수 × 용도별 층고)만큼 세운 매스. 보는 쪽 벽만, 먼 건물부터 그림(가려지는 순서)
//  - 글자: 바닥에서 떼어 똑바로 세움 (기울면 읽기 어려워서)
//  - 도판마다 덧그림(태양 궤적 반구 등)
//  - 틀에 걸친 건물 (2026-11-21 사용자 결정): 모형을 톱으로 자른 것처럼 발자국을 틀 모양으로 잘라 틀 안쪽만 세우고,
//    잘린 경계의 벽은 더 진한 '잘린 면'으로. (예전엔 가운데 점이 틀 안이면 통째로 그려 긴 건물이 틀 밖으로 나갔음)

import { UNIT_TYPE, type TypeScale } from './typeScale'
import { featureCollection, intersect, polygon } from '@turf/turf'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import type { Areal } from '../lib/geo'
import type { DiagramSettings } from '../model/types'
import type { PanelLayer, PanelOutput } from './compose'
import { bldHeight, type Bld } from './data'
import { frameShapeSvg, MAP_CX, MAP_CY, MAP_R, type Frame } from './frame'

/** 틀 모양 (직사각은 shape 'square' + 반폭·반높이) */
type FrameBox = Pick<Frame, 'shape' | 'hx' | 'hy'>
import { luminance, mix, type Palette } from './palette'

export interface Cam3d {
  /** 보는 사람이 선 방위(°, 북 0 → 시계): 225 = 남서쪽에서 북동쪽을 봄 */
  az: number
  /** 내려다보는 각(°): 90 = 바로 위 */
  tilt: number
  /** 높이 과장 */
  vex: number
}

export const CAM_DEFAULT: Cam3d = { az: 225, tilt: 45, vex: 1 }

export function camOf(st: Pick<DiagramSettings, 'cam3d'>): Cam3d {
  return { ...CAM_DEFAULT, ...(st.cam3d ?? {}) }
}

export function is3d(st: Pick<DiagramSettings, 'view3d'>, id: string): boolean {
  return !!st.view3d?.includes(id)
}

const DIR8 = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
export const camDirLabel = (az: number) => DIR8[Math.round((((az % 360) + 360) % 360) / 45) % 8]

export interface Projector {
  /** 평면 도판 좌표(px) + 높이(m) → 화면 */
  P: (px: number, py: number, zM?: number) => [number, number]
  /** 보는 사람에게서 먼 정도 (클수록 멀다) */
  away: (px: number, py: number) => number
  /** 평면 → 화면 바닥 변환 행렬 (SVG matrix) */
  matrix: string
  cam: Cam3d
  /** 화면 위 바닥 판 가운데 */
  cy: number
  sinT: number
  cosT: number
  /** 보는 사람 쪽 방향 (동, 북) */
  toViewer: [number, number]
}

export function projector(cam: Cam3d, f: Frame): Projector {
  const A = (cam.az * Math.PI) / 180
  const T = (Math.max(15, Math.min(85, cam.tilt)) * Math.PI) / 180
  const sinA = Math.sin(A)
  const cosA = Math.cos(A)
  const sinT = Math.sin(T)
  const cosT = Math.cos(T)
  // 바닥 판을 조금 내려 높은 건물이 위로 솟을 자리를 둠
  const cy = MAP_CY + MAP_R * (1 - sinT) * 0.6
  // 사각 판을 비스듬히(모서리 쪽에서) 보면 화면 폭이 최대 √2배로 넓어져 도판 밖으로 잘리고 제목과 겹침 →
  // 판 전체가 원 틀과 같은 폭에 들어오게 줄임 (원·정면 방향은 그대로 1)
  // 직사각(패널 모드)은 돌린 판의 화면 반폭 |cos|·hx + |sin|·hy가 MAP_R 안에 들어오게
  const k = f.shape === 'square' ? (f.hx === f.hy ? 1 / (Math.abs(cosA) + Math.abs(sinA)) : MAP_R / (Math.abs(cosA) * f.hx + Math.abs(sinA) * f.hy)) : 1
  const zs = f.s * cam.vex * cosT * k
  const P = (px: number, py: number, zM = 0): [number, number] => {
    const X = (px - MAP_CX) * k
    const Y = (MAP_CY - py) * k
    return [MAP_CX - X * cosA + Y * sinA, cy + (X * sinA + Y * cosA) * sinT - zM * zs]
  }
  const a = -cosA * k
  const c = -sinA * k
  const e = MAP_CX + k * (MAP_CX * cosA + MAP_CY * sinA)
  const b = sinA * sinT * k
  const d = -cosA * sinT * k
  const ff = cy + k * sinT * (MAP_CY * cosA - MAP_CX * sinA)
  return {
    P,
    away: (px, py) => -((px - MAP_CX) * sinA + (MAP_CY - py) * cosA),
    matrix: `matrix(${[a, b, c, d, e, ff].map((v) => v.toFixed(5)).join(' ')})`,
    cam,
    cy,
    sinT,
    cosT,
    toViewer: [sinA, cosA],
  }
}

/** 바닥 그림에서 똑바로 세울 글자를 뽑아냄 (변환이 붙은 글자는 그대로 둠) */
function liftTexts(svg: string, pr: Projector): { ground: string; texts: string } {
  let texts = ''
  const ground = svg.replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/g, (m, attrs: string, body: string) => {
    if (/\btransform=/.test(attrs)) return m
    const xm = /\sx="([-\d.]+)"/.exec(attrs)
    const ym = /\sy="([-\d.]+)"/.exec(attrs)
    if (!xm || !ym) return m
    const [sx, sy] = pr.P(Number(xm[1]), Number(ym[1]))
    texts += `<text${attrs.replace(/\sx="[-\d.]+"/, ` x="${sx.toFixed(1)}"`).replace(/\sy="[-\d.]+"/, ` y="${sy.toFixed(1)}"`)}>${body}</text>`
    return ''
  })
  return { ground, texts }
}

function outerRings(g: Areal): number[][][] {
  return g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0])
}

// ───────────────────────── 틀 모양으로 자르기 (도판 픽셀 좌표) ─────────────────────────

type XY = [number, number]
const TAU = Math.PI * 2
/** 원 틀을 이 정다각형으로 봄 (원과의 차이 0.04px 미만) */
const CIRCLE_N = 256
const COS_HALF = Math.cos(Math.PI / CIRCLE_N)
/** 틀 경계 위로 볼 거리(px) */
const EDGE_EPS = 0.05

/** 틀 모양 고리 (닫힘) — 원은 정256각형, 꼭짓점 k의 각 = k·2π/N */
export function frameRing(f: FrameBox): XY[] {
  if (f.shape === 'square') {
    const l = MAP_CX - f.hx
    const r = MAP_CX + f.hx
    const t = MAP_CY - f.hy
    const b = MAP_CY + f.hy
    return [[l, t], [r, t], [r, b], [l, b], [l, t]]
  }
  const out: XY[] = []
  for (let k = 0; k <= CIRCLE_N; k++) {
    const a = ((k % CIRCLE_N) * TAU) / CIRCLE_N
    out.push([MAP_CX + MAP_R * Math.cos(a), MAP_CY + MAP_R * Math.sin(a)])
  }
  return out
}

function insideFrame(f: FrameBox, x: number, y: number): boolean {
  if (f.shape === 'square') return Math.abs(x - MAP_CX) <= f.hx && Math.abs(y - MAP_CY) <= f.hy
  return (x - MAP_CX) ** 2 + (y - MAP_CY) ** 2 <= (MAP_R * COS_HALF) ** 2
}

/** 원 틀(정다각형)의 변 위에 있는 점인지 */
function onCircleEdge(x: number, y: number): boolean {
  const ang = (((Math.atan2(y - MAP_CY, x - MAP_CX) % TAU) + TAU) % TAU)
  const k = Math.min(CIRCLE_N - 1, Math.floor(ang / (TAU / CIRCLE_N)))
  const al = ((k + 0.5) * TAU) / CIRCLE_N
  const d = (x - MAP_CX) * Math.cos(al) + (y - MAP_CY) * Math.sin(al)
  return Math.abs(d - MAP_R * COS_HALF) < EDGE_EPS
}

/** 변 a→b가 틀 경계를 따라가는지 (= 자른 자리) */
export function isCutEdge(f: FrameBox, a: XY, b: XY): boolean {
  if (f.shape === 'square') {
    const near = (v: number, w: number) => Math.abs(v - w) < EDGE_EPS
    for (const L of [MAP_CX - f.hx, MAP_CX + f.hx]) if (near(a[0], L) && near(b[0], L)) return true
    for (const L of [MAP_CY - f.hy, MAP_CY + f.hy]) if (near(a[1], L) && near(b[1], L)) return true
    return false
  }
  const rMin = MAP_R * COS_HALF - EDGE_EPS
  const r = (p: XY) => Math.hypot(p[0] - MAP_CX, p[1] - MAP_CY)
  if (r(a) < rMin || r(b) < rMin) return false
  return onCircleEdge((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
}

/**
 * 원 틀 대신 쓸 부채꼴: 가운데 + 건물이 걸친 각도 범위의 정다각형 꼭짓점만 (256각형 전체보다 수십 배 빠름).
 * 건물의 모든 점이 부채꼴 각도 안에 있으므로 자른 결과는 원 전체로 자른 것과 같음. 각도 폭이 반 바퀴를 넘으면 null
 */
function circleWedge(pts: XY[]): Feature<Polygon> | null {
  const step = TAU / CIRCLE_N
  const base = Math.atan2(pts[0][1] - MAP_CY, pts[0][0] - MAP_CX)
  let lo = 0
  let hi = 0
  for (const [x, y] of pts) {
    let a = Math.atan2(y - MAP_CY, x - MAP_CX) - base
    a = ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI
    if (a < lo) lo = a
    if (a > hi) hi = a
  }
  if (hi - lo > Math.PI * 0.9) return null
  // 정다각형 꼭짓점 번호로 (양쪽 한 칸씩 넉넉히)
  const k0 = Math.floor((base + lo) / step) - 1
  const k1 = Math.ceil((base + hi) / step) + 1
  const ring: XY[] = [[MAP_CX, MAP_CY]]
  for (let k = k0; k <= k1; k++) {
    const a = k * step
    ring.push([MAP_CX + MAP_R * Math.cos(a), MAP_CY + MAP_R * Math.sin(a)])
  }
  ring.push([MAP_CX, MAP_CY])
  return polygon([ring])
}

/**
 * 발자국(도판 픽셀, 닫지 않은 고리)을 틀 모양으로 자름 → 틀 안쪽 조각들(닫지 않은 고리).
 * 모두 안이면 그대로, 모두 밖이면 빈 목록. 자르기가 실패하면(꼬인 도형 등) 가운데 점 기준으로 예전처럼.
 */
export function clipToFrame(pts: XY[], f: FrameBox, frame: Feature<Polygon>): { pieces: XY[][]; cut: boolean } {
  if (pts.every(([x, y]) => insideFrame(f, x, y))) return { pieces: [pts], cut: false }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of pts) {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  if (x1 < MAP_CX - f.hx || x0 > MAP_CX + f.hx || y1 < MAP_CY - f.hy || y0 > MAP_CY + f.hy) return { pieces: [], cut: false }
  try {
    const g = intersect(featureCollection<Polygon | MultiPolygon>([polygon([[...pts, pts[0]]]), f.shape === 'circle' ? circleWedge(pts) ?? frame : frame]))
    if (!g) return { pieces: [], cut: false }
    const polys = g.geometry.type === 'Polygon' ? [g.geometry.coordinates] : g.geometry.coordinates
    const pieces = polys.map((p) => p[0].slice(0, -1).map(([x, y]) => [x, y] as XY)).filter((r) => r.length >= 3)
    return { pieces, cut: pieces.length > 0 }
  } catch {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
    return { pieces: insideFrame(f, cx, cy) ? [pts] : [], cut: false }
  }
}

export interface View3dOpts {
  /** 건물 매스 색 (없으면 회색 매스) */
  massColor?: (b: Bld) => string | null
  /** 3D에서 뺄 평면 레이어 (예: 태양 궤적 평면 그림) */
  drop?: RegExp
  /** 덧그림 (태양 궤적 반구 등) */
  extra?: (pr: Projector) => string
  /** 이 도판만 보는 방향을 바꿀 때 (바뀐 까닭을 캡션에) */
  cam?: (cam: Cam3d) => { cam: Cam3d; note: string } | null
  /**
   * 층층이 쌓인 덩어리 (2026-11-21 묶음 E6 건축 가능 영역): 단마다 바닥~위 높이(m)와 발자국 고리(대지 중심 원점 동·북 m,
   * 바깥 반시계·구멍 시계). 아래 단부터 벽 → 윗면 순으로 칠해 겹침이 맞음. note는 캡션에
   */
  stack?: { slabs: { bottom: number; top: number; rings: [number, number][][] }[]; note: string }
}

export function to3d(
  out: PanelOutput,
  ctx: { d: { buildings: Bld[]; scenario?: { name: string; mesh: { positions: number[]; indices: number[] }; baseZ: number } | null }; f: Frame; pal: Palette; st: DiagramSettings; ty?: TypeScale },
  site: string,
  clipId: string,
  opts: View3dOpts = {},
): PanelOutput {
  const { f, pal } = ctx
  const ty = ctx.ty ?? UNIT_TYPE
  const asked = camOf(ctx.st)
  const over = opts.cam?.(asked) ?? null
  const cam = over?.cam ?? asked
  const pr = projector(cam, f)
  const shape = frameShapeSvg(f)
  const fillShape = (fill: string, extra = '') => shape.replace('/>', ` fill="${fill}"${extra}/>`)

  // ── 바닥: 판 두께 + 판 + 평면 그림 + 대지 표시
  let texts = ''
  const groundLayers = out.layers
    .filter((l) => !(opts.drop && opts.drop.test(l.id)))
    .map((l) => {
      const r = liftTexts(l.svg, pr)
      texts += r.texts
      return `<g id="${l.id.replace(/\s+/g, '_')}">${r.ground}</g>`
    })
    .join('')
  const slab = `<g transform="translate(0 ${(12 * pr.cosT + 4).toFixed(1)}) ${pr.matrix}">${fillShape(mix(pal.paper, pal.ink, pal.dark ? 0.25 : 0.18))}</g>`
  const ground =
    `<defs><clipPath id="${clipId}-3d">${shape}</clipPath></defs>` +
    `<g transform="${pr.matrix}">${fillShape(pal.paper)}<g clip-path="url(#${clipId}-3d)">${groundLayers}${site}</g>${fillShape('none', ` stroke="${pal.ink}" stroke-opacity="0.4" stroke-width="1.2" vector-effect="non-scaling-stroke"`)}</g>`

  // ── 건물 매스
  const neutral = pal.dark ? mix(pal.base, pal.ink, 0.25) : mix(pal.paper, pal.base, 0.9)
  const inkDarker = luminance(pal.ink) < luminance(pal.paper)
  const darker = inkDarker ? pal.ink : pal.paper
  const lighter = inkDarker ? pal.paper : pal.ink
  const [vx, vy] = pr.toViewer
  // 빛: 보는 사람 왼쪽 위에서
  const la = ((cam.az - 70) * Math.PI) / 180
  const lx = Math.sin(la)
  const ly = Math.cos(la)
  const frame = polygon([frameRing(f)])
  let cutCount = 0
  type Mass = { away: number; svg: string }
  const masses: Mass[] = []
  const designMesh = ctx.d.scenario?.mesh ?? null
  for (const b of ctx.d.buildings) {
    if (b.underground || b.onSite) continue
    // 설계안은 2.5D 덩어리 대신 아래에서 실제 삼각형으로 (2026-11-21 묶음 C7)
    if (b.src === 'design' && designMesh) continue
    const color = opts.massColor ? opts.massColor(b) : null
    if (color === null && opts.massColor) continue
    const roof = color ?? neutral
    const h = bldHeight(b) ?? 3
    for (const ring of outerRings(b.geom)) {
      const px = ring.map(([lon, lat]) => f.pt(lon, lat))
      // 너무 촘촘한 점은 건너뜀
      const raw: XY[] = []
      for (const p of px) {
        const q = raw[raw.length - 1]
        if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= 1.2) raw.push(p)
      }
      if (raw.length > 2 && Math.hypot(raw[0][0] - raw[raw.length - 1][0], raw[0][1] - raw[raw.length - 1][1]) < 0.1) raw.pop()
      if (raw.length < 3) continue
      const clipped = clipToFrame(raw, f, frame)
      if (clipped.cut) cutCount++
      for (const pts of clipped.pieces) {
        const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
        const cyy = pts.reduce((s, p) => s + p[1], 0) / pts.length
        // 고리 방향 (위쪽 = 북 좌표계에서 반시계면 +)
        let area2 = 0
        for (let i = 0; i < pts.length; i++) {
          const [x1, y1] = pts[i]
          const [x2, y2] = pts[(i + 1) % pts.length]
          area2 += x1 * -y2 - x2 * -y1
        }
        const ccw = area2 > 0
        let lit = ''
        let dark = ''
        let cut = ''
        for (let i = 0; i < pts.length; i++) {
          const [x1, y1] = pts[i]
          const [x2, y2] = pts[(i + 1) % pts.length]
          const ex = x2 - x1
          const ey = -(y2 - y1)
          // 바깥쪽 법선 (동, 북)
          let nx = ccw ? ey : -ey
          let ny = ccw ? -ex : ex
          const nl = Math.hypot(nx, ny) || 1
          nx /= nl
          ny /= nl
          if (nx * vx + ny * vy <= 0) continue
          const a0 = pr.P(x1, y1)
          const a1 = pr.P(x2, y2)
          const b1 = pr.P(x2, y2, h)
          const b0 = pr.P(x1, y1, h)
          const q = `M${a0[0].toFixed(1)} ${a0[1].toFixed(1)}L${a1[0].toFixed(1)} ${a1[1].toFixed(1)}L${b1[0].toFixed(1)} ${b1[1].toFixed(1)}L${b0[0].toFixed(1)} ${b0[1].toFixed(1)}Z`
          if (clipped.cut && isCutEdge(f, pts[i], pts[(i + 1) % pts.length])) cut += q
          else if (nx * lx + ny * ly > 0) lit += q
          else dark += q
        }
        const top = pts.map((p, i) => {
          const [sx, sy] = pr.P(p[0], p[1], h)
          return `${i ? 'L' : 'M'}${sx.toFixed(1)} ${sy.toFixed(1)}`
        })
        // 벽 그늘: 더 어두운 쪽 색(밝은 바탕 = 글자색, 어두운 바탕 = 종이색)으로. 지붕이 아주 어두우면 밝은 쪽으로
        const veryDark = luminance(roof) < 0.08
        const toward = veryDark ? lighter : darker
        const edge = mix(roof, toward, 0.45)
        masses.push({
          away: pr.away(cx, cyy),
          svg:
            (lit ? `<path d="${lit}" fill="${mix(roof, toward, veryDark ? 0.22 : 0.12)}" stroke="${edge}" stroke-width="0.35" stroke-opacity="0.6"/>` : '') +
            (dark ? `<path d="${dark}" fill="${mix(roof, toward, veryDark ? 0.4 : 0.32)}" stroke="${edge}" stroke-width="0.35" stroke-opacity="0.6"/>` : '') +
            // 잘린 면: 단면처럼 가장 진하게
            (cut ? `<path d="${cut}" fill="${mix(roof, toward, veryDark ? 0.62 : 0.58)}" stroke="${edge}" stroke-width="0.35" stroke-opacity="0.8"/>` : '') +
            `<path d="${top.join('')}Z" fill="${roof}" stroke="${edge}" stroke-width="0.4" stroke-opacity="0.7"/>`,
        })
      }
    }
  }
  // ── 설계안: 올린 삼각형 그대로 (대지 강조색). 라이노 파일마다 면 방향이 제각각이라 보는 쪽으로 뒤집어 칠함
  if (designMesh && ctx.d.scenario) {
    const P = designMesh.positions
    const I = designMesh.indices
    const z0 = ctx.d.scenario.baseZ
    const accent = pal.accent
    const roofC = mix(pal.paper, accent, 0.5)
    const litC = mix(pal.paper, accent, 0.7)
    const darkC = mix(accent, darker, 0.25)
    const pt = (k: number): [number, number, number] => [MAP_CX + P[3 * k] * f.s, MAP_CY - P[3 * k + 1] * f.s, P[3 * k + 2] - z0]
    const T = (cam.tilt * Math.PI) / 180
    // 보는 사람 쪽 (동, 북, 위)
    const view: [number, number, number] = [vx * Math.cos(T), vy * Math.cos(T), Math.sin(T)]
    for (let t = 0; t < I.length; t += 3) {
      const a = pt(I[t])
      const b = pt(I[t + 1])
      const c = pt(I[t + 2])
      // 평면 좌표(px, 아래로 +)를 동·북·위(m)로 바꿔 법선
      const ax = (b[0] - a[0]) / f.s
      const ay = -(b[1] - a[1]) / f.s
      const az = b[2] - a[2]
      const bx = (c[0] - a[0]) / f.s
      const by = -(c[1] - a[1]) / f.s
      const bz = c[2] - a[2]
      let nx = ay * bz - az * by
      let ny = az * bx - ax * bz
      let nz = ax * by - ay * bx
      const nl = Math.hypot(nx, ny, nz)
      if (!(nl > 1e-9)) continue
      nx /= nl
      ny /= nl
      nz /= nl
      if (nx * view[0] + ny * view[1] + nz * view[2] < 0) {
        nx = -nx
        ny = -ny
        nz = -nz
      }
      const fill = nz > 0.7 ? roofC : nx * lx + ny * ly > 0 ? litC : darkC
      const s0 = pr.P(a[0], a[1], a[2])
      const s1 = pr.P(b[0], b[1], b[2])
      const s2 = pr.P(c[0], c[1], c[2])
      const cx = (a[0] + b[0] + c[0]) / 3
      const cy = (a[1] + b[1] + c[1]) / 3
      const cz = (a[2] + b[2] + c[2]) / 3
      masses.push({
        // 같은 자리면 높은 면을 나중에 (지붕이 벽을 덮게)
        away: pr.away(cx, cy) - cz * 0.001,
        svg: `<path d="M${s0[0].toFixed(1)} ${s0[1].toFixed(1)}L${s1[0].toFixed(1)} ${s1[1].toFixed(1)}L${s2[0].toFixed(1)} ${s2[1].toFixed(1)}Z" fill="${fill}" stroke="${fill}" stroke-width="0.4" stroke-linejoin="round"/>`,
      })
    }
  }
  // ── 층층 덩어리 (건축 가능 영역): 아래 단이 위 단을 가릴 수 없으므로(위에서 내려다봄) 아래 단부터, 단 안에서는 먼 벽 → 가까운 벽 → 윗면
  if (opts.stack && opts.stack.slabs.length) {
    const accent = pal.accent
    const roofC = mix(pal.paper, accent, 0.45)
    const litC = mix(pal.paper, accent, 0.72)
    const darkC = mix(accent, darker, 0.25)
    const lineC = mix(accent, darker, 0.45)
    const px = ([e, n]: [number, number]): [number, number] => [MAP_CX + e * f.s, MAP_CY - n * f.s]
    let svg = ''
    let sx = 0
    let sy = 0
    let sn = 0
    for (const s of opts.stack.slabs) {
      const walls: { away: number; d: string; lit: boolean }[] = []
      let topD = ''
      for (const ring of s.rings) {
        const pts = ring.map(px)
        for (let i = 0; i < pts.length; i++) {
          const [x1, y1] = pts[i]
          const [x2, y2] = pts[(i + 1) % pts.length]
          // 안쪽이 왼쪽 → 바깥 법선은 오른쪽 (동·북 좌표)
          const ex = x2 - x1
          const ey = -(y2 - y1)
          const nl = Math.hypot(ex, ey) || 1
          const nx = ey / nl
          const ny = -ex / nl
          if (nx * vx + ny * vy <= 0) continue
          const a0 = pr.P(x1, y1, s.bottom)
          const a1 = pr.P(x2, y2, s.bottom)
          const b1 = pr.P(x2, y2, s.top)
          const b0 = pr.P(x1, y1, s.top)
          walls.push({
            away: pr.away((x1 + x2) / 2, (y1 + y2) / 2),
            d: `M${a0[0].toFixed(1)} ${a0[1].toFixed(1)}L${a1[0].toFixed(1)} ${a1[1].toFixed(1)}L${b1[0].toFixed(1)} ${b1[1].toFixed(1)}L${b0[0].toFixed(1)} ${b0[1].toFixed(1)}Z`,
            lit: nx * lx + ny * ly > 0,
          })
        }
        topD += pts.map((p, i) => {
          const [qx, qy] = pr.P(p[0], p[1], s.top)
          return `${i ? 'L' : 'M'}${qx.toFixed(1)} ${qy.toFixed(1)}`
        }).join('') + 'Z'
        for (const p of pts) {
          sx += p[0]
          sy += p[1]
          sn++
        }
      }
      walls.sort((a, b) => b.away - a.away)
      svg += walls.map((w) => `<path d="${w.d}" fill="${w.lit ? litC : darkC}" stroke="${lineC}" stroke-width="0.35" stroke-opacity="0.5" stroke-linejoin="round"/>`).join('')
      svg += `<path d="${topD}" fill="${roofC}" fill-rule="evenodd" stroke="${lineC}" stroke-width="0.5" stroke-opacity="0.8" stroke-linejoin="round"/>`
    }
    // 주변 건물과는 덩어리 가운데 한 점으로 앞뒤를 가림
    masses.push({ away: sn ? pr.away(sx / sn, sy / sn) : 0, svg: `<g id="층층_덩어리">${svg}</g>` })
  }
  masses.sort((a, b) => b.away - a.away)

  // ── 방위표: 화면에서 북쪽이 향하는 쪽
  const o = pr.P(MAP_CX, MAP_CY)
  const n1 = pr.P(MAP_CX, MAP_CY - 100)
  const nxv = n1[0] - o[0]
  const nyv = n1[1] - o[1]
  const nlen = Math.hypot(nxv, nyv) || 1
  const ux = nxv / nlen
  const uy = nyv / nlen
  const ax = MAP_CX + MAP_R - 30
  const ay = 70
  const north = `<g id="방위표_3D"><path d="M${(ax + ux * 22).toFixed(1)} ${(ay + uy * 22).toFixed(1)}L${(ax - uy * 9 - ux * 12).toFixed(1)} ${(ay + ux * 9 - uy * 12).toFixed(1)}L${(ax - ux * 6).toFixed(1)} ${(ay - uy * 6).toFixed(1)}L${(ax + uy * 9 - ux * 12).toFixed(1)} ${(ay - ux * 9 - uy * 12).toFixed(1)}Z" fill="${pal.ink}"/><text x="${(ax + ux * 38).toFixed(1)}" y="${(ay + uy * 38 + 5 * ty.k('mark')).toFixed(1)}" font-size="${ty.v('mark', 15)}" font-weight="600" text-anchor="middle" fill="${pal.ink}">N</text></g>`

  const layers: PanelLayer[] = [
    { id: '3D_판_두께', svg: slab, noClip: true },
    { id: '3D_바닥', svg: ground, noClip: true },
    { id: '3D_건물', svg: masses.map((m) => m.svg).join(''), noClip: true },
    ...(opts.extra ? [{ id: '3D_덧그림', svg: opts.extra(pr), noClip: true }] : []),
    { id: '3D_글자', svg: texts, noClip: true },
    { id: '3D_방위', svg: north, noClip: true },
  ]
  return {
    ...out,
    layers,
    noFrame: true,
    hideBase: true,
    caption: `${out.caption ? `${out.caption} · ` : ''}${over ? `${over.note} · ` : ''}3D: ${camDirLabel(cam.az)}쪽에서 ${Math.round(cam.tilt)}° 내려다봄${cam.vex !== 1 ? `, 높이 ×${cam.vex}` : ''}${cutCount ? ' · 틀에 걸친 건물은 틀에서 잘라 냄(가장 진한 면이 잘린 면)' : ''}${designMesh ? ` · 대지 강조색 = 설계안 ${ctx.d.scenario?.name ?? ''}(올린 매스 그대로)` : ''}${opts.stack ? ` · ${opts.stack.note}` : ''} · 건물 높이는 실측 높이 또는 층수 × 용도별 층고(모르면 3m) · 바닥은 평평하게 그림(지형 높낮이는 반영 안 함) · 축척 막대 없음(깊이에 따라 다름)`,
  }
}
