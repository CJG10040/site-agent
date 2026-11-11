// 상가 업종의 시간 성격 (소상공인시장진흥공단 2023 상권업종 분류 기준).
// 밤: 주점, 유원지·오락(노래방·PC방·게임장 등), 숙박 / 종일: 주점 아닌 음식·카페, 편의점 / 낮: 그 밖(소매·교육·의료·부동산·사무·수리·개인 서비스 등)

export type StoreTime = 'day' | 'allday' | 'night'

export const STORE_TIME_LABEL: Record<StoreTime, string> = {
  day: '낮 (소매·학원·병원 등)',
  allday: '종일 (음식·카페·편의점)',
  night: '밤 (주점·노래방·숙박 등)',
}

export function storeTime(lcls: string, mcls: string, scls = ''): StoreTime {
  const all = `${lcls} ${mcls} ${scls}`
  if (/주점|호프|유흥|노래|PC방|피시방|게임|오락|숙박|모텔|여관|호텔/.test(all)) return 'night'
  if (/^음식/.test(lcls.trim()) || /비알코올|카페|커피|편의점/.test(all)) return 'allday'
  return 'day'
}

/** 중분류 이름을 읽기 쉽게 */
export function mclsLabel(mcls: string): string {
  if (mcls === '비알코올') return '카페·음료'
  if (mcls === '기타 간이') return '분식·간이음식'
  return mcls
}

// ───────────────────────── 업종 묶음 (39 대지 주변 vs 동네 업종) ─────────────────────────
// 사용자 결정(2026-11-12): 한식·일식·서양식처럼 비슷한 중분류는 묶어서 — '비슷한 것끼리 12개쯤'.

export const STORE_GROUPS = [
  '음식점',
  '카페·음료',
  '주점',
  '의류·잡화',
  '생활·가전 소매',
  '식품·종합 소매',
  '미용·개인 서비스',
  '의료',
  '교육',
  '부동산',
  '숙박·여가',
  '전문·사업 서비스',
] as const
export type StoreGroup = (typeof STORE_GROUPS)[number] | '기타'

/** 묶음 설명 (도판 캡션) */
export const STORE_GROUP_NOTE =
  '음식점 = 한식·중식·일식·서양식·동남아·기타 외국식·분식·간이·구내식당 / 의류·잡화 = 의복·신발·시계·귀금속·장식품 / 생활·가전 소매 = 가구·가전·통신·생활용품·의약·화장품·안경 등 / 식품·종합 소매 = 식료품·음료·편의점·슈퍼·백화점 / 미용·개인 서비스 = 이용·미용·목욕·세탁·수리 / 숙박·여가 = 숙박·스포츠·오락 / 전문·사업 서비스 = 광고·디자인·사무·임대·여행사 등'

/** 대분류(lcls)·중분류(mcls) → 12묶음 */
export function storeGroup(lcls: string, mcls: string): StoreGroup {
  const l = lcls.trim()
  const m = mcls.trim()
  if (/^음식/.test(l)) {
    if (/비알코올|카페|커피/.test(m)) return '카페·음료'
    if (/주점/.test(m)) return '주점'
    return '음식점'
  }
  if (/^소매/.test(l)) {
    if (/섬유|의복|신발|시계|귀금속|장식품|가방/.test(m)) return '의류·잡화'
    if (/식료품|음료|종합/.test(m)) return '식품·종합 소매'
    return '생활·가전 소매'
  }
  if (/수리|개인/.test(l)) return '미용·개인 서비스'
  if (/보건|의료/.test(l) || /수의/.test(m)) return '의료'
  if (/교육/.test(l)) return '교육'
  if (/부동산/.test(l)) return '부동산'
  if (/숙박|예술|스포츠|오락/.test(l)) return '숙박·여가'
  if (/과학|기술|시설관리|임대|사업/.test(l)) return '전문·사업 서비스'
  return '기타'
}
