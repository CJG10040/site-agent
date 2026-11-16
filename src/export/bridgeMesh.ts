// 다리·고가 모양 (2026-11-16): 상판(윗면·밑면·옆면) + 난간(긴 변을 따라 두께 25cm 벽) + 교각(폭 방향 벽).
// 라이노(.3dm)와 3D 미리보기가 같은 삼각형을 쓴다 — 삼각형마다 꼭짓점 3개 (x, y, z) × 3.

import { deckZ, type Deck } from './bridges'
import { densify, triangulate, type XY } from './siteModel'

export interface DeckTris {
  slab: number[]
  rail: number[]
  piers: number[]
}

const quad = (out: number[], a: number[], b: number[], c: number[], d: number[]) => out.push(...a, ...b, ...c, ...a, ...c, ...d)

export function deckTris(d: Deck, zAt: (x: number, y: number) => number): DeckTris {
  const slab: number[] = []
  const rail: number[] = []
  const piers: number[] = []
  const top = (x: number, y: number) => deckZ(d, x, y)
  for (const p of d.polys) {
    // 윗면·밑면
    const { pts, tris } = triangulate(p, 4)
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, c] = [pts[tris[i]], pts[tris[i + 1]], pts[tris[i + 2]]]
      slab.push(a[0], a[1], top(a[0], a[1]), b[0], b[1], top(b[0], b[1]), c[0], c[1], top(c[0], c[1]))
      slab.push(a[0], a[1], top(a[0], a[1]) - d.thick, c[0], c[1], top(c[0], c[1]) - d.thick, b[0], b[1], top(b[0], b[1]) - d.thick)
    }
    // 옆면
    for (const ring of [p.outer, ...p.holes]) {
      const r = densify(ring, 2, true)
      for (let i = 0; i < r.length; i++) {
        const [x1, y1] = r[i]
        const [x2, y2] = r[(i + 1) % r.length]
        const t1 = top(x1, y1)
        const t2 = top(x2, y2)
        quad(slab, [x1, y1, t1 - d.thick], [x2, y2, t2 - d.thick], [x2, y2, t2], [x1, y1, t1])
      }
    }
  }
  // 난간: buildDecks가 고른 변 (반시계 고리의 안쪽 = 왼쪽으로 25cm 두께)
  {
    const T = 0.25
    for (const [a, b] of d.railSegs) {
      {
        const dx = b[0] - a[0]
        const dy = b[1] - a[1]
        const len = Math.hypot(dx, dy)
        const nx = -dy / len
        const ny = dx / len
        const seg = densify([a, b], 2, false)
        for (let k = 0; k + 1 < seg.length; k++) {
          const p1: XY = seg[k]
          const p2: XY = seg[k + 1]
          const q1: XY = [p1[0] + nx * T, p1[1] + ny * T]
          const q2: XY = [p2[0] + nx * T, p2[1] + ny * T]
          const z1 = top(p1[0], p1[1])
          const z2 = top(p2[0], p2[1])
          const h = d.rail
          quad(rail, [p1[0], p1[1], z1], [p2[0], p2[1], z2], [p2[0], p2[1], z2 + h], [p1[0], p1[1], z1 + h])
          quad(rail, [q2[0], q2[1], z2], [q1[0], q1[1], z1], [q1[0], q1[1], z1 + h], [q2[0], q2[1], z2 + h])
          quad(rail, [p1[0], p1[1], z1 + h], [p2[0], p2[1], z2 + h], [q2[0], q2[1], z2 + h], [q1[0], q1[1], z1 + h])
        }
      }
    }
  }
  // 교각: 폭 방향 벽 (교량 폭의 3/4, 고가는 8m까지)
  for (const pr of d.piers) {
    const { c, along: u, half, th } = pr
    const v: XY = [-u[1], u[0]]
    const zb = zAt(c[0], c[1]) - 0.5
    const zt = d.zTop(c[0], c[1]) - d.thick
    if (zt - zb < 1) continue
    const P = (a: number, b: number): XY => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b]
    const ring = [P(-th, -half), P(th, -half), P(th, half), P(-th, half)]
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = ring[i]
      const [x2, y2] = ring[(i + 1) % 4]
      quad(piers, [x1, y1, zb], [x2, y2, zb], [x2, y2, zt], [x1, y1, zt])
    }
  }
  return { slab, rail, piers }
}
