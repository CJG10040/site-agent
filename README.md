# 대지해석 에이전트 (Site Interpretation Agent)

건축학과 학생이 대지조사에서 모은 공공데이터와 현장 관찰을 **사실 → 관찰 → 해석 → 긴장·기회 → 설계 질문 → 설계 가설**로 발전시키도록 돕는 웹 도구입니다. 같은 자료로 도판 52장, 리포트·보드, 라이노 3D 모형(렌더링용·콘타 모형용)까지 만듭니다.

- 사이트: https://cjg10040.github.io/site-agent/
- **지금 앱이 하는 일 전체: [docs/현재-기능-정리.md](docs/현재-기능-정리.md)**
- 지형 타일 가공: [docs/지형자료_가공계획서.md](docs/지형자료_가공계획서.md) · 지난 계획·결정 기록(보관): [docs/archive/](docs/archive/)

## 흐름

① 과제 → ② 첫 질문 → ③ 대지(경계·조사 반경) → ④ 공간정보(공공데이터 수집, 수치지도 올리기) → ⑤ 사실 카드(정성 조사 포함) → ⑥ 도판 → ⑦ 현장 관찰 → ⑧ 해석·가설(챗봇 왕복·종합 다이어그램·피드백) → ⑨ 리포트(보드·변화 기록) / ⑩ 3D 모형(렌더링 모델·콘타 모형)

앱 안에 AI는 없습니다. 앱이 챗봇에게 보낼 명령어를 만들고, 학생이 외부 챗봇의 답을 다시 붙여 넣으면 앱이 카드로 정리합니다.

## 사용 방법

1. 사이트에 접속해 **설정**에서 키를 넣습니다(브이월드·SGIS·공공데이터포털·카카오·국가교통정보센터). 키는 그 브라우저에만 저장되며 이 저장소에는 올라가지 않습니다.
2. 브이월드 마이페이지에서 인증키의 서비스 URL을 사이트 주소로 등록합니다.
3. **연결 진단**에서 키와 서비스별 활용신청 승인 여부를 확인합니다.
4. 새 프로젝트를 만들어 ①부터 차례로 진행합니다. 프로젝트는 브라우저에 저장되고, 위 막대 **내보내기**로 파일로 옮길 수 있습니다.

## 개발

```bash
npm install
npm run dev      # 로컬 개발 서버
npm run build    # 타입 검사 + 빌드 (dist/)
```

- `main` 브랜치에 올리면 GitHub Actions가 GitHub Pages에 배포합니다.
- 원자료 폴더(`국토정보플랫폼/`, `국토정보플랫폼 1000/`, `수치표고모델(DEM)_90M/`, `terrain-raw/`)는 저장소에 올리지 않습니다.
- 새 패키지는 공개된 지 2주가 넘은 버전으로 고정합니다.

## 데이터 출처

- 브이월드 (국토교통부 공간정보 오픈플랫폼) — 지도, 검색, 주소, 연속지적도, 용도지역·지구, 건물통합정보, 도로망·도로중심선, 도시계획시설, 재해위험지구·하천망, 공공·문화·복지 시설, 통학구역, 주요상권·전통시장, 위성영상, 부동산 개방데이터(토지이용계획·토지특성·공시지가·토지이동)
- 통계청 SGIS 오픈API — 행정동·집계구 인구·가구·사업체 통계
- 공공데이터포털 — 국토교통부 건축HUB 건축물대장, 국토교통부(TAGO) 버스정류소, 기상청 ASOS 일자료·시간자료, 소상공인시장진흥공단 상가(상권)정보 (서비스마다 활용신청 필요), 전남광주통합특별시 가로수 현황(수종 비율)
- 카카오 로컬 API — 주변 생활 시설 (카카오 디벨로퍼스 REST 키, '카카오맵' 사용 설정 필요)
- 국가교통정보센터(its.go.kr) — 교통소통정보 Open API, 표준노드링크 구간별 실시간 통행 속도
- 국토지리정보원 — 연속수치지형도 등고선·표고점(10m 지형 타일로 가공, [site-agent-terrain](https://github.com/CJG10040/site-agent-terrain)), 1:5,000·1:1,000 수치지도 2.0과 정밀도로지도(학생이 국토정보플랫폼에서 받아 앱에 올림, 브라우저에만 저장)
- 바로가기 — 카카오 로드뷰·지도, 네이버 지도, 토지이음, 국토정보플랫폼 과거 항공사진

## 사용한 공개 코드

- [rhino3dm](https://github.com/mcneel/rhino3dm) 8.35.0 (MIT, Robert McNeel & Associates) — 라이노 .3dm 쓰기
- [three.js](https://github.com/mrdoob/three.js) 0.186.1 (MIT) — 3D 미리보기
- [OpenLayers](https://openlayers.org/) (BSD-2), [proj4js](https://github.com/proj4js/proj4js) (MIT), [Turf](https://turfjs.org/) (MIT) — 지도·좌표·도형
- [delaunator](https://github.com/mapbox/delaunator) 5.1.0 · [earcut](https://github.com/mapbox/earcut) 3.2.4 (ISC, Mapbox) — 삼각망·면 나누기
- [d3-contour](https://github.com/d3/d3-contour) · [d3-array](https://github.com/d3/d3-array) (ISC) — 등고선
- [SunCalc](https://github.com/mourner/suncalc) (BSD-2), [Dexie](https://dexie.org/) (Apache-2.0), [exifr](https://github.com/MikeKovarik/exifr) (MIT), [fflate](https://github.com/101arrowz/fflate) (MIT)
- UTCI 계산식 — [jsthermalcomfort](https://github.com/FedericoTartarini/jsthermalcomfort) 1.4.0의 함수를 옮김 (MIT, Federico Tartarini)
- 글꼴 — [Pretendard](https://github.com/orioncactus/pretendard) (SIL OFL 1.1)

지적·용도지역 정보는 참고용이며 법적 효력이 없습니다. 토지 소유 정보는 다루지 않습니다.
