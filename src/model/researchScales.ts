// 정성 조사 스케일·주제 (2026-11-18) — 도판 자료(diagrams/data.ts)도 쓰므로 다른 모듈을 불러오지 않는 작은 파일로.

export const RESEARCH_SCALES = ['대한민국', '광역', '시·군·구', '동', '대지 주변'] as const
export type ResearchScale = (typeof RESEARCH_SCALES)[number]
export const RESEARCH_THEMES = ['이슈·갈등·개발 계획', '역사·장소의 기억', '지역 문화·생활'] as const
export type ResearchTheme = (typeof RESEARCH_THEMES)[number]
/** 이슈를 볼 기간 (인터뷰: 최근 3년) */
export const ISSUE_YEARS = 3
/** 정성 조사 카드 표시 (auto_key 앞머리) */
export const RESEARCH_KEY = 'research:'
