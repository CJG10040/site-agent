// 생활 시설 아이콘: 색 원 위에 흰 그림 (앱에서 직접 그린 단순한 기호). 생활 영역 6묶음으로 색을 나눈다.

import type { Palette } from './palette'

export interface PoiGroup {
  id: string
  label: string
  codes: string[]
  color: string
}

const GROUPS: Omit<PoiGroup, 'color'>[] = [
  { id: 'transit', label: '교통', codes: ['SW8', 'PK6'] },
  { id: 'edu', label: '교육', codes: ['SC4', 'PS3', 'AC5'] },
  { id: 'health', label: '의료', codes: ['HP8', 'PM9'] },
  { id: 'shop', label: '장보기', codes: ['MT1', 'CS2'] },
  { id: 'culture', label: '문화', codes: ['CT1', 'AT4'] },
  { id: 'public', label: '공공', codes: ['PO3'] },
]

const GROUP_COLORS: Record<string, string[]> = {
  default: ['#3d7dca', '#e0a22a', '#d6455d', '#2a9d8f', '#8c6bb1', '#6b7a8a'],
  cvd: ['#0072b2', '#e69f00', '#d55e00', '#009e73', '#cc79a7', '#666666'],
  mono: ['#222222', '#555555', '#777777', '#999999', '#444444', '#888888'],
}

export function poiGroups(pal: Palette): PoiGroup[] {
  const cs = pal.custom || !GROUP_COLORS[pal.id] ? [pal.cat[3], pal.cat[0], pal.cat[2], pal.cat[4], pal.cat[5], pal.cat[6]] : GROUP_COLORS[pal.id]
  return GROUPS.map((g, i) => ({ ...g, color: cs[i] }))
}

export function groupOf(groups: PoiGroup[], code: string): PoiGroup | undefined {
  return groups.find((g) => g.codes.includes(code))
}

/** 분류별 흰 기호 (가운데 0,0, 대략 ±6 범위) */
function glyph(code: string): string {
  const w = 'fill="#ffffff"'
  const s = 'stroke="#ffffff" fill="none" stroke-linecap="round" stroke-linejoin="round"'
  switch (code) {
    case 'SW8': // 지하철: 차량 앞모습
      return `<rect x="-5" y="-6" width="10" height="10" rx="2.5" ${w}/><rect x="-3.4" y="-4.4" width="6.8" height="3.4" rx="0.8" fill="currentColor"/><circle cx="-2.6" cy="1.6" r="1" fill="currentColor"/><circle cx="2.6" cy="1.6" r="1" fill="currentColor"/><path d="M-3.5 4 L-5 6.5 M3.5 4 L5 6.5" ${s} stroke-width="1.4"/>`
    case 'PK6': // 주차장
      return `<text x="0" y="4.6" font-size="13" font-weight="800" text-anchor="middle" ${w}>P</text>`
    case 'SC4': // 학교: 깃발
      return `<path d="M-3.5 6.5 V-6" ${s} stroke-width="1.6"/><path d="M-3 -6 L5 -3.6 L-3 -1.2 Z" ${w}/>`
    case 'PS3': // 어린이집·유치원: 작은 집
      return `<path d="M-6 0 L0 -5.5 L6 0" ${s} stroke-width="1.6"/><rect x="-4" y="-0.5" width="8" height="6" ${w}/><circle cx="0" cy="2" r="1.4" fill="currentColor"/>`
    case 'AC5': // 학원: 펼친 책
      return `<path d="M0 -3.5 C-2 -5 -4.5 -5 -6 -4.2 V4.8 C-4.5 4 -2 4 0 5.5 C2 4 4.5 4 6 4.8 V-4.2 C4.5 -5 2 -5 0 -3.5 Z" ${w}/><path d="M0 -3.5 V5.5" stroke="currentColor" stroke-width="1"/>`
    case 'HP8': // 병원: 십자
      return `<path d="M-1.9 -6 H1.9 V-1.9 H6 V1.9 H1.9 V6 H-1.9 V1.9 H-6 V-1.9 H-1.9 Z" ${w}/>`
    case 'PM9': // 약국: 캡슐
      return `<g transform="rotate(-40)"><rect x="-6.2" y="-2.6" width="12.4" height="5.2" rx="2.6" ${w}/><rect x="0" y="-2.6" width="6.2" height="5.2" rx="2.6" fill="currentColor" opacity="0.45"/></g>`
    case 'MT1': // 대형마트: 카트
      return `<path d="M-6 -4.5 H-4 L-2.4 2.5 H4.4 L5.8 -2.5 H-3.4" ${s} stroke-width="1.5"/><circle cx="-1.6" cy="5" r="1.3" ${w}/><circle cx="3.6" cy="5" r="1.3" ${w}/>`
    case 'CS2': // 편의점
      return `<text x="0" y="3.8" font-size="9" font-weight="800" text-anchor="middle" ${w}>24</text>`
    case 'CT1': // 문화시설: 별
      return `<path d="M0 -6.2 L1.8 -2 L6.2 -1.8 L2.8 1.1 L3.9 5.6 L0 3.2 L-3.9 5.6 L-2.8 1.1 L-6.2 -1.8 L-1.8 -2 Z" ${w}/>`
    case 'AT4': // 관광명소: 사진기
      return `<rect x="-6" y="-3.4" width="12" height="8.4" rx="1.6" ${w}/><rect x="-2.2" y="-5.6" width="4.4" height="2.6" rx="0.6" ${w}/><circle cx="0" cy="0.8" r="2.4" fill="currentColor"/>`
    case 'PO3': // 공공기관: 기둥 건물
      return `<path d="M-6.2 -2.2 L0 -6.2 L6.2 -2.2 Z" ${w}/><path d="M-4 -1 V4 M0 -1 V4 M4 -1 V4" ${s} stroke-width="1.6"/><rect x="-6" y="4.4" width="12" height="1.8" ${w}/>`
    default:
      return `<circle r="2.5" ${w}/>`
  }
}

/** 색 원 + 흰 기호. r = 반지름(px) */
export function iconSvg(code: string, x: number, y: number, r: number, color: string): string {
  const k = r / 9
  return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(3)})" color="${color}"><circle r="9" fill="${color}" stroke="#ffffff" stroke-width="1.6"/>${glyph(code)}</g>`
}
