// 학생이 도판에서 고친 것 (2026-11-12): 잘못된 자료 빼기, 도판 위 표기(글자) 옮기기·숨기기.
// 사용자 결정: ⑥ 도판 그림에서 눌러 고침 / 모든 도판·분석에 반영 + 기록 / 다시 수집해도 유지.
// 빼기는 위치·이름으로 기억해 그릴 때마다 다시 찾고(diagrams/edits.ts), 표기는 도판 SVG의 글자를 글 내용으로 찾아 옮긴다.

import type { AddEdit, HideEdit, LabelEdit, Project, ProjectEdits } from './types'

export const NO_EDITS: ProjectEdits = { hides: [], labels: [], adds: [] }

export function editsOf(project: Project): ProjectEdits & { adds: AddEdit[] } {
  return { hides: project.edits?.hides ?? [], labels: project.edits?.labels ?? [], adds: project.edits?.adds ?? [] }
}

/** 학생이 마지막으로 더하거나 뺀 때 (환경 계산이 그보다 먼저면 다시 해야 함) — 없으면 '' */
export function lastEditAt(project: Pick<Project, 'edits'>): string {
  let t = ''
  for (const x of [...(project.edits?.hides ?? []), ...(project.edits?.adds ?? [])]) if (x.createdAt > t) t = x.createdAt
  return t
}

/** 더한 건물이 바뀌었는지 가늠하는 서명 (도판·계산을 다시 할 때) */
export function addsSig(project: Pick<Project, 'edits'>): string {
  return (project.edits?.adds ?? []).map((a) => `${a.id}:${a.ring.length}:${a.floors ?? ''}:${a.heightM ?? ''}:${a.use}`).join(',')
}

/** 더한 건물 한 줄 설명 */
export function addDesc(a: AddEdit): string {
  const use = ADD_USES.find(([k]) => k === a.use)?.[1] ?? '용도 모름'
  const size = a.floors ? `${a.floors}층` : a.heightM ? `약 ${Math.round(a.heightM * 10) / 10}m` : '층수 모름'
  return `${a.name || '이름 없음'} · ${size} · ${a.use ? use : '용도 모름'} · ${a.source === 'rhino' ? '라이노 주변 변경' : '지도에서 그림'}`
}

/** 더한 건물 용도 고르기 (건축물대장 주용도 코드 — 용도 도판의 묶음과 층고 어림에 씀) */
export const ADD_USES: [string, string][] = [
  ['', '모름'],
  ['01000', '단독주택'],
  ['02000', '공동주택'],
  ['03000', '근린생활시설'],
  ['14000', '업무'],
  ['07000', '판매'],
  ['05000', '문화·교육·의료·복지'],
  ['17000', '공장·창고'],
]

export function labelEditsFor(project: Project, panelId: string): LabelEdit[] {
  return editsOf(project).labels.filter((l) => l.panelId === panelId)
}

export const newEditId = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** 빼기 기록을 다시 수집해도 같은 것으로 알아보는 열쇠 (목록 비교용) */
export function hideSig(h: HideEdit): string {
  return `${h.layer}:${h.lon.toFixed(6)},${h.lat.toFixed(6)}`
}

// ───────────────────────── 표기 (도판 SVG의 글자) ─────────────────────────

const TEXT_RE = /<text\b([^>]*)>([\s\S]*?)<\/text>/g

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * 도판 SVG의 모든 글자에 열쇠(data-lk = 글 + '#' + 같은 글 중 순서)를 달고, 고친 표기를 적용한다.
 * 옮긴 글은 <g transform>으로 감싸고, 숨긴 글은 display="none".
 */
export function applyLabelEdits(svg: string, edits: LabelEdit[]): string {
  const byKey = new Map(edits.map((e) => [e.key, e]))
  const seen = new Map<string, number>()
  return svg.replace(TEXT_RE, (all, attrs: string, inner: string) => {
    if (attrs.includes('data-lk=')) return all
    const text = decode(inner.replace(/<[^>]+>/g, '')).trim()
    if (!text) return all
    const n = seen.get(text) ?? 0
    seen.set(text, n + 1)
    const key = `${text}#${n}`
    const tagged = `<text data-lk="${attr(key)}"${attrs}>${inner}</text>`
    const e = byKey.get(key)
    if (!e) return tagged
    if (e.hidden) return `<g display="none">${tagged}</g>`
    return `<g transform="translate(${e.dx.toFixed(1)} ${e.dy.toFixed(1)})">${tagged}</g>`
  })
}

/** 도판 캡션에 붙일 고친 것 안내 */
export function editNote(hiddenApplied: number, labelEdits: number): string {
  return [hiddenApplied ? `학생이 자료 ${hiddenApplied}건을 뺌` : '', labelEdits ? `표기 ${labelEdits}개를 옮기거나 숨김` : ''].filter(Boolean).join(' · ')
}
