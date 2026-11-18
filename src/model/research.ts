// 정성 조사 (2026-11-18 사용자 요청: 통계뿐 아니라 프로젝트 당시 이슈·지역 문화 같은 정성적인 부분까지 챗봇이 조사하게).
// 인터뷰: 주제 = 이슈·갈등·개발 계획(최근 3년) · 역사·장소의 기억 · 지역 문화·생활, 거시→미시 5단계(대한민국 → 광역 → 시·군·구 → 동 → 대지 주변)
// 마다 주요 이슈. ⑤ 사실 카드 맨 위에서 명령어를 만들어 챗봇에 보내고 답을 붙여 넣으면 출처가 붙은 사실 카드로 들어옴 — 처음부터 확인됨
// (2026-11-18 사용자 요청: 하나하나 확인을 누르지 않고, 틀리거나 필요 없는 것만 '제외'). 제외하지 않은 것이 해석·가설의 근거와 ⑥ 도판 '스케일별 주요 이슈'에 쓰임.

import { makeCard, nextNumber, nowIso } from './project'
import { contextBlock } from './prompts'
import type { Card, Project } from './types'

import { ISSUE_YEARS, RESEARCH_KEY, RESEARCH_SCALES, RESEARCH_THEMES, type ResearchScale, type ResearchTheme } from './researchScales'

export { ISSUE_YEARS, RESEARCH_SCALES, RESEARCH_THEMES, type ResearchScale, type ResearchTheme }

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 챗봇에게 보낼 정성 조사 명령어 */
export function buildResearchPrompt(project: Project, now = new Date()): string {
  const from = new Date(now)
  from.setFullYear(from.getFullYear() - ISSUE_YEARS)
  const R = project.site.radiusM
  const hints = [project.site.address?.road, project.site.address?.parcel, project.site.parcels[0]?.addr].filter((s): s is string => !!s && !!s.trim())
  return [
    `당신은 건축학과 학생의 대지 조사를 돕는 리서처입니다. 아래 대지와 과제에 대해 **웹 검색으로** 정성적인 맥락 — 진행 중인 이슈·갈등·개발 계획, 역사와 장소의 기억, 지역 문화와 생활 — 을 조사해 주세요. 학생은 출처를 열어 보고 틀리거나 필요 없는 것은 빼고 사실 카드로 씁니다. 통계 수치는 학생이 공공데이터로 따로 모았으니, 여기서는 숫자보다 사건·계획·이야기·사람들의 생활을 찾아 주세요.`,
    contextBlock(project),
    [
      '## 조사 기준',
      `- 기준일: ${ymd(now)}. '이슈·갈등·개발 계획'은 최근 ${ISSUE_YEARS}년(${ymd(from)} ~ ${ymd(now)})의 것만 쓰세요. 예전 일은 지금도 이어지고 있을 때만 쓰고 시점을 밝히세요. '역사·장소의 기억'은 기간 제한이 없습니다.`,
      hints.length ? `- 대지 주소: ${[...new Set(hints)].join(' / ')} — 이것으로 광역(시·도), 시·군·구, 동(법정동·행정동) 이름을 찾으세요.` : '- 대지 주소가 없으면 위 대지 정보로 지역을 찾고, 모르면 "지역 확인 필요"라고 쓰세요.',
      '- 스케일 5단계 (거시 → 미시):',
      '  1. 대한민국 — 이 대지와 과제 주제에 닿는 나라 전체의 흐름 (정책·제도·사회 변화)',
      '  2. 광역 — 대지가 속한 시·도 (특별시·광역시·도·특별자치도)',
      '  3. 시·군·구',
      '  4. 동 — 대지가 속한 법정동·행정동',
      `  5. 대지 주변 — 대지에서 반경 약 ${R.toLocaleString('ko-KR')}m 안 (가로·블록·시설 단위)`,
      `- 주제 3가지: ${RESEARCH_THEMES.join(' / ')}`,
    ].join('\n'),
    [
      '## 이번 요청',
      '1. 스케일마다 주요 이슈를 2~4개 쓰세요. 모든 스케일에 \'이슈·갈등·개발 계획\'이 1개 이상 있어야 합니다. 거시 스케일(대한민국·광역)일수록 이 대지와 과제에 실제로 닿는 것만 고르세요.',
      '   - 예: 재개발·재건축·도시재생 사업, 지구단위계획·도시계획 변경, 공공시설·교통 사업, 상권 변화·젠트리피케이션, 주민 민원·분쟁, 인구·산업 변화에 따른 정책',
      '2. 동과 대지 주변 스케일에서는 \'역사·장소의 기억\'과 \'지역 문화·생활\'을 각각 2개 이상 더 찾으세요.',
      '   - 역사·장소의 기억: 옛 지명과 그 뜻, 과거 용도(공장·시장·철도·군사시설·하천 등), 사건, 지금 남아 있는 흔적, 개발 전후의 변화',
      '   - 지역 문화·생활: 축제·장터·공동체 활동, 상권의 성격과 단골 문화, 종교·예술·교육 시설, 동네 사람들이 부르는 이름과 정체성',
      '3. 위아래 스케일이 이어지는 이슈(예: 나라 정책이 이 동에서 나타나는 모습)는 내용에 그 연결을 한 문장으로 쓰세요.',
    ].join('\n'),
    [
      '## 지켜야 할 원칙',
      '1. 검색으로 확인한 내용만 쓰세요. 항목마다 확인할 수 있는 출처(공공기관·지자체·언론·논문·보고서 이름)와 주소(URL)를 붙이세요. 주소를 찾지 못했으면 `주소: 없음`으로 쓰고 확신도를 낮음으로 하세요.',
      '2. 발표·보도·사건 시점을 \'시점\'에 쓰세요 (예: 2025-03, 1970년대). 모르면 \'모름\'.',
      '3. 해석·평가·설계 제안은 쓰지 마세요 — 사실을 짧게 (해석은 학생이 다음 단계에서 합니다). 수치는 출처에 있는 그대로 쓰세요.',
      '4. 토지·건물 소유자 같은 개인 정보와 특정 개인에 대한 평가는 조사하지 마세요.',
      '5. 서로 다른 출처가 다르게 말하면 둘 다 쓰고 내용에 차이를 밝히세요. 확인되지 않은 소문은 쓰지 마세요.',
      '6. 웹 검색을 할 수 없는 상태라면 답변 첫 줄에 \'검색 불가\'라고 쓰고, 아는 범위만 확신도 낮음으로 쓰세요.',
    ].join('\n'),
    [
      '## 답변 형식 (꼭 지켜 주세요 — 학생의 프로그램이 이 형식을 읽어 카드로 정리합니다)',
      '- 항목마다 `### [조사] N번호` 줄로 시작하고, 그 아래에 `항목명: 내용` 줄을 씁니다. N번호는 N1, N2 … 순서로.',
      `- 스케일은 ${RESEARCH_SCALES.join(' / ')} 중 하나를 쓰고, 그 지역 이름을 괄호에 쓰세요 (예: \`스케일: 시·군·구 (광주 서구)\`).`,
      `- 주제는 ${RESEARCH_THEMES.join(' / ')} 중 하나입니다.`,
      '- 확신도는 높음 / 중간 / 낮음 중 하나입니다.',
      '- 블록 밖의 설명은 꼭 필요할 때만 짧게 씁니다.',
      '',
      '예시:',
      '```',
      '### [조사] N1',
      '스케일: 동 (OO동)',
      '주제: 이슈·갈등·개발 계획',
      '제목: …',
      '내용: …',
      '시점: 2025-03',
      '출처: …',
      '주소: https://…',
      '확신도: 중간',
      '```',
    ].join('\n'),
  ].join('\n\n')
}

export interface ResearchItem {
  label: string | null
  scale: ResearchScale
  /** 괄호 안 지역 이름 (예: 광주 서구) */
  place: string
  theme: ResearchTheme
  title: string
  content: string
  when: string
  source: string
  url: string
  confidence: Card['confidence']
}

const KEY_OF: Record<string, keyof Omit<ResearchItem, 'label' | 'confidence'> | 'confidence'> = {
  스케일: 'scale',
  범위: 'scale',
  단계: 'scale',
  주제: 'theme',
  분야: 'theme',
  제목: 'title',
  내용: 'content',
  요약: 'content',
  시점: 'when',
  시기: 'when',
  날짜: 'when',
  출처: 'source',
  출처명: 'source',
  주소: 'url',
  URL: 'url',
  url: 'url',
  링크: 'url',
  확신도: 'confidence',
}

/** 스케일 글 → 5단계 (괄호 안 지역 이름은 빼고 봄 — '시·군·구 (광주광역시 서구)'가 광역으로 읽히지 않게) */
export function scaleOf(s: string): ResearchScale | null {
  const t = s.replace(/[(（][^)）]*[)）]/g, '').replace(/\s/g, '')
  if (!t) return null
  if (/대지|주변|반경/.test(t)) return '대지 주변'
  if (/대한민국|국가|전국|한국/.test(t)) return '대한민국'
  if (/시[·.]?군[·.]?구|자치구|^[시군구]$/.test(t)) return '시·군·구'
  if (/광역|시[·.]?도|특별시|광역시|특별자치|^도$/.test(t)) return '광역'
  if (/동|읍|면/.test(t)) return '동'
  return null
}

export function themeOf(s: string): ResearchTheme {
  if (/역사|기억|흔적|옛|과거/.test(s)) return '역사·장소의 기억'
  if (/문화|생활|축제|공동체|상권/.test(s)) return '지역 문화·생활'
  return '이슈·갈등·개발 계획'
}

const HEADER = /^\s*#{2,4}\s*\[\s*(?:조사|RESEARCH)\s*\]\s*(N\d+)?.*$/gim

/** 챗봇 답변 → 조사 항목. 형식에 맞지 않는 블록은 warnings로 */
export function parseResearch(answer: string): { items: ResearchItem[]; warnings: string[]; noSearch: boolean } {
  const warnings: string[] = []
  const heads = [...answer.matchAll(HEADER)]
  const items: ResearchItem[] = []
  heads.forEach((h, i) => {
    const start = (h.index ?? 0) + h[0].length
    const end = i + 1 < heads.length ? (heads[i + 1].index ?? answer.length) : answer.length
    const body = answer.slice(start, end)
    const f: Record<string, string> = {}
    let last: string | null = null
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.replace(/^\s*[-*•]\s*/, '').replace(/\*\*/g, '').trim()
      if (!line || /^```/.test(line)) continue
      const m = /^([^:：]{1,8})\s*[:：]\s*(.*)$/.exec(line)
      const k = m ? KEY_OF[m[1].trim()] : undefined
      if (m && k) {
        f[k] = m[2].trim()
        last = k
      } else if (last && last !== 'url') f[last] = `${f[last]} ${line}`.trim()
    }
    const label = h[1] ?? null
    const sc = f.scale ? scaleOf(f.scale) : null
    const body0 = (f.content ?? '').trim()
    if (!sc || !(body0 || f.title)) {
      warnings.push(`${label ?? `${i + 1}번째 항목`}: ${!sc ? '스케일을 알아보지 못함' : '내용이 비었음'} — 건너뜀`)
      return
    }
    const place = /[(（]([^)）]+)[)）]/.exec(f.scale ?? '')?.[1]?.trim() ?? ''
    const urlRaw = (f.url ?? '').trim()
    const url = /https?:\/\/\S+/.exec(urlRaw)?.[0]?.replace(/[)>\].,]+$/, '') ?? ''
    const conf = f.confidence ?? ''
    items.push({
      label,
      scale: sc,
      place,
      theme: themeOf(f.theme ?? ''),
      title: (f.title ?? '').trim(),
      content: body0,
      when: (f.when ?? '').trim(),
      source: (f.source ?? '').trim(),
      url,
      confidence: /높/.test(conf) ? 'high' : /낮/.test(conf) || !url ? 'low' : 'medium',
    })
  })
  if (!heads.length && answer.trim()) warnings.push('`### [조사] N번호` 블록을 찾지 못했습니다 — 명령어의 답변 형식대로 다시 받아 주세요.')
  return { items, warnings, noSearch: /^\s*검색\s*불가/.test(answer) }
}

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

/** 조사 항목을 사실 카드로 — 처음부터 확인됨, 학생이 '제외'로 뺌 (같은 항목은 다시 넣지 않음). draft를 직접 고침 — update() 안에서 부르기 */
export function importResearch(d: Project, items: ResearchItem[]): { added: number; skipped: number } {
  let added = 0
  let skipped = 0
  const t = nowIso()
  for (const it of items) {
    const key = `${RESEARCH_KEY}${hash(`${it.scale}|${it.title}|${it.url || it.content.slice(0, 60)}`)}`
    if (d.cards.some((c) => c.auto_key === key)) {
      skipped++
      continue
    }
    const sid = nextNumber(d, 'S')
    d.sources.push({
      source_id: sid,
      source_name: it.source || '챗봇 웹 조사 (출처 이름 없음)',
      dataset_name: it.title || it.content.slice(0, 40),
      dataset_id: 'research',
      retrieved_at: t,
      update_date: it.when && it.when !== '모름' ? it.when : null,
      geometry: '—',
      coordinate_system: '—',
      spatial_scale: `${it.scale}${it.place ? ` (${it.place})` : ''}`,
      time_range: it.when || null,
      raw_ref: null,
      normalized_value: null,
      unit: null,
      license: '',
      limitations: '챗봇이 웹에서 찾은 내용 — 출처를 열어 보고 틀리면 제외',
      original_url: it.url,
      reliability: 'web',
      feature_count: null,
      status: 'ok',
      error: null,
    })
    d.cards.push(
      makeCard(d, {
        type: 'FACT',
        topic: `정성 조사 · ${it.theme}`,
        text: it.title ? `${it.title} — ${it.content}` : it.content,
        related_source_ids: [sid],
        related_card_ids: [],
        origin: 'chatbot',
        confidence: it.confidence,
        human_validation_required: true,
        status: 'confirmed',
        user_note: '',
        auto_key: key,
        fields: { 스케일: it.scale, 지역: it.place, 주제: it.theme, 제목: it.title, 시점: it.when, 출처: it.source, 주소: it.url },
      }),
    )
    added++
  }
  return { added, skipped }
}

/** 정성 조사 카드인지 */
export const isResearchCard = (c: Card) => !!c.auto_key?.startsWith(RESEARCH_KEY)

/** 제외하지 않은(확인된) 정성 조사 카드 — 스케일 순서대로 (⑥ 도판 '스케일별 주요 이슈') */
export function researchByScale(project: Project): { scale: ResearchScale; place: string; cards: Card[] }[] {
  const ok = project.cards.filter((c) => isResearchCard(c) && c.status === 'confirmed')
  return RESEARCH_SCALES.map((scale) => {
    const cards = ok.filter((c) => c.fields?.['스케일'] === scale)
    const places = [...new Set(cards.map((c) => c.fields?.['지역'] ?? '').filter(Boolean))]
    return { scale, place: places[0] ?? '', cards }
  })
}
