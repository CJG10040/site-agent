// 15-F 국토지리정보원 1:1,000 수치지도 2.0 (NGI·NDA) 읽기 (2026-11-12 사용자가 받은 유스퀘어 주변 9도엽으로 형식 확인).
// NGI = 도형(글자, CP949): 레이어마다 <LAYER_START> … $LAYER_NAME "B0010000" … <DATA> $RECORD id / POINT·LINESTRING·POLYGON(NUMPARTS) / 좌표
// NDA = 속성(글자, CP949): 레이어마다 ATTRIB("이름", …) 정의 + $RECORD id / 값들(쉼표, 글자는 따옴표). $RECORD 번호가 도형과 같다.
// 좌표계: 평면직각(이 도엽은 EPSG:5186 중부원점) — 머리에 좌표계가 없어 대지 경도로 원점을 고른다(UTM-K 범위면 5179).
// 1:5,000과 같은 레이어 코드(B001 건물, A001 도로경계, F001 등고선 …)에 1:1,000에만 있는 것(도로중심선 폭·횡단보도·정류장·가로수·담장·가로등)을 더한다.

import type { Geometry, Position } from 'geojson'
import { beltProjection, utmkToWgs84, wgs84ToUtmk } from '../lib/proj'
import { NGII_KEYS, type Feat, type NgiiKey, type NgiiSheet, type Rec } from './ngiiMap'

const SITE_MARGIN = 60
const TERRAIN_MARGIN = 300

const num = (s: string | undefined): number | null => {
  const t = String(s ?? '').trim()
  const v = Number(t)
  return t !== '' && Number.isFinite(v) ? v : null
}

type GeomKind = 'point' | 'line' | 'polygon'

interface Want {
  match: RegExp
  key: NgiiKey
  kinds: GeomKind[]
  props: (r: Rec) => Record<string, unknown> | null
  terrain?: boolean
}

const WANTS: Want[] = [
  { match: /^B001/, key: 'bldg', kinds: ['polygon'], props: (r) => ({ name: r['명칭'] ?? '', kind: r['종류'] ?? '', use: r['용도'] ?? '', floors: num(r['층수']), note: r['주기'] ?? '' }) },
  { match: /^A001/, key: 'road', kinds: ['polygon'], props: () => ({}) },
  { match: /^A003/, key: 'walk', kinds: ['polygon'], props: (r) => ({ width: num(r['폭']), material: r['재질'] ?? '' }) },
  // 1:1,000 보도는 선(보도 가운데) + 폭 — 도로경계에서 폭의 절반쯤 안쪽 (2026-11-13 확인: 거리/폭 중앙값 0.69) → 3D에서 폭만큼 넓혀 15cm 올림
  { match: /^A003/, key: 'walkline', kinds: ['line'], props: (r) => ({ width: num(r['폭']), material: r['재질'] ?? '' }) },
  {
    match: /^F001/,
    key: 'contour',
    kinds: ['line'],
    terrain: true,
    props: (r) => {
      const z = num(r['등고수치'])
      return z === null ? null : { z, major: r['구분'] === '계곡선' }
    },
  },
  {
    match: /^F002/,
    key: 'spot',
    kinds: ['point'],
    terrain: true,
    props: (r) => {
      const z = num(r['수치'])
      return z === null ? null : { z }
    },
  },
  {
    match: /^H002/,
    key: 'spot',
    kinds: ['point'],
    terrain: true,
    props: (r) => {
      const z = num(r['표고'])
      return z === null || z === 0 ? null : { z, benchmark: r['구분'] || '기준점' }
    },
  },
  { match: /^F004/, key: 'wall', kinds: ['line'], terrain: true, props: (r) => ({ kind: r['종류'] || '옹벽', top: r['상하구분'] !== '하단', h: num(r['높이']) }) },
  { match: /^C005/, key: 'wall', kinds: ['line'], terrain: true, props: (r) => ({ kind: r['구분'] || '제방', top: r['상하구분'] !== '하단', h: num(r['높이']) }) },
  { match: /^F003/, key: 'cutfill', kinds: ['line'], terrain: true, props: (r) => ({ kind: r['구분'] ?? '', top: r['상하구분'] !== '하단' }) },
  // 1:1,000에만
  {
    match: /^A002/,
    key: 'center',
    kinds: ['line'],
    props: (r) => ({ width: num(r['도로폭']), lanes: num(r['차로수']), name: r['도로명'] || r['명칭'] || '', kind: r['도로구분'] ?? '', oneway: r['일방통행'] === '일방통행' }),
  },
  { match: /^A004/, key: 'crosswalk', kinds: ['polygon'], props: () => ({}) },
  // 안전지대: 구조 = 교통섬(올라온 섬) / 평면(도색)(노란 빗금) / 어린이보호구역(적색 포장)
  { match: /^A005/, key: 'safety', kinds: ['polygon'], props: (r) => ({ kind: r['구조'] ?? '', name: r['명칭'] ?? '' }) },
  { match: /^A014/, key: 'stop', kinds: ['point'], props: (r) => ({ name: r['명칭'] ?? '', use: r['용도'] ?? '' }) },
  { match: /^D003/, key: 'tree', kinds: ['point'], props: (r) => ({ kind: r['구분'] ?? '', species: r['수종'] ?? '', h: num(r['높이']), d: num(r['직경']) }) },
  { match: /^B002/, key: 'fence', kinds: ['line'], props: (r) => ({ kind: r['구분'] || '담장', material: r['재질'] ?? '' }) },
  { match: /^C053/, key: 'fence', kinds: ['line'], props: (r) => ({ kind: r['명칭'] || '가드레일', material: r['재질'] ?? '' }) },
  { match: /^C022/, key: 'lamp', kinds: ['point'], props: (r) => ({ kind: r['구분'] ?? '' }) },
  { match: /^E0/, key: 'water', kinds: ['polygon'], props: (r) => ({ name: r['명칭'] ?? '' }) },
]

interface NgiRec {
  id: number
  kind: GeomKind
  parts: number[][][]
}

/** NGI 글 → 레이어 이름별 도형 + 범위 */
function parseNgi(text: string): { layers: Map<string, NgiRec[]>; bound: [number, number, number, number] | null } {
  const layers = new Map<string, NgiRec[]>()
  let bound: [number, number, number, number] | null = null
  for (const block of text.split('<LAYER_START>').slice(1)) {
    const name = /\$LAYER_NAME\s*\r?\n\s*"([^"]*)"/.exec(block)?.[1] ?? ''
    if (!bound) {
      const b = /BOUND\(([^)]*)\)/.exec(block)?.[1].split(',').map(Number)
      if (b && b.length === 4 && b.every(Number.isFinite)) bound = [b[0], b[1], b[2], b[3]]
    }
    const di = block.indexOf('<DATA>')
    if (!name || di < 0) continue
    const lines = block.slice(di + 6).split(/\r?\n/)
    const recs: NgiRec[] = []
    const xy = (s: string) => {
      const [a, b] = s.trim().split(/\s+/)
      return [Number(a), Number(b)]
    }
    for (let i = 0; i < lines.length; i++) {
      const m = /^\$RECORD\s+(\d+)/.exec(lines[i])
      if (!m) continue
      const id = Number(m[1])
      const t = (lines[++i] ?? '').trim()
      if (t === 'POINT') recs.push({ id, kind: 'point', parts: [[xy(lines[++i])]] })
      else if (t === 'LINESTRING') {
        const n = Number(lines[++i])
        const pts: number[][] = []
        for (let k = 0; k < n; k++) pts.push(xy(lines[++i]))
        recs.push({ id, kind: 'line', parts: [pts] })
      } else if (t === 'POLYGON') {
        const np = Number(/NUMPARTS\s+(\d+)/.exec(lines[++i])?.[1] ?? 1)
        const parts: number[][][] = []
        for (let p = 0; p < np; p++) {
          const n = Number(lines[++i])
          const pts: number[][] = []
          for (let k = 0; k < n; k++) pts.push(xy(lines[++i]))
          parts.push(pts)
        }
        recs.push({ id, kind: 'polygon', parts })
      }
    }
    layers.set(name, [...(layers.get(name) ?? []), ...recs])
  }
  return { layers, bound }
}

/** 쉼표로 나눈 값 (따옴표 안 쉼표는 그대로) */
function splitCsv(line: string): string[] {
  const out: string[] = []
  const re = /\s*(?:"((?:[^"]|"")*)"|([^,]*?))\s*(?:,|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) && m[0] !== '') {
    out.push(m[1] !== undefined ? m[1].replace(/""/g, '"') : (m[2] ?? '').trim())
    if (re.lastIndex >= line.length) break
  }
  return out
}

/** NDA 글 → 레이어 이름별 (id → 속성) */
function parseNda(text: string): Map<string, Map<number, Rec>> {
  const out = new Map<string, Map<number, Rec>>()
  for (const block of text.split('<LAYER_START>').slice(1)) {
    const name = /\$LAYER_NAME\s*\r?\n\s*"([^"]*)"/.exec(block)?.[1] ?? ''
    const fields = [...block.matchAll(/ATTRIB\("([^"]*)"/g)].map((m) => m[1])
    const di = block.indexOf('<DATA>')
    if (!name || di < 0) continue
    const map = out.get(name) ?? new Map<number, Rec>()
    const lines = block.slice(di + 6).split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const m = /^\$RECORD\s+(\d+)/.exec(lines[i])
      if (!m) continue
      const vals = splitCsv(lines[++i] ?? '')
      const rec: Rec = {}
      fields.forEach((f, k) => (rec[f] = vals[k] ?? ''))
      map.set(Number(m[1]), rec)
    }
    out.set(name, map)
  }
  return out
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

function toGeom(r: NgiRec, f: (x: number, y: number) => Position): Geometry | null {
  if (r.kind === 'point') return { type: 'Point', coordinates: f(r.parts[0][0][0], r.parts[0][0][1]) }
  const conv = (pts: number[][]) => pts.map(([x, y]) => f(x, y))
  if (r.kind === 'line') return r.parts[0].length > 1 ? { type: 'LineString', coordinates: conv(r.parts[0]) } : null
  // 다각형: 큰 고리부터 바깥, 안에 든 고리는 구멍
  const rings = r.parts.filter((p) => p.length >= 3).map((p) => (p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1] ? p : [...p, p[0]]))
  rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))
  const polys: number[][][][] = []
  for (const ring of rings) {
    const host = polys.find((p) => inRing(ring[0], p[0]))
    if (host) host.push(ring)
    else polys.push([ring])
  }
  if (!polys.length) return null
  const out = polys.map((p) => p.map(conv))
  return out.length === 1 ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out }
}

const round8 = (v: number) => Math.round(v * 1e8) / 1e8

/** 대지 경도로 평면직각 원점 고르기 (서부 125°, 중부 127°, 동부 129°, 동해 131°) */
function beltEpsg(lon: number): number {
  return lon < 126 ? 5185 : lon < 128 ? 5186 : lon < 130 ? 5187 : 5188
}

/**
 * 1:1,000 수치지도 도엽 하나(NGI + NDA)를 읽어 대지 중심 반경 안의 필요한 레이어만 경위도 도형으로.
 * @throws NGI 형식이 아니거나 도형이 없을 때
 */
export function readNgi1000(file: string, ngi: Uint8Array, nda: Uint8Array | null, center: [number, number], radiusM: number): NgiiSheet {
  const dec = new TextDecoder('euc-kr')
  const g = parseNgi(dec.decode(ngi))
  if (!g.layers.size) throw new Error(`${file}: NGI 도형을 찾지 못했습니다 (1:1,000 수치지도 2.0의 .ngi 파일인지 확인)`)
  const attrs = nda ? parseNda(dec.decode(nda)) : new Map<string, Map<number, Rec>>()
  const m = file.match(/(\d{9})_(\d{4})/)
  const code = m?.[1] ?? file.match(/\d{9}/)?.[0] ?? file
  const year = m?.[2] ?? null
  // 좌표계: UTM-K 범위면 5179, 아니면 평면직각(대지 경도로 원점)
  const anyPt = [...g.layers.values()].flat()[0]?.parts[0]?.[0]
  const epsg = anyPt && anyPt[0] > 700000 ? 5179 : beltEpsg(center[0])
  const p = epsg === 5179 ? null : beltProjection(epsg)
  const toLonLat = (x: number, y: number): Position => {
    const [lo, la] = p ? p.toLonLat(x, y) : utmkToWgs84(x, y)
    return [round8(lo), round8(la)]
  }
  const [cx, cy] = p ? p.fromLonLat(center[0], center[1]) : wgs84ToUtmk(center[0], center[1])
  const near = (parts: number[][][], margin: number) => {
    const r = radiusM + margin
    for (const part of parts) for (const [x, y] of part) if (Math.abs(x - cx) <= r && Math.abs(y - cy) <= r) return true
    return false
  }
  let boundsLL: [number, number, number, number] | undefined
  if (g.bound) {
    const [x0, y0, x1, y1] = g.bound
    const cs = [toLonLat(x0, y0), toLonLat(x1, y0), toLonLat(x1, y1), toLonLat(x0, y1)]
    boundsLL = [Math.min(...cs.map((c) => c[0])), Math.min(...cs.map((c) => c[1])), Math.max(...cs.map((c) => c[0])), Math.max(...cs.map((c) => c[1]))]
  }
  const out: NgiiSheet = { code, year, file, epsg, scale: 1000, boundsLL, counts: {}, features: {} }
  for (const [name, recs] of g.layers) {
    // 한 레이어에 규칙이 여럿일 수 있음 (보도: 면 → walk, 선 → walkline)
    for (const want of WANTS.filter((w) => w.match.test(name))) {
      const at = attrs.get(name)
      const list: Feat[] = (out.features[want.key] ??= [])
      for (const r of recs) {
        if (!want.kinds.includes(r.kind)) continue
        if (!near(r.parts, want.terrain ? TERRAIN_MARGIN : SITE_MARGIN)) continue
        const props = want.props(at?.get(r.id) ?? {})
        if (!props) continue
        const geometry = toGeom(r, toLonLat)
        if (!geometry) continue
        list.push({ type: 'Feature', geometry, properties: { ...props, sheet: code } })
      }
    }
  }
  for (const k of NGII_KEYS) if (out.features[k]?.length) out.counts[k] = out.features[k]!.length
  return out
}
