// 공간정보 수집 대상 레이어 목록.
// 레이어 코드와 속성 이름은 2026-11-08 실제 키로 광주 동구 충장로 일대를 조회해 확인했다.
// (용도지구 UQ123·125·129 등은 레이어는 있으나 확인 지역에 해당 구역이 없어 이름은 응답의 uname으로 표시)

export type LayerGroup = '행정' | '규제' | '건물' | '교통' | '시설'
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
  kind: 'admin' | 'zoning' | 'district' | 'protect' | 'buildings' | 'roads' | 'planRoads' | 'facilities'
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
  district('UQ123', '용도지구(UQ123)'),
  district('UQ124', '용도지구(방화지구)'),
  district('UQ125', '용도지구(UQ125)'),
  district('UQ126', '용도지구(보호지구)'),
  district('UQ128', '용도지구(취락지구)'),
  district('UQ129', '용도지구(UQ129)'),
  district('UQ130', '용도지구(특정용도제한지구)'),
  district('UQ141', '지구단위계획구역'),
  district('UD801', '개발제한구역'),
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
    label: '도시계획시설(공원·광장 등)',
    group: '시설',
    scope: 'radius',
    geometry: false,
    nameField: 'uname',
    kind: 'facilities',
    limitations: PLAN_LIMIT,
  },
]

export const LAYER_GROUP_ORDER: LayerGroup[] = ['행정', '규제', '건물', '교통', '시설']
