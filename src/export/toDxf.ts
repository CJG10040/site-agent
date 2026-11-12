// DXF 평면 밑그림 (AutoCAD R12 / AC1009 — 라이노·오토캐드·스케치업이 두루 읽는 가장 단순한 형식).
// 지형은 면 대신 등고선(선마다 높이 = 등고선 높이), 나머지는 높이 0의 평면 선. 단위 m, 원점 = 대지 중심.
// R12는 글자 인코딩이 코드페이지라 한글이 깨질 수 있어 레이어 이름·글자는 영문·숫자로만 쓴다 (앱 화면에 레이어 설명).

import type { Poly, SiteModel, XY } from './siteModel'

export const DXF_LAYERS: { name: string; color: number; label: string }[] = [
  { name: 'INFO', color: 7, label: '원점·좌표 설명' },
  { name: 'SITE', color: 1, label: '대지 경계' },
  { name: 'BLDG', color: 8, label: '주변 건물 발자국' },
  { name: 'BLDG-SITE', color: 6, label: '대지 안 기존 건물' },
  { name: 'BLDG-NOFLOOR', color: 9, label: '층수 모르는 건물' },
  { name: 'BLDG-TEXT', color: 8, label: '건물 층수 (예: 5F)' },
  { name: 'ROAD-EDGE', color: 252, label: '도로 면 경계 (도로중심선 폭)' },
  { name: 'ROAD-CENTER', color: 2, label: '도로중심선' },
  { name: 'PARCEL', color: 151, label: '필지' },
  { name: 'PARCEL-TEXT', color: 151, label: '지번 숫자' },
  { name: 'PARK', color: 3, label: '공원·녹지' },
  { name: 'RIVER', color: 4, label: '하천' },
  { name: 'CONTOUR', color: 34, label: '등고선 (높이 = 대지 중심 지면 기준)' },
  { name: 'CONTOUR-MAJOR', color: 30, label: '계곡선 (굵은 등고선)' },
  { name: 'CONTOUR-TEXT', color: 30, label: '계곡선 높이 숫자' },
  // 수치지도를 올렸을 때만 채워짐
  { name: 'MAP-CONTOUR', color: 32, label: '수치지도 등고선 원본 (선 높이 = 대지 중심 지면 기준)' },
  { name: 'SPOT', color: 32, label: '표고점·기준점 (점 + 해발 숫자)' },
  { name: 'WALL', color: 250, label: '옹벽·석축·제방 상단 (H = 높이 m)' },
  { name: 'CUTFILL', color: 42, label: '절토·성토 경계' },
  { name: 'WALK', color: 253, label: '인도' },
  { name: 'BLDG-MINOR', color: 254, label: '지붕 구조물(무벽건물)·가건물' },
  // 15-F 1:1,000 수치지도·정밀도로지도 (자료가 있을 때만 내용이 들어감)
  { name: 'TREE', color: 3, label: '가로수·독립수 (원 = 수관 어림)' },
  { name: 'STOP', color: 5, label: '정류장 (점 + 이름)' },
  { name: 'CROSSWALK', color: 7, label: '횡단보도 (줄무늬 45cm 칠·45cm 빔, 줄마다 닫힌 선)' },
  { name: 'ISLAND', color: 8, label: '교통섬 (1:1,000 안전지대 중 교통섬)' },
  { name: 'SAFETY-ZONE', color: 2, label: '안전지대 표시 (노란 테두리·빗금)' },
  { name: 'SCHOOL-ZONE', color: 1, label: '어린이보호구역 (적색 포장)' },
  { name: 'SIGNAL', color: 3, label: '신호등 (정밀도로지도, 등 상자 긴 방향 선)' },
  { name: 'SIGN', color: 4, label: '교통안전표지 (정밀도로지도, 판 폭 선)' },
  { name: 'POLE', color: 8, label: '지주 (신호등·표지판 기둥, 팔은 선)' },
  { name: 'BARRIER', color: 9, label: '방호시설 (가드레일·중앙분리대 등)' },
  { name: 'SPEED-BUMP', color: 2, label: '과속방지턱' },
  { name: 'FENCE', color: 9, label: '담장·가드레일' },
  { name: 'LANE', color: 7, label: '차선 (흰색, 점선은 칠한 부분만)' },
  { name: 'LANE-YELLOW', color: 2, label: '차선 (황색·중앙선)' },
  { name: 'LANE-BLUE', color: 5, label: '차선 (청색·버스)' },
  { name: 'ROAD-MARK', color: 7, label: '노면표시' },
  { name: 'CURB', color: 8, label: '연석·도로 경계 (정밀도로지도)' },
]

const n = (v: number) => (Math.round(v * 1000) / 1000).toString()

/** 영문·숫자·기호만 남김 (R12 글자) */
function ascii(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, '').trim()
}

export function siteModelToDxf(m: SiteModel, meta: { title: string; address: string; collected: string }): string {
  const out: string[] = []
  const g = (code: number, value: string | number) => out.push(String(code), typeof value === 'number' ? n(value) : value)

  const polyline = (layer: string, pts: XY[], closed: boolean, elev = 0) => {
    if (pts.length < 2) return
    g(0, 'POLYLINE')
    g(8, layer)
    g(66, '1')
    g(10, 0)
    g(20, 0)
    g(30, elev)
    g(70, closed ? '1' : '0')
    for (const [x, y] of pts) {
      g(0, 'VERTEX')
      g(8, layer)
      g(10, x)
      g(20, y)
      g(30, elev)
    }
    g(0, 'SEQEND')
    g(8, layer)
  }
  const text = (layer: string, [x, y]: XY, h: number, s: string, center = true) => {
    const t = ascii(s)
    if (!t) return
    g(0, 'TEXT')
    g(8, layer)
    g(10, x)
    g(20, y)
    g(30, 0)
    g(40, h)
    g(1, t)
    if (center) {
      g(72, '1')
      g(73, '2')
      g(11, x)
      g(21, y)
      g(31, 0)
    }
  }
  const polys = (layer: string, ps: Poly[]) => {
    for (const p of ps) {
      polyline(layer, p.outer, true)
      for (const h of p.holes) polyline(layer, h, true)
    }
  }
  const centroid = (r: XY[]): XY => {
    let a = 0
    let cx = 0
    let cy = 0
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]
      a += f
      cx += (r[j][0] + r[i][0]) * f
      cy += (r[j][1] + r[i][1]) * f
    }
    if (Math.abs(a) < 1e-9) return r[0]
    return [cx / (3 * a), cy / (3 * a)]
  }

  // ── 머리
  const h = m.half
  g(0, 'SECTION')
  g(2, 'HEADER')
  g(9, '$ACADVER')
  g(1, 'AC1009')
  g(9, '$INSBASE')
  g(10, 0)
  g(20, 0)
  g(30, 0)
  g(9, '$EXTMIN')
  g(10, -h)
  g(20, -h - 40)
  g(30, 0)
  g(9, '$EXTMAX')
  g(10, h)
  g(20, h)
  g(30, 0)
  g(9, '$INSUNITS')
  g(70, '6')
  g(0, 'ENDSEC')

  // ── 표: 선 종류·레이어·글꼴
  g(0, 'SECTION')
  g(2, 'TABLES')
  g(0, 'TABLE')
  g(2, 'LTYPE')
  g(70, '1')
  g(0, 'LTYPE')
  g(2, 'CONTINUOUS')
  g(70, '0')
  g(3, 'Solid line')
  g(72, '65')
  g(73, '0')
  g(40, 0)
  g(0, 'ENDTAB')
  g(0, 'TABLE')
  g(2, 'LAYER')
  g(70, String(DXF_LAYERS.length + 1))
  for (const L of [{ name: '0', color: 7 }, ...DXF_LAYERS]) {
    g(0, 'LAYER')
    g(2, L.name)
    g(70, '0')
    g(62, String(L.color))
    g(6, 'CONTINUOUS')
  }
  g(0, 'ENDTAB')
  g(0, 'TABLE')
  g(2, 'STYLE')
  g(70, '1')
  g(0, 'STYLE')
  g(2, 'STANDARD')
  g(70, '0')
  g(40, 0)
  g(41, 1)
  g(50, 0)
  g(71, '0')
  g(42, 2.5)
  g(3, 'txt')
  g(4, '')
  g(0, 'ENDTAB')
  g(0, 'ENDSEC')

  // ── 도형
  g(0, 'SECTION')
  g(2, 'ENTITIES')

  for (const c of m.contours) {
    const closed = c.pts.length > 2 && c.pts[0][0] === c.pts[c.pts.length - 1][0] && c.pts[0][1] === c.pts[c.pts.length - 1][1]
    polyline(c.major ? 'CONTOUR-MAJOR' : 'CONTOUR', closed ? c.pts.slice(0, -1) : c.pts, closed, c.level)
    if (c.major && c.pts.length > 4) text('CONTOUR-TEXT', c.pts[Math.floor(c.pts.length / 2)], 2, `${c.level >= 0 ? '+' : ''}${c.level}`)
  }
  for (const p of m.parcels) {
    polys('PARCEL', p.polys)
    const num = ascii(p.jibun.replace(/[^\d-]/g, ''))
    if (num && p.polys[0]) text('PARCEL-TEXT', centroid(p.polys[0].outer), 1.2, num)
  }
  for (const c of m.mapContours) polyline('MAP-CONTOUR', c.pts, false, c.z)
  for (const s of m.spots) {
    g(0, 'POINT')
    g(8, 'SPOT')
    g(10, s.x)
    g(20, s.y)
    g(30, s.z)
    text('SPOT', [s.x + 0.8, s.y + 0.8], 1.2, s.level.toFixed(1), false)
  }
  for (const w of m.walls) {
    polyline('WALL', w.pts, false)
    if (w.h && w.pts.length > 1) text('WALL', w.pts[Math.floor(w.pts.length / 2)], 1.2, `H${w.h}`)
  }
  for (const c of m.cutfill) polyline('CUTFILL', c.pts, false)
  polys('WALK', m.walks)
  polys('BLDG-MINOR', m.minor)
  for (const a of m.parks) polys('PARK', a.polys)
  for (const a of m.rivers) polys('RIVER', a.polys)
  polys('ROAD-EDGE', m.roads)
  for (const r of m.roadCenters) polyline('ROAD-CENTER', r.pts, false)
  for (const b of m.buildings) {
    const layer = b.top === null ? 'BLDG-NOFLOOR' : b.onSite ? 'BLDG-SITE' : 'BLDG'
    polys(layer, b.parts)
    if (b.floors && b.parts[0]) text('BLDG-TEXT', centroid(b.parts[0].outer), 1.6, `${b.floors}F`)
  }
  // 15-F 디테일
  for (const t of m.trees) {
    const r = Math.max(1.4, (t.h && t.h > 1 ? t.h : 7) * 0.28)
    g(0, 'CIRCLE')
    g(8, 'TREE')
    g(10, t.x)
    g(20, t.y)
    g(30, 0)
    g(40, r)
  }
  for (const s of m.stops) {
    g(0, 'POINT')
    g(8, 'STOP')
    g(10, s.x)
    g(20, s.y)
    g(30, 0)
    text('STOP', [s.x + 1, s.y + 1], 1.2, s.use || 'STOP', false)
  }
  polys('CROSSWALK', m.zebra.length ? m.zebra : m.crosswalks)
  polys(
    'ISLAND',
    m.safety.filter((s) => s.kind === 'island').map((s) => s.poly),
  )
  polys('SAFETY-ZONE', [...m.safety.filter((s) => s.kind === 'painted').map((s) => s.poly), ...m.hatch])
  polys(
    'SCHOOL-ZONE',
    m.safety.filter((s) => s.kind === 'school').map((s) => s.poly),
  )
  for (const w of m.fences) polyline('FENCE', w.pts, false)
  for (const l of m.lanes) polyline(l.color === 'yellow' ? 'LANE-YELLOW' : l.color === 'blue' ? 'LANE-BLUE' : 'LANE', l.pts, false)
  polys('ROAD-MARK', [...m.marks, ...m.arrows])
  polys('SAFETY-ZONE', m.yellowMarks)
  for (const s of m.signals) {
    const w = s.vehicle ? 0.65 : 0.17
    polyline('SIGNAL', [[s.x - s.axis[0] * w, s.y - s.axis[1] * w], [s.x + s.axis[0] * w, s.y + s.axis[1] * w]], false)
  }
  for (const s of m.signs) polyline('SIGN', [[s.x - (s.axis[0] * s.pw) / 2, s.y - (s.axis[1] * s.pw) / 2], [s.x + (s.axis[0] * s.pw) / 2, s.y + (s.axis[1] * s.pw) / 2]], false)
  for (const p of m.poles) {
    g(0, 'CIRCLE')
    g(8, 'POLE')
    g(10, p.x)
    g(20, p.y)
    g(30, 0)
    g(40, 0.1)
    for (const a of p.arms) polyline('POLE', [[p.x, p.y], a.to], false)
  }
  for (const b of m.barriers) polyline('BARRIER', b.pts, false)
  polys('SPEED-BUMP', m.bumps)
  for (const c of m.curbs) polyline('CURB', c, false)
  polys('SITE', m.site)

  // 정보: 범위 아래에 영문으로
  const o = m.origin
  const info = [
    `${ascii(meta.title) || 'SITE'} - site plan base (units: m)`,
    'ORIGIN (0,0) = site center. +Y = grid north of EPSG:5179',
    `ORIGIN EPSG:5179  X ${o.x5179.toFixed(2)}  Y ${o.y5179.toFixed(2)}`,
    `ORIGIN EPSG:5186  X ${o.x5186.toFixed(2)}  Y ${o.y5186.toFixed(2)}`,
    `ORIGIN WGS84  lon ${o.lon.toFixed(7)}  lat ${o.lat.toFixed(7)}`,
    `TRUE NORTH: ${Math.abs(o.trueNorthDeg).toFixed(2)} deg ${o.trueNorthDeg >= 0 ? 'clockwise' : 'counterclockwise'} from +Y`,
    `CONTOUR elevation 0 = ground at site center${o.elev !== null ? ` (approx. ${o.elev.toFixed(1)} m above sea level)` : ''}, interval ${m.contourStep} m, major ${m.contourStep * 5} m`,
    `TERRAIN: ${m.terrainSource === 'map' ? `NGII 1:5000 digital map${m.mapYear ? ` (${m.mapYear})` : ''} contours/spot heights + retaining walls -> 2 m near site, 10 m beyond` : m.terrainSource === 'ngii' ? 'NGII contours -> 10 m grid' : m.terrainSource === 'terrarium' ? 'AWS Terrarium (~30 m, low accuracy)' : 'none'}`,
    ...(m.spots.length ? ['SPOT text = elevation above sea level (m); MAP-CONTOUR/CONTOUR elevation = relative to site center ground'] : []),
    'BUILDINGS: VWorld GIS building data, height not drawn (floors as text)',
    `ROADS: ${m.roadSource === 'map' ? 'NGII digital map road boundary areas' : m.roadSource === 'mixed' ? 'NGII digital map road areas (inside map sheets) + centerlines widened by width' : 'NGII road centerlines widened by road width'}. Collected ${ascii(meta.collected)}`,
  ]
  info.forEach((s, i) => text('INFO', [-h, -h - 8 - i * 4], 2.4, s, false))
  // 원점 표시 (작은 십자)
  polyline('INFO', [
    [-3, 0],
    [3, 0],
  ], false)
  polyline('INFO', [
    [0, -3],
    [0, 3],
  ], false)

  g(0, 'ENDSEC')
  g(0, 'EOF')
  return out.join('\r\n') + '\r\n'
}
