// 모형 만들기 공통 (⑥ 바로 내려받기 · 15-A 작업대): 지형 격자 고르기 + 대지 모형 + 물체 수·예상 크기.

import type { DiagramData } from '../diagrams/data'
import { wgs84ToUtmk } from '../lib/proj'
import { terrainAround, type TerrainGrid } from '../lib/terrain'
import { compositeGrid, fineHalfFor, fineTerrainCached } from '../lib/terrainFine'
import { buildSiteModel, ringArea, type Poly, type SiteModel } from './siteModel'

/** 대지 경계 꼭짓점이 대지 중심에서 가장 먼 거리 (x·y 중 큰 쪽) — 내보낼 정사각형 범위의 최소값 */
export function siteFarOf(d: Pick<DiagramData, 'center' | 'boundary'>): number {
  const [X0, Y0] = wgs84ToUtmk(d.center[0], d.center[1])
  const polys = (d.boundary.type === 'Polygon' ? [d.boundary.coordinates] : d.boundary.coordinates) as number[][][][]
  let far = 0
  for (const p of polys)
    for (const [lo, la] of p[0]) {
      const [x, y] = wgs84ToUtmk(lo, la)
      far = Math.max(far, Math.abs(x - X0), Math.abs(y - Y0))
    }
  return far
}

/** 범위 후보 (정사각 반쪽, m): 대지가 다 들어가는 것만, 수집 반경까지 */
export function halfOptionsFor(d: Pick<DiagramData, 'center' | 'boundary' | 'R'>): number[] {
  const far = siteFarOf(d)
  const opts = [...new Set([150, 300, 500, 1000, d.R])].filter((h) => h <= d.R && h >= far + 20).sort((a, b) => a - b)
  return opts.length ? opts : [Math.max(d.R, Math.ceil(far + 20))]
}

/** 처음 고를 범위 (가로·세로 600m 안팎) */
export function defaultHalf(opts: number[]): number {
  return opts.find((h) => h >= 300) ?? opts[opts.length - 1]
}

/** 범위(정사각 반쪽)에 맞춘 지형 격자로 대지 모형을 만든다. 수치지도를 올렸으면 대지 주변 2m + 그 밖 10m를 섞은 격자 (범위가 크면 칸을 키움) */
export async function buildModelFor(data: DiagramData, half: number): Promise<SiteModel> {
  let grid: TerrainGrid | null | undefined
  if (data.ngii) {
    const fine = fineTerrainCached(data.ngii, data.center, fineHalfFor(data.R))
    const base = await terrainAround(data.center[0], data.center[1], data.R).catch(() => null)
    grid = compositeGrid(base, fine, data.center, half + 20, half <= 300 ? 2 : half <= 600 ? 4 : 5)
  }
  return buildSiteModel(data, half, grid !== undefined ? { grid } : {})
}

export interface ModelStats {
  /** 라이노 파일에 들어갈 물체 수 (어림) */
  objects: number
  /** 예상 .3dm 크기 (MB, 어림) */
  mb: number
  /** 항목별 개수 (화면 표) */
  rows: { label: string; n: number; unit: string }[]
  /** 무거우면 이유 */
  warn: string | null
}

const areaOf = (ps: Poly[]) => ps.reduce((s, p) => s + Math.abs(ringArea(p.outer)), 0)
const lenOf = (pts: [number, number][]) => pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0)

/**
 * 물체 수와 파일 크기 어림. 상수는 유스퀘어 주변 600m 시험(2026-11-12)으로 맞춤:
 * 2m 지형 면 9.1MB(디테일 없이), 디테일(얹은 면·차선·나무 등) +3.4MB → 12.5MB.
 */
export function modelStats(m: SiteModel): ModelStats {
  const cell = m.terrain?.cell ?? 10
  const terrainCells = m.terrain ? m.terrain.cols * m.terrain.rows : 0
  const drapeEdge = Math.min(6, Math.max(3, cell * 1.5))
  const draped = [m.roads, m.walks, m.crosswalks, m.marks, m.hdPaths, ...m.parks.map((a) => a.polys), ...m.rivers.map((a) => a.polys)]
  const drapedArea = draped.reduce((s, ps) => s + areaOf(ps), 0)
  const dashLen = m.lanes.filter((l) => l.dashed).reduce((s, l) => s + lenOf(l.pts) * (l.double ? 2 : 1), 0)
  const lanePieces = m.lanes.filter((l) => !l.dashed).reduce((s, l) => s + (l.double ? 2 : 1), 0) + Math.ceil(dashLen / 8)
  const bldParts = m.buildings.reduce((s, b) => s + b.parts.length, 0)
  const objects =
    1 + (m.terrain ? 1 : 0) + m.contours.length + bldParts + m.mapContours.length + m.spots.length + m.walls.length * 2 + m.cutfill.length + m.minor.length +
    draped.filter((ps) => ps.length).length + m.roadCenters.length + m.parcels.reduce((s, p) => s + p.polys.length, 0) +
    m.parks.reduce((s, a) => s + a.polys.length, 0) + m.rivers.reduce((s, a) => s + a.polys.length, 0) + m.site.length +
    (m.curbs.length ? 1 : 0) + new Set(m.lanes.map((l) => l.color)).size + m.fences.length + (m.trees.length ? 2 : 0) + m.stops.length * 3 + (m.lamps.length ? 1 : 0) +
    new Set(m.safety.map((s) => s.kind)).size
  // 크기: 지형 칸당 약 92B, 얹은 면 1㎡당 약 (2/드레이프 변²)개 삼각형 × 65B, 물체마다 약 420B (300·600·800m 실측에 맞춰 조금 넉넉히), 건물 꼭짓점·선 점은 물체 몫에 포함
  // 차선·연석 띠(2m마다 꼭짓점 2~4개), 쉘터·가로등 상자(꼭짓점 8·면 6)
  const ribbonLen = m.lanes.reduce((s, l) => s + lenOf(l.pts) * (l.double ? 2 : 1), 0) + m.curbs.reduce((s, c) => s + lenOf(c) * 3, 0)
  const bytes =
    terrainCells * 92 + drapedArea * (2 / (drapeEdge * drapeEdge)) * 65 + objects * 420 + m.trees.length * 32 * 30 + ribbonLen * 45 + m.lamps.length * 900 + m.stops.length * 3000
  const mb = bytes / 1e6
  const rows = [
    { label: '지형 면', n: terrainCells, unit: `칸 (${cell}m)` },
    { label: '건물', n: m.buildings.length, unit: '동' },
    { label: '등고선', n: m.contours.length + m.mapContours.length, unit: '줄' },
    { label: '도로·인도·공원·하천 면', n: Math.round(drapedArea / 100) * 100, unit: '㎡' },
    { label: '옹벽·석축·제방', n: m.walls.length, unit: '곳' },
    { label: '가로수', n: m.trees.length, unit: '그루' },
    { label: '정류장', n: m.stops.length, unit: '곳' },
    { label: '가로등', n: m.lamps.length, unit: '개' },
    { label: '횡단보도', n: m.crosswalks.length, unit: '곳 (줄무늬)' },
    { label: '교통섬·안전지대', n: m.safety.length, unit: '곳' },
    { label: '담장·가드레일', n: m.fences.length, unit: '줄' },
    { label: '차선', n: m.lanes.length, unit: `줄 (점선 조각 포함 ${lanePieces})` },
    { label: '노면표시', n: m.marks.length, unit: '개' },
  ].filter((r) => r.n > 0)
  const warn = mb > 60 ? `파일이 약 ${Math.round(mb)}MB로 커서 라이노가 느릴 수 있습니다 — 범위를 줄이세요` : objects > 40000 ? `물체가 ${objects.toLocaleString('ko-KR')}개로 많습니다 — 범위를 줄이세요` : null
  return { objects, mb, rows, warn }
}
