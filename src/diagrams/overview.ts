// 대지 개요: 대지와 같은 반경 안의 주요 숫자를 한눈에.

import { overlapsSite, areaM2 } from '../lib/geo'
import type { TerrainAnalysis } from '../lib/terrainSite'
import { useName } from '../model/codes'
import type { Project } from '../model/types'
import type { DiagramData } from './data'
import { centroidOf } from './frame'

/** 국토의 계획 및 이용에 관한 법률 시행령 제84조·제85조의 건폐율·용적률 상한(%) */
const ZONE_LIMITS: [RegExp, number, number][] = [
  [/제1종전용주거/, 50, 100],
  [/제2종전용주거/, 50, 150],
  [/제1종일반주거/, 60, 200],
  [/제2종일반주거/, 60, 250],
  [/제3종일반주거/, 50, 300],
  [/준주거/, 70, 500],
  [/중심상업/, 90, 1500],
  [/일반상업/, 80, 1300],
  [/근린상업/, 70, 900],
  [/유통상업/, 80, 1100],
  [/전용공업/, 70, 300],
  [/일반공업/, 70, 350],
  [/준공업/, 70, 400],
  [/보전녹지/, 20, 80],
  [/생산녹지/, 20, 100],
  [/자연녹지/, 20, 100],
  [/보전관리/, 20, 80],
  [/생산관리/, 20, 80],
  [/계획관리/, 40, 100],
  [/농림/, 20, 80],
  [/자연환경보전/, 20, 80],
]

export function zoneLimits(name: string): { bcr: number; far: number } | null {
  const hit = ZONE_LIMITS.find(([re]) => re.test(name.replace(/\s+/g, '')))
  return hit ? { bcr: hit[1], far: hit[2] } : null
}

export interface OverviewItem {
  label: string
  value: string
  note?: string
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

export function siteOverview(project: Project, d: DiagramData, terrain: TerrainAnalysis | null = null): { site: OverviewItem[]; around: OverviewItem[]; note: string } {
  const site: OverviewItem[] = []
  const around: OverviewItem[] = []
  const a = areaM2(d.boundary)
  site.push({ label: '대지 면적', value: `${fmt(a)}㎡`, note: `약 ${fmt(a / 3.3058)}평 (도형 계산)` })
  const zones = [...new Set(d.zoning.filter((z) => overlapsSite(z.geom, d.boundary)).map((z) => z.name))]
  if (zones.length) {
    site.push({ label: '용도지역', value: zones.join('·') })
    const lim = zones.map(zoneLimits).filter((x): x is { bcr: number; far: number } => !!x)
    if (lim.length) {
      const bcr = Math.min(...lim.map((l) => l.bcr))
      const far = Math.min(...lim.map((l) => l.far))
      site.push({
        label: '건폐율·용적률 상한',
        value: `${bcr}% · ${fmt(far)}%`,
        note:
          zones.length > 1
            ? '여러 용도지역에 걸쳐 가장 낮은 상한을 표시 — 걸친 대지는 국토계획법 제84조 기준으로 따로 따져야 함'
            : '국토계획법 시행령 상한 (조례·지구단위계획으로 더 낮을 수 있음)',
      })
      site.push({ label: '최대 건축면적·연면적 (상한 기준)', value: `${fmt((a * bcr) / 100)}㎡ · ${fmt((a * far) / 100)}㎡`, note: '대지 면적 × 상한, 참고용' })
    }
  }
  const priced = project.site.parcels.filter((p) => p.jiga && p.jiga > 0)
  if (priced.length) {
    const prices = priced.map((p) => p.jiga as number)
    site.push({ label: '개별공시지가', value: `㎡당 ${fmt(Math.min(...prices))}${Math.max(...prices) !== Math.min(...prices) ? `~${fmt(Math.max(...prices))}` : ''}원` })
  }

  const inside = d.buildings.filter((b) => {
    const c = centroidOf(b.geom)
    if (!c) return false
    const dx = (c[0] - d.center[0]) * 111320 * Math.cos((d.center[1] * Math.PI) / 180)
    const dy = (c[1] - d.center[1]) * 110574
    return Math.hypot(dx, dy) <= d.R
  })
  if (inside.length) {
    around.push({ label: '건물', value: `${fmt(inside.length)}동` })
    const fl = inside.map((b) => b.floors).filter((n): n is number => n !== null)
    if (fl.length) around.push({ label: '평균 층수', value: `${fmt(fl.reduce((x, y) => x + y, 0) / fl.length, 1)}층`, note: `최고 ${Math.max(...fl)}층, 층수 미상 제외` })
    const years = inside.map((b) => b.year).filter((y): y is number => y !== null)
    if (years.length) {
      const cut = new Date().getFullYear() - 30
      around.push({
        label: '평균 사용승인 연도',
        value: `${Math.round(years.reduce((x, y) => x + y, 0) / years.length)}년`,
        note: `30년 넘은 건물 ${Math.round((years.filter((y) => y < cut).length / years.length) * 100)}%`,
      })
    }
    const uses = new Map<string, number>()
    for (const b of inside) if (b.use) uses.set(b.use, (uses.get(b.use) ?? 0) + 1)
    const top = [...uses.entries()].sort((x, y) => y[1] - x[1])[0]
    if (top) around.push({ label: '가장 많은 용도', value: useName(top[0]), note: `용도 확인 건물의 ${Math.round((top[1] / [...uses.values()].reduce((x, y) => x + y, 0)) * 100)}%` })
  }
  const st = d.stations
    .map((p) => ({ p, d: Math.hypot((p.lon - d.center[0]) * 111320 * Math.cos((d.center[1] * Math.PI) / 180), (p.lat - d.center[1]) * 110574) }))
    .sort((x, y) => x.d - y.d)[0]
  if (st) around.push({ label: '가장 가까운 역', value: st.p.name.replace(/\s.*$/, ''), note: `대지 중심에서 약 ${fmt(Math.round(st.d / 10) * 10)}m` })
  if (d.stops.length) around.push({ label: '버스정류소', value: `${d.stops.length}곳`, note: '대지 중심 약 500m' })
  if (terrain) {
    const sign = (v: number) => `${v > 0 ? '+' : ''}${fmt(v, 0)}`
    site.push({
      label: '대지 안 높낮이 차',
      value: `${fmt(terrain.site.range, 1)}m`,
      note: `평균 경사 ${fmt(terrain.site.meanSlope, 1)}°${terrain.grid.source === 'ngii' ? '' : ' · 대체 자료'}`,
    })
    if (terrain.high && terrain.low)
      around.push({ label: '높이 (대지 중심 = 0m)', value: `${sign(terrain.low.rel)} ~ ${sign(terrain.high.rel)}m`, note: `기복 약 ${fmt(terrain.high.rel - terrain.low.rel, 0)}m` })
  }

  return {
    site,
    around,
    note: `반경 ${d.R}m · 평균은 값이 있는 건물만으로 계산 · 건폐율·용적률은 법령 상한이며 실제는 조례·계획으로 확인`,
  }
}
