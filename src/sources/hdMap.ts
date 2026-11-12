// 15-F 국토지리정보원 정밀도로지도 (B110, SHP ZIP) 읽기 — 렌더링 모델의 차선·노면표시·보도·연석, 그리고 (2026-11-13 사용자 요청으로 더함)
// 신호등·교통안전표지·지주·방호시설·과속방지턱.
// 2026-11-12 사용자가 받은 광주 서구 파일로 형식 확인: 좌표계 EPSG:5179(UTM-K, PRJ 'KGD2002_Unified_Coordinate_System'), 선은 PolyLineZ.
// 두 가지 형식이 섞여 있다:
//   C-ITS 실증지구(2025): b2_surfacelinemark(차선, type·kind) · b3_surfacemark(노면표시 면) · c1_trafficlight(신호등 점) · b1_safetysign(표지판 면, 3D)
//                        · c6_postpoint(지주 점) · c3_vehicleprotectionsafety(방호시설 선, iscentral) · a4_subsidiarysection …
//   새 형식(2026): rm1_laneline(차선, linetype·linekind) · rm2_roadmarking(노면표시 면) · rs1_roadborder(도로 경계·연석) · pw1_pathway(보도 면)
//                 · sf1_barrier(방호시설) · sf2_trafficsign(표지판 점) · sf3_trafficlight(신호등 점) · sf4_supportpost(지주 점) · sf5_speedbump(과속방지턱 면) …
// 같은 구간이 여러 ZIP에 겹쳐 들어 있어 레이어·id로 한 번만 담는다.
// 차선 종류 3자리(type/linetype): 첫째 색(1 황색·2 백색·3 청색), 둘째 1 단선·2 겹선, 셋째 1 실선·2 점선.
//   유스퀘어 주변 자료의 kind(의미)와 맞춰 확인: 503 차선 = 212(백색 단선 점선), 501 중앙선 = 111(황색 실선), 504 버스전용 = 312·311(청색),
//   530 정지선 = 211(백색 실선), 515 주정차금지 = 111 / 121(황색 겹선 = 절대금지).
// 노면표시 화살표(2026-11-13): 도형은 화살표 크기의 사각형뿐이라 진행 방향을 주행경로링크(a2_link·nt2_link, 꼭짓점 순서 = 진행 방향)에서 구해
//   az(북에서 시계, 도)로 담는다 — 링크 id(linkid)가 있으면 그 링크, 없으면 3m 안 가장 가까운 링크.
//   종류(도로교통법 시행규칙 별표6 번호 + 끝자리): 537x 진행방향(5371 직진·5372 좌회전·5373 우회전·5374 유턴), 538x 직진+좌·우회전, 539x 유턴(5392 좌회전+유턴),
//   543x 차로변경, 544 오르막경사면, 529 횡단보도예고, 524 정차금지지대. 좌·우는 중앙선(황색)에 붙은 차로인지로 확인(5372 115:16, 5373 13:115).
// 신호등·표지판 높이(2026-11-13 자료로 확인, 공식 코드표는 찾지 못함): 점·판의 Z에서 지주 밑(없으면 가까운 차선 높이)을 빼 '땅 위 높이'로 담는다.
//   차량 신호등(C-ITS 1·2·99, 2026 100·101·201)은 약 5.8m·지주에서 팔로 약 6m, 보행등(11·14, 2026 300)은 약 3m.
//   표지판 종류 1~4(2026은 100~400) = 주의·규제·지시·보조 — 판 모양(삼각형·원·원·사각형)으로 확인. 판 높이 약 0.9m, 아래 끝 약 3m.

import { unzipSync } from 'fflate'
import type { Position } from 'geojson'
import { beltProjection, utmkToWgs84, wgs84ToUtmk } from '../lib/proj'
import { epsgOf, readDbf, readShp, toGeometry, type Feat, type Rec, type ShpRec } from './ngiiMap'

export type HdKey = 'lane' | 'mark' | 'border' | 'path' | 'light' | 'sign' | 'post' | 'barrier' | 'bump'
export const HD_KEYS: HdKey[] = ['lane', 'mark', 'border', 'path', 'light', 'sign', 'post', 'barrier', 'bump']
export const HD_LABEL: Record<HdKey, string> = {
  lane: '차선',
  mark: '노면표시',
  border: '도로 경계(연석)',
  path: '보도 면',
  light: '신호등',
  sign: '교통안전표지',
  post: '지주',
  barrier: '방호시설',
  bump: '과속방지턱',
}
export const hdLayer = (k: HdKey | 'files') => `hd:${k}`

const MARGIN = 80

interface Want {
  match: RegExp
  key: HdKey
  props: (r: Rec) => Record<string, unknown>
}

/** 표지판 종류 → 1 주의 · 2 규제 · 3 지시 · 4 보조 (모르면 0) */
function signCat(t: string): number {
  const n = Number(t)
  if (!Number.isFinite(n)) return 0
  const c = n >= 100 ? Math.floor(n / 100) : n
  return c >= 1 && c <= 4 ? c : 0
}

const WANTS: Want[] = [
  { match: /(b2_surfacelinemark|rm1_laneline)$/i, key: 'lane', props: (r) => ({ type: r.type || r.linetype || '', kind: r.kind || r.linekind || '' }) },
  { match: /(b3_surfacemark|rm2_roadmarking)$/i, key: 'mark', props: (r) => ({ type: r.type || r.marktype || '', kind: r.kind || r.markkind || '' }) },
  { match: /rs1_roadborder$/i, key: 'border', props: (r) => ({ kerb: r.kerb === '1' }) },
  { match: /pw1_pathway$/i, key: 'path', props: (r) => ({ type: r.pathtype ?? '' }) },
  { match: /(c1_trafficlight|sf3_trafficlight)$/i, key: 'light', props: (r) => ({ type: r.type || r.lighttype || '', postid: r.postid || '' }) },
  { match: /(b1_safetysign|sf2_trafficsign)$/i, key: 'sign', props: (r) => ({ cat: signCat(r.type || r.signtype || ''), postid: r.postid || '' }) },
  { match: /(c6_postpoint|sf4_supportpost)$/i, key: 'post', props: (r) => ({ type: r.type || r.posttype || '' }) },
  { match: /(c3_vehicleprotectionsafety|sf1_barrier)$/i, key: 'barrier', props: (r) => ({ type: r.type || r.barrtype || '', central: r.iscentral === '1' }) },
  { match: /sf5_speedbump$/i, key: 'bump', props: () => ({}) },
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
const round2 = (v: number) => Math.round(v * 100) / 100

interface Layer {
  base: string
  want: Want
  shapes: (ShpRec | null)[]
  recs: (Rec | null)[]
  toLonLat: (x: number, y: number) => Position
  /** 이 레이어 좌표 → UTM-K (지주·땅 높이를 레이어 사이에서 맞추려고) */
  toUtmk: (x: number, y: number) => [number, number]
  cx: number
  cy: number
}

/**
 * 정밀도로지도 ZIP 하나를 읽어 대지 중심 반경 안의 것만.
 * @param seen 앞서 읽은 ZIP의 '레이어:id' (겹치는 구간을 한 번만)
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
  const LINK = /(a2_link|nt2_link)$/i
  if (!bases.length) throw new Error(`${name}: 정밀도로지도 차선·노면표시 레이어(…_laneline·…_surfacelinemark 등)를 찾지 못했습니다`)
  const out: HdSet = { file: name, sections: [], counts: {}, features: {} }

  // ── 1차: 레이어 읽기
  const layers: Layer[] = []
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
    const toUtmk = (x: number, y: number): [number, number] => {
      if (!p) return [x, y]
      const [lo, la] = p.toLonLat(x, y)
      return wgs84ToUtmk(lo, la)
    }
    const [cx, cy] = p ? p.fromLonLat(center[0], center[1]) : wgs84ToUtmk(center[0], center[1])
    const cpg = fset.cpg ? new TextDecoder().decode(fset.cpg).trim().toLowerCase() : ''
    const dec = new TextDecoder(/utf-?8/.test(cpg) ? 'utf-8' : 'euc-kr')
    layers.push({ base, want, shapes: readShp(fset.shp), recs: readDbf(fset.dbf, dec), toLonLat, toUtmk, cx, cy })
    const sec = /_(S(?:EC)?\d+)_/.exec(base)?.[1]
    if (sec && !out.sections.includes(sec)) out.sections.push(sec)
  }

  // ── 주행경로링크 (노면표시 화살표 방향만, 저장하지 않음): UTM-K 선
  const links = new Map<string, number[][]>()
  const linkList: number[][][] = []
  for (const [base, fset] of byBase) {
    if (!LINK.test(base) || !fset.shp || !fset.dbf) continue
    const epsg = (fset.prj && epsgOf(new TextDecoder().decode(fset.prj))) || 5179
    const p = epsg === 5179 ? null : beltProjection(epsg)
    const [cx, cy] = p ? p.fromLonLat(center[0], center[1]) : wgs84ToUtmk(center[0], center[1])
    const rr = radiusM + MARGIN + 50
    const shapes = readShp(fset.shp)
    const recs = readDbf(fset.dbf, new TextDecoder('euc-kr'))
    shapes.forEach((s, i) => {
      if (!s) return
      const b = s.bbox
      if (b[2] < cx - rr || b[0] > cx + rr || b[3] < cy - rr || b[1] > cy + rr) return
      const line = s.parts.flat().map(([x, y]) => {
        if (!p) return [x, y]
        const [lo, la] = p.toLonLat(x, y)
        return wgs84ToUtmk(lo, la)
      })
      linkList.push(line)
      const id = recs[i]?.id
      if (id) links.set(id, line)
    })
  }
  /** 선 위 가장 가까운 선분의 방향 (거리 maxD 안) */
  const dirOn = (lines: number[][][], x: number, y: number, maxD: number): number | null => {
    let best = maxD
    let az: number | null = null
    for (const l of lines)
      for (let i = 0; i + 1 < l.length; i++) {
        const [ax, ay] = l[i]
        const [bx, by] = l[i + 1]
        if ((x < ax - best && x < bx - best) || (x > ax + best && x > bx + best) || (y < ay - best && y < by - best) || (y > ay + best && y > by + best)) continue
        const dx = bx - ax
        const dy = by - ay
        const L2 = dx * dx + dy * dy
        if (!L2) continue
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2))
        const d = Math.hypot(x - ax - t * dx, y - ay - t * dy)
        if (d < best) {
          best = d
          az = (Math.atan2(dx, dy) * 180) / Math.PI
        }
      }
    return az
  }

  // ── 땅 높이(차선·도로 경계 꼭짓점 Z, 5m 칸)와 지주(id → 밑 높이·위치)
  const ground = new Map<string, number[]>()
  const cell = (x: number, y: number) => `${Math.floor(x / 5)},${Math.floor(y / 5)}`
  const posts = new Map<string, { x: number; y: number; z: number }>()
  for (const L of layers) {
    if (L.want.key === 'lane' || L.want.key === 'border')
      L.shapes.forEach((s) => {
        if (!s?.z) return
        s.parts.forEach((part, i) =>
          part.forEach(([x, y], j) => {
            const z = s.z![i]?.[j]
            if (!Number.isFinite(z)) return
            const [ux, uy] = L.toUtmk(x, y)
            const k = cell(ux, uy)
            const list = ground.get(k) ?? []
            list.push(z)
            ground.set(k, list)
          }),
        )
      })
    if (L.want.key === 'post')
      L.shapes.forEach((s, i) => {
        const id = L.recs[i]?.id
        const z = s?.z?.[0]?.[0]
        if (!s || !id || !Number.isFinite(z)) return
        const [ux, uy] = L.toUtmk(s.parts[0][0][0], s.parts[0][0][1])
        posts.set(id, { x: ux, y: uy, z: z! })
      })
  }
  /** 가까운 차선 높이 (아래쪽 4분위 — 연석 위보다 노면에 가깝게) */
  const roadZ = (ux: number, uy: number): number | null => {
    for (let r = 0; r <= 6; r++) {
      const zs: number[] = []
      const ix = Math.floor(ux / 5)
      const iy = Math.floor(uy / 5)
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) zs.push(...(ground.get(`${ix + i},${iy + j}`) ?? []))
      if (zs.length) return zs.sort((a, b) => a - b)[Math.floor(zs.length / 4)]
    }
    return null
  }

  // ── 2차: 대지 반경 안 물체를 담기
  const r = radiusM + MARGIN
  for (const L of layers) {
    const key = L.want.key
    const list = (out.features[key] ??= [])
    for (let i = 0; i < L.shapes.length; i++) {
      const s = L.shapes[i]
      const rec = L.recs[i]
      if (!s || !rec) continue
      const b = s.bbox
      if (b[2] < L.cx - r || b[0] > L.cx + r || b[3] < L.cy - r || b[1] > L.cy + r) continue
      const id = rec.id || `${L.base}#${i}`
      if (seen.has(`${key}:${id}`)) continue
      seen.add(`${key}:${id}`)
      const props: Record<string, unknown> = { ...L.want.props(rec), id }
      let geometry = toGeometry(s, L.toLonLat)
      if (key === 'mark' && linkList.length) {
        // 화살표 진행 방향
        const pts = s.parts[0] ?? []
        if (pts.length) {
          const [ux, uy] = L.toUtmk(pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length)
          const own = rec.linkid ? links.get(rec.linkid) : undefined
          const az = (own && dirOn([own], ux, uy, 15)) ?? dirOn(linkList, ux, uy, 3)
          if (az !== null) props.az = Math.round(az * 10) / 10
        }
      }
      if (key === 'light' || key === 'sign' || key === 'post') {
        // 점으로 담고 높이·판 크기는 속성으로 (판 면은 수직이라 평면 도형이 납작함)
        const pts = s.parts.flat()
        const zs = s.z?.flat().filter(Number.isFinite) ?? []
        const x = pts.reduce((a, q) => a + q[0], 0) / pts.length
        const y = pts.reduce((a, q) => a + q[1], 0) / pts.length
        geometry = { type: 'Point', coordinates: L.toLonLat(x, y) }
        if (key === 'post') {
          props.pid = id
        } else if (zs.length) {
          const [ux, uy] = L.toUtmk(x, y)
          const post = posts.get(String(props.postid ?? ''))
          const g = post ? post.z : roadZ(ux, uy)
          const bottom = Math.min(...zs)
          if (g !== null) props.h = round2(bottom - g)
          if (key === 'sign' && pts.length > 2) {
            // 판: 높이·폭·판이 놓인 방향(가장 먼 두 꼭짓점)
            let w = 0
            let az: number | null = null
            for (const a of pts)
              for (const c of pts) {
                const d = Math.hypot(a[0] - c[0], a[1] - c[1])
                if (d > w) {
                  w = d
                  az = (Math.atan2(c[0] - a[0], c[1] - a[1]) * 180) / Math.PI
                }
              }
            props.ph = round2(Math.max(...zs) - bottom)
            props.pw = round2(w)
            if (az !== null) props.az = Math.round(az * 10) / 10
          }
          if (post) {
            props.px = round2(post.x - ux)
            props.py = round2(post.y - uy)
          }
        }
      }
      if (!geometry) continue
      list.push({ type: 'Feature', geometry, properties: props })
    }
  }
  for (const k of Object.keys(out.features) as HdKey[]) out.counts[k] = out.features[k]!.length
  return out
}
