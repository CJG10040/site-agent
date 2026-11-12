// 15-A 작업대 3D 미리보기: 대지 모형(SiteModel)을 three.js 장면으로. 라이노 파일과 같은 자료·같은 어림(나무 높이·쉘터 크기 등)을 쓴다.
// 이 파일은 미리보기를 열 때만 불러온다 (three.js가 함께 따라옴).
// 좌표: x 동쪽, y 북쪽, z 위 (m) — 카메라 up을 z로.

import * as THREE from 'three'
import { dashesOf, densify, offsetLine, triangulate, type Poly, type SiteModel, type XY } from './siteModel'
import { BARRIER_RAIL, barrierPosts, boxMesh, BUMP_H, densifyLine, hatchStripes, lampBoxes, poleBoxes, ribbon, shelterBoxes, signalBoxes, signPanels, STREET, type Box, type SignColor } from './streetDetail'

export interface PreviewParts {
  group: THREE.Group
  triangles: number
  dispose: () => void
}

const COLORS = {
  terrain: '#ddd3c1',
  bldg: '#f1efea',
  bldgSite: '#e7a3a0',
  bldgUnknown: '#cfccc6',
  road: '#a3a19c',
  walk: '#cfc6b3',
  crosswalk: '#f6f6f4',
  mark: '#f3f3f1',
  hdPath: '#d3c6ae',
  park: '#93bd7f',
  river: '#82b4d8',
  contour: '#a9865c',
  wall: '#6f6a64',
  fence: '#b9b1a5',
  curb: '#808080',
  site: '#d63a2f',
  laneWhite: '#ffffff',
  laneYellow: '#e8b923',
  laneBlue: '#3e6fd8',
  tree: '#6f9d5a',
  trunk: '#7d6248',
  stop: '#4b5563',
  glass: '#a9cbe0',
  lamp: '#7d7d7d',
  lampHead: '#ece6cf',
  island: '#cfcac0',
  hatch: '#e8b923',
  school: '#b9483c',
  pole: '#8d8f91',
  signal: '#262626',
  barrier: '#c9ccd0',
  bump: '#e8b923',
}
const SIGN_HEX: Record<SignColor, string> = { red: '#c8322a', yellow: '#f2c230', white: '#f4f4f2', blue: '#2a5bb0' }

export function buildPreview(m: SiteModel): PreviewParts {
  const group = new THREE.Group()
  const disposables: { dispose: () => void }[] = []
  let triangles = 0
  const mat = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => {
    const x = new THREE.MeshLambertMaterial({ color, ...extra })
    disposables.push(x)
    return x
  }
  const addMesh = (positions: number[], color: string, extra: THREE.MeshLambertMaterialParameters = {}, name = '') => {
    if (!positions.length) return
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.computeVertexNormals()
    disposables.push(g)
    const mesh = new THREE.Mesh(g, mat(color, extra))
    mesh.name = name
    group.add(mesh)
    triangles += positions.length / 9
  }
  const addLines = (segs: number[], color: string, name = '') => {
    if (!segs.length) return
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3))
    disposables.push(g)
    const lm = new THREE.LineBasicMaterial({ color })
    disposables.push(lm)
    const ls = new THREE.LineSegments(g, lm)
    ls.name = name
    group.add(ls)
  }
  const z = (x: number, y: number) => m.zAt(x, y)
  /** 선 → 선분 쌍 (지형에 얹음) */
  const drapedSegs = (pts: XY[], lift: number, out: number[], closed = false) => {
    const d = densify(pts, 4, closed)
    if (closed && d.length) d.push(d[0])
    for (let i = 0; i + 1 < d.length; i++) out.push(d[i][0], d[i][1], z(d[i][0], d[i][1]) + lift, d[i + 1][0], d[i + 1][1], z(d[i + 1][0], d[i + 1][1]) + lift)
  }
  /** 면 → 지형에 얹은 삼각형 */
  const drapedPolys = (polys: Poly[], lift: number, edge: number, out: number[]) => {
    for (const p of polys) {
      const { pts, tris } = triangulate(p, edge)
      for (let i = 0; i < tris.length; i += 3)
        for (const k of [tris[i], tris[i + 1], tris[i + 2]]) {
          const [x, y] = pts[k]
          out.push(x, y, z(x, y) + lift)
        }
    }
  }

  // ── 지형 면
  const t = m.terrain
  if (t) {
    const pos: number[] = []
    const at = (r: number, c: number): [number, number, number] | null => {
      const v = t.z[r * t.cols + c]
      return Number.isNaN(v) ? null : [t.x0 + c * t.cell, t.y0 - r * t.cell, v]
    }
    for (let r = 0; r + 1 < t.rows; r++)
      for (let c = 0; c + 1 < t.cols; c++) {
        const tl = at(r, c)
        const tr = at(r, c + 1)
        const bl = at(r + 1, c)
        const br = at(r + 1, c + 1)
        if (tl && bl && br) pos.push(...tl, ...bl, ...br)
        if (tl && br && tr) pos.push(...tl, ...br, ...tr)
      }
    addMesh(pos, COLORS.terrain, { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }, '지형 면')
  }

  // ── 얹은 면들
  const edge = Math.min(6, Math.max(3, (t?.cell ?? 10) * 1.5))
  const layer = (polys: Poly[], color: string, lift: number, name: string, e = edge) => {
    const out: number[] = []
    drapedPolys(polys, lift, e, out)
    addMesh(out, color, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }, name)
  }
  layer(m.parks.flatMap((a) => a.polys), COLORS.park, 0.05, '공원·녹지')
  layer(m.rivers.flatMap((a) => a.polys), COLORS.river, 0.05, '하천')
  layer(m.roads, COLORS.road, 0.08, '도로 면')
  // ── 거리 디테일 (2026-11-13): 인도·교통섬 단차, 횡단보도 줄무늬, 안전지대 빗금, 차선·연석 띠
  const R = STREET.roadLift
  const H = STREET.curbH
  /** 선 → 폭 w 띠 삼각형 (지형에 얹음) */
  const ribbonTris = (pts: XY[], w: number, lift: number, out: number[], closed = false) => {
    const d = densifyLine(pts, 2, closed)
    if (d.length < 2) return
    const { left, right } = ribbon(d, w)
    const v = (q: XY) => [q[0], q[1], z(q[0], q[1]) + lift]
    for (let i = 0; i + 1 < d.length; i++) {
      const a = v(left[i])
      const b = v(right[i])
      const c = v(right[i + 1])
      const e = v(left[i + 1])
      out.push(...a, ...b, ...c, ...a, ...c, ...e)
    }
  }
  /** 고리를 따라 세운 옆면 (땅 + lo ~ 땅 + hi) */
  const sideTris = (ring: XY[], lo: number, hi: number, out: number[], closed = true) => {
    const d = densifyLine(ring, 2, closed)
    for (let i = 0; i + 1 < d.length; i++) {
      const [x1, y1] = d[i]
      const [x2, y2] = d[i + 1]
      const z1 = z(x1, y1)
      const z2 = z(x2, y2)
      out.push(x1, y1, z1 + lo, x2, y2, z2 + lo, x2, y2, z2 + hi, x1, y1, z1 + lo, x2, y2, z2 + hi, x1, y1, z1 + hi)
    }
  }
  /** 올라온 면: 윗면 + 옆면 */
  const raised = (polys: Poly[], color: string, name: string) => {
    if (!polys.length) return
    const out: number[] = []
    drapedPolys(polys, R + H, Math.min(edge, 3), out)
    for (const p of polys) for (const r of [p.outer, ...p.holes]) sideTris(r, R, R + H, out)
    addMesh(out, color, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }, name)
  }
  raised(m.walks, COLORS.walk, '인도')
  raised(m.hdPaths, COLORS.hdPath, '보도 면')
  raised(
    m.safety.filter((s) => s.kind === 'island').map((s) => s.poly),
    COLORS.island,
    '교통섬',
  )
  {
    const rim: number[] = []
    for (const s of m.safety) if (s.kind === 'island') for (const r of [s.poly.outer, ...s.poly.holes]) ribbonTris(r, 0.3, R + H + 0.01, rim, true)
    addMesh(rim, '#96938c', { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, '교통섬 연석')
  }
  layer(m.zebra.length ? m.zebra : m.crosswalks, COLORS.crosswalk, R + 0.03, '횡단보도 줄무늬', 3)
  layer(m.marks, COLORS.mark, R + 0.04, '노면표시', Math.min(edge, 3))
  layer(m.arrows, COLORS.mark, R + 0.04, '노면표시 화살표', 3)
  layer(
    m.safety.filter((s) => s.kind === 'school').map((s) => s.poly),
    COLORS.school,
    R + 0.015,
    '어린이보호구역',
    Math.min(edge, 3),
  )
  {
    const out: number[] = []
    drapedPolys(m.hatch, R + 0.03, 3, out)
    for (const sz of m.safety) if (sz.kind === 'painted') ribbonTris(sz.poly.outer, STREET.hatchEdge, R + 0.03, out, true)
    drapedPolys(m.yellowMarks, R + 0.03, 3, out)
    addMesh(out, COLORS.hatch, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, '안전지대 표시')
  }
  {
    const out: number[] = []
    for (const c of m.curbs) {
      ribbonTris(c, STREET.curbW, R + H, out)
      const { left, right } = ribbon(densifyLine(c, 2), STREET.curbW)
      sideTris(left, R, R + H, out, false)
      sideTris(right, R, R + H, out, false)
    }
    addMesh(out, COLORS.curb, { side: THREE.DoubleSide }, '연석')
    const lanes: Record<'white' | 'yellow' | 'blue', number[]> = { white: [], yellow: [], blue: [] }
    for (const l of m.lanes)
      for (const line of l.double ? [offsetLine(l.pts, 0.15), offsetLine(l.pts, -0.15)] : [l.pts])
        for (const seg of l.dashed ? dashesOf(line) : [line]) ribbonTris(seg, STREET.laneW, R + 0.03, lanes[l.color])
    const lo = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }
    addMesh(lanes.white, COLORS.laneWhite, lo, '차선 (흰색)')
    addMesh(lanes.yellow, COLORS.laneYellow, lo, '차선 (황색)')
    addMesh(lanes.blue, COLORS.laneBlue, lo, '차선 (청색)')
  }
  /** 상자들 → 삼각형 */
  const boxTris = (boxes: Box[], ground: number, out: number[]) => {
    for (const b of boxes) {
      const { v, f } = boxMesh(b, ground)
      for (const [a, bb, c, d] of f) out.push(...v[a], ...v[bb], ...v[c], ...v[a], ...v[c], ...v[d])
    }
  }

  // ── 건물 (벽 + 지붕), 층수 모르면 납작한 발자국
  const walls: Record<'bldg' | 'bldgSite' | 'bldgUnknown', number[]> = { bldg: [], bldgSite: [], bldgUnknown: [] }
  for (const b of m.buildings) {
    const key = b.top === null ? 'bldgUnknown' : b.onSite ? 'bldgSite' : 'bldg'
    const top = b.top ?? b.base + 0.4
    const out = walls[key]
    for (const p of b.parts) {
      for (const ring of [p.outer, ...p.holes])
        for (let i = 0; i < ring.length; i++) {
          const [x1, y1] = ring[i]
          const [x2, y2] = ring[(i + 1) % ring.length]
          out.push(x1, y1, b.base, x2, y2, b.base, x2, y2, top, x1, y1, b.base, x2, y2, top, x1, y1, top)
        }
      const { pts, tris } = triangulate(p, 1e9)
      for (let i = 0; i < tris.length; i += 3)
        for (const k of [tris[i], tris[i + 1], tris[i + 2]]) out.push(pts[k][0], pts[k][1], top)
    }
  }
  addMesh(walls.bldg, COLORS.bldg, { side: THREE.DoubleSide }, '주변 건물')
  addMesh(walls.bldgSite, COLORS.bldgSite, { side: THREE.DoubleSide }, '대지 안 건물')
  addMesh(walls.bldgUnknown, COLORS.bldgUnknown, { side: THREE.DoubleSide }, '층수 모름')

  // ── 담장·가드레일 (세운 면)
  {
    const out: number[] = []
    for (const w of m.fences) {
      const h = /가드|펜스|레일/.test(w.kind) ? 0.8 : 1.5
      const d = densify(w.pts, 3, false)
      for (let i = 0; i + 1 < d.length; i++) {
        const [x1, y1] = d[i]
        const [x2, y2] = d[i + 1]
        const z1 = z(x1, y1)
        const z2 = z(x2, y2)
        out.push(x1, y1, z1, x2, y2, z2, x2, y2, z2 + h, x1, y1, z1, x2, y2, z2 + h, x1, y1, z1 + h)
      }
    }
    addMesh(out, COLORS.fence, { side: THREE.DoubleSide }, '담장·가드레일')
  }

  // ── 선: 등고선·옹벽·연석·차선·대지 경계
  {
    const cont: number[] = []
    for (const c of m.contours) for (let i = 0; i + 1 < c.pts.length; i++) cont.push(c.pts[i][0], c.pts[i][1], c.level + 0.05, c.pts[i + 1][0], c.pts[i + 1][1], c.level + 0.05)
    addLines(cont, COLORS.contour, '등고선')
    const wl: number[] = []
    for (const w of m.walls) drapedSegs(w.pts, 0.1, wl)
    addLines(wl, COLORS.wall, '옹벽·석축')
    const site: number[] = []
    for (const p of m.site) drapedSegs(p.outer, 0.3, site, true)
    addLines(site, COLORS.site, '대지 경계')
  }

  // ── 가로등 (기둥 + 도로 쪽 팔 + 등 머리), 정류장 쉘터 (지붕·기둥·의자·표지 + 유리)
  {
    const pole: number[] = []
    const head: number[] = []
    for (const l of m.lamps) {
      const bs = lampBoxes(l.x, l.y, l.toRoad)
      const g = z(l.x, l.y) + R + H
      boxTris(
        bs.filter((b) => b.part !== 'head'),
        g,
        pole,
      )
      boxTris(
        bs.filter((b) => b.part === 'head'),
        g,
        head,
      )
    }
    addMesh(pole, COLORS.lamp, {}, '가로등')
    addMesh(head, COLORS.lampHead, {}, '가로등 머리')
    const frame: number[] = []
    const glass: number[] = []
    for (const st of m.stops) {
      const bs = shelterBoxes(st.x, st.y, st.along, st.toRoad)
      const g = z(st.x, st.y) + R + H
      boxTris(
        bs.filter((b) => b.part !== 'glass'),
        g,
        frame,
      )
      boxTris(
        bs.filter((b) => b.part === 'glass'),
        g,
        glass,
      )
    }
    addMesh(frame, COLORS.stop, {}, '정류장 쉘터')
    addMesh(glass, COLORS.glass, { transparent: true, opacity: 0.45, depthWrite: false }, '정류장 유리')
  }

  // ── 정밀도로지도 지주·신호등·표지판·방호시설·과속방지턱 (2026-11-13)
  {
    const pole: number[] = []
    for (const p of m.poles) boxTris(poleBoxes(p), z(p.x, p.y) + R, pole)
    addMesh(pole, COLORS.pole, {}, '지주')
    const sig: number[] = []
    for (const s of m.signals) boxTris(signalBoxes(s), z(s.x, s.y) + R, sig)
    addMesh(sig, COLORS.signal, {}, '신호등')
    const sc: Record<SignColor, number[]> = { red: [], yellow: [], white: [], blue: [] }
    for (const s of m.signs) {
      const g = z(s.x, s.y) + R
      for (const pan of signPanels(s)) {
        const r = pan.ring
        for (let i = 1; i + 1 < r.length; i++) sc[pan.color].push(r[0][0], r[0][1], g + r[0][2], r[i][0], r[i][1], g + r[i][2], r[i + 1][0], r[i + 1][1], g + r[i + 1][2])
      }
    }
    for (const c of ['red', 'yellow', 'white', 'blue'] as SignColor[]) addMesh(sc[c], SIGN_HEX[c], { side: THREE.DoubleSide }, '교통안전표지')
    const bar: number[] = []
    for (const b of m.barriers) {
      for (const pb of barrierPosts(b.pts)) boxTris([pb], z(pb.c[0], pb.c[1]) + R, bar)
      sideTris(b.pts, R + BARRIER_RAIL[0], R + BARRIER_RAIL[1], bar, false)
    }
    addMesh(bar, COLORS.barrier, { side: THREE.DoubleSide }, '방호시설')
    const bump: number[] = []
    drapedPolys(m.bumps, R + BUMP_H, 1.5, bump)
    for (const p of m.bumps) for (const r of [p.outer, ...p.holes]) sideTris(r, R, R + BUMP_H, bump)
    addMesh(bump, COLORS.bump, { side: THREE.DoubleSide }, '과속방지턱')
    const bs: number[] = []
    drapedPolys(
      m.bumps.flatMap((p) => hatchStripes(p)),
      R + BUMP_H + 0.005,
      1.5,
      bs,
    )
    addMesh(bs, COLORS.crosswalk, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, '과속방지턱 줄')
  }

  // ── 나무 (수관 + 줄기), 정류장 쉘터 — 같은 모양을 여러 번 (InstancedMesh)
  const dummy = new THREE.Object3D()
  if (m.trees.length) {
    const crownG = new THREE.IcosahedronGeometry(1, 1)
    const trunkG = new THREE.CylinderGeometry(0.15, 0.2, 1, 6)
    trunkG.rotateX(Math.PI / 2)
    trunkG.translate(0, 0, 0.5)
    disposables.push(crownG, trunkG)
    const crowns = new THREE.InstancedMesh(crownG, mat(COLORS.tree, { flatShading: true }), m.trees.length)
    const trunks = new THREE.InstancedMesh(trunkG, mat(COLORS.trunk), m.trees.length)
    m.trees.forEach((tr, i) => {
      const h = tr.h && tr.h > 1 ? tr.h : 7
      const r = Math.max(1.4, h * 0.28)
      const z0 = z(tr.x, tr.y)
      dummy.position.set(tr.x, tr.y, z0 + h - r)
      dummy.scale.set(r, r, r * 0.9)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      crowns.setMatrixAt(i, dummy.matrix)
      dummy.position.set(tr.x, tr.y, z0)
      dummy.scale.set(1, 1, Math.max(0.5, h - r * 1.5))
      dummy.updateMatrix()
      trunks.setMatrixAt(i, dummy.matrix)
    })
    crowns.name = '가로수'
    group.add(crowns, trunks)
    triangles += m.trees.length * (crownG.index ? crownG.index.count / 3 : crownG.attributes.position.count / 3)
  }

  return {
    group,
    triangles: Math.round(triangles),
    dispose: () => disposables.forEach((d) => d.dispose()),
  }
}
