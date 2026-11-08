// 현장 관찰(OBSERVATION 카드) 도우미

import { bearing, booleanPointInPolygon, distance, feature, point } from '@turf/turf'
import { centerOf, siteBoundary } from '../lib/geo'
import { makeCard, newId, nowIso } from './project'
import type { Card, ObservationDetail, Project } from './types'

export const SENSE_PRESETS = ['시끄러움', '조용함', '냄새', '그늘', '햇빛', '바람', '더움', '추움', '좁음', '트임', '어두움', '밝음', '경사', '거친 바닥', '물기']
export const ACTOR_PRESETS = ['주민', '상인', '노인', '어린이', '청소년', '대학생', '직장인', '관광객', '배달·노동자', '반려동물']
export const ACTION_PRESETS = ['통과', '머무름', '앉음', '대화', '기다림', '판매·영업', '쇼핑', '식사', '놀이', '흡연', '주차', '짐 옮기기', '구경']

export function emptyDetail(): ObservationDetail {
  return {
    photoIds: [],
    location: null,
    relative: null,
    observedAt: null,
    timeSource: null,
    senses: [],
    actors: [],
    actions: [],
    feeling: '',
    weather: '',
    discovery: false,
    links: [],
  }
}

export function createObservation(project: Project): Card {
  const card = makeCard(project, {
    type: 'OBSERVATION',
    topic: '현장 관찰',
    text: '',
    related_source_ids: [],
    related_card_ids: [],
    origin: 'user',
    confidence: 'high',
    human_validation_required: false,
    status: 'confirmed',
    user_note: '',
    auto_key: null,
  })
  card.uid = newId()
  card.observation = emptyDetail()
  return card
}

export function observationsOf(project: Project): Card[] {
  return project.cards.filter((c) => c.type === 'OBSERVATION' && c.observation && c.status !== 'rejected')
}

const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']

/** 대지 중심에서 본 관찰 위치 설명 */
export function describeRelative(project: Project, lon: number, lat: number): string | null {
  const boundary = siteBoundary(project.site)
  if (!boundary) return null
  const p = point([lon, lat])
  if (booleanPointInPolygon(p, feature(boundary))) return '대지 안'
  const c = centerOf(boundary)
  const d = distance(point(c), p, { units: 'meters' })
  const b = (bearing(point(c), p) + 360) % 360
  const dir = DIRS[Math.round(b / 45) % 8]
  const dist = d < 1000 ? `${Math.round(d / 10) * 10}m` : `${(d / 1000).toFixed(1)}km`
  return `대지 ${dir}쪽 ${dist}`
}

/** 관찰 하나의 내용을 바꾸고 수정 시각을 갱신 */
export function patchObservation(project: Project, id: string, fn: (card: Card, detail: ObservationDetail) => void): void {
  const card = project.cards.find((c) => c.id === id)
  if (!card || !card.observation) return
  fn(card, card.observation)
  card.updated_at = nowIso()
}

/** 사실 카드 → 그 사실에 연결된 관찰들 */
export function linksByFact(project: Project): Map<string, { obsId: string; relation: 'match' | 'differ' }[]> {
  const m = new Map<string, { obsId: string; relation: 'match' | 'differ' }[]>()
  for (const o of observationsOf(project)) {
    for (const l of o.observation!.links) {
      m.set(l.cardId, [...(m.get(l.cardId) ?? []), { obsId: o.id, relation: l.relation }])
    }
  }
  return m
}
