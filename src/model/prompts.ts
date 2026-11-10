// 챗봇에게 보낼 프롬프트 만들기 (계획서 4장, 요청서 9·10장).
// 원칙: 확인한 사실(F)·현장 관찰(O)·미확인(U)·앞 단계 카드만 근거로 쓰게 하고,
//       답변은 앱이 다시 읽을 수 있는 정해진 블록 형식으로 받는다.

import { formatObservedAt, timeBand } from '../lib/photos'
import { areaM2, siteBoundary } from '../lib/geo'
import { observationsOf } from './observations'
import type { Card, Project, Reaction, RoundId } from './types'

export interface RoundDef {
  id: RoundId
  title: string
  short: string
  optional: boolean
  produces: string
}

export const ROUNDS: RoundDef[] = [
  { id: 'R1', title: '관계·긴장·기회', short: '①', optional: false, produces: '관계 5+ · 긴장 3+ · 기회 2+' },
  { id: 'R2', title: '복수 해석·설계 질문', short: '②', optional: false, produces: '긴장마다 해석 3개 · 설계 질문 3+' },
  { id: 'R3', title: '설계 가설', short: '③', optional: false, produces: '서로 다른 가설 3+' },
  { id: 'R4', title: '심화·반대 해석', short: '④', optional: true, produces: "'발전시키기'·'반대 해석' 표시한 카드의 변형" },
  { id: 'R5', title: '추가 조사·패널 요약', short: '⑤', optional: true, produces: '추가 현장조사 질문 · 패널 요약문' },
]

export const REACTION_LABEL: Record<Reaction, string> = {
  agree: '동의',
  partial: '부분 동의',
  differs: '현장과 다름',
  unimportant: '중요하지 않음',
  investigate: '더 조사하기',
  counter: '반대 해석 만들기',
  develop: '발전시키기',
}

export const TYPE_LABEL: Record<string, string> = {
  FACT: '사실',
  OBSERVATION: '관찰',
  UNKNOWN: '미확인',
  INTERPRETATION: '해석',
  TENSION: '긴장',
  OPPORTUNITY: '기회',
  QUESTION: '설계 질문',
  HYPOTHESIS: '설계 가설',
}

const AI_TYPES = new Set(['INTERPRETATION', 'TENSION', 'OPPORTUNITY', 'QUESTION', 'HYPOTHESIS'])

export function isAiCard(c: Card): boolean {
  return AI_TYPES.has(c.type) || (c.type === 'UNKNOWN' && c.origin === 'chatbot')
}

/** 관계 카드는 해석(INTERPRETATION) 중 구분이 '관계'인 것 */
export function isRelation(c: Card): boolean {
  return c.type === 'INTERPRETATION' && c.fields?.['구분'] === '관계'
}

export function cardTitle(c: Card): string {
  return c.fields?.['제목'] || c.text
}

// ───────────── 재료 ─────────────

/** 도판 id → 제목 (prompts가 diagrams 모듈을 불러오지 않도록 이름만 따로 둔다) */
const PANEL_TITLES: Record<string, string> = {
  aerial: '항공사진',
  zoning: '용도지역',
  districts: '구역·지구',
  facilities: '도시계획시설',
  cadastral: '지적',
  plotsize: '필지 규모',
  terrainClass: '필지 지형등급',
  terrain: '지형·등고선',
  slope: '경사도',
  aspect: '경사 방향',
  figure: '건물',
  use: '건축물 용도',
  age: '준공 연대',
  height: '건축물 높이',
  high: '고층',
  low: '저층',
  density: '밀도',
  green: '공원·녹지·하천',
  roads: '도로 위계',
  transit: '지하철·버스',
  sun: '태양 궤적·그림자',
  population: '집계구 인구밀도',
  stores: '상가 업종',
  poi: '생활 시설',
  observations: '현장 관찰 위치',
  blocks: '가구',
  enclosure: '가로 위요감 (D/H)',
  choiceWalk: '선택도 (걷는 규모)',
  choiceWide: '선택도 (넓은 규모)',
  walkshed: '도보권',
  speed: '실시간 도로 속도',
  wind: '바람장미',
}

function panelTitle(id: string): string {
  return PANEL_TITLES[id] ?? id
}

export function contextBlock(project: Project): string {
  const b = project.brief
  const q = project.question
  const lines: string[] = ['## 과제 맥락']
  const add = (label: string, v: string) => v.trim() && lines.push(`- ${label}: ${v.trim()}`)
  add('프로젝트', b.projectName)
  add('과제·공모전 주제', b.theme)
  add('건축 프로그램', b.program)
  add('예상 규모', b.scale)
  add('사용자·대상자', b.targetUsers)
  add('설계 대상의 성격', b.nature)
  add('제출 결과물', b.deliverables)
  if (b.visit) lines.push(`- 현장답사: ${{ done: '다녀옴', planned: '갈 예정', none: '계획 없음' }[b.visit]}`)

  lines.push('', '## 학생의 첫 질문과 관점')
  add('이 대지에서 가장 궁금한 것', q.curiosity)
  const lenses = [...q.lenses, q.lensOther.trim()].filter(Boolean)
  if (lenses.length) lines.push(`- 관심 관점: ${lenses.join(', ')}`)
  add('이 대지를 고른 이유·기억·불편했던 점', q.personal)
  add('피하고 싶은 일반적인 해석', q.avoid)

  const boundary = siteBoundary(project.site)
  lines.push('', '## 대지')
  const addr = project.site.address?.road || project.site.address?.parcel || project.site.parcels[0]?.addr
  if (addr) lines.push(`- 위치: ${addr}`)
  if (boundary) lines.push(`- 대지 면적: 약 ${Math.round(areaM2(boundary)).toLocaleString('ko-KR')}㎡ (도형 계산값), 주변 조사 반경 ${project.site.radiusM}m`)
  return lines.join('\n')
}

function sourceHint(project: Project, c: Card): string {
  const s = project.sources.find((x) => x.source_id === c.related_source_ids[0])
  if (!s) return c.origin === 'user' ? '학생이 직접 입력' : ''
  return `${s.dataset_name}${s.time_range ? `, ${s.time_range}` : ''}`
}

function materialsBlock(project: Project): string {
  const lines: string[] = []
  const facts = project.cards.filter((c) => c.type === 'FACT' && c.status === 'confirmed')
  lines.push('## 확인된 사실 (공공데이터·문헌, 학생이 확인함)')
  if (facts.length === 0) lines.push('- (없음)')
  for (const f of facts) {
    const src = sourceHint(project, f)
    lines.push(`- ${f.id} [${f.topic}] ${f.text}${src ? ` (출처: ${src})` : ''}`)
  }

  const obs = observationsOf(project).filter((o) => o.text.trim())
  lines.push('', '## 현장 관찰 (학생이 현장에서 직접 기록)')
  if (obs.length === 0) lines.push('- (없음)')
  for (const o of obs) {
    const d = o.observation!
    const { band, weekend } = timeBand(d.observedAt)
    const when = d.observedAt ? `${formatObservedAt(d.observedAt)} ${band}${weekend === null ? '' : weekend ? '·주말' : '·평일'}` : '시간 미상'
    const parts = [`- ${o.id} [${when}, ${d.relative ?? '위치 미상'}] ${o.text.trim()}`]
    const tags = [
      d.senses.length ? `감각: ${d.senses.join(', ')}` : '',
      d.actors.length ? `누가: ${d.actors.join(', ')}` : '',
      d.actions.length ? `행위: ${d.actions.join(', ')}` : '',
      d.weather.trim() ? `상황: ${d.weather.trim()}` : '',
    ].filter(Boolean)
    if (tags.length) parts.push(`  · ${tags.join(' / ')}`)
    if (d.feeling.trim()) parts.push(`  · 학생의 느낌: ${d.feeling.trim()}`)
    if (d.discovery) parts.push('  · 지도·공공데이터에 없던 새로운 발견')
    if (d.photoIds.length) parts.push(`  · 사진 ${d.photoIds.length}장 (첨부한 사진의 ${o.id} 표시)`)
    lines.push(...parts)
  }

  const differ = obs.flatMap((o) => o.observation!.links.filter((l) => l.relation === 'differ').map((l) => `- ${l.cardId} ↔ ${o.id}: 자료와 현장이 다름`))
  const match = obs.flatMap((o) => o.observation!.links.filter((l) => l.relation === 'match').map((l) => `- ${l.cardId} ↔ ${o.id}: 일치`))
  if (differ.length || match.length) {
    lines.push('', '## 자료와 현장의 비교 (학생 판단)')
    lines.push(...differ, ...match)
  }

  // Phase 7: 학생이 도판마다 적은 결론 (도판에서 읽은 판단)
  const panelNotes = Object.entries(project.diagrams?.panels ?? {}).filter(([, n]) => n.conclusion.trim())
  if (panelNotes.length) {
    lines.push('', '## 도판에서 읽은 결론 (학생이 도판마다 고르거나 쓴 판단)')
    for (const [id, n] of panelNotes) lines.push(`- [도판 ${panelTitle(id)}] ${n.conclusion.trim()}`)
  }

  // 챗봇이 만든 미확인 카드는 '앞 단계 결과'에 들어가므로 여기서는 자료·학생 것만
  const unknowns = project.cards.filter((c) => c.type === 'UNKNOWN' && c.status !== 'rejected' && c.origin !== 'chatbot')
  if (unknowns.length) {
    lines.push('', '## 아직 확인하지 못한 것')
    for (const u of unknowns) lines.push(`- ${u.id} ${u.text}`)
  }
  return lines.join('\n')
}

function describeAiCard(c: Card): string {
  const f = c.fields ?? {}
  const head = `- ${c.id} [${f['구분'] === '관계' ? '관계' : TYPE_LABEL[c.type]}${f['관점'] ? `·${f['관점']}` : ''}${f['질문 유형'] ? `·${f['질문 유형']}` : ''}]`
  const body =
    c.type === 'HYPOTHESIS'
      ? `${cardTitle(c)} — 공간적 행동: ${f['공간적 행동'] ?? ''}${f['해결하려는 긴장'] ? ` / 해결하려는 긴장: ${f['해결하려는 긴장']}` : ''}`
      : `${f['제목'] ? `${f['제목']}: ` : ''}${c.text}`
  const extra = [
    c.related_card_ids.length ? `근거 ${c.related_card_ids.join(', ')}` : '',
    f['방향'] ? `방향 ${f['방향']}` : '',
    c.reaction ? `학생 반응: ${REACTION_LABEL[c.reaction]}` : '',
    c.edited ? '학생이 고쳐 씀' : '',
    c.user_note.trim() ? `학생 메모: ${c.user_note.trim()}` : '',
  ].filter(Boolean)
  return `${head} ${body}${extra.length ? ` (${extra.join(' / ')})` : ''}`
}

function previousBlock(project: Project, rounds: RoundId[]): string {
  const cards = project.cards.filter((c) => isAiCard(c) && c.round && rounds.includes(c.round) && c.status !== 'rejected')
  if (cards.length === 0) return ''
  return ['## 앞 단계 결과 (학생이 지우지 않은 것, 반응·메모 포함)', ...cards.map(describeAiCard)].join('\n')
}

// ───────────── 원칙·형식 ─────────────

const PRINCIPLES = `## 지켜야 할 원칙
1. 설계안을 대신 결정하지 마세요. 하나의 정답 대신 서로 다른 가능성을 보여 주세요. 최종 선택은 학생이 합니다.
2. 사실과 해석을 구분하세요. 위 목록에 없는 사실이나 수치를 만들지 마세요. 자료가 부족하면 "이 자료만으로는 판단하기 어렵다"고 쓰세요.
3. 근거에는 위 목록의 번호(F-·O-·U-·앞 단계 카드 번호)나 이번 답변에서 붙인 N번호만 쓰세요.
4. 인구 통계로 주민의 행동을 단정하지 말고, 공공데이터만으로 현장 분위기를 확정하지 마세요. 학생의 현장 관찰과 느낌을 무시하지 마세요.
5. 자료와 현장이 다른 지점은 오류로 지우지 말고 중요한 질문으로 다루세요.
6. 법규 정보는 참고용입니다. 인허가 가능성을 판단하지 말고 "확인 필요"로 표시하세요.
7. '연결', '소통', '지속가능성' 같은 추상어로 끝내지 말고, 사람·행위·시간을 다루는 공간적 행동(동사)으로 바꾸세요.
8. 기존 수상작의 형태를 흉내 내도록 이끌지 마세요.
9. 단정 대신 "~가능성이 있다", "~확인할 필요가 있다", "다르게 해석할 수 있다" 같은 표현을 쓰세요.`

const FIELD_SPEC: Record<string, string[]> = {
  관계: ['근거', '관계 유형', '내용', '확신도'],
  긴장: ['근거', '제목', '내용', '방향', '확신도', '확인 필요'],
  기회: ['근거', '제목', '내용', '방향', '확신도'],
  해석: ['근거', '관점', '내용', '반전 질문', '확신도'],
  질문: ['근거', '질문 유형', '내용', '스케일'],
  가설: ['근거', '제목', '해석', '해결하려는 긴장', '공간적 행동', '예상 경험', '장점', '위험', '추가 조사', '스케일'],
  미확인: ['근거', '내용', '확인 방법'],
  요약: ['근거', '내용'],
}

function formatBlock(tags: string[]): string {
  const lines = [
    '## 답변 형식 (꼭 지켜 주세요 — 학생의 프로그램이 이 형식을 읽어 카드로 정리합니다)',
    '- 항목마다 `### [유형] N번호` 줄로 시작하고, 그 아래에 `항목명: 내용` 줄을 씁니다.',
    '- N번호는 이번 답변 안에서 N1, N2, N3 … 순서로 붙이고, 다른 항목의 근거로 이번 답변의 항목을 쓸 때는 N번호를 씁니다.',
    '- 근거는 쉼표로 구분한 번호만 씁니다 (예: `근거: F-03, O-02, N1`).',
    '- 확신도는 높음 / 중간 / 낮음 중 하나입니다.',
    '- 블록 밖의 설명은 꼭 필요할 때만 짧게 씁니다.',
    '',
    '이번 답변에서 쓸 유형과 항목:',
  ]
  for (const t of tags) lines.push(`- [${t}] ${FIELD_SPEC[t].join(' / ')}`)
  const sample = tags[0]
  lines.push('', '예시:', '```', `### [${sample}] N1`, ...FIELD_SPEC[sample].map((k) => `${k}: …`), '```')
  return lines.join('\n')
}

const OPENING = `당신은 건축학과 학생의 대지 해석을 돕는 조력자입니다. 학생이 모은 공공데이터(사실)와 현장 관찰을 바탕으로, 학생이 스스로 대지를 다르게 보고 설계 질문을 만들도록 생각을 넓혀 주세요.`

// ───────────── 단계별 요청 ─────────────

function requestFor(project: Project, round: RoundId): { request: string; tags: string[]; prev: RoundId[] } {
  switch (round) {
    case 'R1':
      return {
        tags: ['관계', '긴장', '기회', '미확인'],
        prev: [],
        request: `## 이번 요청 — ① 관계·긴장·기회
1. 사실·관찰 사이의 **관계**를 5개 이상 찾으세요 [관계]. 각 관계는 근거를 두 개 이상 연결해야 합니다. 관계 유형은 공간적 인접 / 거리와 접근 / 밀도와 분포 / 시간적 변화 / 충돌 / 반복 / 단절 / 공존 / 배제 / 보존과 변환 가능성 중에서 고르세요.
2. 관계에서 생기는 **긴장**(갈등·모순)을 3개 이상 [긴장], **기회**(가능성)를 2개 이상 [기회] 쓰세요. 근거에는 관계의 N번호와 사실·관찰 번호를 함께 쓰고, 방향은 보존할 것 / 드러낼 것 / 피할 것 / 변환할 것 중에서 고르세요.
3. 사람·행위·시간(시간대별 점유, 거주인구와 활동인구의 차이 등)과 장소의 기억·변화를 놓치지 마세요.
4. 판단하기에 자료가 부족한 것은 [미확인]으로 무엇을 어떻게 확인할지 쓰세요.`,
      }
    case 'R2':
      return {
        tags: ['해석', '질문', '미확인'],
        prev: ['R1'],
        request: `## 이번 요청 — ② 복수 해석과 설계 질문
1. 앞 단계의 긴장·기회 가운데 학생이 지우지 않은 것마다 서로 다른 **해석**을 3개씩 쓰세요 [해석]. 관점은 '현실적', '관계적', '반전적' 하나씩입니다. 근거에 그 긴장·기회의 번호를 넣으세요.
   - 반전적 해석에는 '반전 질문'을 함께 쓰세요. 예: 이 문제를 제거하지 않고 활용한다면? 이 경계를 없애지 않고 두껍게 만든다면? 이 빈 공간을 채우지 않고 비워 둔다면? 이 소음을 차단하지 않고 정체성으로 받아들인다면? 오래된 흔적을 새로운 층위와 충돌시킨다면?
2. **설계 질문**을 3개 이상 쓰세요 [질문]. 질문 유형은 보존 / 드러냄 / 연결 / 분리 / 공유 / 비움 / 변화 중 하나이고, "무엇을 ~할 것인가?" 형태로 공간적 행동으로 이어질 수 있게 구체적으로 쓰세요.
   - 스케일은 사람의 몸과 감각 / 건물과 외부공간 / 필지와 블록 / 동네와 도시 / 지역과 생태계 / 현재와 미래 중에서 고르세요.
3. 학생이 '현장과 다름', '더 조사하기'로 표시하거나 메모를 남긴 카드는 그 의견을 반영하세요.`,
      }
    case 'R3':
      return {
        tags: ['가설', '미확인'],
        prev: ['R1', 'R2'],
        request: `## 이번 요청 — ③ 설계 가설
앞 단계의 해석과 설계 질문(학생이 동의·수정한 것을 우선)을 바탕으로 **서로 방향이 다른 설계 가설을 3개 이상** 쓰세요 [가설].
- 각 가설은 형식의 모든 항목을 채우세요. 근거에는 사실·관찰 번호와 앞 단계 카드 번호를 함께 쓰세요.
- '해결하려는 긴장'에는 앞 단계 긴장 번호를 쓰세요.
- '공간적 행동'은 공간 동사로 쓰세요. 예: 연결 → 가로지르게 한다 / 공존 → 서로 다른 활동이 시간차를 두고 점유하게 한다 / 기억 → 흔적을 이동 경로와 시선으로 재구성한다 / 개방성 → 누구나 통과하거나 머물 수 있는 단계적 경계를 만든다.
- 장점과 위험(부작용)을 함께 쓰고, 검증에 필요한 추가 조사를 쓰세요.
- 하나를 추천하거나 순위를 매기지 마세요. 법규·구조·인허가 판단은 하지 마세요.`,
      }
    case 'R4': {
      const develop = project.cards.filter((c) => isAiCard(c) && c.reaction === 'develop' && c.status !== 'rejected').map((c) => c.id)
      const counter = project.cards.filter((c) => isAiCard(c) && c.reaction === 'counter' && c.status !== 'rejected').map((c) => c.id)
      return {
        tags: ['가설', '해석', '질문', '미확인'],
        prev: ['R1', 'R2', 'R3', 'R4'],
        request: `## 이번 요청 — ④ 심화와 반대 해석
${develop.length ? `1. 학생이 '발전시키기'로 고른 카드: ${develop.join(', ')}
   - 가설이면 스케일·시간·사용자를 달리한 변형을 2개씩 [가설]로 쓰고, 각각 어떻게 검증할지 '추가 조사'에 쓰세요.
   - 해석·질문이면 더 구체적인 설계 질문 [질문]으로 바꾸세요.` : '1. (발전시키기로 고른 카드 없음)'}
${counter.length ? `2. 학생이 '반대 해석 만들기'로 고른 카드: ${counter.join(', ')}
   - 같은 근거를 정반대로 읽는 해석을 [해석](관점: 반전적)으로 쓰고, 그 해석에서 나오는 새 질문이 있으면 [질문]으로 쓰세요.` : '2. (반대 해석을 요청한 카드 없음)'}
근거에는 고른 카드의 번호를 반드시 넣으세요.`,
      }
    }
    case 'R5':
      return {
        tags: ['미확인', '요약'],
        prev: ['R1', 'R2', 'R3', 'R4'],
        request: `## 이번 요청 — ⑤ 추가 조사와 패널 요약
1. 지금까지의 가설을 검증하거나 반박하는 데 필요한 **추가 현장조사**를 5개 이상 쓰세요 [미확인]. 언제(시간대·요일)·어디서·무엇을·어떻게 볼지 구체적으로 '확인 방법'에 쓰세요.
2. 발표 패널에 쓸 **대지해석 요약문**을 하나 쓰세요 [요약]. "어떤 사실을 발견했는가 → 어떻게 해석했는가 → 무엇을 질문했는가 → 공간적으로 어떻게 바꿀 수 있는가" 순서로 400자 안팎, 근거 번호를 괄호로 넣고, 가설 하나를 정답처럼 고르지 마세요.`,
      }
  }
}

export function buildPrompt(project: Project, round: RoundId): string {
  const { request, tags, prev } = requestFor(project, round)
  return [OPENING, contextBlock(project), materialsBlock(project), previousBlock(project, prev), request, PRINCIPLES, formatBlock(tags)]
    .filter((s) => s && s.trim())
    .join('\n\n')
}

/** 단계를 시작할 수 있는지와 주의할 점 */
export function roundReadiness(project: Project, round: RoundId): { ok: boolean; warnings: string[] } {
  const facts = project.cards.filter((c) => c.type === 'FACT' && c.status === 'confirmed').length
  const drafts = project.cards.filter((c) => c.type === 'FACT' && c.status === 'draft').length
  const obs = observationsOf(project).filter((o) => o.text.trim()).length
  const has = (r: RoundId) => project.cards.some((c) => c.round === r && c.status !== 'rejected')
  const warnings: string[] = []
  if (facts < 5) warnings.push(`확인한 사실이 ${facts}개입니다 (MVP 기준 5개 이상).${drafts ? ` 검토 대기 ${drafts}개를 먼저 확인하세요.` : ''}`)
  if (obs < 5) warnings.push(`현장 관찰이 ${obs}개입니다 (MVP 기준 5개 이상). 관찰 없이도 진행할 수 있지만 해석이 자료에만 기댑니다.`)
  switch (round) {
    case 'R1':
      return { ok: facts + obs > 0, warnings }
    case 'R2':
      if (!has('R1')) return { ok: false, warnings: ['① 관계·긴장·기회 답변을 먼저 가져오세요.'] }
      return { ok: true, warnings: [] }
    case 'R3':
      if (!has('R2')) return { ok: false, warnings: ['② 복수 해석·설계 질문 답변을 먼저 가져오세요.'] }
      return { ok: true, warnings: [] }
    case 'R4': {
      const marked = project.cards.some((c) => isAiCard(c) && (c.reaction === 'develop' || c.reaction === 'counter') && c.status !== 'rejected')
      return marked ? { ok: true, warnings: [] } : { ok: false, warnings: ["카드 보드에서 '발전시키기' 또는 '반대 해석 만들기'를 먼저 고르세요."] }
    }
    case 'R5':
      return has('R3') ? { ok: true, warnings: [] } : { ok: false, warnings: ['③ 설계 가설 답변을 먼저 가져오세요.'] }
  }
}

/**
 * 긴 프롬프트를 나눠 복사할 수 있게 자른다. 단락(빈 줄) 경계에서만 자른다.
 * 앞 조각에는 "아직 답하지 말라"는 안내를 붙인다.
 */
export function splitPrompt(prompt: string, maxChars: number): string[] {
  if (prompt.length <= maxChars) return [prompt]
  const paras = prompt.split(/\n\n/)
  const chunks: string[] = []
  let cur = ''
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > maxChars - 120) {
      chunks.push(cur)
      cur = p
    } else cur = cur ? `${cur}\n\n${p}` : p
  }
  if (cur) chunks.push(cur)
  const n = chunks.length
  return chunks.map((c, i) =>
    i < n - 1
      ? `(${i + 1}/${n}) 자료가 길어서 나눠 보냅니다. 이 메시지에는 아직 답하지 말고 "받음"이라고만 답해 주세요.\n\n${c}`
      : `(${n}/${n}) 마지막 부분입니다. 이제 앞의 메시지까지 모두 읽고 답해 주세요.\n\n${c}`,
  )
}
