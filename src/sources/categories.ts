// 데이터 선택 화면(요청서 화면 3)의 자료 묶음.

export type DataCategory =
  | 'zoning'
  | 'land'
  | 'terrain'
  | 'buildings'
  | 'register'
  | 'roads'
  | 'facilities'
  | 'population'
  | 'business'
  | 'hazard'
  | 'civic'
  | 'commerce'
  | 'transit'
  | 'climate'
  | 'stores'
  | 'poi'
  | 'traffic'
  | 'network'
  | 'env'

export type KeyNeed = 'vworld' | 'sgis' | 'dataGoKr' | 'kakao' | 'its' | 'none'

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
    detail: '용도지역·지구, 지구단위계획구역, 개발제한구역, 교육환경·문화유산 보호구역 (도판용으로 반경 전체를 받고, 대지에 걸친 것은 사실 카드로)',
    source: '브이월드 2D 데이터',
    scope: '반경 (사실은 대지 경계)',
    needs: 'vworld',
  },
  {
    id: 'land',
    label: '토지',
    detail: '토지대장 면적, 토지이용계획(높이 제한 등 포함), 토지특성(지형·형상·도로접면), 공시지가·토지이동 이력 + 반경 안 지적과 필지별 지형등급(도판용)',
    source: '브이월드 부동산 개방데이터',
    scope: '대지 필지 + 반경 안 필지',
    needs: 'vworld',
  },
  {
    id: 'terrain',
    label: '지형',
    detail: '대지 안 높낮이 차, 평균 경사도·비탈 방향, 반경 안 가장 높은·낮은 곳 (대지 중심 = 0m 상대 높이)',
    source: '국토지리정보원 연속수치지형도 → 10m 격자 (광주·전남·전북)',
    scope: '반경',
    needs: 'none',
  },
  {
    id: 'buildings',
    label: '주변 건물',
    detail: '건물 외곽선과 층수·용도·사용승인일 → 높이 분포, 용도 구성, 노후도 (빠진 건물은 도로명주소 건물로 보강)',
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
    detail: '차도 중심선(도로명·제한속도), 도시계획도로(대로·중로·소로), 도로중심선(폭·차로, 골목 포함)',
    source: '브이월드 2D 데이터',
    scope: '반경',
    needs: 'vworld',
  },
  {
    id: 'facilities',
    label: '도시계획시설',
    detail: '공원·광장, 주차장·철도 등 교통시설, 공간·유통공급·환경기초 등 기반시설',
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
  {
    id: 'hazard',
    label: '재해·하천',
    detail: '재해위험지구, 급경사재해예방지역, 방재시설(유수지·저류지 등), 하천과의 거리',
    source: '브이월드 2D 데이터',
    scope: '반경',
    needs: 'vworld',
  },
  {
    id: 'civic',
    label: '공공·문화·복지·교육',
    detail: '공공문화체육·보건위생 시설, 박물관·미술관, 작은도서관, 노인·아동복지시설, 초·중·고 통학구역',
    source: '브이월드 2D 데이터',
    scope: '반경 (통학구역은 대지 중심)',
    needs: 'vworld',
  },
  {
    id: 'commerce',
    label: '상권·전통시장',
    detail: '주요상권, 전통시장(점포 수·개설 주기), 시장정비구역, 주거환경개선지구, 창업보육센터',
    source: '브이월드 2D 데이터',
    scope: '반경',
    needs: 'vworld',
  },
  {
    id: 'transit',
    label: '대중교통',
    detail: '가까운 버스정류소와 거리, 정류소를 지나는 노선 수·종류',
    source: '공공데이터포털 국토교통부(TAGO)',
    scope: '대지 중심 약 500m',
    needs: 'dataGoKr',
  },
  {
    id: 'climate',
    label: '기후·바람',
    detail: '가장 가까운 기상관측소의 최근 3년 기온·강수·일조, 계절별 많이 부는 바람 + 매시 자료로 만든 바람장미(연중·계절별 16방위)',
    source: '공공데이터포털 기상청 ASOS (일자료·시간자료)',
    scope: '가장 가까운 관측소',
    needs: 'dataGoKr',
  },
  {
    id: 'stores',
    label: '상가 업종 구성',
    detail: '반경 안 상가업소의 업종(대·중분류)과 층 분포, 대지 바로 주변 50m 업종',
    source: '공공데이터포털 소상공인시장진흥공단',
    scope: '반경 (최대 2km)',
    needs: 'dataGoKr',
  },
  {
    id: 'poi',
    label: '주변 생활 시설',
    detail: '지하철역·학교·어린이집·병원·약국·공공기관·문화시설·관광명소·마트·편의점·카페·음식점·주차장 수와 가까운 곳',
    source: '카카오 로컬 API',
    scope: '대지 중심 반경',
    needs: 'kakao',
  },
  {
    id: 'network',
    label: '길의 연결',
    detail: '골목까지 든 도로중심선으로 선택도(지나가기 쉬운 길, 걷는 규모 800m·넓은 규모), 걸어서 5·10·15분 도보권, 길로 둘러싸인 가구 계산. 도로·건물을 함께 고르면 가로 위요감(D/H)도',
    source: '브이월드 도로중심선 → 앱에서 계산',
    scope: '반경 + 800m (최소 1.5km)',
    needs: 'vworld',
  },
  {
    id: 'traffic',
    label: '실시간 도로 속도',
    detail: '지금 이 순간 도로 구간별 통행 속도 (막힘 정도). 도판 화면에서 출근·낮·퇴근 시간에 한 번씩 더 받아 쌓을 수 있음',
    source: '국가교통정보센터 교통소통정보 + 표준노드링크',
    scope: '반경을 감싼 사각형',
    needs: 'its',
  },
  {
    id: 'env',
    label: '환경 계산',
    detail: "일조시간(동지·춘추분·하지), 개방감·대지에서 본 하늘, 높이별 가시권, 수목(위성영상), 실험: 바람 흐름·여름 열쾌적. '주변 건물'이 필요하고, 바람·열쾌적은 '기후·바람'도 필요 (수집 끝에 몇 초~1분 계산)",
    source: '수집한 건물·지형·기후 → 앱에서 계산 + 브이월드 위성영상',
    scope: '반경 (일조 세부는 대지 주변 200m)',
    needs: 'vworld',
  },
]

export const ALL_CATEGORIES: DataCategory[] = DATA_CATEGORIES.map((c) => c.id)
