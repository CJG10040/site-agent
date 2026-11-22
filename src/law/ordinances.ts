// 조례 표 읽기 (2026-11-21 묶음 E2·E3): 배포할 때 GitHub가 국가법령정보센터에서 받아 만든 `law/ordinances.json`.
// 지역: 광주 + 전남·전북 모든 시·군(사용자 결정). 2026-07-01 광주·전남 통합(전남광주통합특별시) 뒤 광주 조례는 '(구)광주광역시'로.
// 출처 표기: 법제처 국가법령정보센터 (법제처 자료는 출처를 밝혀야 함).

import type { Project } from '../model/types'

export interface ZoneValue {
  pct: number
  bound: string
  note?: string
  /** 조례 조문 번호 (예: 제67조) */
  article: string
}

export interface OrdinanceRef {
  name: string
  mst: string
  effective: string
  url: string
}

export interface UrbanOrdinance extends OrdinanceRef {
  /** 용도지역 이름(띄어쓰기 없음) → 값 */
  bcr: Record<string, ZoneValue>
  far: Record<string, ZoneValue>
  from: string[]
  /** 묶음 F2: 용도지역 안에서 건축할 수 있는(없는) 건축물 별표들 */
  zoneUses?: { no: number; branch: number; title: string; text: string }[]
  /** 묶음 F2: 경관·고도지구 조문 */
  scenic?: ArticleBundle
}

/** 조문 몇 개 + 그 조문이 가리키는 별표 (묶음 F2) */
export interface ArticleBundle {
  articles: { article: string; title: string; text: string }[]
  tables: Record<string, { title: string; text: string; why?: string }>
}

export interface BuildingOrdinance extends OrdinanceRef {
  setback?: { article: string; title: string; text: string; table?: string; tableText?: string }
  sunlight?: { article: string; title: string; text: string }
  /** 묶음 F2: 대지 안의 조경 · 공개공지 */
  landscape?: ArticleBundle
  openSpace?: ArticleBundle
}

/** 묶음 F2: 주차장 조례 — 부설주차장 조문·별표 */
export interface ParkingOrdinance extends OrdinanceRef, ArticleBundle {}

export interface RegionTable {
  id: string
  name: string
  province: string
  org: string
  districts?: string[]
  urban?: UrbanOrdinance
  building?: BuildingOrdinance
  parking?: ParkingOrdinance
  issues: string[]
  checkedAt?: string
  stale?: boolean
  staleReason?: string
}

export interface LawArticles {
  mst?: string
  effective?: string
  url?: string
  articles?: Record<string, { title: string; text: string }>
  missing?: string[]
  error?: string
}

export interface LawTables {
  mst?: string
  effective?: string
  url?: string
  /** 별표 번호 → 제목·글 */
  tables?: Record<string, { title: string; text: string }>
  missing?: number[]
  error?: string
}

export interface OrdinanceTable {
  version: number
  checkedAt: string
  source: string
  transition: { law: string; effective: string; url: string; excerpts: string[] } | null
  laws?: Record<string, LawArticles> | null
  /** 법령 별표 (주차장법 시행령 별표 1 등, 묶음 E4) */
  lawTables?: Record<string, LawTables> | null
  regions: RegionTable[]
}

let cached: Promise<OrdinanceTable | null> | null = null

/** 표 받기 (없으면 null — 개발 서버 등). 한 번만 */
export function loadOrdinances(): Promise<OrdinanceTable | null> {
  if (!cached) {
    cached = fetch(`${import.meta.env.BASE_URL}law/ordinances.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<OrdinanceTable>) : null))
      .then((t) => (t && Array.isArray(t.regions) ? t : null))
      .catch(() => null)
  }
  return cached
}

const JEONNAM = ['목포시', '여수시', '순천시', '나주시', '광양시', '담양군', '곡성군', '구례군', '고흥군', '보성군', '화순군', '장흥군', '강진군', '해남군', '영암군', '무안군', '함평군', '영광군', '장성군', '완도군', '진도군', '신안군']
const JEONBUK = ['전주시', '군산시', '익산시', '정읍시', '남원시', '김제시', '완주군', '진안군', '무주군', '장수군', '임실군', '순창군', '고창군', '부안군']
const GWANGJU_GU = ['동구', '서구', '남구', '북구', '광산구']

/** 대지 주소 글 (도로명·지번·필지) */
export function siteAddress(project: Project): string {
  const s = project.site
  return [s.address?.road, s.address?.parcel, ...s.parcels.map((p) => p.addr)].filter(Boolean).join(' / ')
}

/**
 * 대지가 속한 조례 지역 id (표의 regions[].id). 모르면 null.
 * 주소 글과 필지 번호(PNU 앞 2자리: 29 광주, 46 전남, 45·52 전북)로 찾는다.
 */
export function regionIdOf(project: Project): string | null {
  const addr = siteAddress(project)
  const sido = project.site.parcels[0]?.pnu?.slice(0, 2) ?? ''
  const gwangju = /광주광역시/.test(addr) || sido === '29' || (/전남광주통합특별시/.test(addr) && GWANGJU_GU.some((g) => new RegExp(`전남광주통합특별시\\s*${g}`).test(addr)))
  if (gwangju) return 'gwangju'
  const jeonnam = /전라남도|전남광주통합특별시/.test(addr) || sido === '46'
  const jeonbuk = /전라북도|전북특별자치도/.test(addr) || sido === '45' || sido === '52'
  if (jeonnam) {
    const n = JEONNAM.find((x) => addr.includes(x))
    if (n) return `jn-${n}`
  }
  if (jeonbuk) {
    const n = JEONBUK.find((x) => addr.includes(x))
    if (n) return `jb-${n}`
  }
  return null
}

export function regionOf(table: OrdinanceTable | null, project: Project): RegionTable | null {
  const id = regionIdOf(project)
  return (id && table?.regions.find((r) => r.id === id)) || null
}

/** 용도지역 이름 맞추기 (띄어쓰기·가운뎃점 빼고) */
export function zoneKey(name: string): string {
  return name.replace(/[\s·ㆍ]/g, '')
}

/** 법령 조문 링크 (조문 단위 한글주소) */
export function lawArticleUrl(law: string, article: string): string {
  return `https://www.law.go.kr/법령/${law.replace(/\s/g, '')}/${article}`
}

export const LAW_SOURCE = '출처: 법제처 국가법령정보센터 (www.law.go.kr)'
