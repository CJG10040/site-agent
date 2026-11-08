// 건물 층수 구분 색 (한 가지 색상의 단계 — 대지 경계 주황색과 겹치지 않도록 파란 계열)

export interface FloorClass {
  id: string
  label: string
  color: string
  test: (floors: number) => boolean
}

export const FLOOR_CLASSES: FloorClass[] = [
  { id: 'f1', label: '1~2층', color: '#d0dcf0', test: (f) => f >= 1 && f <= 2 },
  { id: 'f2', label: '3~5층', color: '#9fb6e0', test: (f) => f >= 3 && f <= 5 },
  { id: 'f3', label: '6~10층', color: '#6489cb', test: (f) => f >= 6 && f <= 10 },
  { id: 'f4', label: '11~20층', color: '#3a5fae', test: (f) => f >= 11 && f <= 20 },
  { id: 'f5', label: '21층 이상', color: '#1d3a7a', test: (f) => f >= 21 },
]

export const FLOOR_UNKNOWN: FloorClass = { id: 'f0', label: '층수 미상', color: '#d6d3cc', test: () => true }

export function floorClass(floors: number): FloorClass {
  if (!Number.isFinite(floors) || floors < 1) return FLOOR_UNKNOWN
  return FLOOR_CLASSES.find((c) => c.test(floors)) ?? FLOOR_UNKNOWN
}
