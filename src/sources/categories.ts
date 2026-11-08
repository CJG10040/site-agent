// 데이터 선택 화면(요청서 화면 3)의 자료 묶음.

export type DataCategory = 'zoning' | 'land' | 'buildings' | 'register' | 'roads' | 'facilities' | 'population' | 'business'

export type KeyNeed = 'vworld' | 'sgis' | 'dataGoKr'

export interface CategoryDef {
  id: DataCategory
  label: string
  detail: string
  source: string
  scope: string
  needs: KeyNeed
}

export const DATA_CATEGORIES: CategoryDef[] = [
  {
    id: 'zoning',
    label: '규제·계획',
    detail: '용도지역·지구, 지구단위계획구역, 개발제한구역, 교육환경·문화유산 보호구역',
    source: '브이월드 2D 데이터',
    scope: '대지 경계',
    needs: 'vworld',
  },
  {
    id: 'land',
    label: '토지',
    detail: '토지대장 면적, 토지이용계획(높이 제한 등 포함), 토지특성(지형·형상·도로접면), 공시지가·토지이동 이력',
    source: '브이월드 부동산 개방데이터',
    scope: '대지 필지',
    needs: 'vworld',
  },
  {
    id: 'buildings',
    label: '주변 건물',
    detail: '건물 외곽선과 층수·용도·사용승인일 → 높이 분포, 용도 구성, 노후도',
    source: '브이월드 GIS건물통합정보',
    scope: '반경',
    needs: 'vworld',
  },
  {
    id: 'register',
    label: '건축물대장',
    detail: '대지와 맞닿은 필지 건물의 주용도·구조·층수·높이·층별 용도',
    source: '공공데이터포털 건축HUB',
    scope: '대지 + 맞닿은 필지',
    needs: 'dataGoKr',
  },
  {
    id: 'roads',
    label: '도로',
    detail: '차도 중심선(도로명·제한속도), 도시계획도로(대로·중로·소로)',
    source: '브이월드 2D 데이터',
    scope: '반경',
    needs: 'vworld',
  },
  {
    id: 'facilities',
    label: '도시계획시설',
    detail: '공원·광장, 주차장·철도 등 교통시설',
    source: '브이월드 2D 데이터',
    scope: '반경',
    needs: 'vworld',
  },
  {
    id: 'population',
    label: '인구·가구',
    detail: '행정동 인구·나이·고령화·가구 추이(2015~), 1인 가구, 반경 안 집계구별 분포',
    source: '통계청 SGIS',
    scope: '행정동 + 반경 안 집계구',
    needs: 'sgis',
  },
  {
    id: 'business',
    label: '사업체·산업',
    detail: '행정동 사업체·종사자 추이, 산업 대분류별 구성과 5년 변화',
    source: '통계청 SGIS',
    scope: '행정동',
    needs: 'sgis',
  },
]

export const ALL_CATEGORIES: DataCategory[] = DATA_CATEGORIES.map((c) => c.id)
