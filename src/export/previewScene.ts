// 15-A 작업대 3D 미리보기: 대지 모형(SiteModel)을 three.js 장면으로. 라이노 파일과 같은 자료·같은 어림(나무 높이·쉘터 크기 등)을 쓴다.
// 이 파일은 미리보기를 열 때만 불러온다 (three.js가 함께 따라옴).
// 좌표: x 동쪽, y 북쪽, z 위 (m) — 카메라 up을 z로.

import * as THREE from 'three'
import { dashesOf, densify, offsetLine, triangulate, type Poly, type SiteModel, type XY } from './siteModel'

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
  stop: '#4f7fb0',
  lamp: '#8a8a8a',
}

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
  layer(m.walks, COLORS.walk, 0.15, '인도')
  layer(m.hdPaths, COLORS.hdPath, 0.14, '보도 면')
  layer(m.crosswalks, COLORS.crosswalk, 0.12, '횡단보도', Math.min(edge, 3))
  layer(m.marks, COLORS.mark, 0.13, '노면표시', Math.min(edge, 3))

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
    const cb: number[] = []
    for (const c of m.curbs) drapedSegs(c, 0.16, cb)
    addLines(cb, COLORS.curb, '연석')
    const lanes: Record<'white' | 'yellow' | 'blue', number[]> = { white: [], yellow: [], blue: [] }
    for (const l of m.lanes)
      for (const line of l.double ? [offsetLine(l.pts, 0.15), offsetLine(l.pts, -0.15)] : [l.pts])
        for (const seg of l.dashed ? dashesOf(line) : [line]) drapedSegs(seg, 0.18, lanes[l.color])
    addLines(lanes.white, COLORS.laneWhite, '차선 (흰색)')
    addLines(lanes.yellow, COLORS.laneYellow, '차선 (황색)')
    addLines(lanes.blue, COLORS.laneBlue, '차선 (청색)')
    const site: number[] = []
    for (const p of m.site) drapedSegs(p.outer, 0.3, site, true)
    addLines(site, COLORS.site, '대지 경계')
    const lamp: number[] = []
    for (const l of m.lamps) {
      const z0 = z(l.x, l.y)
      lamp.push(l.x, l.y, z0, l.x, l.y, z0 + 7)
    }
    addLines(lamp, COLORS.lamp, '가로등')
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
  if (m.stops.length) {
    const boxG = new THREE.BoxGeometry(3, 1.4, 2.6)
    boxG.translate(0, 0, 1.3)
    disposables.push(boxG)
    const boxes = new THREE.InstancedMesh(boxG, mat(COLORS.stop), m.stops.length)
    m.stops.forEach((s, i) => {
      dummy.position.set(s.x, s.y, z(s.x, s.y))
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      boxes.setMatrixAt(i, dummy.matrix)
    })
    boxes.name = '정류장'
    group.add(boxes)
  }

  return {
    group,
    triangles: Math.round(triangles),
    dispose: () => disposables.forEach((d) => d.dispose()),
  }
}
