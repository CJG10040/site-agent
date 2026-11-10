// 프로젝트 데이터 구조.
// 요청서 5장(정보 유형), 6.1·6.2(시작 입력), 8.4(출처 기록), 8.5(해석 데이터)를 따른다.

import type { Geometry, Polygon, MultiPolygon } from 'geojson'

export const SCHEMA_VERSION = 1

export type StepId = 'brief' | 'question' | 'site' | 'data' | 'facts' | 'diagrams' | 'observe' | 'interpret' | 'report'

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
  /** Phase 7 도판: 그리기 설정과 도판별 결론 */
  diagrams?: DiagramState
}

// ───────────────────────── Phase 7 도판 ─────────────────────────

export type FrameShape = 'circle' | 'square'
export type PaletteId = 'default' | 'cvd' | 'mono'
export type SiteMark = 'outline' | 'fill' | 'dot'

export interface DiagramSettings {
  frame: FrameShape
  palette: PaletteId
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
}
