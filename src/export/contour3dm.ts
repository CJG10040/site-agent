// 15-B 콘타 모형 → 라이노 .3dm (mm). 레이저 판 도면(판마다 레이어, 선 색: 외곽 자르기 분홍 · 구멍 자르기 빨강 · 새김 파랑)
// + 재료 판 테두리 + 번호 붙은 3D 조립 안내(판을 두께만큼 쌓은 솔리드). 조립 모습은 원점(대지 중심), 재료 판은 그 오른쪽에 나란히.

import { free, loadRhino, type ExportMeta } from './to3dm'
import { placedShapes, ROAD_T, type ContourPlan, type EngraveKind } from './contour'
import type { XY } from './siteModel'

type Rgb = [number, number, number]

export const LASER_COLORS: Record<'outer' | 'inner' | 'engrave', Rgb> = {
  outer: [255, 0, 255],
  inner: [255, 0, 0],
  engrave: [0, 0, 255],
}
export const ENGRAVE_LABEL: Record<EngraveKind, string> = {
  align: '맞춤 (위 판 자리)',
  bldg: '건물 자리',
  site: '대지 경계',
  road: '도로',
}

const pad = (p: number) => String(p).padStart(2, '0')
const fmt = (v: number) => (Math.round(v * 100) / 100).toLocaleString('ko-KR')

/** 판마다 쌓는 높이 표 (정보) */
export function contourNotes(plan: ContourPlan, meta: ExportMeta, elev: number | null): [string, string][] {
  const plates = plan.groups.find((g) => g.material === 'plate')
  const roads = plan.groups.find((g) => g.material === 'road')
  return [
    ['제목', `${meta.title} 콘타 모형`],
    ['주소', meta.address],
    ['자료 수집', meta.collected],
    ['축척', `1:${plan.scale}`],
    ['판 두께', `${plan.thickness}mm → 등고 간격 ${fmt(plan.interval)}m`],
    ['모형 크기', `${fmt(plan.side)} × ${fmt(plan.side)}mm, 판 ${plan.plates}장 쌓은 높이 ${fmt(plan.height)}mm (실제 ${fmt((plan.side * plan.scale) / 1000)}m 정사각)`],
    ['판 1 윗면', `대지 중심 지면 기준 ${fmt(plan.levels[0])}m${elev !== null ? ` (해발 약 ${fmt(elev + plan.levels[0])}m)` : ''}`],
    ['조각', `판 조각 ${plan.pieces.filter((p) => p.kind === 'plate').length}개${roads ? `, 도로 조각 ${plan.pieces.filter((p) => p.kind === 'road').length}개` : ''}`],
    ['재료 판', `${plan.sheetW}×${plan.sheetH}mm ${plates?.sheets.length ?? 0}장${roads ? ` + 도로 재료(${ROAD_T}mm) ${roads.sheets.length}장` : ''}`],
    ['선 색', '분홍(255,0,255) = 외곽 자르기, 빨강(255,0,0) = 구멍 자르기(안쪽 먼저), 파랑(0,0,255) = 새김(맞춤·건물 자리·대지 경계·도로·번호)'],
    ['번호', '판 번호 = 아래에서부터 쌓는 순서. 같은 판에 조각이 여럿이면 3-1, 3-2. 도로 조각은 R3-1 (판 3 위에 붙임). 번호는 되도록 위 판에 가려지는 자리에 새김'],
    ['좌표', '조립 모습: 원점 = 대지 중심, 위쪽 = 북. 재료 판 위 조각은 돌려 놓았을 수 있음 (번호로 찾기)'],
  ]
}

export async function contourTo3dm(plan: ContourPlan, meta: ExportMeta, elev: number | null, onStep?: (s: string) => void): Promise<Uint8Array> {
  onStep?.('라이노 모듈 불러오는 중')
  const rhino = await loadRhino()
  const doc = new rhino.File3dm()
  try {
    const st = doc.settings()
    st.modelUnitSystem = rhino.UnitSystem.Millimeters
    st.modelAbsoluteTolerance = 0.01
    doc.applicationName = '대지해석 에이전트'
    doc.applicationUrl = 'https://cjg10040.github.io/site-agent/'
    for (const [k, v] of contourNotes(plan, meta, elev)) doc.strings().set(k, v)

    // ── 레이어
    const layerIndex = new Map<string, number>()
    const layerId = new Map<string, string>()
    const addLayer = (key: string, name: string, color: Rgb, parent?: string) => {
      const L = new rhino.Layer()
      L.name = name
      L.color = { r: color[0], g: color[1], b: color[2], a: 255 }
      if (parent) L.parentLayerId = layerId.get(parent) ?? ''
      const idx = doc.layers().add(L)
      free(L)
      layerIndex.set(key, idx)
      layerId.set(key, doc.layers().get(idx).id)
    }
    addLayer('info', '정보', [40, 40, 40])
    addLayer('sheet', '재료 판 테두리 (자르지 않음)', [170, 170, 170])
    addLayer('plates', '판 도면 (분홍 외곽 · 빨강 구멍 · 파랑 새김)', [255, 0, 255])
    for (let p = 1; p <= plan.plates; p++) {
      const lv = plan.levels[p - 1]
      addLayer(`plate${p}`, `판 ${pad(p)} · 윗면 ${lv >= 0 ? '+' : ''}${fmt(lv)}m${elev !== null ? ` (해발 ${fmt(elev + lv)}m)` : ''}`, [255, 0, 255], 'plates')
    }
    const hasRoad = plan.pieces.some((p) => p.kind === 'road')
    if (hasRoad) addLayer('roads', `도로 조각 도면 (${ROAD_T}mm 재료)`, [255, 0, 255])
    addLayer('asm', '3D 조립 안내', [120, 120, 120])
    addLayer('asmPlate', '조립 — 판', [232, 226, 214], 'asm')
    if (hasRoad) addLayer('asmRoad', '조립 — 도로 조각', [150, 150, 150], 'asm')
    addLayer('asmEngrave', '조립 — 새김 (건물 자리·대지 경계·도로)', [60, 80, 200], 'asm')
    addLayer('asmLabel', '조립 — 번호', [30, 30, 30], 'asm')

    const objs = doc.objects()
    const attrs = (key: string, name = '', color?: Rgb) => {
      const at = new rhino.ObjectAttributes()
      at.layerIndex = layerIndex.get(key) ?? 0
      if (name) at.name = name
      if (color) {
        at.colorSource = rhino.ObjectColorSource.ColorFromObject
        at.objectColor = { r: color[0], g: color[1], b: color[2], a: 255 }
      }
      return at
    }
    const addLine = (pts: number[][], key: string, name: string, color?: Rgb) => {
      if (pts.length < 2) return
      const c = new rhino.PolylineCurve(pts)
      const at = attrs(key, name, color)
      objs.addCurve(c, at)
      free(c)
      free(at)
    }
    const dot = (text: string, at3: number[], key: string) => {
      const at = attrs(key, text)
      objs.addTextDot(text, at3, at)
      free(at)
    }
    const ring3 = (r: XY[], z: number, dx = 0, dy = 0) => [...r, r[0]].map(([x, y]) => [x + dx, y + dy, z])
    const k = 1000 / plan.scale

    // ── 3D 조립 안내 (원점 = 대지 중심)
    onStep?.('조립 모습')
    for (const piece of plan.pieces) {
      const z0 = piece.kind === 'plate' ? (piece.plate - 1) * plan.thickness : piece.plate * plan.thickness
      const h = piece.kind === 'plate' ? plan.thickness : ROAD_T
      const key = piece.kind === 'plate' ? 'asmPlate' : 'asmRoad'
      const toMm = (r: XY[]): XY[] => r.map(([x, y]) => [x * k, y * k])
      const outer = new rhino.PolylineCurve(ring3(toMm(piece.poly.outer), z0))
      const ex = rhino.Extrusion.create(outer, h, true)
      free(outer)
      const name = piece.kind === 'plate' ? `판 ${piece.id}` : `도로 ${piece.id}`
      if (ex) {
        for (const hole of piece.poly.holes) {
          const hc = new rhino.PolylineCurve(ring3(toMm(hole), z0))
          ex.addInnerProfile(hc)
          free(hc)
        }
        const at = attrs(key, name)
        objs.addExtrusion(ex, at)
        free(ex)
        free(at)
      } else addLine(ring3(toMm(piece.poly.outer), z0), key, name)
      // 새김(맞춤선은 위 판에 가려지니 뺌)
      for (const e of piece.engrave)
        if (e.kind !== 'align')
          addLine(
            e.pts.map(([x, y]) => [x * k, y * k, z0 + h + 0.02]),
            'asmEngrave',
            ENGRAVE_LABEL[e.kind],
          )
      dot(piece.id, [piece.label.at[0] * k, piece.label.at[1] * k, z0 + h + 0.5], 'asmLabel')
    }
    dot('원점 (대지 중심)', [0, 0, plan.height + 5], 'info')

    // ── 재료 판 (조립 모습 오른쪽에 나란히)
    onStep?.('재료 판 도면')
    let x0 = plan.side / 2 + 200
    for (const g of plan.groups) {
      const label = g.material === 'plate' ? `판 재료 (우드락·폼보드 ${g.thickness}mm)` : `도로 조각 재료 (${g.thickness}mm)`
      const origins = g.sheets.map((s) => {
        const o: XY = [x0, -s.h / 2]
        x0 += s.w + 100
        return o
      })
      g.sheets.forEach((s, i) => {
        const [sx, sy] = origins[i]
        addLine(
          [
            [sx, sy, 0],
            [sx + s.w, sy, 0],
            [sx + s.w, sy + s.h, 0],
            [sx, sy + s.h, 0],
            [sx, sy, 0],
          ],
          'sheet',
          `재료 판 ${i + 1}`,
        )
        dot(`${label} ${i + 1}/${g.sheets.length}${s.oversize ? ' — 재료 판보다 큰 조각' : ''}`, [sx + s.w / 2, sy + s.h + 25, 0], 'sheet')
      })
      for (const pl of g.placed) {
        const piece = plan.pieces[pl.piece]
        const [sx, sy] = origins[pl.sheet]
        const sh = placedShapes(plan, piece, pl)
        const key = piece.kind === 'plate' ? `plate${piece.plate}` : 'roads'
        const nm = piece.kind === 'plate' ? `판 ${piece.id}` : `도로 ${piece.id}`
        for (const e of sh.engrave) addLine(e.pts.map(([x, y]) => [x + sx, y + sy, 0]), key, `${nm} 새김 — ${ENGRAVE_LABEL[e.kind]}`, LASER_COLORS.engrave)
        for (const t of sh.text) addLine(t.map(([x, y]) => [x + sx, y + sy, 0]), key, `${nm} 번호`, LASER_COLORS.engrave)
        for (const h of sh.holes) addLine(ring3(h, 0, sx, sy), key, `${nm} 구멍`, LASER_COLORS.inner)
        addLine(ring3(sh.outer, 0, sx, sy), key, `${nm} 외곽`, LASER_COLORS.outer)
      }
      x0 += 200
    }

    onStep?.('파일 쓰는 중')
    return doc.toByteArray()
  } finally {
    free(doc)
  }
}
