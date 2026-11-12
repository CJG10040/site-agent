// 14-E 평면/3D 전환 (2026-11-12 사용자 결정: 도판마다 '평면 · 3D', 보는 방향·기울기·높이 과장은 설정에서).
// 3D = 비스듬히 내려다본 평행 투영(축측). 새 라이브러리 없이 SVG로:
//  - 바닥: 평면 도판의 그림을 그대로 기울인 바닥 판에 붙임 (SVG 변환 행렬) + 판 두께
//  - 건물: 높이(실측 또는 층수 × 용도별 층고)만큼 세운 매스. 보는 쪽 벽만, 먼 건물부터 그림(가려지는 순서)
//  - 글자: 바닥에서 떼어 똑바로 세움 (기울면 읽기 어려워서)
//  - 도판마다 덧그림(태양 궤적 반구 등)

import type { Areal } from '../lib/geo'
import type { DiagramSettings } from '../model/types'
import type { PanelLayer, PanelOutput } from './compose'
import { bldHeight, type Bld } from './data'
import { MAP_CX, MAP_CY, MAP_R, type Frame } from './frame'
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
  const zs = f.s * cam.vex * cosT
  const P = (px: number, py: number, zM = 0): [number, number] => {
    const X = px - MAP_CX
    const Y = MAP_CY - py
    return [MAP_CX - X * cosA + Y * sinA, cy + (X * sinA + Y * cosA) * sinT - zM * zs]
  }
  const a = -cosA
  const c = -sinA
  const e = MAP_CX + MAP_CX * cosA + MAP_CY * sinA
  const b = sinA * sinT
  const d = -cosA * sinT
  const ff = cy - MAP_CX * sinA * sinT + MAP_CY * cosA * sinT
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

export interface View3dOpts {
  /** 건물 매스 색 (없으면 회색 매스) */
  massColor?: (b: Bld) => string | null
  /** 3D에서 뺄 평면 레이어 (예: 태양 궤적 평면 그림) */
  drop?: RegExp
  /** 덧그림 (태양 궤적 반구 등) */
  extra?: (pr: Projector) => string
  /** 이 도판만 보는 방향을 바꿀 때 (바뀐 까닭을 캡션에) */
  cam?: (cam: Cam3d) => { cam: Cam3d; note: string } | null
}

export function to3d(
  out: PanelOutput,
  ctx: { d: { buildings: Bld[] }; f: Frame; pal: Palette; st: DiagramSettings },
  site: string,
  clipId: string,
  opts: View3dOpts = {},
): PanelOutput {
  const { f, pal } = ctx
  const asked = camOf(ctx.st)
  const over = opts.cam?.(asked) ?? null
  const cam = over?.cam ?? asked
  const pr = projector(cam, f)
  const shape =
    f.shape === 'circle' ? `<circle cx="${MAP_CX}" cy="${MAP_CY}" r="${MAP_R}"/>` : `<rect x="${MAP_CX - MAP_R}" y="${MAP_CY - MAP_R}" width="${MAP_R * 2}" height="${MAP_R * 2}"/>`
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
  const R2 = (MAP_R * 0.985) ** 2
  type Mass = { away: number; svg: string }
  const masses: Mass[] = []
  for (const b of ctx.d.buildings) {
    if (b.underground || b.onSite) continue
    const color = opts.massColor ? opts.massColor(b) : null
    if (color === null && opts.massColor) continue
    const roof = color ?? neutral
    const h = bldHeight(b) ?? 3
    for (const ring of outerRings(b.geom)) {
      const px = ring.map(([lon, lat]) => f.pt(lon, lat))
      // 너무 촘촘한 점은 건너뜀
      const pts: [number, number][] = []
      for (const p of px) {
        const q = pts[pts.length - 1]
        if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= 1.2) pts.push(p)
      }
      if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.1) pts.pop()
      if (pts.length < 3) continue
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
      const cyy = pts.reduce((s, p) => s + p[1], 0) / pts.length
      if ((cx - MAP_CX) ** 2 + (cyy - MAP_CY) ** 2 > R2) continue
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
        if (nx * lx + ny * ly > 0) lit += q
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
          `<path d="${top.join('')}Z" fill="${roof}" stroke="${edge}" stroke-width="0.4" stroke-opacity="0.7"/>`,
      })
    }
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
  const north = `<g id="방위표_3D"><path d="M${(ax + ux * 22).toFixed(1)} ${(ay + uy * 22).toFixed(1)}L${(ax - uy * 9 - ux * 12).toFixed(1)} ${(ay + ux * 9 - uy * 12).toFixed(1)}L${(ax - ux * 6).toFixed(1)} ${(ay - uy * 6).toFixed(1)}L${(ax + uy * 9 - ux * 12).toFixed(1)} ${(ay - ux * 9 - uy * 12).toFixed(1)}Z" fill="${pal.ink}"/><text x="${(ax + ux * 38).toFixed(1)}" y="${(ay + uy * 38 + 5).toFixed(1)}" font-size="15" font-weight="700" text-anchor="middle" fill="${pal.ink}">N</text></g>`

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
    caption: `${out.caption ? `${out.caption} · ` : ''}${over ? `${over.note} · ` : ''}3D: ${camDirLabel(cam.az)}쪽에서 ${Math.round(cam.tilt)}° 내려다봄${cam.vex !== 1 ? `, 높이 ×${cam.vex}` : ''} · 건물 높이는 실측 높이 또는 층수 × 용도별 층고(모르면 3m) · 바닥은 평평하게 그림(지형 높낮이는 반영 안 함) · 축척 막대 없음(깊이에 따라 다름)`,
  }
}
