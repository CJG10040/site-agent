// 공간정보 수집 대상 레이어 목록.
// 레이어 코드와 속성 이름은 2026-11-08 실제 키로 광주 동구 충장로 일대를 조회해 확인했다.
// (용도지구 UQ123·125·129 등은 레이어는 있으나 확인 지역에 해당 구역이 없어 이름은 응답의 uname으로 표시)
// Phase 6 레이어(재해·하천, 공공·교육, 상권)의 속성 이름은 2026-11-09 브이월드 2D데이터 API 레퍼런스에서 확인했다.

import type { DataCategory } from './categories'

export type LayerGroup = '행정' | '규제' | '건물' | '교통' | '시설' | '재해·하천' | '공공·교육' | '상권'

/** 레이어가 속한 데이터 묶음 (행정은 위치 확인에 늘 필요하므로 null = 항상 수집) */
export function layerCategory(layer: CollectLayer): DataCategory | null {
  switch (layer.kind) {
    case 'admin':
      return null
    case 'zoning':
    case 'district':
    case 'protect':
      return 'zoning'
    case 'buildings':
      return 'buildings'
    case 'roads':
    case 'planRoads':
      return 'roads'
    case 'facilities':
      return 'facilities'
    case 'hazard':
    case 'river':
      return 'hazard'
    case 'civic':
    case 'school':
      return 'civic'
    case 'commerce':
      return 'commerce'
  }
}
export type LayerScope = 'center' | 'site' | 'radius'

export interface CollectLayer {
  id: string
  label: string
  group: LayerGroup
  scope: LayerScope
  geometry: boolean
  /** 이름으로 쓸 속성 */
  nameField: string
  /** 사실 문장에서 이름 앞에 붙일 말 (예: "교육환경 ") */
  namePrefix?: string
  /** 사실 문장에 덧붙일 관련 대상 속성 (예: 학교명) */
  remarkField?: string
  kind: 'admin' | 'zoning' | 'district' | 'protect' | 'buildings' | 'roads' | 'planRoads' | 'facilities' | 'hazard' | 'river' | 'civic' | 'school' | 'commerce'
  /** 이름 옆에 붙일 분류 속성 (예: 시설분류명) */
  typeField?: string
  /** 사실 문장에 덧붙일 속성 (예: 전통시장 점포 수) */
  detailFields?: { field: string; label: string; unit?: string }[]
  maxFeatures?: number
  limitations: string
}

const PLAN_LIMIT =
  '도시계획 정보는 참고용이며 법적 효력이 없음. 경계 부근은 오차가 있을 수 있어 토지이음 토지이용계획확인원으로 확인해야 함.'

const district = (code: string, label: string): CollectLayer => ({
  id: `LT_C_${code}`,
  label,
  group: '규제',
  scope: 'site',
  geometry: false,
  nameField: 'uname',
  kind: 'district',
  limitations: PLAN_LIMIT,
})

export const COLLECT_LAYERS: CollectLayer[] = [
  {
    id: 'LT_C_ADEMD_INFO',
    label: '법정 읍·면·동',
    group: '행정',
    scope: 'center',
    geometry: false,
    nameField: 'full_nm',
    kind: 'admin',
    limitations: '법정동 기준이며 주민센터 단위의 행정동과 다를 수 있음.',
  },
  { ...district('UQ111', '용도지역(도시지역)'), kind: 'zoning' },
  { ...district('UQ112', '용도지역(관리지역)'), kind: 'zoning' },
  { ...district('UQ113', '용도지역(농림지역)'), kind: 'zoning' },
  { ...district('UQ114', '용도지역(자연환경보전지역)'), kind: 'zoning' },
  district('UQ121', '용도지구(경관지구)'),
  district('UQ123', '용도지구(고도지구)'),
  district('UQ124', '용도지구(방화지구)'),
  district('UQ125', '용도지구(방재지구)'),
  district('UQ126', '용도지구(보호지구)'),
  district('UQ128', '용도지구(취락지구)'),
  district('UQ129', '용도지구(개발진흥지구)'),
  district('UQ130', '용도지구(특정용도제한지구)'),
  district('UQ141', '지구단위계획구역'),
  district('UD801', '개발제한구역'),
  { ...district('UPISUQ171', '개발행위허가제한지역'), nameField: 'dgm_nm' },
  {
    ...district('UO101', '교육환경보호구역'),
    kind: 'protect',
    namePrefix: '교육환경 ',
    remarkField: 'remark',
  },
  {
    ...district('UO301', '문화유산 현상변경허가 대상구역'),
    kind: 'protect',
    namePrefix: '문화유산 ',
    remarkField: 'remark',
  },
  { ...district('UO501', '기타 보호구역(UO501)'), kind: 'protect', remarkField: 'remark' },
  { ...district('UO601', '기타 보호구역(UO601)'), kind: 'protect', remarkField: 'remark' },
  {
    id: 'LT_C_BLDGINFO',
    label: 'GIS건물통합정보',
    group: '건물',
    scope: 'radius',
    geometry: true,
    nameField: 'bld_nm',
    kind: 'buildings',
    maxFeatures: 5000,
    limitations:
      '건축물대장과 건물 도형을 결합한 자료. 높이·건폐율·용적률은 비어 있거나 0인 경우가 많고, 무허가·최근 건물은 빠질 수 있음.',
  },
  {
    id: 'LT_L_MOCTLINK',
    label: '도로망(표준노드링크)',
    group: '교통',
    scope: 'radius',
    geometry: true,
    nameField: 'road_name',
    kind: 'roads',
    limitations: '차도 중심선 자료이며 골목·보행로는 대부분 없음. 도로 폭 정보는 없음.',
  },
  {
    id: 'LT_C_UPISUQ151',
    label: '도시계획시설(도로)',
    group: '교통',
    scope: 'radius',
    geometry: true,
    nameField: 'dgm_nm',
    kind: 'planRoads',
    limitations: `${PLAN_LIMIT} 계획상 도로이므로 실제 개설 여부와 다를 수 있음.`,
  },
  {
    id: 'LT_C_UPISUQ152',
    label: '도시계획시설(교통시설)',
    group: '시설',
    scope: 'radius',
    geometry: false,
    nameField: 'dgm_nm',
    kind: 'facilities',
    limitations: PLAN_LIMIT,
  },
  {
    id: 'LT_C_UQ162',
    label: '도시자연공원구역',
    group: '시설',
    scope: 'radius',
    geometry: false,
    nameField: 'uname',
    kind: 'facilities',
    limitations: PLAN_LIMIT,
  },
]

const UPIS_FACILITY_LIMIT = `${PLAN_LIMIT} 도시계획으로 결정된 시설 부지이며, 실제로 지어졌는지는 집행상태와 현장으로 확인해야 함.`
const POI_LIMIT = '공공기관이 모아 공개한 시설 목록으로, 최근 개관·폐관이 반영되지 않았을 수 있음. 위치는 주소를 좌표로 바꾼 값이라 오차가 있을 수 있음.'

const point = (
  code: string,
  label: string,
  group: LayerGroup,
  kind: CollectLayer['kind'],
  nameField: string,
  extra: Partial<CollectLayer> = {},
): CollectLayer => ({
  id: `LT_P_${code}`,
  label,
  group,
  scope: 'radius',
  geometry: true,
  nameField,
  kind,
  limitations: POI_LIMIT,
  ...extra,
})

const area = (code: string, label: string, group: LayerGroup, kind: CollectLayer['kind'], nameField: string, extra: Partial<CollectLayer> = {}): CollectLayer => ({
  id: `LT_C_${code}`,
  label,
  group,
  scope: 'radius',
  geometry: true,
  nameField,
  kind,
  limitations: PLAN_LIMIT,
  ...extra,
})

const SCHOOL_LIMIT = '교육청이 정한 통학구역·학교군 자료로, 해마다 바뀔 수 있음. 실제 배정은 교육지원청에 확인해야 함.'

/** Phase 6: 재해·하천, 공공·문화·복지·교육, 상권·전통시장 */
export const NEARBY_LAYERS: CollectLayer[] = [
  area('UP201', '재해위험지구', '재해·하천', 'hazard', 'uname'),
  area('UP401', '급경사재해예방지역', '재해·하천', 'hazard', 'uname'),
  area('UPISUQ156', '도시계획시설(방재시설)', '재해·하천', 'hazard', 'dgm_nm', { typeField: 'scl_nam', limitations: UPIS_FACILITY_LIMIT }),
  area('WKMSTRM', '하천망', '재해·하천', 'river', 'riv_nm', {
    typeField: 'cat_nam',
    limitations: '하천 구역을 면으로 그린 자료로, 작은 도랑·복개천은 빠졌을 수 있음.',
  }),
  area('UPISUQ155', '도시계획시설(공공문화체육시설)', '공공·교육', 'civic', 'dgm_nm', { typeField: 'scl_nam', limitations: UPIS_FACILITY_LIMIT }),
  area('UPISUQ157', '도시계획시설(보건위생시설)', '공공·교육', 'civic', 'dgm_nm', { typeField: 'scl_nam', limitations: UPIS_FACILITY_LIMIT }),
  point('DGMUSEUMART', '박물관·미술관', '공공·교육', 'civic', 'mus_nam', { typeField: 'mus_typ' }),
  point('SMALLLIBRARY', '작은도서관', '공공·교육', 'civic', 'lbr_name', { typeField: 'category' }),
  point('MGPRTFB', '노인복지시설', '공공·교육', 'civic', 'fac_nam', { typeField: 'cat_nam' }),
  point('MGPRTFC', '아동복지시설', '공공·교육', 'civic', 'fac_nam', { typeField: 'cat_nam' }),
  { ...area('DESCH', '초등학교 통학구역', '공공·교육', 'school', 'hakgudo_nm'), scope: 'center', geometry: false, limitations: SCHOOL_LIMIT },
  { ...area('DMSCH', '중학교 학교군', '공공·교육', 'school', 'hakgudo_nm'), scope: 'center', geometry: false, limitations: SCHOOL_LIMIT },
  { ...area('DHSCH', '고등학교 학교군', '공공·교육', 'school', 'hakgudo_nm'), scope: 'center', geometry: false, limitations: SCHOOL_LIMIT },
  area('DGMAINBIZ', '주요상권', '상권', 'commerce', 'nm', {
    limitations: '소상공인시장진흥공단이 정한 주요상권 범위로, 실제 상권의 경계와 다를 수 있음.',
  }),
  point('TRADSIJANG', '전통시장', '상권', 'commerce', 'name', {
    typeField: 'category',
    detailFields: [
      { field: 'market', label: '점포', unit: '개' },
      { field: 'opn_per', label: '개설 주기' },
    ],
  }),
  area('UB901', '시장정비구역', '상권', 'commerce', 'uname'),
  area('UD601', '주거환경개선지구', '상권', 'commerce', 'uname'),
  point('BUSIINCUBATOR', '창업보육센터', '상권', 'commerce', 'bui_nam', { typeField: 'mainpart' }),
]

export const LAYER_GROUP_ORDER: LayerGroup[] = ['행정', '규제', '건물', '교통', '시설', '재해·하천', '공공·교육', '상권']

/** 수집 순서대로 모든 브이월드 레이어 */
export const ALL_LAYERS: CollectLayer[] = [...COLLECT_LAYERS, ...NEARBY_LAYERS]
