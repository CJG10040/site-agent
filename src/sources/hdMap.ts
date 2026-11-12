// 15-F 국토지리정보원 정밀도로지도 (B110, SHP ZIP) 읽기 — 렌더링 모델의 차선·노면표시·보도·연석.
// 2026-11-12 사용자가 받은 광주 서구 파일로 형식 확인: 좌표계 EPSG:5179(UTM-K, PRJ 'KGD2002_Unified_Coordinate_System'), 선은 PolyLineZ.
// 두 가지 형식이 섞여 있다:
//   C-ITS 실증지구(2025): b2_surfacelinemark(차선, type·kind) · b3_surfacemark(노면표시 면) · a4_subsidiarysection …
//   새 형식(2026): rm1_laneline(차선, linetype·linekind) · rm2_roadmarking(노면표시 면) · rs1_roadborder(도로 경계·연석) · pw1_pathway(보도 면) …
// 같은 구간이 여러 ZIP에 겹쳐 들어 있어 id로 한 번만 담는다.
// 차선 종류 3자리(type/linetype): 첫째 색(1 황색·2 백색·3 청색), 둘째 1 단선·2 겹선, 셋째 1 실선·2 점선.
//   유스퀘어 주변 자료의 kind(의미)와 맞춰 확인: 503 차선 = 212(백색 단선 점선), 501 중앙선 = 111(황색 실선), 504 버스전용 = 312·311(청색),
//   530 정지선 = 211(백색 실선), 515 주정차금지 = 111 / 121(황색 겹선 = 절대금지).

import { unzipSync } from 'fflate'
import type { Position } from 'geojson'
import { beltProjection, utmkToWgs84, wgs84ToUtmk } from '../lib/proj'
import { epsgOf, readDbf, readShp, toGeometry, type Feat, type Rec } from './ngiiMap'

export type HdKey = 'lane' | 'mark' | 'border' | 'path'
export const HD_KEYS: HdKey[] = ['lane', 'mark', 'border', 'path']
export const HD_LABEL: Record<HdKey, string> = { lane: '차선', mark: '노면표시', border: '도로 경계(연석)', path: '보도 면' }
export const hdLayer = (k: HdKey | 'files') => `hd:${k}`

const MARGIN = 80

interface Want {
  match: RegExp
  key: HdKey
  props: (r: Rec) => Record<string, unknown>
}

const WANTS: Want[] = [
  { match: /(b2_surfacelinemark|rm1_laneline)$/i, key: 'lane', props: (r) => ({ type: r.type || r.linetype || '', kind: r.kind || r.linekind || '' }) },
  { match: /(b3_surfacemark|rm2_roadmarking)$/i, key: 'mark', props: (r) => ({ type: r.type || r.marktype || '', kind: r.kind || r.markkind || '' }) },
  { match: /rs1_roadborder$/i, key: 'border', props: (r) => ({ kerb: r.kerb === '1' }) },
  { match: /pw1_pathway$/i, key: 'path', props: (r) => ({ type: r.pathtype ?? '' }) },
]

export interface HdSet {
  file: string
  /** 구간 이름 (SEC008 …) */
  sections: string[]
  counts: Partial<Record<HdKey, number>>
  features: Partial<Record<HdKey, Feat[]>>
}

/** 차선 종류 → 색·점선 */
export function laneStyle(type: string): { color: 'yellow' | 'white' | 'blue'; dashed: boolean; double: boolean } {
  const t = String(type).padStart(3, '0')
  return { color: t[0] === '1' ? 'yellow' : t[0] === '3' ? 'blue' : 'white', double: t[1] === '2', dashed: t[2] === '2' }
}

const round8 = (v: number) => Math.round(v * 1e8) / 1e8

/**
 * 정밀도로지도 ZIP 하나를 읽어 대지 중심 반경 안의 차선·노면표시·도로 경계·보도만.
 * @param seen 앞서 읽은 ZIP의 id (겹치는 구간을 한 번만)
 * @throws ZIP이 아니거나 정밀도로지도 레이어가 없을 때
 */
export function readHdZip(name: string, data: Uint8Array, center: [number, number], radiusM: number, seen: Set<string> = new Set()): HdSet {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data)
  } catch {
    throw new Error(`${name}: ZIP 파일을 열 수 없습니다`)
  }
  const byBase = new Map<string, Record<string, Uint8Array>>()
  for (const [path, bytes] of Object.entries(files)) {
    const m = path.replace(/\\/g, '/').split('/').pop()!.match(/^(.+)\.(shp|dbf|prj|cpg)$/i)
    if (!m) continue
    const rec = byBase.get(m[1]) ?? {}
    rec[m[2].toLowerCase()] = bytes
    byBase.set(m[1], rec)
  }
  const bases = [...byBase.keys()].filter((b) => WANTS.some((w) => w.match.test(b)))
  if (!bases.length) throw new Error(`${name}: 정밀도로지도 차선·노면표시 레이어(…_laneline·…_surfacelinemark 등)를 찾지 못했습니다`)
  const out: HdSet = { file: name, sections: [], counts: {}, features: {} }
  for (const base of bases) {
    const want = WANTS.find((w) => w.match.test(base))!
    const fset = byBase.get(base)!
    if (!fset.shp || !fset.dbf) continue
    const epsg = (fset.prj && epsgOf(new TextDecoder().decode(fset.prj))) || 5179
    const p = epsg === 5179 ? null : beltProjection(epsg)
    const toLonLat = (x: number, y: number): Position => {
      const [lo, la] = p ? p.toLonLat(x, y) : utmkToWgs84(x, y)
      return [round8(lo), round8(la)]
    }
    const [cx, cy] = p ? p.fromLonLat(center[0], center[1]) : wgs84ToUtmk(center[0], center[1])
    const r = radiusM + MARGIN
    const cpg = fset.cpg ? new TextDecoder().decode(fset.cpg).trim().toLowerCase() : ''
    const dec = new TextDecoder(/utf-?8/.test(cpg) ? 'utf-8' : 'euc-kr')
    const shapes = readShp(fset.shp)
    const recs = readDbf(fset.dbf, dec)
    const sec = /_(S(?:EC)?\d+)_/.exec(base)?.[1]
    if (sec && !out.sections.includes(sec)) out.sections.push(sec)
    const list = (out.features[want.key] ??= [])
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i]
      const rec = recs[i]
      if (!s || !rec) continue
      const b = s.bbox
      if (b[2] < cx - r || b[0] > cx + r || b[3] < cy - r || b[1] > cy + r) continue
      const id = rec.id || `${base}#${i}`
      if (seen.has(id)) continue
      seen.add(id)
      const geometry = toGeometry(s, toLonLat)
      if (!geometry) continue
      list.push({ type: 'Feature', geometry, properties: { ...want.props(rec), id } })
    }
  }
  for (const k of Object.keys(out.features) as HdKey[]) out.counts[k] = out.features[k]!.length
  return out
}
