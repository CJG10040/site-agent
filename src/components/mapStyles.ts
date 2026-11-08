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

// 집계구 인구밀도 (명/㎢) — 건물(파랑)·대지(주황)와 겹치지 않도록 보라 계열 단계
export const DENSITY_CLASSES: FloorClass[] = [
  { id: 'd1', label: '5천 미만', color: '#ece4f5', test: (d) => d < 5000 },
  { id: 'd2', label: '5천~1만', color: '#cbb5e5', test: (d) => d >= 5000 && d < 10000 },
  { id: 'd3', label: '1만~2만', color: '#a185cd', test: (d) => d >= 10000 && d < 20000 },
  { id: 'd4', label: '2만~3만', color: '#7556b0', test: (d) => d >= 20000 && d < 30000 },
  { id: 'd5', label: '3만 이상', color: '#4a2f86', test: (d) => d >= 30000 },
]

export const DENSITY_UNKNOWN: FloorClass = { id: 'd0', label: '값 가려짐', color: '#d6d3cc', test: () => true }

export function densityClass(d: number | null | undefined): FloorClass {
  if (d === null || d === undefined || !Number.isFinite(d)) return DENSITY_UNKNOWN
  return DENSITY_CLASSES.find((c) => c.test(d)) ?? DENSITY_UNKNOWN
}

export function floorClass(floors: number): FloorClass {
  if (!Number.isFinite(floors) || floors < 1) return FLOOR_UNKNOWN
  return FLOOR_CLASSES.find((c) => c.test(floors)) ?? FLOOR_UNKNOWN
}
