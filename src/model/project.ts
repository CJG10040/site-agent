import { SCHEMA_VERSION, type Card, type CardType, type Project, type StepId } from './types'

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function createProject(): Project {
  const t = nowIso()
  return {
    schema: SCHEMA_VERSION,
    id: newId(),
    createdAt: t,
    updatedAt: t,
    lastExportedAt: null,
    brief: {
      projectName: '',
      program: '',
      theme: '',
      scale: '',
      targetUsers: '',
      nature: '',
      visit: '',
      deliverables: '',
      materials: '',
    },
    question: { curiosity: '', lenses: [], lensOther: '', avoid: '', personal: '' },
    site: { parcels: [], drawn: null, boundaryMode: 'parcels', radiusM: 500, address: null },
    collectedAt: null,
    collectedRadiusM: null,
    collected: {},
    sources: [],
    cards: [],
    counters: {},
  }
}

const CARD_PREFIX: Record<CardType, string> = {
  FACT: 'F',
  OBSERVATION: 'O',
  INTERPRETATION: 'I',
  TENSION: 'T',
  OPPORTUNITY: 'P',
  QUESTION: 'Q',
  HYPOTHESIS: 'H',
  UNKNOWN: 'U',
}

/** 카드·출처 번호를 프로젝트 안에서 순서대로 발급 (예: F-01, S-03). 한 번 쓴 번호는 다시 쓰지 않는다. */
export function nextNumber(project: Project, prefix: string): string {
  const n = (project.counters[prefix] ?? 0) + 1
  project.counters[prefix] = n
  return `${prefix}-${String(n).padStart(2, '0')}`
}

export function nextCardId(project: Project, type: CardType): string {
  return nextNumber(project, CARD_PREFIX[type])
}

export function cardPrefix(type: CardType): string {
  return CARD_PREFIX[type]
}

export function makeCard(project: Project, partial: Omit<Card, 'id' | 'created_at' | 'updated_at' | 'history' | 'edited'>): Card {
  const t = nowIso()
  return { ...partial, id: nextCardId(project, partial.type), created_at: t, updated_at: t, history: [], edited: false }
}

export const STEPS: { id: StepId; label: string; phase: number }[] = [
  { id: 'brief', label: '과제', phase: 1 },
  { id: 'question', label: '첫 질문', phase: 1 },
  { id: 'site', label: '대지', phase: 1 },
  { id: 'data', label: '공간정보', phase: 1 },
  { id: 'facts', label: '사실 카드', phase: 1 },
  { id: 'observe', label: '현장 관찰', phase: 3 },
  { id: 'interpret', label: '해석·가설', phase: 4 },
  { id: 'report', label: '리포트', phase: 5 },
]

/** 대지 경계가 바뀌었는지 비교하기 위한 짧은 식별값 */
export function siteKey(site: Project['site']): string {
  if (site.boundaryMode === 'drawn') {
    const ring = site.drawn?.coordinates[0] ?? []
    return `drawn:${ring.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).join(';')}`
  }
  return `parcels:${site.parcels
    .map((p) => p.pnu)
    .sort()
    .join(',')}`
}

export function hasBoundary(project: Project): boolean {
  const s = project.site
  return s.boundaryMode === 'drawn' ? !!s.drawn : s.parcels.length > 0
}

/** 단계 옆에 표시할 진행 상태 */
export function stepStatus(project: Project, step: StepId): { done: boolean; note: string } {
  switch (step) {
    case 'brief': {
      const b = project.brief
      const filled = [b.program, b.theme, b.scale, b.targetUsers, b.nature, b.deliverables].filter((v) => v.trim()).length
      return { done: !!(b.program.trim() || b.theme.trim()), note: filled ? `${filled}/6` : '' }
    }
    case 'question': {
      const q = project.question
      return { done: !!(q.curiosity.trim() || q.lenses.length), note: '' }
    }
    case 'site':
      return {
        done: hasBoundary(project),
        note: project.site.boundaryMode === 'drawn' ? (project.site.drawn ? '직접 그림' : '') : project.site.parcels.length ? `${project.site.parcels.length}필지` : '',
      }
    case 'data':
      return { done: !!project.collectedAt, note: project.collectedAt ? `${project.sources.filter((s) => s.status === 'ok').length}종` : '' }
    case 'facts': {
      const confirmed = project.cards.filter((c) => c.type === 'FACT' && c.status === 'confirmed').length
      const drafts = project.cards.filter((c) => c.status === 'draft').length
      return { done: confirmed >= 5, note: confirmed || drafts ? `확인 ${confirmed}${drafts ? ` · 검토 ${drafts}` : ''}` : '' }
    }
    case 'observe': {
      const obs = project.cards.filter((c) => c.type === 'OBSERVATION' && c.status !== 'rejected' && c.text.trim())
      const differ = obs.filter((c) => c.observation?.links.some((l) => l.relation === 'differ')).length
      return { done: obs.length >= 5, note: obs.length ? `${obs.length}개${differ ? ` · 다름 ${differ}` : ''}` : '' }
    }
    default:
      return { done: false, note: '' }
  }
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
