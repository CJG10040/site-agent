// 라이노 .3dm 쓰기 — rhino3dm(MIT, McNeel)을 내보낼 때만 불러온다 (wasm 약 2.7MB).
// 레이어: 정보 / 대지 경계 / 건물(대지 안·주변·층수 모름) / 지형(면·등고선·계곡선) / 도로(면·중심선) / 필지 / 공원·녹지 / 하천
// 지면에 놓이는 선·면은 지형 높이를 따라 얹는다(조금 띄움). 지구 위치(Earth Anchor)에 원점의 경위도·해발을 적는다.

import type { RhinoModule } from 'rhino3dm'
import wasmUrl from 'rhino3dm/rhino3dm.wasm?url'
import { densify, modelNotes, triangulate, type Poly, type SiteModel, type XY } from './siteModel'

type Rgb = [number, number, number]

interface LayerDef {
  key: string
  name: string
  color: Rgb
  parent?: string
}

const LAYERS: LayerDef[] = [
  { key: 'info', name: '정보', color: [40, 40, 40] },
  { key: 'site', name: '대지 경계', color: [220, 38, 38] },
  { key: 'bldg', name: '건물', color: [140, 140, 140] },
  { key: 'bldgAround', name: '주변 건물 (실측 높이·층수 × 용도별 층고)', color: [150, 150, 150], parent: 'bldg' },
  { key: 'bldgSite', name: '대지 안 기존 건물', color: [230, 150, 150], parent: 'bldg' },
  { key: 'bldgUnknown', name: '층수 모름 (발자국만)', color: [190, 190, 190], parent: 'bldg' },
  { key: 'bldgMinor', name: '지붕 구조물·가건물 (수치지도, 발자국)', color: [200, 190, 170], parent: 'bldg' },
  { key: 'terrain', name: '지형', color: [150, 120, 90] },
  { key: 'mesh', name: '지형 면', color: [215, 205, 185], parent: 'terrain' },
  { key: 'contour', name: '등고선', color: [176, 130, 90], parent: 'terrain' },
  { key: 'contourMajor', name: '계곡선 (굵은 등고선)', color: [130, 85, 50], parent: 'terrain' },
  { key: 'mapContour', name: '수치지도 등고선 (원본)', color: [150, 95, 60], parent: 'terrain' },
  { key: 'spot', name: '표고점·기준점 (이름 = 해발)', color: [120, 70, 40], parent: 'terrain' },
  { key: 'wall', name: '옹벽·석축·제방', color: [70, 70, 70], parent: 'terrain' },
  { key: 'cutfill', name: '절토·성토', color: [160, 120, 80], parent: 'terrain' },
  { key: 'road', name: '도로', color: [90, 90, 90] },
  { key: 'roadSurf', name: '도로 면', color: [120, 120, 120], parent: 'road' },
  { key: 'walk', name: '인도 (수치지도)', color: [190, 180, 160], parent: 'road' },
  { key: 'roadCenter', name: '도로중심선', color: [200, 160, 40], parent: 'road' },
  { key: 'parcel', name: '필지', color: [170, 170, 200] },
  { key: 'park', name: '공원·녹지', color: [90, 160, 90] },
  { key: 'river', name: '하천', color: [70, 140, 200] },
  // 15-F 1:1,000 수치지도·정밀도로지도 디테일 (자료가 있을 때만)
  { key: 'detail', name: '디테일 (1:1,000 수치지도·정밀도로지도)', color: [110, 110, 110] },
  { key: 'tree', name: '가로수·독립수 (수관, 높이 모르면 7m)', color: [96, 150, 80], parent: 'detail' },
  { key: 'trunk', name: '가로수 줄기', color: [120, 95, 70], parent: 'detail' },
  { key: 'stop', name: '정류장 (쉘터 어림 3×1.4×2.6m)', color: [60, 110, 170], parent: 'detail' },
  { key: 'lamp', name: '가로등 (높이 어림 7m)', color: [150, 150, 150], parent: 'detail' },
  { key: 'crosswalk', name: '횡단보도', color: [245, 245, 245], parent: 'detail' },
  { key: 'fence', name: '담장·가드레일 (높이 어림 담장 1.5m·가드레일 0.8m)', color: [170, 160, 150], parent: 'detail' },
  { key: 'laneWhite', name: '차선 (흰색)', color: [250, 250, 250], parent: 'detail' },
  { key: 'laneYellow', name: '차선 (황색·중앙선)', color: [240, 190, 40], parent: 'detail' },
  { key: 'laneBlue', name: '차선 (청색·버스)', color: [60, 110, 220], parent: 'detail' },
  { key: 'mark', name: '노면표시 (화살표·글자 등)', color: [240, 240, 240], parent: 'detail' },
  { key: 'hdPath', name: '보도 면 (정밀도로지도)', color: [205, 195, 175], parent: 'detail' },
  { key: 'curb', name: '연석·도로 경계 (정밀도로지도)', color: [130, 130, 130], parent: 'detail' },
]

/** 정이십면체 (나무 수관) */
const ICO: { v: number[][]; f: number[][] } = (() => {
  const t = (1 + Math.sqrt(5)) / 2
  const raw = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ]
  const v = raw.map((p) => {
    const l = Math.hypot(p[0], p[1], p[2])
    return p.map((c) => c / l)
  })
  const f = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ]
  return { v, f }
})()

/** 선을 옆으로 d만큼 (겹선 차선) — 꼭짓점마다 앞뒤 방향의 평균 법선 */
function offsetLine(pts: XY[], d: number): XY[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [p[0] - ((b[1] - a[1]) / L) * d, p[1] + ((b[0] - a[0]) / L) * d] as XY
  })
}

/** 점선 차선: 칠한 길이 on, 빈 길이 off (도로교통 규격 어림 3m·5m) */
function dashesOf(pts: XY[], on = 3, off = 5): XY[][] {
  const out: XY[][] = []
  let cur: XY[] = []
  let pos = 0
  const period = on + off
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    const L = Math.hypot(x1 - x0, y1 - y0)
    let t = 0
    while (t < L) {
      const phase = pos % period
      const drawing = phase < on
      const step = Math.min(L - t, drawing ? on - phase : period - phase)
      const a: XY = [x0 + ((x1 - x0) * t) / L, y0 + ((y1 - y0) * t) / L]
      const b: XY = [x0 + ((x1 - x0) * (t + step)) / L, y0 + ((y1 - y0) * (t + step)) / L]
      if (drawing) {
        if (!cur.length) cur.push(a)
        cur.push(b)
      } else if (cur.length) {
        out.push(cur)
        cur = []
      }
      t += step
      pos += step
    }
  }
  if (cur.length > 1) out.push(cur)
  return out
}

/** wasm 쪽 메모리 풀기 (타입 선언에는 없지만 embind 객체마다 있음) */
function free(o: unknown) {
  ;(o as { delete?: () => void } | null)?.delete?.()
}

let rhinoP: Promise<RhinoModule> | null = null

function loadRhino(): Promise<RhinoModule> {
  rhinoP ??= import('rhino3dm/rhino3dm.module.js').then((m) => (m.default as (o: object) => Promise<RhinoModule>)({ locateFile: () => wasmUrl }))
  return rhinoP
}

export interface ExportMeta {
  title: string
  address: string
  collected: string
}

export async function siteModelTo3dm(m: SiteModel, meta: ExportMeta, onStep?: (s: string) => void): Promise<Uint8Array> {
  onStep?.('라이노 모듈 불러오는 중')
  const rhino = await loadRhino()
  const doc = new rhino.File3dm()
  try {
    const st = doc.settings()
    st.modelUnitSystem = rhino.UnitSystem.Meters
    st.modelAbsoluteTolerance = 0.001
    // 지구 위치: 모형 원점 = 대지 중심, 진북 방향 반영
    const ea = st.earthAnchorPoint
    ea.earthBasepointLatitude = m.origin.lat
    ea.earthBasepointLongitude = m.origin.lon
    ea.earthBasepointElevation = m.origin.elev ?? 0
    ea.earthBasepointElevationZero = rhino.BasepointZero.MeanSeaLevel
    ea.modelBasePoint = [0, 0, 0]
    const a = (m.origin.trueNorthDeg * Math.PI) / 180
    ea.modelNorth = [Math.sin(a), Math.cos(a), 0]
    ea.modelEast = [Math.cos(a), -Math.sin(a), 0]
    ea.name = '대지 중심'
    ea.description = `EPSG:5179 X ${m.origin.x5179.toFixed(2)} Y ${m.origin.y5179.toFixed(2)}`
    st.earthAnchorPoint = ea
    doc.applicationName = '대지해석 에이전트'
    doc.applicationUrl = 'https://cjg10040.github.io/site-agent/'

    // 레이어 (부모를 먼저 넣고 id로 잇는다)
    const layerIndex = new Map<string, number>()
    const layerId = new Map<string, string>()
    const hasMap = m.mapYear !== null || m.walls.length > 0 || m.walks.length > 0
    for (const def of LAYERS) {
      if (!hasMap && ['bldgMinor', 'mapContour', 'spot', 'wall', 'cutfill', 'walk'].includes(def.key)) continue
      // 디테일 레이어는 자료가 있을 때만
      const detailHas: Record<string, boolean> = {
        tree: m.trees.length > 0,
        trunk: m.trees.length > 0,
        stop: m.stops.length > 0,
        lamp: m.lamps.length > 0,
        crosswalk: m.crosswalks.length > 0,
        fence: m.fences.length > 0,
        laneWhite: m.lanes.some((l) => l.color === 'white'),
        laneYellow: m.lanes.some((l) => l.color === 'yellow'),
        laneBlue: m.lanes.some((l) => l.color === 'blue'),
        mark: m.marks.length > 0,
        hdPath: m.hdPaths.length > 0,
        curb: m.curbs.length > 0,
      }
      if (def.key === 'detail' && !Object.values(detailHas).some(Boolean)) continue
      if (def.key in detailHas && !detailHas[def.key]) continue
      const L = new rhino.Layer()
      L.name =
        def.key === 'mesh'
          ? `지형 면 (${m.terrain?.cell ?? 10}m 칸${m.terrainSource === 'map' ? ', 수치지도' : ''})`
          : def.key === 'roadSurf'
            ? m.roadSource === 'centerline'
              ? '도로 면 (도로중심선 폭)'
              : '도로 면 (수치지도 도로경계)'
            : def.name
      L.color = { r: def.color[0], g: def.color[1], b: def.color[2], a: 255 }
      if (def.parent) L.parentLayerId = layerId.get(def.parent) ?? ''
      const idx = doc.layers().add(L)
      free(L)
      layerIndex.set(def.key, idx)
      layerId.set(def.key, doc.layers().get(idx).id)
    }
    const attrs = (key: string, name = '', user: Record<string, string> = {}) => {
      const at = new rhino.ObjectAttributes()
      at.layerIndex = layerIndex.get(key) ?? 0
      if (name) at.name = name
      for (const [k, v] of Object.entries(user)) at.setUserString(k, v)
      return at
    }
    const objs = doc.objects()
    const addPolyline = (pts: number[][], key: string, name = '', user: Record<string, string> = {}) => {
      if (pts.length < 2) return
      const c = new rhino.PolylineCurve(pts)
      const at = attrs(key, name, user)
      objs.addCurve(c, at)
      free(c)
      free(at)
    }
    const draped = (pts: XY[], closed: boolean, lift: number) => {
      const d = densify(pts, 4, closed).map(([x, y]) => [x, y, m.zAt(x, y) + lift])
      if (closed && d.length) d.push([...d[0]])
      return d
    }
    /** 지형에 얹은 면들을 메시 하나로 */
    // 지형 칸이 작으면(수치지도 2m) 얹는 면도 잘게 — 단차를 가로지르는 큰 삼각형이 땅에 묻히지 않게
    const DRAPE_EDGE = Math.min(6, Math.max(3, (m.terrain?.cell ?? 10) * 1.5))
    const drapedMesh = (polys: Poly[], key: string, name: string, lift: number, maxEdge = DRAPE_EDGE) => {
      if (!polys.length) return
      const mesh = new rhino.Mesh()
      const vs = mesh.vertices()
      const fs = mesh.faces()
      for (const p of polys) {
        const { pts, tris } = triangulate(p, maxEdge)
        const base = vs.count
        for (const [x, y] of pts) vs.add(x, y, m.zAt(x, y) + lift)
        for (let i = 0; i < tris.length; i += 3) fs.addTriFace(base + tris[i], base + tris[i + 1], base + tris[i + 2])
      }
      mesh.normals().computeNormals()
      mesh.compact()
      const at = attrs(key, name)
      objs.addMesh(mesh, at)
      free(mesh)
      free(at)
    }

    // ── 정보
    const notes = modelNotes(m, meta)
    const strings = doc.strings()
    for (const [k, v] of notes) strings.set(k, v)
    {
      const at = attrs('info', '원점')
      objs.addTextDot('원점 (대지 중심)', [0, 0, 0], at)
      free(at)
    }

    // ── 지형 면
    onStep?.('지형 면')
    const t = m.terrain
    if (t) {
      const mesh = new rhino.Mesh()
      const vs = mesh.vertices()
      const fs = mesh.faces()
      const id = new Int32Array(t.cols * t.rows).fill(-1)
      for (let r = 0; r < t.rows; r++)
        for (let c = 0; c < t.cols; c++) {
          const z = t.z[r * t.cols + c]
          if (Number.isNaN(z)) continue
          id[r * t.cols + c] = vs.add(t.x0 + c * t.cell, t.y0 - r * t.cell, z)
        }
      for (let r = 0; r + 1 < t.rows; r++)
        for (let c = 0; c + 1 < t.cols; c++) {
          const tl = id[r * t.cols + c]
          const tr = id[r * t.cols + c + 1]
          const bl = id[(r + 1) * t.cols + c]
          const br = id[(r + 1) * t.cols + c + 1]
          // 북서–남동 대각선으로 나눔 (zAt과 같은 방식), 반시계 = 위를 향함
          if (tl >= 0 && bl >= 0 && br >= 0) fs.addTriFace(tl, bl, br)
          if (tl >= 0 && br >= 0 && tr >= 0) fs.addTriFace(tl, br, tr)
        }
      mesh.normals().computeNormals()
      mesh.compact()
      const at = attrs('mesh', '지형 면')
      objs.addMesh(mesh, at)
      free(mesh)
      free(at)
    }
    for (const c of m.contours)
      addPolyline(
        c.pts.map(([x, y]) => [x, y, c.level]),
        c.major ? 'contourMajor' : 'contour',
        `${c.level >= 0 ? '+' : ''}${c.level}m`,
        { 높이: String(c.level) },
      )

    // ── 건물
    onStep?.('건물')
    for (const b of m.buildings) {
      const key = b.top === null ? 'bldgUnknown' : b.onSite ? 'bldgSite' : 'bldgAround'
      const label = [b.name, b.floors ? `${b.floors}층` : '층수 모름'].filter(Boolean).join(' ')
      const user: Record<string, string> = { 층수: b.floors ? String(b.floors) : '모름' }
      if (b.use) user['용도'] = b.use
      if (b.top !== null) user['높이(m, 어림)'] = (b.top - b.base).toFixed(1)
      for (const p of b.parts) {
        const ring = (r: XY[]) => [...r, r[0]].map(([x, y]) => [x, y, b.base])
        if (b.top === null) {
          addPolyline(ring(p.outer), key, label, user)
          continue
        }
        const outer = new rhino.PolylineCurve(ring(p.outer))
        const ex = rhino.Extrusion.create(outer, b.top - b.base, true)
        free(outer)
        if (!ex) {
          addPolyline(ring(p.outer), 'bldgUnknown', label, user)
          continue
        }
        for (const h of p.holes) {
          const hc = new rhino.PolylineCurve(ring(h))
          ex.addInnerProfile(hc)
          free(hc)
        }
        const at = attrs(key, label, user)
        objs.addExtrusion(ex, at)
        free(ex)
        free(at)
      }
    }

    // ── 수치지도: 원본 등고선·표고점·옹벽·절성토·지붕 구조물
    for (const c of m.mapContours) addPolyline(c.pts.map(([x, y]) => [x, y, c.z]), 'mapContour', `해발 ${c.level}m`, { 해발: String(c.level), 구분: c.major ? '계곡선' : '주곡선' })
    for (const s of m.spots) {
      const at = attrs('spot', `해발 ${s.level}m`, { 해발: String(s.level) })
      objs.addPoint([s.x, s.y, s.z], at)
      free(at)
    }
    for (const w of m.walls) {
      const label = `${w.kind}${w.h ? ` 높이 ${w.h}m` : ''}${w.top ? '' : ' (하단)'}`
      const user = { 종류: w.kind, '높이(m)': w.h === null ? '모름' : String(w.h), 구분: w.top ? '상단' : '하단' }
      const h = w.h ?? 0
      if (w.top && h >= 0.2) {
        // 벽 면: 지형 단차의 위·아래 (단차 가운데에서 ±h/2)
        const pts = densify(w.pts, 2, false)
        const mesh = new rhino.Mesh()
        const vs = mesh.vertices()
        const fs = mesh.faces()
        // 벽 위·아래 = 선 양옆 3m의 지형 높이 (선 바로 위는 단차 한가운데라 2m 칸에서 들쭉날쭉함)
        const off = Math.max(3, (m.terrain?.cell ?? 2) * 1.5)
        const tops: number[] = []
        pts.forEach(([x, y], i) => {
          const [ax, ay] = pts[Math.max(0, i - 1)]
          const [bx, by] = pts[Math.min(pts.length - 1, i + 1)]
          const L = Math.hypot(bx - ax, by - ay) || 1
          const nx = -(by - ay) / L
          const ny = (bx - ax) / L
          const za = m.zAt(x + nx * off, y + ny * off)
          const zb = m.zAt(x - nx * off, y - ny * off)
          const lo = Math.min(za, zb)
          const hi = Math.max(lo + 0.2, Math.max(za, zb))
          vs.add(x, y, lo - 0.1)
          vs.add(x, y, hi)
          tops.push(hi)
        })
        for (let i = 0; i + 1 < pts.length; i++) fs.addQuadFace(2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1)
        mesh.normals().computeNormals()
        const at = attrs('wall', label, user)
        objs.addMesh(mesh, at)
        free(mesh)
        free(at)
        addPolyline(
          pts.map(([x, y], i) => [x, y, tops[i]]),
          'wall',
          label,
          user,
        )
      } else addPolyline(draped(w.pts, false, 0.1), 'wall', label, user)
    }
    for (const c of m.cutfill) addPolyline(draped(c.pts, false, 0.1), 'cutfill', `${c.kind}${c.top ? ' 상단' : ' 하단'}`)
    for (const p of m.minor) addPolyline(draped(p.outer, true, 0.05), 'bldgMinor', '지붕 구조물·가건물')

    // ── 도로·필지·공원·하천·대지
    onStep?.('도로·필지')
    drapedMesh(m.roads, 'roadSurf', '도로 면', 0.08)
    drapedMesh(m.walks, 'walk', '인도', 0.15)
    for (const r of m.roadCenters) addPolyline(draped(r.pts, false, 0.12), 'roadCenter', r.width ? `폭 ${r.width}m` : '폭 모름')
    for (const p of m.parcels)
      for (const poly of p.polys) addPolyline(draped(poly.outer, true, 0.04), 'parcel', p.jibun, { 지번: p.jibun, 지목: p.jimok })
    for (const a of m.parks) {
      drapedMesh(a.polys, 'park', a.name, 0.05)
      for (const poly of a.polys) addPolyline(draped(poly.outer, true, 0.06), 'park', a.name)
    }
    for (const a of m.rivers) {
      drapedMesh(a.polys, 'river', a.name, 0.05)
      for (const poly of a.polys) addPolyline(draped(poly.outer, true, 0.06), 'river', a.name)
    }
    for (const p of m.site) {
      addPolyline(draped(p.outer, true, 0.15), 'site', '대지 경계')
      for (const h of p.holes) addPolyline(draped(h, true, 0.15), 'site', '대지 경계 (구멍)')
    }

    // ── 1:1,000 수치지도·정밀도로지도 디테일 (15-F)
    if (m.crosswalks.length || m.marks.length || m.hdPaths.length || m.lanes.length || m.trees.length || m.fences.length || m.stops.length || m.lamps.length || m.curbs.length) onStep?.('디테일 (나무·차선·횡단보도 등)')
    drapedMesh(m.hdPaths, 'hdPath', '보도 면', 0.14)
    drapedMesh(m.crosswalks, 'crosswalk', '횡단보도', 0.12, Math.min(DRAPE_EDGE, 3))
    drapedMesh(m.marks, 'mark', '노면표시', 0.13, Math.min(DRAPE_EDGE, 3))
    for (const c of m.curbs) addPolyline(draped(c, false, 0.16), 'curb', '연석·도로 경계')
    for (const l of m.lanes) {
      const key = l.color === 'yellow' ? 'laneYellow' : l.color === 'blue' ? 'laneBlue' : 'laneWhite'
      const label = `${l.double ? '겹선' : '단선'} ${l.dashed ? '점선' : '실선'}`
      for (const line of l.double ? [offsetLine(l.pts, 0.15), offsetLine(l.pts, -0.15)] : [l.pts])
        for (const seg of l.dashed ? dashesOf(line) : [line]) addPolyline(draped(seg, false, 0.12), key, label)
    }
    // 담장·가드레일: 선을 따라 세운 얇은 면
    for (const w of m.fences) {
      const hgt = /가드|펜스|레일/.test(w.kind) ? 0.8 : 1.5
      const pts = densify(w.pts, 3, false)
      if (pts.length < 2) continue
      const mesh = new rhino.Mesh()
      const vs = mesh.vertices()
      const fs = mesh.faces()
      for (const [x, y] of pts) {
        const z = m.zAt(x, y)
        vs.add(x, y, z)
        vs.add(x, y, z + hgt)
      }
      for (let i = 0; i + 1 < pts.length; i++) fs.addQuadFace(2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1)
      mesh.normals().computeNormals()
      const at = attrs('fence', w.kind)
      objs.addMesh(mesh, at)
      free(mesh)
      free(at)
    }
    // 가로수: 줄기(가는 사각 기둥) + 수관(정이십면체)을 각각 메시 하나로
    if (m.trees.length) {
      const crown = new rhino.Mesh()
      const trunk = new rhino.Mesh()
      const cv = crown.vertices()
      const cf = crown.faces()
      const tv = trunk.vertices()
      const tf = trunk.faces()
      for (const t of m.trees) {
        const hgt = t.h && t.h > 1 ? t.h : 7
        const z0 = m.zAt(t.x, t.y)
        const r = Math.max(1.4, hgt * 0.28)
        const cz = z0 + hgt - r
        const base = cv.count
        for (const [a, b, c] of ICO.v) cv.add(t.x + a * r, t.y + b * r, cz + c * r * 0.9)
        for (const [a, b, c] of ICO.f) cf.addTriFace(base + a, base + b, base + c)
        const tb = tv.count
        const w = 0.15
        const top = cz - r * 0.5
        for (const [dx, dy] of [
          [-w, -w],
          [w, -w],
          [w, w],
          [-w, w],
        ]) {
          tv.add(t.x + dx, t.y + dy, z0)
          tv.add(t.x + dx, t.y + dy, top)
        }
        for (let k = 0; k < 4; k++) {
          const a = tb + 2 * k
          const b = tb + 2 * ((k + 1) % 4)
          tf.addQuadFace(a, b, b + 1, a + 1)
        }
      }
      crown.normals().computeNormals()
      trunk.normals().computeNormals()
      const a1 = attrs('tree', `가로수·독립수 ${m.trees.length}그루`)
      objs.addMesh(crown, a1)
      const a2 = attrs('trunk', '가로수 줄기')
      objs.addMesh(trunk, a2)
      free(crown)
      free(trunk)
      free(a1)
      free(a2)
    }
    // 정류장: 쉘터 상자(어림) + 이름 점
    for (const st of m.stops) {
      const z0 = m.zAt(st.x, st.y)
      const box = new rhino.Mesh()
      const vs = box.vertices()
      const fs = box.faces()
      const [hx, hy, hz] = [1.5, 0.7, 2.6]
      for (const zz of [z0, z0 + hz]) for (const [dx, dy] of [
          [-hx, -hy],
          [hx, -hy],
          [hx, hy],
          [-hx, hy],
        ])
          vs.add(st.x + dx, st.y + dy, zz)
      fs.addQuadFace(4, 5, 6, 7)
      fs.addQuadFace(0, 1, 5, 4)
      fs.addQuadFace(1, 2, 6, 5)
      fs.addQuadFace(2, 3, 7, 6)
      fs.addQuadFace(3, 0, 4, 7)
      box.normals().computeNormals()
      const label = [st.name, st.use].filter(Boolean).join(' · ') || '정류장'
      const at = attrs('stop', label, { 이름: st.name, 용도: st.use })
      objs.addMesh(box, at)
      objs.addTextDot(label, [st.x, st.y, z0 + hz + 0.5], at)
      free(box)
      free(at)
    }
    // 가로등: 7m 기둥 선
    for (const l of m.lamps) {
      const z0 = m.zAt(l.x, l.y)
      addPolyline(
        [
          [l.x, l.y, z0],
          [l.x, l.y, z0 + 7],
        ],
        'lamp',
        '가로등',
      )
    }

    onStep?.('파일 쓰는 중')
    return doc.toByteArray()
  } finally {
    free(doc)
  }
}
