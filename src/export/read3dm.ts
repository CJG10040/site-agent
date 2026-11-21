// 라이노 .3dm 읽기 (2026-11-21 묶음 C1): 내 설계안 매스·주변 변경을 앱으로 가져온다.
// rhino3dm.js에는 폴리서피스(Brep)를 메시로 바꾸는 기능이 없어서:
//  - 메시: 그대로
//  - 돌출(Extrusion): 파일에 저장된 렌더 메시 → 없으면 윤곽(아래·위) + 벽·뚜껑을 직접 삼각형으로
//  - 폴리서피스(Brep): 면마다 저장된 렌더 메시 → 없으면 평평한 면만 테두리로 직접 삼각형, 굽은 면은 '메시로 바꿔 저장' 안내
//  - 블록·SubD·곡선·점·글자 등은 읽지 않고 목록에 까닭을 적음
// wasm 메모리: 도형·속성·파일은 free, 목록 객체(레이어 표·물체 표·면 목록 등)는 delete가 '항목 지우기'라 부르지 않음.
// 좌표는 모형 단위를 미터로 바꾼다. 앱이 내보낸 .3dm(대지 중심 = 원점, 미터, 지구 기준점 = 대지 중심)에 그리면 그대로 대지 위.

import earcut from 'earcut'
import type { RhinoModule } from 'rhino3dm'
import { free, loadRhino } from './to3dm'

/** 삼각형 묶음: 꼭짓점 xyz(미터, 파일 좌표 그대로) + 세 개씩 번호 */
export interface TriMesh {
  positions: number[]
  indices: number[]
}

export interface Read3dmObject {
  id: string
  name: string
  layer: string
  /** 메시 · 돌출 · 폴리서피스 · 블록 · 곡선 … */
  kind: string
  triangles: number
  status: 'ok' | 'partial' | 'skip'
  /** 읽은 방법이나 못 읽은 까닭 */
  note: string
}

export interface Read3dmLayer {
  index: number
  path: string
  /** 이 레이어에 있는 물체 수 */
  objects: number
  /** 읽은 삼각형 수 */
  triangles: number
}

export interface Read3dmResult {
  /** 모형 단위 이름과 미터로 바꾸는 배율 */
  units: string
  scale: number
  /** 지구 기준점 (앱이 내보낸 파일이면 대지 중심) — 정해지지 않았으면 null */
  anchor: { lat: number; lon: number; elev: number } | null
  layers: Read3dmLayer[]
  objects: Read3dmObject[]
  /** 레이어 경로 → 삼각형 (미터) */
  meshes: Record<string, TriMesh>
  /** 읽은 것 전체의 범위 (미터) [minX, minY, minZ, maxX, maxY, maxZ], 없으면 null */
  bbox: [number, number, number, number, number, number] | null
}

type Rhino = RhinoModule
type XYZ = [number, number, number]

const UNIT_SCALE: [string, number, string][] = [
  ['Millimeters', 0.001, 'mm'],
  ['Centimeters', 0.01, 'cm'],
  ['Decimeters', 0.1, 'dm'],
  ['Meters', 1, 'm'],
  ['Kilometers', 1000, 'km'],
  ['Inches', 0.0254, 'inch'],
  ['Feet', 0.3048, 'ft'],
  ['Yards', 0.9144, 'yd'],
]

function unitsOf(rhino: Rhino, u: unknown): { units: string; scale: number; known: boolean } {
  const us = rhino.UnitSystem as unknown as Record<string, unknown>
  for (const [k, s, label] of UNIT_SCALE) if (us[k] === u) return { units: label, scale: s, known: true }
  return { units: '정해지지 않음(미터로 봄)', scale: 1, known: false }
}

/** 곡선 → 점들 (꺾은선은 꼭짓점 그대로, 굽은 선은 24칸으로 나눔), 닫힌 곡선이면 끝점 중복을 뺌 */
function curvePoints(c: unknown, steps = 24): XYZ[] {
  const curve = c as { toNurbsCurve: () => unknown; domain: number[]; pointAt: (t: number) => number[] }
  const out: XYZ[] = []
  const nc = curve.toNurbsCurve() as { order: number; points: () => { count: number; get: (i: number) => number[] } } | null
  try {
    if (nc && nc.order === 2) {
      const cps = nc.points()
      for (let i = 0; i < cps.count; i++) {
        const p = cps.get(i)
        const w = p.length > 3 && p[3] !== 0 ? p[3] : 1
        out.push([p[0] / w, p[1] / w, p[2] / w])
      }
    } else {
      const [t0, t1] = curve.domain
      for (let k = 0; k <= steps; k++) {
        const p = curve.pointAt(t0 + ((t1 - t0) * k) / steps)
        out.push([p[0], p[1], p[2]])
      }
    }
  } finally {
    free(nc)
  }
  const a = out[0]
  const b = out[out.length - 1]
  if (out.length > 1 && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-9) out.pop()
  return out
}

/** 다각형(3D)의 법선 (Newell) */
function newell(ring: XYZ[]): XYZ {
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1, z1] = ring[i]
    const [x2, y2, z2] = ring[(i + 1) % ring.length]
    nx += (y1 - y2) * (z1 + z2)
    ny += (z1 - z2) * (x1 + x2)
    nz += (x1 - x2) * (y1 + y2)
  }
  const l = Math.hypot(nx, ny, nz) || 1
  return [nx / l, ny / l, nz / l]
}

/** 평평한 면(바깥 고리 + 구멍들)을 삼각형으로. 평평하지 않으면 false */
function addPlanar(out: TriMesh, rings: XYZ[][], s: number): number | false {
  const outer = rings[0]
  if (!outer || outer.length < 3) return 0
  const n = newell(outer)
  // 평평한지: 모든 점이 바깥 고리 평면에서 크기의 0.5% 안
  const o = outer[0]
  let size = 0
  for (const p of outer) size = Math.max(size, Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]))
  for (const r of rings) for (const p of r) if (Math.abs((p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1] + (p[2] - o[2]) * n[2]) > Math.max(1e-6, size * 0.005)) return false
  // 법선이 가장 큰 축을 버리고 2D로
  const ax = Math.abs(n[0])
  const ay = Math.abs(n[1])
  const az = Math.abs(n[2])
  const [i, j] = az >= ax && az >= ay ? [0, 1] : ax >= ay ? [1, 2] : [0, 2]
  const flat: number[] = []
  const holes: number[] = []
  const pts: XYZ[] = []
  rings.forEach((r, k) => {
    if (k > 0) holes.push(pts.length)
    for (const p of r) {
      flat.push(p[i], p[j])
      pts.push(p)
    }
  })
  const tri = earcut(flat, holes.length ? holes : undefined, 2)
  const base = out.positions.length / 3
  for (const p of pts) out.positions.push(p[0] * s, p[1] * s, p[2] * s)
  for (const t of tri) out.indices.push(base + t)
  return tri.length / 3
}

function addMesh(out: TriMesh, mesh: unknown, s: number): number {
  const m = mesh as { vertices: () => { count: number; get: (i: number) => number[] }; faces: () => { count: number; get: (i: number) => number[] } }
  const vs = m.vertices()
  const fs = m.faces()
  const base = out.positions.length / 3
  for (let i = 0; i < vs.count; i++) {
    const p = vs.get(i)
    out.positions.push(p[0] * s, p[1] * s, p[2] * s)
  }
  let n = 0
  for (let i = 0; i < fs.count; i++) {
    const [a, b, c, d] = fs.get(i)
    out.indices.push(base + a, base + b, base + c)
    n++
    if (d !== c) {
      out.indices.push(base + a, base + c, base + d)
      n++
    }
  }
  return n
}

/** 돌출: 렌더 메시가 없을 때 윤곽으로 직접 (벽 + 위아래 뚜껑) */
function extrusionTris(out: TriMesh, ext: unknown, s: number): number {
  const e = ext as { profileCount: number; profile3d: (i: number, t: number) => unknown; isCappedAtBottom: boolean; isCappedAtTop: boolean }
  let n = 0
  const bottoms: XYZ[][] = []
  const tops: XYZ[][] = []
  for (let k = 0; k < e.profileCount; k++) {
    const cb = e.profile3d(k, 0)
    const ct = e.profile3d(k, 1)
    const b = curvePoints(cb)
    const t = curvePoints(ct)
    free(cb)
    free(ct)
    if (b.length < 2 || b.length !== t.length) continue
    bottoms.push(b)
    tops.push(t)
    const base = out.positions.length / 3
    for (const p of [...b, ...t]) out.positions.push(p[0] * s, p[1] * s, p[2] * s)
    const L = b.length
    for (let q = 0; q < L; q++) {
      const q2 = (q + 1) % L
      out.indices.push(base + q, base + q2, base + L + q2, base + q, base + L + q2, base + L + q)
      n += 2
    }
  }
  if (e.isCappedAtBottom && bottoms.length) n += addPlanar(out, bottoms, s) || 0
  if (e.isCappedAtTop && tops.length) n += addPlanar(out, tops, s) || 0
  return n
}

/** 폴리서피스 면 하나의 고리들 (바깥 고리 먼저), 모서리 곡선을 이어서 */
function faceRings(rhino: Rhino, brep: unknown, face: unknown): XYZ[][] {
  const OUTER = ((rhino as unknown as Record<string, Record<string, unknown> | undefined>).BrepLoopType ?? {}).Outer
  const b = brep as { edges: () => { count: number; get: (i: number) => unknown } }
  const f = face as { loops: { count: number; get: (i: number) => { loopType: unknown; trims: { count: number; get: (i: number) => { edgeIndex: number; isReversed: boolean } } } } }
  const edges = b.edges()
  const rings: { outer: boolean; pts: XYZ[] }[] = []
  for (let li = 0; li < f.loops.count; li++) {
    const loop = f.loops.get(li)
    const pts: XYZ[] = []
    for (let ti = 0; ti < loop.trims.count; ti++) {
      const tr = loop.trims.get(ti)
      if (tr.edgeIndex < 0) continue
      const edge = edges.get(tr.edgeIndex)
      let ep = curvePoints(edge, 12)
      // 닫힌 모서리(원 등)는 curvePoints가 끝점을 뺐으니 그대로, 열린 모서리는 끝점을 다음 모서리가 잇는다
      if (tr.isReversed) ep = ep.reverse()
      const closedEdge = (edge as { isClosed?: boolean }).isClosed
      pts.push(...(closedEdge ? ep : ep.slice(0, -1)))
      free(edge)
    }
    rings.push({ outer: loop.loopType === OUTER, pts })
  }
  rings.sort((a, b2) => Number(b2.outer) - Number(a.outer))
  return rings.map((r) => r.pts).filter((r) => r.length >= 3)
}

export async function read3dm(bytes: Uint8Array): Promise<Read3dmResult> {
  const rhino = await loadRhino()
  const doc = rhino.File3dm.fromByteArray(bytes)
  if (!doc) throw new Error('라이노 파일(.3dm)로 읽을 수 없습니다. 라이노 7·8에서 저장한 파일인지 확인하세요.')
  try {
    const settings = doc.settings()
    const { units, scale } = unitsOf(rhino, settings.modelUnitSystem)
    const ea = settings.earthAnchorPoint
    // 정해지지 않은 기준점은 0,0 이거나 '값 없음'(-1.23e308)
    const lat = ea?.earthBasepointLatitude ?? NaN
    const lon = ea?.earthBasepointLongitude ?? NaN
    const okAnchor = Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0)
    const elev = ea?.earthBasepointElevation ?? 0
    const anchor = okAnchor ? { lat, lon, elev: Math.abs(elev) < 1e6 ? elev * scale : 0 } : null
    free(ea)
    free(settings)

    const layerTable = doc.layers()
    const layerPath = new Map<number, string>()
    for (let i = 0; i < layerTable.count; i++) {
      const L = layerTable.get(i)
      layerPath.set(L.index, L.fullPath || L.name || `레이어 ${L.index}`)
      free(L)
    }

    const OT = rhino.ObjectType as unknown as Record<string, unknown>
    const MT = rhino.MeshType as unknown as Record<string, unknown>
    const meshes: Record<string, TriMesh> = {}
    const objects: Read3dmObject[] = []
    const table = doc.objects()
    for (let i = 0; i < table.count; i++) {
      const obj = table.get(i)
      const attr = obj.attributes()
      const geom = obj.geometry() as unknown as { objectType: unknown; getMesh?: (t: unknown) => unknown; faces?: () => { count: number; get: (i: number) => unknown } }
      const layer = layerPath.get(attr.layerIndex) ?? '기본'
      const rec: Read3dmObject = { id: attr.id, name: attr.name || '', layer, kind: '기타', triangles: 0, status: 'skip', note: '' }
      const out = (meshes[layer] ??= { positions: [], indices: [] })
      const t = geom?.objectType
      try {
        if (t === OT.Mesh) {
          rec.kind = '메시'
          rec.triangles = addMesh(out, geom, scale)
          rec.note = '메시 그대로'
        } else if (t === OT.Extrusion) {
          rec.kind = '돌출'
          const m = geom.getMesh?.(MT.Any) ?? null
          if (m) {
            rec.triangles = addMesh(out, m, scale)
            rec.note = '저장된 렌더 메시'
            free(m)
          } else {
            rec.triangles = extrusionTris(out, geom, scale)
            rec.note = '윤곽과 높이로 직접 만듦'
          }
        } else if (t === OT.Brep) {
          rec.kind = '폴리서피스'
          const faces = geom.faces!()
          let fromMesh = 0
          let fromEdge = 0
          let curved = 0
          for (let fi = 0; fi < faces.count; fi++) {
            const face = faces.get(fi) as { getMesh: (t: unknown) => unknown }
            const m = face.getMesh(MT.Any)
            if (m) {
              rec.triangles += addMesh(out, m, scale)
              fromMesh++
              free(m)
            } else {
              const r = addPlanar(out, faceRings(rhino, geom, face), scale)
              if (r === false) curved++
              else {
                rec.triangles += r
                fromEdge++
              }
            }
            free(face)
          }
          rec.note =
            fromMesh && !fromEdge && !curved
              ? '저장된 렌더 메시'
              : `${fromMesh ? `렌더 메시 ${fromMesh}면 · ` : ''}${fromEdge ? `평평한 면 ${fromEdge}개를 테두리로 직접 · ` : ''}${curved ? `굽은 면 ${curved}개 못 읽음 — 라이노에서 Mesh로 바꾸거나 음영 보기로 한 번 본 뒤 저장` : ''}`.replace(/ · $/, '')
          if (curved && rec.triangles) rec.status = 'partial'
        } else if (t === OT.InstanceReference) {
          rec.kind = '블록'
          rec.note = '블록은 읽지 않음 — 라이노에서 Explode 한 뒤 저장'
        } else if (t === OT.SubD) {
          rec.kind = 'SubD'
          rec.note = 'SubD는 읽지 않음 — 라이노에서 ToNURBS 또는 Mesh로 바꾼 뒤 저장'
        } else if (t === OT.Surface) {
          rec.kind = '면'
          rec.note = '열린 면 하나는 매스가 아니라 읽지 않음'
        } else if (t === OT.Curve || t === OT.Point || t === OT.PointSet || t === OT.Annotation || t === OT.TextDot || t === OT.Hatch) {
          rec.kind = t === OT.Curve ? '곡선' : t === OT.Annotation || t === OT.TextDot ? '글자' : t === OT.Hatch ? '해치' : '점'
          rec.note = '매스가 아니라 읽지 않음'
        } else {
          rec.note = '읽지 않는 종류'
        }
        if (rec.triangles > 0 && rec.status === 'skip') rec.status = 'ok'
        if (rec.triangles === 0 && rec.status !== 'skip') rec.status = 'skip'
        if (rec.triangles === 0 && (rec.kind === '폴리서피스' || rec.kind === '돌출') && !rec.note.includes('못 읽음')) rec.note = `${rec.note} — 삼각형을 만들지 못함`
      } catch (e) {
        rec.status = 'skip'
        rec.note = `읽다가 오류: ${e instanceof Error ? e.message : String(e)}`
      }
      objects.push(rec)
      free(geom)
      free(attr)
      free(obj)
    }

    // 빈 레이어 묶음은 빼고, 범위
    let bbox: Read3dmResult['bbox'] = null
    for (const [k, m] of Object.entries(meshes)) {
      if (!m.indices.length) {
        delete meshes[k]
        continue
      }
      for (let i = 0; i < m.positions.length; i += 3) {
        const x = m.positions[i]
        const y = m.positions[i + 1]
        const z = m.positions[i + 2]
        if (!bbox) bbox = [x, y, z, x, y, z]
        else {
          bbox[0] = Math.min(bbox[0], x)
          bbox[1] = Math.min(bbox[1], y)
          bbox[2] = Math.min(bbox[2], z)
          bbox[3] = Math.max(bbox[3], x)
          bbox[4] = Math.max(bbox[4], y)
          bbox[5] = Math.max(bbox[5], z)
        }
      }
    }
    const layers: Read3dmLayer[] = [...layerPath.entries()]
      .map(([index, path]) => ({ index, path, objects: objects.filter((o) => o.layer === path).length, triangles: objects.filter((o) => o.layer === path).reduce((n, o) => n + o.triangles, 0) }))
      .filter((l) => l.objects > 0)
    return { units, scale, anchor, layers, objects, meshes, bbox }
  } finally {
    free(doc)
  }
}
