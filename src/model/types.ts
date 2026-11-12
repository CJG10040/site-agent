// 프로젝트 데이터 구조.
// 요청서 5장(정보 유형), 6.1·6.2(시작 입력), 8.4(출처 기록), 8.5(해석 데이터)를 따른다.

import type { Geometry, Polygon, MultiPolygon } from 'geojson'

export const SCHEMA_VERSION = 1

export type StepId = 'brief' | 'question' | 'site' | 'data' | 'facts' | 'diagrams' | 'observe' | 'interpret' | 'report' | 'model'

/** F-02 과제 맥락 + 6.1 시작 입력 */
export interface Brief {
  projectName: string
  program: string // 건축 프로그램
  theme: string // 과제명 또는 공모전 주제
  scale: string // 예상 규모·연면적
  targetUsers: string // 사용자·대상자
  nature: string // 설계 대상의 성격 (신축, 리노베이션 …)
  visit: '' | 'done' | 'planned' | 'none' // 현장답사 여부
  deliverables: string // 제출 결과물 형태
  materials: string // 이미 가진 사진·도면·메모
}

/** 6.2 첫 질문 + 4.2 개인의 관점 */
export interface FirstQuestion {
  curiosity: string // 이 대지를 통해 가장 궁금한 것
  lenses: string[] // 관심 관점
  lensOther: string
  avoid: string // 피하고 싶은 일반적인 해석
  personal: string // 이 대지를 고른 이유, 기억, 불편했던 점
}

export interface ParcelRef {
  pnu: string
  addr: string
  jibun: string // 예: "3-4대"
  jimok: string // 예: "대"
  jiga: number | null // 개별공시지가 (원/㎡)
  gosiYM: string | null // 기준 연월 "2025-01"
  areaM2: number // 지적 도형으로 계산한 면적
  geometry: Polygon | MultiPolygon
}

export interface Site {
  parcels: ParcelRef[]
  drawn: Polygon | null
  boundaryMode: 'parcels' | 'drawn'
  radiusM: number
  address: { road?: string; parcel?: string } | null
}

/** 8.4 권장 데이터 구조 */
export interface SourceRecord {
  source_id: string // 예: "S-03"
  source_name: string // 예: "브이월드 (국토교통부 공간정보 오픈플랫폼)"
  dataset_name: string // 예: "GIS건물통합정보"
  dataset_id: string // 예: "LT_C_BLDGINFO"
  retrieved_at: string // ISO 시각
  update_date: string | null // 데이터 갱신일 (제공되지 않으면 null)
  geometry: string // 조회 범위 설명
  coordinate_system: string
  spatial_scale: string // 예: "대지 경계", "반경 500m"
  time_range: string | null
  raw_ref: string | null // collected 안의 원본 키
  normalized_value: unknown
  unit: string | null
  license: string
  limitations: string
  original_url: string // 인증키는 제거하고 저장
  reliability: 'official' | 'computed' | 'user' | 'secondary' // secondary = 민간 지도 서비스(카카오 등)
  feature_count: number | null
  status: 'ok' | 'empty' | 'error'
  error: string | null
}

export type CardType =
  | 'FACT'
  | 'OBSERVATION'
  | 'INTERPRETATION'
  | 'TENSION'
  | 'OPPORTUNITY'
  | 'QUESTION'
  | 'HYPOTHESIS'
  | 'UNKNOWN'

export type CardStatus = 'draft' | 'confirmed' | 'rejected'

/** 현장 관찰(F-05, 화면 4)의 세부 정보 — OBSERVATION 카드에 붙는다 */
export interface ObservationDetail {
  photoIds: string[]
  location: { lon: number; lat: number; source: 'exif' | 'gps' | 'map' } | null
  /** 대지 중심에서 본 위치 (예: "대지 북동쪽 120m") — 저장 시 계산 */
  relative: string | null
  /** 관찰 시각 (현지 시각, "YYYY-MM-DDTHH:mm") */
  observedAt: string | null
  timeSource: 'exif' | 'now' | 'manual' | null
  senses: string[]
  actors: string[]
  actions: string[]
  feeling: string
  weather: string
  /** 자료(지도·공공데이터)에 없던 새로운 발견인지 */
  discovery: boolean
  /** 관련 사실 카드와의 관계 */
  links: { cardId: string; relation: 'match' | 'differ' }[]
}

/** 8.5 해석 데이터 구조를 카드 단위로 표현 */
export interface Card {
  id: string // 예: "F-01"
  /** 기기 사이에 관찰을 합칠 때 쓰는 고유값 (번호와 달리 바뀌지 않음) */
  uid?: string
  observation?: ObservationDetail
  type: CardType
  topic: string // 예: "규제", "주변 건물"
  text: string
  related_source_ids: string[]
  related_card_ids: string[]
  origin: 'data' | 'user' | 'chatbot'
  confidence: 'high' | 'medium' | 'low'
  human_validation_required: boolean
  status: CardStatus
  user_note: string
  /** 자동 생성 카드를 다시 만들 때 같은 항목을 찾기 위한 키 */
  auto_key: string | null
  /** 사용자가 문장을 고쳤는지 (고친 카드는 재생성 시 덮어쓰지 않음) */
  edited: boolean
  created_at: string
  updated_at: string
  history: { at: string; text: string }[]
  /** 챗봇 답변의 구조화된 항목 (예: 관점, 관계 유형, 공간적 행동, 장점, 위험 …) */
  fields?: Record<string, string>
  /** 이 카드를 만든 챗봇 왕복 단계 */
  round?: RoundId
  /** 요청서 F-12 사용자 반응 */
  reaction?: Reaction | null
}

/** 챗봇 왕복 단계: ① 관계·긴장·기회 ② 복수 해석·설계 질문 ③ 설계 가설 ④ 심화 ⑤ 추가 조사·요약 */
export type RoundId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5'

/** 요청서 F-12: 동의 · 부분 동의 · 현장과 다름 · 중요하지 않음 · 더 조사하기 · 반대 해석 만들기 · 발전시키기 (직접 수정은 편집으로) */
export type Reaction = 'agree' | 'partial' | 'differs' | 'unimportant' | 'investigate' | 'counter' | 'develop'

/** 계획서 3.6 챗봇 세션: 보낸 프롬프트와 붙여넣은 답변 원문을 남긴다 */
export interface ChatSession {
  id: string
  round: RoundId
  createdAt: string
  prompt: string
  answer: string | null
  answeredAt: string | null
  chatbot: string
  importedCardIds: string[]
}

export interface CollectedLayer {
  dataset_id: string
  retrieved_at: string
  features: { type: 'Feature'; geometry: Geometry | null; properties: Record<string, unknown> }[]
}

/** 15-C 렌더링 모델 디테일 단계 */
export type RenderLevel = 'light' | 'normal' | 'detail'

/** 15-C 렌더링 모델 설정: 단계 + 켠 항목 (단계를 고르면 그 단계의 항목으로 바뀜) */
export interface RenderModelSettings {
  level: RenderLevel
  items: string[]
}

/** 15-B 콘타 모형 도로 처리: 새김선 / 따로 자른 조각(얇은 재료) / 파내기(한 판 내려앉힘) */
export type ContourRoadMode = 'engrave' | 'pieces' | 'cutout'

/** 15-B 콘타 모형 설정 (2026-11-12 인터뷰: 기본 1:500, 우드락·폼보드 1~5mm, 재료 판 600×900) */
export interface ContourSettings {
  /** 축척 분모 (1:500 → 500) */
  scale: number
  /** 판 두께 (mm) — 등고 간격 = 두께 × 축척 */
  thickness: number
  /** 재료 판 가로·세로 (mm) */
  sheetW: number
  sheetH: number
  /** 모형 가로·세로 (mm, 정사각). 0 = 재료 판에 들어가는 가장 큰 것 */
  sizeMm: number
  roads: ContourRoadMode
}

export interface Project {
  schema: number
  id: string
  createdAt: string
  updatedAt: string
  lastExportedAt: string | null
  brief: Brief
  question: FirstQuestion
  site: Site
  collectedAt: string | null
  collectedRadiusM: number | null
  /** 수집할 때의 대지 경계 식별값 (대지가 바뀌었는지 알기 위함) */
  collectedSiteKey?: string | null
  /** 수집할 자료 묶음 (데이터 선택 화면). 없으면 전부 */
  dataSelection?: string[]
  /** 마지막 수집의 항목별 결과 (새로고침 후에도 보여 주기 위함) */
  collectLog?: { id: string; label: string; group: string; state: 'pending' | 'running' | 'ok' | 'empty' | 'error'; count?: number; message?: string }[]
  collected: Record<string, CollectedLayer>
  sources: SourceRecord[]
  cards: Card[]
  counters: Record<string, number>
  /** 챗봇 왕복 기록 */
  chatLog?: ChatSession[]
  /** 패널용 대지해석 요약문 (⑤ 단계 답변) */
  panelSummary?: string
  /** 리포트를 마지막으로 인쇄(PDF 저장)한 시각 */
  reportPrintedAt?: string
  /** ⑩ 3D 모형에서 .3dm·DXF를 마지막으로 내려받은 때 */
  modelExportedAt?: string
  /** 15-B 콘타 모형 설정 (축척·판 두께·재료 판·크기·도로 처리) */
  contour?: ContourSettings
  /** 15-C 렌더링 모델 단계·항목 */
  renderModel?: RenderModelSettings
  /** 15-D 지붕 구조를 건축물대장에서 조회할 반경 (m, 학생이 정함) */
  roofRadiusM?: number
  /** Phase 7 도판: 그리기 설정과 도판별 결론 */
  diagrams?: DiagramState
  /** Phase 12 종합 다이어그램 (⑧ 해석·가설에서 그림) */
  synth?: SynthState
  /** Phase 12 교수·조교·동료 피드백과 반영 */
  feedback?: Feedback[]
  /** 도판에서 학생이 고친 것 (2026-11-12): 잘못된 자료 빼기, 도판 위 표기 옮기기·숨기기 */
  edits?: ProjectEdits
}

// ───────────────────────── 학생이 고친 것 (2026-11-12) ─────────────────────────
// 사용자 결정: ⑥ 도판 그림에서 눌러 '잘못된 점·도형 빼기'와 '표기 옮기기' / 모든 도판·분석에 반영 + 기록 / 다시 수집해도 유지.

/** 뺄 수 있는 자료 갈래 */
export type HideLayer = 'building' | 'stop' | 'station' | 'store' | 'poi' | 'park' | 'facility'

/** 자료 빼기: 수집 자료가 바뀌어도 같은 것을 다시 찾도록 위치(점·도형 가운데)와 이름으로 기억 */
export interface HideEdit {
  id: string
  layer: HideLayer
  lon: number
  lat: number
  name: string
  /** 목록에 보일 설명 (예: '건물 · 대광아파트 경비실 · 5층') */
  desc: string
  reason: string
  createdAt: string
}

/** 표기 옮기기·숨기기: 도판 하나의 글자 (같은 글이 여럿이면 몇 번째인지까지) */
export interface LabelEdit {
  id: string
  panelId: string
  /** 글 + '#' + 같은 글 중 순서 */
  key: string
  text: string
  dx: number
  dy: number
  hidden: boolean
  createdAt: string
}

export interface ProjectEdits {
  hides: HideEdit[]
  labels: LabelEdit[]
}

// ───────────────────────── Phase 7 도판 ─────────────────────────

export type FrameShape = 'circle' | 'square'
export type PaletteId = 'default' | 'cvd' | 'mono' | 'paperSage' | 'paperNavy' | 'pastelBloom' | 'pastelSky' | 'pastelMint' | 'concrete' | 'brick' | 'wood' | 'metal' | 'night' | 'navy' | 'vividRed' | 'vividTeal' | 'theme'
export type SiteMark = 'outline' | 'fill' | 'dot'

/** 학생이 고친 색 (빈 칸 = 묶음 색 그대로). 줄 색은 자리별, 빈 문자열 = 그대로 */
export interface PaletteEdit {
  paper?: string
  ink?: string
  subtle?: string
  base?: string
  unknown?: string
  water?: string
  green?: string
  accent?: string
  seq?: string[]
  cat?: string[]
  div?: string[]
}

/** 도판 하나만 다른 색 (2026-11-12 사용자 결정: 보드 전체 + 도판별 덮어쓰기) */
/** 14-D 두 주제 겹쳐 보기 한 칸 */
export interface OverlaySpec {
  /** 아래 도판 id */
  base: string
  /** 위 도판 id */
  top: string
  /** 위 도판 진하기 0.15~1 */
  opacity: number
  /** fill 그대로 / lines 면을 테두리로 */
  mode: 'fill' | 'lines'
}

/** 테마색 하나로 만드는 색 조합 (2026-11-12 사용자 요청) */
export interface ThemeSpec {
  /** 테마색 #rrggbb */
  color: string
  /** 범주색을 고르는 방식: 유사색 · 보색 · 세 색 */
  harmony: 'analog' | 'complement' | 'triad'
  /** 바탕: 밝게 · 파스텔 · 어둡게 */
  tone: 'light' | 'pastel' | 'dark'
  /** '다른 조합'을 누른 횟수 (범주색 순서·강조색을 바꿈) */
  variant: number
}

export interface PanelStyle {
  /** 다른 묶음 (없으면 보드 전체 묶음 + 전체 고친 색 위에 colors) */
  palette?: PaletteId
  /** 테마색으로 만든 조합 (palette보다 먼저) */
  theme?: ThemeSpec
  colors?: PaletteEdit
}

export interface DiagramSettings {
  frame: FrameShape
  palette: PaletteId
  /** 보드 전체를 테마색 조합으로 (있으면 palette 대신) */
  theme?: ThemeSpec
  /** 보드 전체 묶음에서 학생이 고친 색 */
  colors?: PaletteEdit
  /** 도판별 덮어쓰기 (도판 id → 묶음·색) */
  panelStyles?: Record<string, PanelStyle>
  /** white = 묶음의 종이색으로 칠함 / none = 투명 */
  background: 'white' | 'none'
  siteMark: SiteMark
  /** 고층 도판: 이 층수 이상 */
  highFloors: number
  /** 저층 도판: 이 층수 이하 */
  lowFloors: number
  sunDay: 'summer' | 'equinox' | 'winter'
  /** 그림자 시각 (한국 표준시, 시) */
  sunHour: number
  /** PNG 가로 픽셀 */
  pngWidth: number
  /** 바람장미 계절 (0 연중, 1 봄, 2 여름, 3 가을, 4 겨울) */
  windSeason: number
  /** 실시간 도로 속도 장면 번호 (-1 = 가장 최근) */
  speedSnap: number
  /** 가시권에서 강조할 계획 층수 */
  planFloors: number
  /** 단면 방향 회전(°, 시계방향): 0이면 남북·동서 */
  sectionAngle: number
  /** 단면 높이 과장 배율 (1 = 실제 비율, 2026-11-12 사용자 결정: 기본 1:1 + 과장 고르기) */
  sectionVex: number
  /** 단면 범위: site 대지와 주변(기본, 2026-11-12) / radius 수집 반경 전체 */
  sectionRange: 'site' | 'radius'
  /** 계산 결과(일조·가시권·바람·더위)·지형 칠하기: smooth 매끄럽게(기본, 14-B) / cells 칸 그대로 */
  fieldStyle: 'smooth' | 'cells'
  /** 바람 흐름 실험 표현: lines 흐름선(기본) / arrows 들어오는 방향 화살표만 */
  windStyle: 'lines' | 'arrows'
  /** 지형 도판 음영 기복 */
  terrainShade: boolean
  /** 두 주제 겹쳐 보기 칸 (14-D, 비면 null) */
  overlays?: (OverlaySpec | null)[]
  /** 분해 다이어그램 (14-F): 층(아래 → 위, 도판 id 또는 'site'), 보는 방향 */
  exploded?: { layers?: string[]; az?: number }
  /** 3D로 볼 도판 id (14-E, 도판마다 평면/3D) */
  view3d?: string[]
  /** 3D 보는 방향(°, 보는 사람이 선 방위)·내려다보는 각(°)·높이 과장 */
  cam3d?: { az?: number; tilt?: number; vex?: number }
}

/** 도판 하나의 결론 */
export interface PanelNote {
  conclusion: string
  /** 챗봇이 제안한 결론 후보 */
  suggestions: string[]
  /** 리포트에 넣을지 */
  include: boolean
  /** 지금 결론이 어디서 왔는지 */
  source: 'user' | 'chatbot' | null
  updatedAt: string
}

export interface DiagramChat {
  at: string
  chatbot: string
  prompt: string
  answer: string
  matched: number
}

export interface DiagramState {
  settings: DiagramSettings
  panels: Record<string, PanelNote>
  chatLog?: DiagramChat[]
  /** ⑨ 리포트의 보드 조판 설정 */
  board?: BoardSettings
}

// ───────────────────────── Phase 12 교수 피드백 ─────────────────────────

/** 아직 안 정함 · 반영함 · 보류 · 다르게 판단 */
export type FeedbackStatus = 'open' | 'applied' | 'hold' | 'disagree'

export interface Feedback {
  /** 예: "FB-01" */
  id: string
  /** 받은 날 (YYYY-MM-DD) */
  date: string
  /** 누가: 교수·조교·동료·외부 전문가 … */
  who: string
  /** 어느 자리에서: 중간 크리틱·개별 지도 … */
  occasion: string
  text: string
  cardIds: string[]
  panelIds: string[]
  status: FeedbackStatus
  /** 어떻게 반영했는지, 또는 왜 보류·다르게 판단했는지 */
  response: string
  /** 받은 시점에 저장한 조사 버전 (받은 뒤 바뀐 것을 보여 줌) */
  versionId: string | null
  createdAt: string
  updatedAt: string
}

// ───────────────────────── Phase 12 종합 다이어그램 ─────────────────────────

/** 색 = 방향 (긴장·기회 카드의 '방향'과 같은 네 가지) + neutral = 조건(방향 없음, 먹색) */
export type SynthTone = 'keep' | 'reveal' | 'avoid' | 'transform' | 'neutral'
/**
 * 모양(점을 어떻게 찍는가): arrow 방향 있는 꺾은선, line 방향 없는 꺾은선(2판), vector 기준점→방향 두 점(2판),
 * area 다각형, point 한 점, note 글상자(+지시선 끝), card 카드 배지
 */
export type SynthKind = 'arrow' | 'line' | 'vector' | 'area' | 'point' | 'note' | 'card'

/**
 * 기호(뜻) — 2판(2026-11-11). 1판 그림에는 없고, 없으면 모양에서 정함 (symOf).
 * 흐름: arrow·car·walk·wind / 두 점: noise·view·entry / 선: edge·frontage·axis·buffer·line /
 * 점: dot·star·bolt·landmark·node / 면: zone·bubble·keepout / note·card
 */
export type SynthSym =
  | 'arrow'
  | 'car'
  | 'walk'
  | 'wind'
  | 'noise'
  | 'view'
  | 'entry'
  | 'edge'
  | 'frontage'
  | 'axis'
  | 'buffer'
  | 'line'
  | 'dot'
  | 'star'
  | 'bolt'
  | 'landmark'
  | 'node'
  | 'zone'
  | 'bubble'
  | 'keepout'
  | 'note'
  | 'card'

export interface SynthItem {
  id: string
  kind: SynthKind
  /** 경위도 점: 꺾은선 2개 이상, 두 점 기호 2개, 영역 3개 이상, 포인트·카드 1개, 글상자 1개(+ 지시선 끝 1개) */
  pts: [number, number][]
  tone: SynthTone
  /** 글 (카드는 비우면 카드 제목) */
  label: string
  cardId?: string
  /** 화살표 양쪽 */
  both?: boolean
  /** 1판 포인트 모양 (2판은 sym) */
  mark?: 'dot' | 'star' | 'bolt'
  /** 기호 (없으면 1판 — 모양에서 정함) */
  sym?: SynthSym
  /** 굵기: 3 주 · 2 부(기본) · 1 작은 것 */
  weight?: 1 | 2 | 3
  /** 일반 화살표·선의 선 모양 */
  dash?: 'solid' | 'dash' | 'dot'
  /** 시선 부채꼴 폭(°) 또는 완충대 폭(m) */
  spread?: number
  /** 경계 톱니를 반대쪽에 */
  flip?: boolean
  /** 근거 (2판 12-B): 카드 번호와 도판 id. 카드 배지는 그 카드와 카드의 근거를 따로 적지 않아도 따라감 */
  evidence?: { cards: string[]; panels: string[] }
}

export interface SynthState {
  items: SynthItem[]
  /** 바탕: 'plain'(회색 건물·도로) 또는 도판 id */
  base: string
  /** 도판 반경(m), null이면 수집 반경 */
  radius: number | null
  updatedAt: string
}

// ───────────────────────── Phase 11 보드 조판 ─────────────────────────

export type BoardPaper = 'A4' | 'A3' | 'A2' | 'A1'

export interface BoardSettings {
  paper: BoardPaper
  landscape: boolean
  /** 열 수 (2~6) */
  cols: number
  /** 비우면 프로젝트 이름 */
  title: string
  /** 도판 순서 (도판 id). 여기 없는 도판은 기본 순서로 뒤에 */
  order: string[]
  /** 제목 아래 대지 개요 한 줄 */
  overview: boolean
  /** 도판 아래 결론 문장 */
  conclusions: boolean
}
