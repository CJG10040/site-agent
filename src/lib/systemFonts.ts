// 이 컴퓨터에 깔린 글꼴 목록 (2026-11-21 사용자 요청: 글꼴 이름을 치지 않고 고르기).
// 1) 자주 쓰는 글꼴 가운데 이 컴퓨터에 있는 것을 글자 폭으로 찾아 바로 보여 주고
// 2) 크롬·엣지는 '모두 불러오기'로 전체 목록(브라우저 '로컬 글꼴' 기능 — 처음 한 번 허락을 물음)을 받는다.
// 받은 이름 목록은 이 브라우저에만 기억(다음에 다시 묻지 않게). 글꼴 파일은 읽지 않고 이름만 쓴다.

import { useEffect, useState } from 'react'

/** 자주 쓰는 글꼴 (한글 먼저) — 이 컴퓨터에 있는지 확인해 목록에 넣음 */
const COMMON = [
  'Malgun Gothic',
  'NanumGothic',
  'NanumSquare',
  'NanumSquare Neo',
  'NanumBarunGothic',
  'NanumMyeongjo',
  'Noto Sans KR',
  'Noto Serif KR',
  'Noto Sans CJK KR',
  'Spoqa Han Sans Neo',
  'SUIT',
  'Apple SD Gothic Neo',
  'AppleMyungjo',
  'Gulim',
  'Dotum',
  'Batang',
  'Gungsuh',
  'Arial',
  'Arial Narrow',
  'Helvetica',
  'Helvetica Neue',
  'Futura',
  'Gill Sans',
  'Gill Sans MT',
  'Avenir',
  'Avenir Next',
  'Century Gothic',
  'Franklin Gothic Medium',
  'Garamond',
  'Times New Roman',
  'Georgia',
  'Verdana',
  'Tahoma',
  'Segoe UI',
  'Calibri',
  'Bahnschrift',
  'Consolas',
  'Courier New',
  'DIN Alternate',
  'Inter',
  'Roboto',
  'Montserrat',
  'Source Sans Pro',
  'IBM Plex Sans',
]

/** 앱이 인터넷에서 불러오는 글꼴 — 도판 그림(SVG를 그림으로)에는 안 보이므로 목록에서 뺌 */
const WEB_FONTS = new Set(['Pretendard', 'Pretendard Variable', 'IBM Plex Mono'])

const STORE_KEY = 'site-agent:local-fonts'

/** 글자 폭으로 글꼴이 있는지 (기본 글꼴 셋과 폭이 하나라도 다르면 있음) */
function detect(names: string[]): string[] {
  try {
    const cv = document.createElement('canvas')
    const g = cv.getContext('2d')
    if (!g) return []
    const sample = '가나다라마바사 mmmmmmmmmmlli 0123456789 WQ@'
    const base = ['monospace', 'serif', 'sans-serif'].map((b) => {
      g.font = `72px ${b}`
      return g.measureText(sample).width
    })
    return names.filter((n) =>
      ['monospace', 'serif', 'sans-serif'].some((b, i) => {
        g.font = `72px '${n}', ${b}`
        return Math.abs(g.measureText(sample).width - base[i]) > 0.5
      }),
    )
  } catch {
    return []
  }
}

function readStored(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** 브라우저가 전체 목록 기능을 지원하는지 (크롬·엣지) */
export function canListAll(): boolean {
  return typeof window !== 'undefined' && 'queryLocalFonts' in window
}

interface LocalFontData {
  family: string
}

let common: string[] | null = null
let all: string[] = readStored()
const listeners = new Set<() => void>()

/** 전체 목록 받기 (단추를 누를 때 — 처음 한 번 브라우저가 허락을 물음) */
export async function loadAllFonts(): Promise<{ ok: boolean; message?: string }> {
  if (!canListAll()) return { ok: false, message: '이 브라우저는 글꼴 목록을 주지 않습니다 (크롬·엣지에서 됨)' }
  try {
    const q = (window as unknown as { queryLocalFonts: () => Promise<LocalFontData[]> }).queryLocalFonts
    const list = await q()
    const fams = [...new Set(list.map((f) => f.family).filter((f) => f && !WEB_FONTS.has(f)))].sort((a, b) => a.localeCompare(b, 'ko'))
    if (!fams.length) return { ok: false, message: '글꼴 목록이 비어 있습니다 — 브라우저에서 글꼴 사용을 허락했는지 확인하세요' }
    all = fams
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(fams))
    } catch {
      // 기억 못 해도 이번에는 씀
    }
    listeners.forEach((fn) => fn())
    return { ok: true }
  } catch (e) {
    const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
    return { ok: false, message: denied ? '글꼴 목록을 허락하지 않았습니다 — 주소창 왼쪽 사이트 설정에서 \'글꼴\'을 허용하면 다시 됩니다' : `글꼴 목록을 받지 못했습니다: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** 이 컴퓨터 글꼴: 전체 목록을 받았으면 그것, 아니면 자주 쓰는 것 중 있는 것 */
export function useSystemFonts(): { names: string[]; full: boolean } {
  const [, setTick] = useState(0)
  useEffect(() => {
    const fn = () => setTick((t) => t + 1)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  if (all.length) return { names: all, full: true }
  if (!common) common = detect(COMMON.filter((n) => !WEB_FONTS.has(n)))
  return { names: common, full: false }
}
