// 렌더 재질 (2026-11-16 사용자 결정): 간단한 작업은 엔스케이프(라이노 안), 메인 컷은 D5 — 둘 다 되게.
// - 라이노 PBR 재질(기본색·거칠기·금속감·불투명도)과 옛 재질 값(확산색·투명도)을 함께 적는다 → 어느 쪽을 읽는 프로그램이든 색이 맞음
// - 재질 이름은 SA_로 시작하는 영문 + 한글 설명 → 엔스케이프·D5에서 이름으로 찾아 자기 재질로 바꿔 끼우기 쉬움
// - 무늬 이미지(textures.ts)는 한 장 = 실제 tile m. 메시마다 그 크기로 UV를 직접 적는다
//   (D5 LiveSync는 라이노의 WCS 매핑을 못 받는다 — D5 문서. 메시에 적힌 UV는 그대로 감)
// - 재질 방식은 학생이 고름: 사실적 + 무늬 / 사실적 단색 / 흰 모형 / 재질 없음

import { TEX_FILE, type TexId } from './textures'

export type MaterialStyle = 'tex' | 'flat' | 'white' | 'none'

export const MATERIAL_STYLES: { id: MaterialStyle; label: string; note: string }[] = [
  {
    id: 'tex',
    label: '사실적 + 무늬',
    note: 'PBR 재질에 아스팔트·보도블록·잔디·땅·콘크리트 무늬 이미지(앱이 그림)를 넣습니다. 바로 렌더해도 그럴듯합니다. 파일이 약 1MB 커집니다.',
  },
  { id: 'flat', label: '사실적 단색', note: 'PBR 재질(색·거칠기·반사)만 넣습니다. 가볍고, 엔스케이프·D5에서 재질 이름별로 자기 재질로 바꿔 끼우기 좋습니다.' },
  { id: 'white', label: '흰 모형', note: '무광 흰색·옅은 회색의 모형 재질입니다. 매스·다이어그램 렌더용.' },
  { id: 'none', label: '재질 없음', note: '예전처럼 레이어 색만 (렌더러 기본 재질).' },
]

export type MatId =
  | 'asphalt'
  | 'asphaltRed'
  | 'paving'
  | 'grass'
  | 'ground'
  | 'aerial'
  | 'concrete'
  | 'curb'
  | 'retaining'
  | 'fence'
  | 'facade'
  | 'facadeSite'
  | 'roof'
  | 'parapet'
  | 'water'
  | 'glass'
  | 'metal'
  | 'metalDark'
  | 'paintWhite'
  | 'paintYellow'
  | 'paintBlue'
  | 'signRed'
  | 'signYellow'
  | 'signWhite'
  | 'signBlue'
  | 'treeLeaves'
  | 'treeBark'

type Rgb = [number, number, number]

export interface MatDef {
  name: string
  /** 기본색 (sRGB 0~255) — 무늬가 있으면 무늬의 평균색 */
  base: Rgb
  /** 거칠기 0(거울)~1(무광) */
  rough: number
  metal?: number
  /** 불투명도 (유리) */
  opacity?: number
  tex?: TexId
  bump?: TexId
  /** 무늬 한 장의 실제 크기 (m) — UV를 이 크기로 적음 */
  tile?: number
}

/** 이름은 방식이 달라도 같게 (렌더러에서 바꿔 끼운 재질을 다시 내려받아도 이름으로 맞추기) */
const NAME: Record<MatId, string> = {
  asphalt: 'SA_Asphalt (도로 아스팔트)',
  asphaltRed: 'SA_Asphalt_Red (어린이보호구역 적색 포장)',
  paving: 'SA_Paving (보도블록)',
  grass: 'SA_Grass (잔디·공원)',
  ground: 'SA_Ground (땅)',
  aerial: 'SA_Aerial (지형 항공사진)',
  concrete: 'SA_Concrete (교통섬·콘크리트)',
  curb: 'SA_Curb (연석)',
  retaining: 'SA_Retaining_Wall (옹벽·석축)',
  fence: 'SA_Fence (담장)',
  facade: 'SA_Facade (주변 건물 외벽)',
  facadeSite: 'SA_Facade_Site (대지 안 기존 건물)',
  roof: 'SA_Roof (경사 지붕)',
  parapet: 'SA_Parapet (파라펫)',
  water: 'SA_Water (하천)',
  glass: 'SA_Glass (유리)',
  metal: 'SA_Metal (가로등·지주·방호시설)',
  metalDark: 'SA_Metal_Dark (신호등·쉘터)',
  paintWhite: 'SA_Paint_White (흰 노면표시)',
  paintYellow: 'SA_Paint_Yellow (노란 노면표시)',
  paintBlue: 'SA_Paint_Blue (파란 노면표시)',
  signRed: 'SA_Sign_Red (표지판 빨강)',
  signYellow: 'SA_Sign_Yellow (표지판 노랑)',
  signWhite: 'SA_Sign_White (표지판 흰색)',
  signBlue: 'SA_Sign_Blue (표지판 파랑)',
  treeLeaves: 'SA_Tree_Leaves (나무 수관)',
  treeBark: 'SA_Tree_Bark (나무 줄기)',
}

/** 사실적 (무늬 이미지 포함) */
const REAL: Record<MatId, Omit<MatDef, 'name'>> = {
  asphalt: { base: [74, 74, 76], rough: 0.9, tex: 'asphalt', tile: 4 },
  asphaltRed: { base: [150, 64, 54], rough: 0.85, tex: 'asphaltRed', tile: 4 },
  paving: { base: [184, 178, 166], rough: 0.8, tex: 'paving', bump: 'pavingBump', tile: 2.4 },
  grass: { base: [92, 120, 56], rough: 0.95, tex: 'grass', tile: 4 },
  ground: { base: [112, 108, 76], rough: 0.95, tex: 'ground', tile: 8 },
  aerial: { base: [255, 255, 255], rough: 0.95 },
  concrete: { base: [184, 182, 176], rough: 0.8, tex: 'concrete', tile: 3 },
  curb: { base: [168, 166, 160], rough: 0.7, tex: 'concrete', tile: 1.5 },
  retaining: { base: [150, 147, 140], rough: 0.85, tex: 'concrete', tile: 3 },
  fence: { base: [178, 172, 164], rough: 0.85, tex: 'concrete', tile: 3 },
  facade: { base: [214, 210, 202], rough: 0.7, tile: 3 },
  facadeSite: { base: [226, 200, 190], rough: 0.7, tile: 3 },
  roof: { base: [98, 100, 106], rough: 0.5, metal: 0.3, tile: 3 },
  parapet: { base: [200, 198, 192], rough: 0.8, tex: 'concrete', tile: 3 },
  water: { base: [52, 86, 100], rough: 0.05, tile: 8 },
  glass: { base: [190, 214, 224], rough: 0.05, opacity: 0.35 },
  metal: { base: [150, 152, 155], rough: 0.4, metal: 1 },
  metalDark: { base: [52, 55, 60], rough: 0.5, metal: 0.6 },
  paintWhite: { base: [236, 236, 232], rough: 0.6, tile: 1 },
  paintYellow: { base: [232, 180, 40], rough: 0.6, tile: 1 },
  paintBlue: { base: [52, 96, 200], rough: 0.6, tile: 1 },
  signRed: { base: [200, 50, 42], rough: 0.35 },
  signYellow: { base: [242, 194, 48], rough: 0.35 },
  signWhite: { base: [244, 244, 242], rough: 0.35 },
  signBlue: { base: [42, 91, 176], rough: 0.35 },
  treeLeaves: { base: [72, 112, 52], rough: 0.9 },
  treeBark: { base: [96, 74, 56], rough: 0.9 },
}

/** 흰 모형: 무광 흰색 바탕에 길·물·유리만 옅게 구분 */
const WHITE: Record<MatId, Omit<MatDef, 'name'>> = {
  asphalt: { base: [184, 184, 182], rough: 0.9 },
  asphaltRed: { base: [198, 184, 180], rough: 0.9 },
  paving: { base: [214, 212, 206], rough: 0.9 },
  grass: { base: [212, 220, 204], rough: 0.95 },
  ground: { base: [226, 224, 218], rough: 0.95 },
  aerial: { base: [255, 255, 255], rough: 0.95 },
  concrete: { base: [222, 220, 214], rough: 0.9 },
  curb: { base: [222, 220, 214], rough: 0.9 },
  retaining: { base: [222, 220, 214], rough: 0.9 },
  fence: { base: [232, 230, 226], rough: 0.9 },
  facade: { base: [240, 238, 234], rough: 0.85 },
  facadeSite: { base: [242, 226, 220], rough: 0.85 },
  roof: { base: [232, 230, 226], rough: 0.85 },
  parapet: { base: [240, 238, 234], rough: 0.85 },
  water: { base: [196, 212, 220], rough: 0.15 },
  glass: { base: [230, 238, 242], rough: 0.05, opacity: 0.4 },
  metal: { base: [210, 210, 208], rough: 0.8 },
  metalDark: { base: [196, 196, 194], rough: 0.8 },
  paintWhite: { base: [246, 246, 244], rough: 0.85 },
  paintYellow: { base: [230, 222, 198], rough: 0.85 },
  paintBlue: { base: [206, 214, 228], rough: 0.85 },
  signRed: { base: [232, 214, 210], rough: 0.85 },
  signYellow: { base: [236, 230, 210], rough: 0.85 },
  signWhite: { base: [246, 246, 244], rough: 0.85 },
  signBlue: { base: [214, 220, 232], rough: 0.85 },
  treeLeaves: { base: [238, 238, 234], rough: 0.9 },
  treeBark: { base: [220, 214, 204], rough: 0.9 },
}

/** 방식에 맞는 재질 값. 'none'이면 null */
export function materialSet(style: MaterialStyle): Record<MatId, MatDef> | null {
  if (style === 'none') return null
  const out = {} as Record<MatId, MatDef>
  for (const id of Object.keys(NAME) as MatId[]) {
    const real = REAL[id]
    const src = style === 'white' ? { ...WHITE[id], tile: real.tile } : style === 'flat' ? { ...real, tex: undefined, bump: undefined } : real
    out[id] = { name: NAME[id], ...src }
  }
  return out
}

/** 레이어 → 재질 (레이어 재질로 붙임). 선만 있는 레이어는 없음 */
export const LAYER_MAT: Partial<Record<string, MatId>> = {
  bldgAround: 'facade',
  bldgSite: 'facadeSite',
  roofPitched: 'roof',
  parapet: 'parapet',
  mesh: 'ground',
  wall: 'retaining',
  roadSurf: 'asphalt',
  walk: 'paving',
  park: 'grass',
  river: 'water',
  stop: 'metalDark',
  stopGlass: 'glass',
  lamp: 'metal',
  crosswalk: 'paintWhite',
  island: 'concrete',
  safetyPaint: 'paintYellow',
  schoolZone: 'asphaltRed',
  fence: 'fence',
  laneWhite: 'paintWhite',
  laneYellow: 'paintYellow',
  laneBlue: 'paintBlue',
  mark: 'paintWhite',
  signal: 'metalDark',
  pole: 'metal',
  sign: 'signYellow',
  barrier: 'metal',
  bump: 'paintYellow',
  hdPath: 'paving',
  curb: 'curb',
  treeBlock: 'treeLeaves',
}

/** 이 재질들이 쓰는 무늬 이미지 */
export function texturesOf(set: Record<MatId, MatDef>, ids: Iterable<MatId>): TexId[] {
  const out = new Set<TexId>()
  for (const id of ids) {
    const d = set[id]
    if (d.tex) out.add(d.tex)
    if (d.bump) out.add(d.bump)
  }
  return [...out]
}

/** .3dm 안에 넣는 이미지 경로 (라이노가 열 때 '파일이름_embedded_files' 폴더로 풀고 이름으로 찾음) */
export const TEX_DIR = 'C:/site-agent/textures/'
export const texPath = (file: string) => TEX_DIR + file
export { TEX_FILE }

/** 렌더러에서 쓰는 법 (3dm 정보·ZIP 읽어보기에 같이 적음) */
export const RENDER_HELP: [string, string][] = [
  ['엔스케이프', '라이노에서 그대로 렌더 — 레이어마다 SA_ 재질이 붙어 있음. 잔디·물은 엔스케이프 재질 편집기에서 종류를 Grass·Water로 바꾸면 더 좋음'],
  ['D5', 'D5 LiveSync(또는 Sync)로 라이노에서 넘기거나 D5에서 .3dm을 바로 불러오기. 재질 이름(SA_…)으로 D5 재질 라이브러리와 바꿔 끼우기. 메시에 실제 크기 UV가 적혀 있어 무늬 크기가 맞음'],
  ['무늬가 안 보이면', '⑩의 "무늬 이미지 따로 받기 (ZIP)"를 .3dm과 같은 폴더에 풀기 (라이노는 모형 폴더에서 같은 이름의 이미지를 찾음)'],
]
