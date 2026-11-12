// 15-B 콘타 모형 3D 미리보기: 판을 실제 높이(등고 간격)만큼 쌓은 계단 모양. 미리보기를 열 때만 불러온다 (three.js와 함께).
// 좌표는 대지 모형과 같게 (m, 대지 중심 = 원점, z 위) — 카메라·조작은 ModelPreview가 같이 씀.

import * as THREE from 'three'
import { ROAD_T, type ContourPlan, type EngraveKind } from './contour'
import type { PreviewParts } from './previewScene'
import type { XY } from './siteModel'

const PLATE = ['#f2efe9', '#e4dfd5']
const ROAD = '#8f8c86'
const EDGE = '#9c9180'
const ENGRAVE: Partial<Record<EngraveKind, string>> = { bldg: '#34436f', site: '#d63a2f', road: '#5f5f5f' }

export function buildContourPreview(plan: ContourPlan): PreviewParts {
  const group = new THREE.Group()
  const disposables: { dispose: () => void }[] = []
  let triangles = 0
  const mats = new Map<string, THREE.MeshLambertMaterial>()
  const mat = (color: string) => {
    let m = mats.get(color)
    if (!m) {
      // 면을 살짝 뒤로 밀어 위에 그린 새김선이 묻히지 않게
      m = new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
      mats.set(color, m)
      disposables.push(m)
    }
    return m
  }
  const shapeOf = (outer: XY[], holes: XY[][]) => {
    const s = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)))
    for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
    return s
  }
  const segs = new Map<string, number[]>()
  const addSeg = (color: string, pts: XY[], z: number, closed: boolean) => {
    const out = segs.get(color) ?? []
    const src = closed ? [...pts, pts[0]] : pts
    for (let i = 0; i + 1 < src.length; i++) out.push(src[i][0], src[i][1], z, src[i + 1][0], src[i + 1][1], z)
    segs.set(color, out)
  }
  const dz = plan.interval
  const roadH = (ROAD_T * plan.scale) / 1000
  for (const piece of plan.pieces) {
    const top = piece.kind === 'plate' ? plan.levels[piece.plate - 1] : plan.levels[piece.plate - 1] + roadH
    const h = piece.kind === 'plate' ? dz : roadH
    const g = new THREE.ExtrudeGeometry(shapeOf(piece.poly.outer, piece.poly.holes), { depth: h, bevelEnabled: false, curveSegments: 1 })
    g.translate(0, 0, top - h)
    g.computeVertexNormals()
    disposables.push(g)
    const mesh = new THREE.Mesh(g, mat(piece.kind === 'plate' ? PLATE[piece.plate % 2] : ROAD))
    mesh.name = piece.id
    group.add(mesh)
    triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3
    addSeg(EDGE, piece.poly.outer, top + h * 0.002, true)
    for (const e of piece.engrave) {
      const c = ENGRAVE[e.kind]
      if (c) addSeg(c, e.pts, top + Math.max(0.02, h * 0.03), false)
    }
  }
  for (const [color, pos] of segs) {
    if (!pos.length) continue
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    const lm = new THREE.LineBasicMaterial({ color })
    disposables.push(g, lm)
    group.add(new THREE.LineSegments(g, lm))
  }
  return { group, triangles: Math.round(triangles), dispose: () => disposables.forEach((d) => d.dispose()) }
}
