// 국토지리정보원 1:5,000 수치지도 2.0 (국토정보플랫폼에서 도엽별로 받는 ZIP 안의 SHP)을 브라우저에서 읽어 대지 주변만 남긴다.
// 사용자 결정(2026-11-11): 학생이 대지 도엽 ZIP을 ④ 공간정보에 올림 / 도로경계·인도·옹벽·석축·절성토·건물·등고선·표고점을 모두 씀 /
// 도판·환경 계산·3D·DXF까지 반영.
// 확인한 것(광주 2025년판 9장): 좌표계 EPSG:5186(중부원점), 속성 CP949, 도로경계 면은 인도를 포함한 도로 전체,
// 옹벽·절성토 '상단' 선은 그린 방향의 오른쪽이 낮은 쪽(상단–하단 짝 12쌍 중 11쌍).

import { unzipSync } from 'fflate'
import type { Geometry, Position } from 'geojson'
import { beltProjection, utmkToWgs84, wgs84ToUtmk } from '../lib/proj'

export type NgiiKey = 'bldg' | 'road' | 'walk' | 'contour' | 'spot' | 'wall' | 'cutfill' | 'center' | 'crosswalk' | 'safety' | 'stop' | 'tree' | 'fence' | 'lamp' | 'water'
export const NGII_KEYS: NgiiKey[] = ['bldg', 'road', 'walk', 'contour', 'spot', 'wall', 'cutfill', 'center', 'crosswalk', 'safety', 'stop', 'tree', 'fence', 'lamp', 'water']
export const NGII_LABEL: Record<NgiiKey, string> = {
  bldg: '건물',
  road: '도로경계 면',
  walk: '인도',
  contour: '등고선',
  spot: '표고점·기준점',
  wall: '옹벽·석축·제방',
  cutfill: '절토·성토',
  // 아래는 1:1,000 수치지도에만 (15-F, 2026-11-12)
  center: '도로중심선',
  crosswalk: '횡단보도',
  safety: '교통섬·안전지대',
  stop: '정류장',
  tree: '가로수·독립수',
  fence: '담장·가드레일',
  lamp: '가로등',
  water: '하천·호수 면',
}
export const ngiiLayer = (k: NgiiKey | 'sheets') => `ngii:${k}`

/** 건물·도로는 수집 반경 + 이만큼, 지형 자료는 삼각망 가장자리를 위해 더 넓게 */
const SITE_MARGIN = 60
const TERRAIN_MARGIN = 300

export type Rec = Record<string, string>
export type Feat = { type: 'Feature'; geometry: Geometry | null; properties: Record<string, unknown> }

const num = (s: string | undefined): number | null => {
  const v = Number(String(s ?? '').trim())
  return String(s ?? '').trim() !== '' && Number.isFinite(v) ? v : null
}

interface Want {
  match: (name: string) => boolean
  key: NgiiKey
  props: (r: Rec) => Record<string, unknown> | null
  terrain: boolean
}

const WANTS: Want[] = [
  {
    match: (n) => n === 'N3A_B0010000',
    key: 'bldg',
    props: (r) => ({ name: r['명칭'] ?? '', kind: r['종류'] ?? '', use: r['용도'] ?? '', floors: num(r['층수']), note: r['주기'] ?? '' }),
    terrain: false,
  },
  { match: (n) => n === 'N3A_A0010000', key: 'road', props: () => ({}), terrain: false },
  { match: (n) => n.startsWith('N3A_A003'), key: 'walk', props: (r) => ({ width: num(r['폭']), material: r['재질'] ?? '' }), terrain: false },
  {
    match: (n) => n === 'N3L_F0010000',
    key: 'contour',
    props: (r) => {
      const z = num(r['등고수치'])
      return z === null ? null : { z, major: r['구분'] === '계곡선' }
    },
    terrain: true,
  },
  {
    match: (n) => n === 'N3P_F0020000',
    key: 'spot',
    props: (r) => {
      const z = num(r['수치'])
      return z === null ? null : { z }
    },
    terrain: true,
  },
  {
    match: (n) => n === 'N3P_H0020000',
    key: 'spot',
    props: (r) => {
      const z = num(r['표고'])
      return z === null || z === 0 ? null : { z, benchmark: r['구분'] ?? '기준점' }
    },
    terrain: true,
  },
  {
    match: (n) => n === 'N3L_F0040000',
    key: 'wall',
    props: (r) => ({ kind: r['종류'] || '옹벽', top: r['상하구분'] !== '하단', h: num(r['높이']) }),
    terrain: true,
  },
  {
    match: (n) => n === 'N3L_C0050000',
    key: 'wall',
    props: (r) => ({ kind: r['구분'] || '제방', top: r['상하구분'] !== '하단', h: num(r['높이']) }),
    terrain: true,
  },
  {
    match: (n) => n === 'N3L_F0030000',
    key: 'cutfill',
    props: (r) => ({ kind: r['구분'] ?? '', top: r['상하구분'] !== '하단' }),
    terrain: true,
  },
]

// ───────────────────────── SHP·DBF 읽기 ─────────────────────────

export interface ShpRec {
  type: number
  parts: number[][][]
  bbox: [number, number, number, number]
  /** Z가 있는 형식(PointZ·PolyLineZ·PolygonZ)이면 꼭짓점마다 높이 (parts와 같은 모양) */
  z?: number[][]
}

export function readShp(buf: Uint8Array): (ShpRec | null)[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const out: (ShpRec | null)[] = []
  let off = 100
  while (off + 12 <= buf.length) {
    const len = dv.getInt32(off + 4, false) * 2
    const c = off + 8
    const t = dv.getInt32(c, true)
    if (t === 1 || t === 11 || t === 21) {
      const x = dv.getFloat64(c + 4, true)
      const y = dv.getFloat64(c + 12, true)
      const rec: ShpRec = { type: 1, parts: [[[x, y]]], bbox: [x, y, x, y] }
      if (t === 11 && len >= 28) rec.z = [[dv.getFloat64(c + 20, true)]]
      out.push(rec)
    } else if (t === 3 || t === 5 || t === 13 || t === 15 || t === 23 || t === 25) {
      const bbox: [number, number, number, number] = [dv.getFloat64(c + 4, true), dv.getFloat64(c + 12, true), dv.getFloat64(c + 20, true), dv.getFloat64(c + 28, true)]
      const np = dv.getInt32(c + 36, true)
      const n = dv.getInt32(c + 40, true)
      const starts: number[] = []
      for (let i = 0; i < np; i++) starts.push(dv.getInt32(c + 44 + 4 * i, true))
      const p0 = c + 44 + 4 * np
      const parts: number[][][] = []
      for (let i = 0; i < np; i++) {
        const e = i + 1 < np ? starts[i + 1] : n
        const pts: number[][] = []
        for (let j = starts[i]; j < e; j++) pts.push([dv.getFloat64(p0 + 16 * j, true), dv.getFloat64(p0 + 16 * j + 8, true)])
        parts.push(pts)
      }
      const rec: ShpRec = { type: t % 10 === 5 ? 5 : 3, parts, bbox }
      // Z: 점 다음에 범위(16바이트) + 꼭짓점마다 8바이트
      const z0 = p0 + 16 * n + 16
      if ((t === 13 || t === 15) && z0 + 8 * n <= c + len)
        rec.z = parts.map((_, i) => {
          const e = i + 1 < np ? starts[i + 1] : n
          const zs: number[] = []
          for (let j = starts[i]; j < e; j++) zs.push(dv.getFloat64(z0 + 8 * j, true))
          return zs
        })
      out.push(rec)
    } else out.push(null)
    off = c + len
  }
  return out
}

export function readDbf(buf: Uint8Array, dec: TextDecoder): (Rec | null)[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const n = dv.getUint32(4, true)
  const headerLen = dv.getUint16(8, true)
  const recLen = dv.getUint16(10, true)
  const fields: { name: string; len: number }[] = []
  for (let o = 32; o + 32 <= headerLen && buf[o] !== 0x0d; o += 32) {
    let e = o
    while (e < o + 11 && buf[e] !== 0) e++
    fields.push({ name: dec.decode(buf.subarray(o, e)).trim(), len: buf[o + 16] })
  }
  const out: (Rec | null)[] = []
  for (let i = 0; i < n; i++) {
    const base = headerLen + i * recLen
    if (base + recLen > buf.length) break
    if (buf[base] === 0x2a) {
      out.push(null)
      continue
    }
    const rec: Rec = {}
    let off = base + 1
    for (const f of fields) {
      rec[f.name] = dec.decode(buf.subarray(off, off + f.len)).replace(/\0/g, '').trim()
      off += f.len
    }
    out.push(rec)
  }
  return out
}

export function epsgOf(prj: string): number | null {
  if (/East_Sea_Belt/i.test(prj)) return 5188
  if (/East_Belt/i.test(prj)) return 5187
  if (/Central_Belt/i.test(prj)) return 5186
  if (/West_Belt/i.test(prj)) return 5185
  if (/Unified|UTM[-_ ]?K|central_meridian",127\.5/i.test(prj)) return 5179
  return null
}

function ringArea(r: number[][]): number {
  let s = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]
  return s / 2
}

function inRing([x, y]: number[], ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function toGeometry(rec: ShpRec, f: (x: number, y: number) => Position): Geometry | null {
  if (rec.type === 1) return { type: 'Point', coordinates: f(rec.parts[0][0][0], rec.parts[0][0][1]) }
  const conv = (pts: number[][]) => pts.map(([x, y]) => f(x, y))
  if (rec.type === 3) {
    const lines = rec.parts.filter((p) => p.length > 1).map(conv)
    if (!lines.length) return null
    return lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines }
  }
  // 다각형: SHP는 바깥 고리 시계 방향, 구멍 반시계 → 바깥마다 구멍을 찾아 붙인다
  const rings = rec.parts.filter((p) => p.length >= 4)
  const outers: number[][][][] = []
  const holes: number[][][] = []
  for (const r of rings) (ringArea(r) <= 0 ? outers.push([r]) : holes.push(r))
  for (const h of holes) {
    const host = outers.find((o) => inRing(h[0], o[0]))
    if (host) host.push(h)
    else outers.push([h])
  }
  if (!outers.length) return null
  const polys = outers.map((p) => p.map(conv))
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys }
}

// ───────────────────────── 도엽 하나 읽기 ─────────────────────────

export interface NgiiSheet {
  code: string
  year: string | null
  file: string
  epsg: number
  /** 축척 (없으면 5000) */
  scale?: 1000 | 5000
  /** 도엽 범위 [서, 남, 동, 북] (1:1,000은 파일 머리의 BOUND로) */
  boundsLL?: [number, number, number, number]
  counts: Partial<Record<NgiiKey, number>>
  features: Partial<Record<NgiiKey, Feat[]>>
}

const round8 = (v: number) => Math.round(v * 1e8) / 1e8

/**
 * 수치지도 2.0 ZIP 하나를 읽어 대지 중심 반경 안의 필요한 레이어만 경위도 도형으로 돌려준다.
 * @throws 수치지도 2.0 ZIP이 아니거나 좌표계를 알 수 없을 때
 */
export function readNgiiZip(name: string, data: Uint8Array, center: [number, number], radiusM: number): NgiiSheet {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data)
  } catch {
    throw new Error(`${name}: ZIP 파일을 열 수 없습니다`)
  }
  const byBase = new Map<string, Record<string, Uint8Array>>()
  for (const [path, bytes] of Object.entries(files)) {
    const m = path.replace(/\\/g, '/').split('/').pop()!.match(/^(.+)\.(shp|shx|dbf|prj|cpg)$/i)
    if (!m) continue
    const rec = byBase.get(m[1]) ?? {}
    rec[m[2].toLowerCase()] = bytes
    byBase.set(m[1], rec)
  }
  const bases = [...byBase.keys()]
  if (!bases.some((b) => /^N3[ALP]_/.test(b))) {
    throw new Error(`${name}: 수치지도 2.0 레이어(N3A_·N3L_·N3P_로 시작하는 SHP)가 없습니다. 국토정보플랫폼에서 '수치지도 2.0'을 받아 주세요`)
  }
  const codeFromName = name.match(/(\d{8})_(\d{4})/)
  const sheetCode = codeFromName?.[1] ?? name.match(/\d{8}/)?.[0] ?? ''
  const year = codeFromName?.[2] ?? null

  let epsg: number | null = null
  for (const b of bases) {
    const prj = byBase.get(b)!.prj
    if (prj) {
      epsg = epsgOf(new TextDecoder().decode(prj))
      if (epsg) break
    }
  }
  if (!epsg) throw new Error(`${name}: 좌표계(.prj)를 알 수 없습니다`)
  const toLonLat =
    epsg === 5179
      ? (x: number, y: number): Position => {
          const [lo, la] = utmkToWgs84(x, y)
          return [round8(lo), round8(la)]
        }
      : (() => {
          const p = beltProjection(epsg!)
          return (x: number, y: number): Position => {
            const [lo, la] = p.toLonLat(x, y)
            return [round8(lo), round8(la)]
          }
        })()
  const [cx, cy] = epsg === 5179 ? wgs84ToUtmk(center[0], center[1]) : beltProjection(epsg).fromLonLat(center[0], center[1])
  const near = (b: [number, number, number, number], margin: number) => {
    const r = radiusM + margin
    return b[2] >= cx - r && b[0] <= cx + r && b[3] >= cy - r && b[1] <= cy + r
  }

  const out: NgiiSheet = { code: sheetCode, year, file: name, epsg, counts: {}, features: {} }
  for (const base of bases) {
    const want = WANTS.find((w) => w.match(base))
    if (!want) continue
    const fset = byBase.get(base)!
    if (!fset.shp || !fset.dbf) continue
    const cpg = fset.cpg ? new TextDecoder().decode(fset.cpg).trim().toLowerCase() : ''
    const dec = new TextDecoder(/utf-?8/.test(cpg) ? 'utf-8' : 'euc-kr')
    const shapes = readShp(fset.shp)
    const recs = readDbf(fset.dbf, dec)
    const list = (out.features[want.key] ??= [])
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i]
      const r = recs[i]
      if (!s || !r) continue
      if (!near(s.bbox, want.terrain ? TERRAIN_MARGIN : SITE_MARGIN)) continue
      const props = want.props(r)
      if (!props) continue
      const geometry = toGeometry(s, toLonLat)
      if (!geometry) continue
      list.push({ type: 'Feature', geometry, properties: { ...props, sheet: sheetCode } })
    }
  }
  for (const k of NGII_KEYS) if (out.features[k]) out.counts[k] = out.features[k]!.length
  return out
}
