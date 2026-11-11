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
