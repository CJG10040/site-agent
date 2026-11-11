// 학생이 도판에서 고친 것 (2026-11-12): 잘못된 자료 빼기, 도판 위 표기(글자) 옮기기·숨기기.
// 사용자 결정: ⑥ 도판 그림에서 눌러 고침 / 모든 도판·분석에 반영 + 기록 / 다시 수집해도 유지.
// 빼기는 위치·이름으로 기억해 그릴 때마다 다시 찾고(diagrams/edits.ts), 표기는 도판 SVG의 글자를 글 내용으로 찾아 옮긴다.

import type { HideEdit, LabelEdit, Project, ProjectEdits } from './types'

export const NO_EDITS: ProjectEdits = { hides: [], labels: [] }

export function editsOf(project: Project): ProjectEdits {
  return { hides: project.edits?.hides ?? [], labels: project.edits?.labels ?? [] }
}

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
