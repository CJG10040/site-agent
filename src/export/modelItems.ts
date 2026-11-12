// 15-C 렌더링 모델 단계·항목 (2026-11-12 인터뷰: "단계(가벼움·보통·자세히) + 항목별 켜고 끄기").
// 대지 모형(SiteModel)에서 끈 항목을 비워 .3dm·DXF·미리보기·물체 수가 같은 것을 보게 한다.

import type { RenderLevel } from '../model/types'
import type { SiteModel } from './siteModel'

export type ModelItem =
  | 'terrain'
  | 'buildings'
  | 'site'
  | 'contours'
  | 'spots'
  | 'walls'
  | 'minor'
  | 'roads'
  | 'roadCenters'
  | 'walks'
  | 'parcels'
  | 'parks'
  | 'rivers'
  | 'trees'
  | 'stops'
  | 'lamps'
  | 'crosswalks'
  | 'safety'
  | 'signals'
  | 'signs'
  | 'barriers'
  | 'bumps'
  | 'fences'
  | 'lanes'
  | 'marks'
  | 'hdPaths'
  | 'curbs'

export const LEVELS: { id: RenderLevel; label: string; note: string }[] = [
  { id: 'light', label: '가벼움', note: '지형 면 + 건물 매스 + 대지 경계' },
  { id: 'normal', label: '보통', note: '+ 도로·인도·공원·하천·필지·등고선·옹벽' },
  { id: 'detail', label: '자세히', note: '+ 가로수·정류장 쉘터·가로등·횡단보도 줄무늬·교통섬·담장·차선·노면표시·연석' },
]

/** 항목: 그 항목이 처음 들어가는 단계 */
export const MODEL_ITEMS: { id: ModelItem; label: string; level: RenderLevel; unit: string }[] = [
  { id: 'terrain', label: '지형 면', level: 'light', unit: '칸' },
  { id: 'buildings', label: '건물 매스', level: 'light', unit: '동' },
  { id: 'site', label: '대지 경계', level: 'light', unit: '' },
  { id: 'contours', label: '등고선', level: 'normal', unit: '줄' },
  { id: 'spots', label: '표고점', level: 'normal', unit: '개' },
  { id: 'walls', label: '옹벽·석축·절성토', level: 'normal', unit: '곳' },
  { id: 'minor', label: '지붕 구조물·가건물', level: 'normal', unit: '곳' },
  { id: 'roads', label: '도로 면', level: 'normal', unit: '' },
  { id: 'roadCenters', label: '도로중심선', level: 'normal', unit: '줄' },
  { id: 'walks', label: '인도 (수치지도)', level: 'normal', unit: '' },
  { id: 'parcels', label: '필지', level: 'normal', unit: '필' },
  { id: 'parks', label: '공원·녹지', level: 'normal', unit: '곳' },
  { id: 'rivers', label: '하천', level: 'normal', unit: '곳' },
  { id: 'trees', label: '가로수·독립수', level: 'detail', unit: '그루' },
  { id: 'stops', label: '버스정류장', level: 'detail', unit: '곳' },
  { id: 'lamps', label: '가로등', level: 'detail', unit: '개' },
  { id: 'crosswalks', label: '횡단보도 (줄무늬)', level: 'detail', unit: '곳' },
  { id: 'safety', label: '교통섬·안전지대', level: 'detail', unit: '곳' },
  { id: 'signals', label: '신호등·지주 (정밀도로지도)', level: 'detail', unit: '개' },
  { id: 'signs', label: '교통안전표지 (정밀도로지도)', level: 'detail', unit: '개' },
  { id: 'barriers', label: '방호시설 (정밀도로지도)', level: 'detail', unit: '줄' },
  { id: 'bumps', label: '과속방지턱', level: 'detail', unit: '개' },
  { id: 'fences', label: '담장·가드레일', level: 'detail', unit: '줄' },
  { id: 'lanes', label: '차선', level: 'detail', unit: '줄' },
  { id: 'marks', label: '노면표시 (화살표 모양)', level: 'detail', unit: '개' },
  { id: 'hdPaths', label: '보도 면 (정밀도로지도)', level: 'detail', unit: '' },
  { id: 'curbs', label: '연석', level: 'detail', unit: '줄' },
]

const RANK: Record<RenderLevel, number> = { light: 0, normal: 1, detail: 2 }

/** 단계에 들어가는 항목 */
export function itemsOfLevel(level: RenderLevel): ModelItem[] {
  return MODEL_ITEMS.filter((it) => RANK[it.level] <= RANK[level]).map((it) => it.id)
}

/** 항목마다 개수 (자료가 없으면 0 → 화면에서 고를 수 없게) */
export function itemCounts(m: SiteModel): Record<ModelItem, number> {
  return {
    terrain: m.terrain ? m.terrain.cols * m.terrain.rows : 0,
    buildings: m.buildings.length,
    site: m.site.length,
    contours: m.contours.length + m.mapContours.length,
    spots: m.spots.length,
    walls: m.walls.length + m.cutfill.length,
    minor: m.minor.length,
    roads: m.roads.length,
    roadCenters: m.roadCenters.length,
    walks: m.walks.length,
    parcels: m.parcels.length,
    parks: m.parks.length,
    rivers: m.rivers.length,
    trees: m.trees.length,
    stops: m.stops.length,
    lamps: m.lamps.length,
    crosswalks: m.crosswalks.length,
    safety: m.safety.length,
    signals: m.signals.length,
    signs: m.signs.length,
    barriers: m.barriers.length,
    bumps: m.bumps.length,
    fences: m.fences.length,
    lanes: m.lanes.length,
    marks: m.marks.length + m.arrows.length,
    hdPaths: m.hdPaths.length,
    curbs: m.curbs.length,
  }
}

/** 끈 항목을 비운 모형 (높이 함수 zAt은 그대로 — 남은 것을 땅에 얹을 때 씀) */
export function filterModel(m: SiteModel, items: Iterable<string>): SiteModel {
  const on = new Set(items)
  const keep = <T>(id: ModelItem, v: T[]): T[] => (on.has(id) ? v : [])
  return {
    ...m,
    terrain: on.has('terrain') ? m.terrain : null,
    buildings: keep('buildings', m.buildings),
    site: keep('site', m.site),
    contours: keep('contours', m.contours),
    mapContours: keep('contours', m.mapContours),
    spots: keep('spots', m.spots),
    walls: keep('walls', m.walls),
    cutfill: keep('walls', m.cutfill),
    minor: keep('minor', m.minor),
    roads: keep('roads', m.roads),
    roadCenters: keep('roadCenters', m.roadCenters),
    walks: keep('walks', m.walks),
    parcels: keep('parcels', m.parcels),
    parks: keep('parks', m.parks),
    rivers: keep('rivers', m.rivers),
    trees: keep('trees', m.trees),
    stops: keep('stops', m.stops),
    lamps: keep('lamps', m.lamps),
    crosswalks: keep('crosswalks', m.crosswalks),
    zebra: keep('crosswalks', m.zebra),
    safety: keep('safety', m.safety),
    hatch: keep('safety', m.hatch),
    signals: keep('signals', m.signals),
    signs: keep('signs', m.signs),
    // 지주: 달린 것이 켜져 있을 때만 (아무것도 안 달린 지주는 신호등·표지판 중 하나라도 켜면)
    poles: m.poles.filter((p) =>
      p.kinds.length ? (p.kinds.includes('signal') && on.has('signals')) || (p.kinds.includes('sign') && on.has('signs')) : on.has('signals') || on.has('signs'),
    ),
    barriers: keep('barriers', m.barriers),
    bumps: keep('bumps', m.bumps),
    fences: keep('fences', m.fences),
    lanes: keep('lanes', m.lanes),
    marks: keep('marks', m.marks),
    arrows: keep('marks', m.arrows),
    yellowMarks: keep('marks', m.yellowMarks),
    hdPaths: keep('hdPaths', m.hdPaths),
    curbs: keep('curbs', m.curbs),
  }
}
