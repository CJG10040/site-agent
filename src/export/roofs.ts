// 15-D 지붕 모양 (2026-11-12 인터뷰: 건축물대장 지붕 구조로 어림 — 기와·슬레이트 → 경사, 콘크리트 → 평지붕 + 파라펫; 대장이 없으면 규칙).
// 라이노 파일과 3D 미리보기가 같은 모양을 쓰게 삼각형(x, y, z × 3)으로 만든다. 치수는 어림.

import earcut from 'earcut'
import type { Poly, XY } from './siteModel'
import { clipHalf, mainAxes, span } from './streetDetail'

export type RoofKind = 'flat' | 'gable' | 'metal'

export interface ModelRoof {
  kind: RoofKind
  source: 'register' | 'rule'
  /** 건축물대장 지붕 구조 이름 (규칙이면 '') */
  label: string
}

/** 파라펫 높이·두께 (m, 어림) */
export const PARAPET_H = 1.0
export const PARAPET_W = 0.2
/** 경사 (도): 박공 25°, 금속 판넬 지붕 8° */
export const PITCH: Record<'gable' | 'metal', number> = { gable: 25, metal: 8 }

export const ROOF_LABEL: Record<RoofKind, string> = { flat: '평지붕 + 파라펫', gable: '박공 (경사 25°)', metal: '낮은 경사 (금속, 8°)' }

/** 건축물대장 지붕 구조(+ 건물 구조) → 모양 (모르면 null → 규칙) */
export function roofKindOf(roof: string, strct = ''): RoofKind | null {
  const r = roof.replace(/\s/g, '')
  if (/콘크리트|슬래브|슬라브|평지붕|평슬/.test(r)) return 'flat'
  if (/기와|슬레이트|스레트|슬레트|슁글|싱글|너와|초가|동판|징크|아스팔트/.test(r)) return 'gable'
  if (/판넬|패널|강판|철판|칼라|금속|아연|샌드위치|스틸|함석/.test(r)) return 'metal'
  const s = strct.replace(/\s/g, '')
  if (/철근콘크리트|철골철근|콘크리트|라멘/.test(s)) return 'flat'
  if (/경량철골|일반철골|철골조/.test(s)) return 'metal'
  return null
}

/** 규칙 (대장이 없거나 지붕 구조를 모를 때): 1~2층 단독주택(바닥 300㎡ 미만) 박공, 그 밖 평지붕 + 파라펫 */
export function ruleRoof(use: string, floors: number | null, area: number): RoofKind {
  const house = /^01/.test(use) || /단독|다가구|다중주택/.test(use)
  return house && (floors ?? 1) <= 2 && area < 300 ? 'gable' : 'flat'
}

const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1]

function triangulate2d(ring: XY[]): number[] {
  return earcut(ring.flat())
}

/** 경사 지붕을 얹을 수 있는 바닥인지: 구멍 없음, 폭 박공 20m·금속 60m까지, 많이 오목하지 않음(경계 상자 넓이의 60% 이상) */
export function pitchedFits(p: Poly, kind: 'gable' | 'metal'): boolean {
  const o = p.outer
  if (p.holes.length || o.length < 3) return false
  const { lenU, lenV } = mainAxes(o)
  if (lenV / 2 > (kind === 'gable' ? 10 : 30)) return false
  let area = 0
  for (let i = 0, j = o.length - 1; i < o.length; j = i++) area += o[j][0] * o[i][1] - o[i][0] * o[j][1]
  return Math.abs(area / 2) >= lenU * lenV * 0.6
}

/**
 * 박공(경사) 지붕 + 지붕에 맞춘 벽: 용마루는 바닥 모양의 긴 축 방향, 처마 = eave.
 * 벽은 꼭짓점마다 지붕 높이까지 (박공 면의 삼각형 벽이 저절로 생김), 지붕은 용마루로 나눈 두 평면.
 * 구멍(안마당)이 있거나, 너무 넓거나(박공 20m·금속 60m 넘음), 많이 오목하면 null (평지붕 + 파라펫으로).
 */
export function gableGeometry(p: Poly, base: number, eave: number, kind: 'gable' | 'metal'): { walls: number[]; roof: number[]; ridge: number } | null {
  if (p.holes.length) return null
  const o = p.outer
  if (o.length < 3) return null
  const { v } = mainAxes(o)
  const [b0, b1] = span(o, v)
  const vc = (b0 + b1) / 2
  const halfW = (b1 - b0) / 2
  if (halfW < 0.5 || !pitchedFits(p, kind)) return null
  const tan = Math.tan((PITCH[kind] * Math.PI) / 180)
  const zOf = (q: XY) => eave + (halfW - Math.abs(dot(q, v) - vc)) * tan
  // 바깥 고리에 용마루를 지나는 점을 넣음 (벽 위 선이 지붕과 맞게)
  const ring: XY[] = []
  for (let i = 0; i < o.length; i++) {
    const a = o[i]
    const b = o[(i + 1) % o.length]
    ring.push(a)
    const da = dot(a, v) - vc
    const db = dot(b, v) - vc
    if (da * db < 0) {
      const t = da / (da - db)
      ring.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  const walls: number[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const za = zOf(a)
    const zb = zOf(b)
    walls.push(a[0], a[1], base, b[0], b[1], base, b[0], b[1], zb, a[0], a[1], base, b[0], b[1], zb, a[0], a[1], za)
  }
  const roof: number[] = []
  for (const side of [1, -1]) {
    const half = clipHalf(ring, [v[0] * side, v[1] * side], vc * side)
    if (half.length < 3) continue
    const tris = triangulate2d(half)
    for (let i = 0; i < tris.length; i += 3)
      for (const k of [tris[i], tris[i + 1], tris[i + 2]]) {
        const q = half[k]
        roof.push(q[0], q[1], zOf(q))
      }
  }
  return { walls, roof, ridge: eave + halfW * tan }
}

/** 평지붕 파라펫: 바깥 고리(와 안마당 고리) 안쪽으로 폭 0.2m·높이 1m 띠 (윗면 + 안·밖 옆면) */
export function parapetGeometry(p: Poly, top: number): number[] {
  const out: number[] = []
  const z0 = top
  const z1 = top + PARAPET_H
  // 바깥 고리는 반시계, 구멍은 시계 → 왼쪽이 늘 건물 안
  for (const r of [p.outer, ...p.holes]) {
    const n = r.length
    if (n < 3) continue
    const inner: XY[] = r.map((q, i) => {
      const a = r[(i - 1 + n) % n]
      const b = r[(i + 1) % n]
      const e1 = [q[0] - a[0], q[1] - a[1]]
      const e2 = [b[0] - q[0], b[1] - q[1]]
      const l1 = Math.hypot(e1[0], e1[1]) || 1
      const l2 = Math.hypot(e2[0], e2[1]) || 1
      // 두 변의 왼쪽 법선 평균 (뾰족한 모서리는 너무 멀리 가지 않게 1.5배까지)
      const nx = -e1[1] / l1 - e2[1] / l2
      const ny = e1[0] / l1 + e2[0] / l2
      const L = Math.hypot(nx, ny) || 1
      const cos = Math.max(0.67, L / 2)
      return [q[0] + (nx / L) * (PARAPET_W / cos), q[1] + (ny / L) * (PARAPET_W / cos)] as XY
    })
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const [ax, ay] = r[i]
      const [bx, by] = r[j]
      const [cx, cy] = inner[i]
      const [dx, dy] = inner[j]
      // 윗면
      out.push(ax, ay, z1, bx, by, z1, dx, dy, z1, ax, ay, z1, dx, dy, z1, cx, cy, z1)
      // 바깥 옆면
      out.push(ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z0, bx, by, z1, ax, ay, z1)
      // 안쪽 옆면
      out.push(cx, cy, z0, dx, dy, z0, dx, dy, z1, cx, cy, z0, dx, dy, z1, cx, cy, z1)
    }
  }
  return out
}
