// 어림 치수 (2026-11-17 사용자 요청: 기본 모델링에서 어림으로 넣는 모든 치수를 고칠 수 있게, 기본값은 그대로).
// 인터뷰: 층고는 3D 모형에만(도판·환경 계산은 diagrams/data.ts의 층고 그대로), 프로젝트마다 저장 + '내 기본값'(이 브라우저),
// 작업대에 묶음별로 접어 보여 줌, 나무 높이는 수종마다.
// 여기 기본값(def)이 예전 코드의 고정 숫자와 같아야 함 — 기본값 그대로면 예전과 똑같은 모형.

import type { Bld } from '../diagrams/data'

export type DimGroup = 'bld' | 'road' | 'river' | 'street' | 'tree'

export const DIM_GROUPS: { id: DimGroup; label: string; note?: string }[] = [
  { id: 'bld', label: '건물·지붕', note: '층고는 실측 높이가 없는 건물에만 (층수 × 층고). 3D 모형에만 쓰고 도판·환경 계산은 그대로' },
  { id: 'road', label: '도로·바닥' },
  { id: 'river', label: '하천·다리', note: '하천 깊이는 위 막대로' },
  { id: 'street', label: '가로 시설' },
  { id: 'tree', label: '나무 (수종별 보통 높이)', note: '그루마다 ±12% 다르게' },
]

export interface DimDef {
  key: DimKey
  group: DimGroup
  label: string
  unit: 'm' | '°' | '%'
  def: number
  min: number
  max: number
  step: number
}

const D = (key: DimKey, group: DimGroup, label: string, unit: DimDef['unit'], def: number, min: number, max: number, step: number): DimDef => ({ key, group, label, unit, def, min, max, step })

export type DimKey =
  | 'floorHouse'
  | 'floorOther'
  | 'floorFactory'
  | 'floorUnknown'
  | 'parapetH'
  | 'parapetW'
  | 'pitchGable'
  | 'pitchMetal'
  | 'curbH'
  | 'curbW'
  | 'laneW'
  | 'laneDouble'
  | 'dashOn'
  | 'dashOff'
  | 'zebraBar'
  | 'zebraGap'
  | 'hatchW'
  | 'hatchGap'
  | 'hatchEdge'
  | 'bumpH'
  | 'roadLift'
  | 'waterCarve'
  | 'bankStep'
  | 'bankSlope'
  | 'clearance'
  | 'thickRoad'
  | 'thickWalk'
  | 'thickRail'
  | 'thickOver'
  | 'railRoad'
  | 'railWalk'
  | 'spanRoad'
  | 'spanWalk'
  | 'spanOver'
  | 'overH'
  | 'overGrade'
  | 'shelterW'
  | 'shelterD'
  | 'shelterH'
  | 'lampH'
  | 'lampArm'
  | 'poleH'
  | 'poleD'
  | 'sigCarL'
  | 'sigPedH'
  | 'barrierH'
  | 'barrierGap'
  | 'fenceWall'
  | 'fenceGuard'
  | 'treeGinkgo'
  | 'treeMeta'
  | 'treeZelkova'
  | 'treeCherry'
  | 'treePlatanus'
  | 'treeFringe'
  | 'treeMaple'
  | 'treeOther'
  | 'treeGarden'

export const DIM_DEFS: DimDef[] = [
  // 건물·지붕
  D('floorHouse', 'bld', '주거 층고 (단독·공동주택)', 'm', 3.0, 2.2, 6, 0.1),
  D('floorOther', 'bld', '비주거 층고', 'm', 4.0, 2.2, 8, 0.1),
  D('floorFactory', 'bld', '공장·창고 층고', 'm', 5.0, 2.2, 12, 0.1),
  D('floorUnknown', 'bld', '용도 모름 층고', 'm', 3.3, 2.2, 8, 0.1),
  D('parapetH', 'bld', '파라펫 높이', 'm', 1.0, 0, 3, 0.05),
  D('parapetW', 'bld', '파라펫 두께', 'm', 0.2, 0.05, 1, 0.05),
  D('pitchGable', 'bld', '박공 지붕 경사', '°', 25, 5, 50, 1),
  D('pitchMetal', 'bld', '낮은 경사 지붕 (금속)', '°', 8, 1, 30, 1),
  // 도로·바닥
  D('curbH', 'road', '인도·교통섬·연석 높이 (차도보다)', 'm', 0.15, 0, 0.5, 0.01),
  D('curbW', 'road', '연석 폭', 'm', 0.2, 0.05, 0.6, 0.01),
  D('laneW', 'road', '차선 폭', 'm', 0.15, 0.05, 0.5, 0.01),
  D('laneDouble', 'road', '겹선(중앙선) 두 줄 중심 간격', 'm', 0.3, 0.1, 1, 0.01),
  D('dashOn', 'road', '점선 칠한 길이', 'm', 3, 0.5, 20, 0.5),
  D('dashOff', 'road', '점선 빈 길이', 'm', 5, 0.5, 20, 0.5),
  D('zebraBar', 'road', '횡단보도 줄 폭', 'm', 0.45, 0.2, 1.5, 0.05),
  D('zebraGap', 'road', '횡단보도 줄 사이', 'm', 0.45, 0.2, 1.5, 0.05),
  D('hatchW', 'road', '안전지대 빗금 폭', 'm', 0.3, 0.1, 1, 0.05),
  D('hatchGap', 'road', '안전지대 빗금 간격', 'm', 1.2, 0.3, 5, 0.1),
  D('hatchEdge', 'road', '안전지대 테두리 폭', 'm', 0.15, 0.05, 0.5, 0.01),
  D('bumpH', 'road', '과속방지턱 높이', 'm', 0.08, 0.02, 0.3, 0.01),
  D('roadLift', 'road', '도로 면 띄움 (지형 위, 겹쳐 깜빡이지 않게)', 'm', 0.08, 0, 0.5, 0.01),
  // 하천·다리
  D('waterCarve', 'river', '물 밑 땅 파기 (물 면 아래)', 'm', 0.6, 0, 3, 0.1),
  D('bankStep', 'river', '둔치가 물보다 높은 만큼 (물가)', 'm', 0.4, 0, 3, 0.1),
  D('bankSlope', 'river', '둔치 비탈 (물가 → 둑)', '%', 30, 5, 100, 1),
  D('clearance', 'river', '다리 밑과 물 사이 여유', 'm', 0.3, 0, 5, 0.1),
  D('thickRoad', 'river', '도로교 상판 두께', 'm', 1.2, 0.3, 4, 0.1),
  D('thickWalk', 'river', '보도교 상판 두께', 'm', 0.5, 0.2, 3, 0.1),
  D('thickRail', 'river', '철교 상판 두께', 'm', 1.5, 0.3, 4, 0.1),
  D('thickOver', 'river', '고가차도 상판 두께', 'm', 1.4, 0.3, 4, 0.1),
  D('railRoad', 'river', '도로교·고가 난간 높이', 'm', 1.0, 0, 2, 0.05),
  D('railWalk', 'river', '보도교 난간 높이', 'm', 1.1, 0, 2, 0.05),
  D('spanRoad', 'river', '도로교·철교 교각 간격', 'm', 25, 5, 100, 1),
  D('spanWalk', 'river', '보도교 교각 간격', 'm', 20, 5, 100, 1),
  D('spanOver', 'river', '고가차도 교각 간격', 'm', 30, 5, 100, 1),
  D('overH', 'river', '고가 밑 높이 (자료에 없을 때)', 'm', 5, 2, 20, 0.5),
  D('overGrade', 'river', '고가 오르막 경사', '%', 6, 1, 15, 0.5),
  // 가로 시설
  D('shelterW', 'street', '정류장 쉘터 길이', 'm', 3.6, 1, 15, 0.1),
  D('shelterD', 'street', '정류장 쉘터 깊이', 'm', 1.5, 0.5, 5, 0.1),
  D('shelterH', 'street', '정류장 쉘터 높이', 'm', 2.55, 1.5, 5, 0.05),
  D('lampH', 'street', '가로등 높이', 'm', 8, 2, 20, 0.5),
  D('lampArm', 'street', '가로등 팔 길이', 'm', 1.6, 0.4, 5, 0.1),
  D('poleH', 'street', '지주 높이 (아무것도 안 달린 것)', 'm', 3.5, 1, 12, 0.1),
  D('poleD', 'street', '지주 지름', 'm', 0.16, 0.05, 0.6, 0.01),
  D('sigCarL', 'street', '차량 신호등 길이', 'm', 1.3, 0.3, 3, 0.05),
  D('sigPedH', 'street', '보행 신호등 높이', 'm', 0.85, 0.3, 2, 0.05),
  D('barrierH', 'street', '방호시설 높이', 'm', 0.8, 0.3, 2, 0.05),
  D('barrierGap', 'street', '방호시설 기둥 간격', 'm', 2, 0.5, 10, 0.5),
  D('fenceWall', 'street', '담장 높이', 'm', 1.5, 0.3, 5, 0.1),
  D('fenceGuard', 'street', '가드레일·펜스 높이', 'm', 0.8, 0.3, 3, 0.1),
  // 나무
  D('treeGinkgo', 'tree', '은행나무', 'm', 10, 2, 40, 0.5),
  D('treeMeta', 'tree', '메타세쿼이아', 'm', 15, 2, 40, 0.5),
  D('treeZelkova', 'tree', '느티나무', 'm', 10, 2, 40, 0.5),
  D('treeCherry', 'tree', '왕벚나무', 'm', 8, 2, 40, 0.5),
  D('treePlatanus', 'tree', '플라타너스', 'm', 12, 2, 40, 0.5),
  D('treeFringe', 'tree', '이팝나무', 'm', 7, 2, 40, 0.5),
  D('treeMaple', 'tree', '중국단풍', 'm', 7, 2, 40, 0.5),
  D('treeOther', 'tree', '기타 수종', 'm', 7, 2, 40, 0.5),
  D('treeGarden', 'tree', '정원수 (1:1,000 독립수)', 'm', 4.5, 1, 30, 0.5),
]

export type ModelDims = Record<DimKey, number>

export const DEFAULT_DIMS: ModelDims = Object.fromEntries(DIM_DEFS.map((d) => [d.key, d.def])) as ModelDims

const DEF_BY_KEY = new Map(DIM_DEFS.map((d) => [d.key, d]))

/** 저장된 일부 값 + 기본값 (범위 밖·숫자 아님은 기본값) */
export function dimsOf(p?: Partial<Record<string, number>> | null): ModelDims {
  const out = { ...DEFAULT_DIMS }
  if (p)
    for (const [k, v] of Object.entries(p)) {
      const d = DEF_BY_KEY.get(k as DimKey)
      if (d && typeof v === 'number' && Number.isFinite(v)) out[d.key] = Math.max(d.min, Math.min(d.max, v))
    }
  return out
}

/** 기본값과 다른 것만 (프로젝트에 저장할 때) */
export function changedDims(d: ModelDims): Partial<ModelDims> {
  const out: Partial<ModelDims> = {}
  for (const def of DIM_DEFS) if (Math.abs(d[def.key] - def.def) > 1e-9) out[def.key] = d[def.key]
  return out
}

/** 수종 → 치수 키 */
export const TREE_DIM: Record<string, DimKey> = {
  은행나무: 'treeGinkgo',
  메타세쿼이아: 'treeMeta',
  느티나무: 'treeZelkova',
  왕벚나무: 'treeCherry',
  플라타너스: 'treePlatanus',
  이팝나무: 'treeFringe',
  중국단풍: 'treeMaple',
  기타: 'treeOther',
  정원수: 'treeGarden',
}

/** 3D 모형 층고 (용도 코드 앞 두 자리: 01·02 주거, 17·18 공장·창고) — diagrams/data.ts floorHeightOf와 같은 나눔 */
export function modelFloorHeight(use: string, d: ModelDims): number {
  const u = use.trim()
  if (!u) return d.floorUnknown
  if (u.startsWith('01') || u.startsWith('02')) return d.floorHouse
  if (u.startsWith('17') || u.startsWith('18')) return d.floorFactory
  return d.floorOther
}

/** 3D 모형 건물 높이: 실측 높이, 없으면 층수 × 층고 (0.1m 단위), 둘 다 없으면 null */
export function modelBldHeight(b: Pick<Bld, 'floors' | 'use' | 'heightM'>, d: ModelDims): number | null {
  if (b.heightM && b.heightM > 0) return b.heightM
  if (b.floors && b.floors > 0) return Math.round(b.floors * modelFloorHeight(b.use, d) * 10) / 10
  return null
}

/** '내 기본값' (이 브라우저, 새 프로젝트가 이 값으로 시작) */
const USER_KEY = 'site-agent:model-dims'

export function loadUserDims(): Partial<ModelDims> | null {
  try {
    const s = localStorage.getItem(USER_KEY)
    if (!s) return null
    const v = JSON.parse(s) as unknown
    return v && typeof v === 'object' ? changedDims(dimsOf(v as Partial<Record<string, number>>)) : null
  } catch {
    return null
  }
}

export function saveUserDims(d: Partial<ModelDims> | null): boolean {
  try {
    if (!d || !Object.keys(d).length) localStorage.removeItem(USER_KEY)
    else localStorage.setItem(USER_KEY, JSON.stringify(d))
    return true
  } catch {
    return false
  }
}
