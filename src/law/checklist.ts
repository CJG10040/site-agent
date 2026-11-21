// 법규검토 체크리스트 (2026-11-21 묶음 E3): 주용도·대략 규모 → 해당 항목만, 항목마다 확인할 것 · 이 대지 값 · 근거 조문 링크 · 내 확인 상태.
// 사용자 결정: 참고용(법적 판정 아님), 내 안이 넘는지 앱이 점검하지 않음, 자료로 모르는 것은 '확인 필요'.
// 숫자 기준(문턱값)은 여기 코드에 두고, 화면에는 조례 표와 함께 받아 둔 법령 조문 글(시행일)을 같이 보여 준다.

import type { ZoneRule } from '../diagrams/panelsLaw'
import { lawArticleUrl, zoneKey, type OrdinanceTable, type RegionTable, type ZoneValue } from './ordinances'
import { USE_CLASSES, useLabel, type UsePick } from './uses'

export type CheckStatus = 'todo' | 'ok' | 'na'

export const STATUS_LABEL: Record<CheckStatus, string> = {
  todo: '확인 필요',
  ok: '확인함',
  na: '해당 없음',
}

export interface Basis {
  label: string
  url: string
  /** 받아 둔 조문 글 (법령: '건축법'·'건축법 시행령'… / 조문: '제58조') */
  law?: string
  article?: string
}

export interface CheckItem {
  id: string
  group: string
  title: string
  /** 무엇을 확인할지 */
  what: string
  /** 이 대지 값 (줄마다) — 모르면 '확인 필요' 줄 */
  values: string[]
  basis: Basis[]
  /** 조례 글 (펼쳐 보기) */
  ordinanceText?: { label: string; text: string; url: string }
  /** 자료로 모르는 것이 있음 */
  unknown?: boolean
}

export interface CheckCtx {
  zones: { name: string; share: number; rule: ZoneRule | null }[]
  /** 대지 면적(㎡) */
  siteArea: number
  /** 대지에 걸친 용도지구·구역 이름 */
  overlays: string[]
  use: UsePick | null
  floors: number | null
  basement: number | null
  /** 연면적(㎡) */
  gfa: number | null
  table: OrdinanceTable | null
  region: RegionTable | null
  /** 대지 둘레 학교(카카오 SC4)·어린이집·유치원(PS3)과 거리(m, 점 기준) — 묶음 E4 */
  schools?: { name: string; kind: string; dist: number }[]
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

const law = (name: string, article: string, label?: string): Basis => ({
  label: label ?? `${name} ${article}`,
  url: lawArticleUrl(name, article),
  law: name,
  article,
})

const ordin = (o: { name: string; url: string } | undefined, article: string | undefined, label?: string): Basis[] =>
  o ? [{ label: `${o.name}${article ? ` ${article}` : ''}${label ? ` (${label})` : ''}`, url: o.url }] : []

const useClass = (ctx: CheckCtx) => (ctx.use ? USE_CLASSES.find((u) => u.no === ctx.use!.no) : undefined)
const isUse = (ctx: CheckCtx, ...nos: string[]) => !!ctx.use && nos.includes(ctx.use.no)
const residentialZone = (ctx: CheckCtx) => ctx.zones.some((z) => z.rule && /전용주거|일반주거/.test(z.rule.label))

/** 용도지역마다 조례 값 (없으면 법 상한) */
function zoneLimit(ctx: CheckCtx, kind: 'bcr' | 'far'): { zone: string; share: number; law: string; ord: ZoneValue | null }[] {
  return ctx.zones.map((z) => {
    const label = z.rule?.label ?? z.name
    const ord = ctx.region?.urban?.[kind]?.[zoneKey(label)] ?? null
    const lawText = z.rule ? (kind === 'bcr' ? `${z.rule.bcr}% 이하` : `${z.rule.farMin}~${z.rule.farMax}% 범위에서 조례로`) : '표에 없음'
    return { zone: label, share: z.share, law: lawText, ord }
  })
}

function limitLines(ctx: CheckCtx, kind: 'bcr' | 'far'): { lines: string[]; unknown: boolean } {
  const name = kind === 'bcr' ? '건축면적' : '지상 연면적'
  const rows = zoneLimit(ctx, kind)
  if (!rows.length) return { lines: ['대지의 용도지역 자료가 없음 — 토지이음에서 확인 필요'], unknown: true }
  let unknown = false
  let weighted = 0
  const lines = rows.map((r) => {
    const share = rows.length > 1 ? ` (대지의 ${Math.round(r.share * 100)}%)` : ''
    if (r.ord) {
      weighted += (r.ord.pct / 100) * r.share
      return `${r.zone}${share}: 조례 ${r.ord.pct}% ${r.ord.bound} (${r.ord.article})${r.ord.note ? ` — ${r.ord.note}` : ''} · 법 ${r.law}`
    }
    unknown = true
    return `${r.zone}${share}: 조례 값 확인 필요 · 법 ${r.law}`
  })
  if (!unknown && ctx.siteArea > 0) lines.push(`대지 ${fmt(ctx.siteArea)}㎡ × 조례 값 → 최대 ${name} 약 ${fmt(ctx.siteArea * weighted)}㎡${rows.length > 1 ? ' (면적 비율로 나눈 평균 — 국토계획법 제84조: 가장 작은 부분이 330㎡ 이하일 때. 넘으면 부분마다 따로)' : ''}`)
  return { lines, unknown }
}

function setbackLines(ctx: CheckCtx): { lines: string[]; unknown: boolean } {
  const s = ctx.region?.building?.setback
  if (!s) return { lines: ['조례의 대지 안의 공지 기준을 읽지 못함 — 원문 확인 필요'], unknown: true }
  if (!s.tableText) return { lines: [`${s.article} → ${s.table ?? '별표'}: 표 글을 읽지 못함 — 원문 확인 필요`], unknown: true }
  // 고른 용도 이름이 들어간 줄을 먼저
  const c = useClass(ctx)
  const keys = [c?.name.replace(/\s/g, ''), ctx.use?.sub?.replace(/\(.*\)/, '').replace(/\s/g, '')].filter(Boolean) as string[]
  const rows = s.tableText.split('\n').map((l) => l.trim()).filter(Boolean)
  const hits = keys.length ? rows.filter((l) => keys.some((k) => l.replace(/\s/g, '').includes(k))) : []
  return {
    lines: hits.length ? [`${s.table}에서 '${keys.join('·')}'이 들어간 줄:`, ...hits.slice(0, 6).map((l) => `· ${l.slice(0, 160)}`)] : [`${s.table}에 고른 용도 이름이 없음 — 표 전체를 펼쳐 확인 (해당 없으면 법 기준)`],
    unknown: !hits.length,
  }
}

/** 법령 별표에서 고른 용도가 들어간 줄(과 바로 다음 두 줄 — 기준 숫자가 다음 칸에 있는 경우가 많음) */
function useRows(ctx: CheckCtx, lawName: string, no: number): { rows: string[]; table?: { title: string; text: string }; url?: string } {
  const lt = ctx.table?.lawTables?.[lawName]
  const t = lt?.tables?.[String(no)]
  if (!t?.text) return { rows: [] }
  const c = useClass(ctx)
  const keys = [c?.name, ctx.use?.sub?.replace(/\(.*\)/, '')].filter(Boolean).map((k) => k!.replace(/\s/g, ''))
  // 글로 그린 표(┃│─)는 한 칸이 여러 줄로 나뉘고 기준 숫자가 위 줄에 있기도 해서 선을 지우고 앞뒤 두 줄씩
  const boxed = /[┃│]/.test(t.text)
  const lines = t.text
    .split('\n')
    .map((l) => (boxed ? l.replace(/[┃│├┤┼─━┌┐└┘┬┴╋┠┨┯┷]/g, ' ') : l).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const before = boxed ? 2 : 0
  const picked = new Set<number>()
  lines.forEach((l, i) => {
    if (keys.some((k) => l.replace(/\s/g, '').includes(k))) for (let j = Math.max(0, i - before); j < Math.min(lines.length, i + 3); j++) picked.add(j)
  })
  return { rows: [...picked].sort((a, b) => a - b).slice(0, 9).map((i) => `· ${lines[i].slice(0, 180)}`), table: t, url: lt?.url }
}

/** 체크리스트 (해당하는 것만) */
export function buildChecklist(ctx: CheckCtx): CheckItem[] {
  const items: CheckItem[] = []
  const reg = ctx.region
  const urban = reg?.urban
  const building = reg?.building
  const zonesText = ctx.zones.length ? ctx.zones.map((z) => `${z.rule?.label ?? z.name}${ctx.zones.length > 1 ? ` ${Math.round(z.share * 100)}%` : ''}`).join(', ') : '용도지역 자료 없음'

  // ── 국토계획법
  items.push({
    id: 'zone-use',
    group: '국토계획법 (용도지역)',
    title: '용도지역 안에서 지을 수 있는 건축물',
    what: `고른 용도(${useLabel(ctx.use)})를 이 용도지역에 지을 수 있는지 — 시행령 별표와 조례의 '건축할 수 있는 건축물' 표에서 확인`,
    values: [`대지 용도지역: ${zonesText}`, '지을 수 있는지는 앱이 판정하지 않음 — 확인 필요'],
    basis: [law('국토의 계획 및 이용에 관한 법률', '제76조'), law('국토의 계획 및 이용에 관한 법률 시행령', '제71조', '국토계획법 시행령 제71조 (별표 2~22)'), ...ordin(urban, undefined, '용도지역 안에서의 건축제한')],
    unknown: true,
  })
  const b = limitLines(ctx, 'bcr')
  items.push({
    id: 'bcr',
    group: '국토계획법 (용도지역)',
    title: '건폐율',
    what: '용도지역별 건폐율 — 법 상한 안에서 시·군 조례가 정한 값',
    values: b.lines,
    basis: [law('국토의 계획 및 이용에 관한 법률 시행령', '제84조', '국토계획법 시행령 제84조'), law('국토의 계획 및 이용에 관한 법률', '제84조', '국토계획법 제84조 (둘 이상 용도지역에 걸친 대지)'), law('건축법', '제55조'), ...ordin(urban, Object.values(urban?.bcr ?? {})[0]?.article)],
    unknown: b.unknown,
  })
  const f = limitLines(ctx, 'far')
  items.push({
    id: 'far',
    group: '국토계획법 (용도지역)',
    title: '용적률',
    what: '용도지역별 용적률 — 법 범위 안에서 시·군 조례가 정한 값 (지하층·주차 등 빼는 면적은 건축법 시행령 제119조)',
    values: f.lines,
    basis: [law('국토의 계획 및 이용에 관한 법률 시행령', '제85조', '국토계획법 시행령 제85조'), law('건축법', '제56조'), law('건축법 시행령', '제119조', '건축법 시행령 제119조 (면적 산정)'), ...ordin(urban, Object.values(urban?.far ?? {})[0]?.article)],
    unknown: f.unknown,
  })
  items.push({
    id: 'overlay',
    group: '국토계획법 (용도지역)',
    title: '용도지구·구역·지구단위계획',
    what: '경관·고도·방화지구, 지구단위계획구역 등이 걸치면 건폐율·용적률·높이·배치가 따로 정해짐 (지구단위계획이 우선)',
    values: ctx.overlays.length ? [`걸친 지구·구역: ${ctx.overlays.join(', ')}`, '각 지구·구역의 기준(결정도·시행지침) 확인 필요'] : ['수집 자료에서 걸친 지구·구역을 찾지 못함 — 토지이음에서 확인 필요'],
    basis: [law('국토의 계획 및 이용에 관한 법률', '제76조'), law('국토의 계획 및 이용에 관한 법률', '제54조', '국토계획법 제54조 (지구단위계획구역에서의 건축)'), ...ordin(urban, undefined)],
    unknown: true,
  })

  // ── 건축법
  const big = (ctx.gfa ?? 0) >= (isUse(ctx, '17') ? 3000 : 2000)
  items.push({
    id: 'road',
    group: '건축법 (대지·도로)',
    title: '대지와 도로의 관계 (접도)',
    what: '대지가 너비 4m 이상 도로에 2m 이상 접해야 함. 연면적 2,000㎡(공장 3,000㎡) 이상이면 너비 6m 이상 도로에 4m 이상',
    values: [ctx.gfa ? `연면적 ${fmt(ctx.gfa)}㎡ → ${big ? '너비 6m 이상 도로에 4m 이상 접해야 함' : '너비 4m 이상 도로에 2m 이상 접해야 함'}` : '연면적을 넣으면 어느 기준인지 보여 줌', '실제 도로 너비·접한 길이는 지적도·현장 확인 필요'],
    basis: [law('건축법', '제44조'), law('건축법 시행령', '제28조')],
    unknown: true,
  })
  items.push({
    id: 'line',
    group: '건축법 (대지·도로)',
    title: '건축선 (좁은 도로 후퇴)',
    what: '도로 너비가 4m에 못 미치면 도로 중심선에서 2m(맞은편이 하천 등이면 그쪽 경계에서 4m) 물러난 선이 건축선 — 그 안쪽은 대지 면적에서 빠짐',
    values: ['접한 도로 너비 확인 필요 (수집한 도로 자료는 대략 폭)'],
    basis: [law('건축법', '제46조'), law('건축법 시행령', '제31조')],
    unknown: true,
  })
  const sb = setbackLines(ctx)
  items.push({
    id: 'setback',
    group: '건축법 (배치·높이)',
    title: '대지 안의 공지 (건축선·인접 대지경계선에서 띄울 거리)',
    what: '용도·규모별로 건축선과 인접 대지경계선에서 띄울 거리 — 조례 별표',
    values: sb.lines,
    basis: [law('건축법', '제58조'), law('건축법 시행령', '제80조의2', '건축법 시행령 제80조의2 (별표 2)'), ...ordin(building, building?.setback?.article, building?.setback?.table)],
    ordinanceText: building?.setback?.tableText ? { label: `${building.name} ${building.setback.table ?? ''}`, text: building.setback.tableText, url: building.url } : undefined,
    unknown: sb.unknown,
  })
  if (residentialZone(ctx)) {
    items.push({
      id: 'north',
      group: '건축법 (배치·높이)',
      title: '정북 방향 일조 높이 제한',
      what: '전용·일반주거지역: 정북 방향 인접 대지경계선에서 높이 10m 이하 부분은 1.5m 이상, 10m 초과 17m 이하 부분은 5m 이상, 17m 넘는 부분은 그 높이의 1/2 이상 띄움 (건축법 제61조 ①, 2026-08-11 개정 — 조례로 더 띄울 수 있음, 도판 7에 반영). 정북 쪽 대지가 주거지역이 아니거나 20m 넘는 도로에 접한 지구단위계획구역 등은 예외(시행령 제86조 ②), 2층 이하·8m 이하는 조례로 빼 줄 수 있음(법 제61조 ④)',
      values: [`대지 용도지역: ${zonesText} → 대상`, building?.sunlight ? `조례 ${building.sunlight.article}(${building.sunlight.title})도 확인 — 정북 방향 도로·공원 등은 완화될 수 있음` : '조례의 일조 조문을 찾지 못함 — 원문 확인'],
      basis: [law('건축법', '제61조'), law('건축법 시행령', '제86조'), ...ordin(building, building?.sunlight?.article)],
      ordinanceText: building?.sunlight ? { label: `${building.name} ${building.sunlight.article}`, text: building.sunlight.text, url: building.url } : undefined,
    })
  }
  if (isUse(ctx, '2')) {
    items.push({
      id: 'apt-light',
      group: '건축법 (배치·높이)',
      title: '공동주택 채광 일조 (동 사이 거리·인접 대지)',
      what: '공동주택(일반·중심상업지역 제외)은 채광창 방향 인접 대지경계선 거리, 같은 대지 안 동 사이 거리를 높이에 맞춰 띄움',
      values: ['동 배치·높이가 정해지면 확인 필요'],
      basis: [law('건축법', '제61조'), law('건축법 시행령', '제86조')],
      unknown: true,
    })
  }
  items.push({
    id: 'height',
    group: '건축법 (배치·높이)',
    title: '건축물 높이 제한 (가로구역별 최고높이 등)',
    what: '허가권자가 가로구역마다 정한 최고높이, 고도·경관지구 높이 등이 있는지',
    values: [ctx.floors ? `계획 지상 ${ctx.floors}층${ctx.basement ? ` · 지하 ${ctx.basement}층` : ''}` : '층수를 넣으면 함께 보여 줌', '해당 지자체 고시·지구 기준 확인 필요'],
    basis: [law('건축법', '제60조'), ...ordin(urban, undefined, '경관·고도지구 높이')],
    unknown: true,
  })
  if (ctx.siteArea >= 200) {
    items.push({
      id: 'landscape',
      group: '건축법 (대지)',
      title: '대지의 조경',
      what: '대지 면적 200㎡ 이상이면 조례가 정한 조경 면적·식재 기준',
      values: [`대지 ${fmt(ctx.siteArea)}㎡ → 대상 (조례의 '대지 안의 조경' 조문에서 비율 확인)`],
      basis: [law('건축법', '제42조'), law('건축법 시행령', '제27조'), ...ordin(building, undefined, '대지 안의 조경')],
      unknown: true,
    })
  }
  // 공개공지: 일반주거·준주거·상업·준공업 + 해당 용도 + 바닥면적 합계 5,000㎡ 이상
  const ozone = ctx.zones.some((z) => z.rule && /일반주거|준주거|상업|준공업/.test(z.rule.label))
  // 판매시설 중 농수산물유통시설, 운수시설 중 여객용이 아닌 것은 빠짐 — 세부로 가리기 어려워 문구로 안내
  const ouse = isUse(ctx, '5', '6', '7', '8', '14', '15')
  if (ozone && ouse) {
    const need = (ctx.gfa ?? 0) >= 5000
    items.push({
      id: 'openspace',
      group: '건축법 (대지)',
      title: '공개공지 확보',
      what: '일반주거·준주거·상업·준공업지역에서 문화 및 집회, 종교, 판매(농수산물유통시설 제외), 운수(여객용만), 업무, 숙박 시설로 그 용도 바닥면적 합계 5,000㎡ 이상이면 대지 면적 10% 이하에서 조례가 정한 공개공지',
      values: [ctx.gfa ? `연면적 ${fmt(ctx.gfa)}㎡ → ${need ? '대상일 수 있음 (그 용도 바닥면적 합계로 확인)' : '5,000㎡ 미만 — 대상 아님일 수 있음'}` : '연면적을 넣으면 대상인지 보여 줌', `대지 ${fmt(ctx.siteArea)}㎡의 10% = ${fmt(ctx.siteArea * 0.1)}㎡ 이하 범위 — 조례 비율 확인`],
      basis: [law('건축법', '제43조'), law('건축법 시행령', '제27조의2'), ...ordin(building, undefined, '공개공지 등의 확보')],
      unknown: true,
    })
  }
  buildMore(ctx, items)
  return items
}

/** 묶음 E4: 주차 · 장애인 편의 · 피난·방화·설비 · 에너지 · 주변 보호구역 · 그 밖 */
function buildMore(ctx: CheckCtx, items: CheckItem[]): void {
  const c = useClass(ctx)
  const useName = useLabel(ctx.use)
  const gfa = ctx.gfa ?? 0
  const floors = ctx.floors ?? 0

  // ── 주차
  const park = useRows(ctx, '주차장법 시행령', 1)
  items.push({
    id: 'parking',
    group: '주차장법',
    title: '부설주차장 대수',
    what: '용도·시설면적에 따라 부설주차장 대수 — 주차장법 시행령 별표 1 기준을 시·군 주차장 조례로 강화할 수 있음',
    values: !ctx.use
      ? ['주용도를 고르면 별표 1에서 그 용도 줄을 보여 줌']
      : park.rows.length
        ? [`주차장법 시행령 별표 1에서 '${useName}'이 들어간 줄:`, ...park.rows, '시·군 주차장 조례의 강화 기준 확인 필요']
        : [ctx.table?.lawTables ? `별표 1에서 '${useName}' 줄을 찾지 못함 — 표 전체를 펼쳐 확인` : '주차장법 시행령 별표 1을 아직 받지 못함 — 원문 확인', '시·군 주차장 조례 확인 필요'],
    basis: [law('주차장법', '제19조'), law('주차장법 시행령', '제6조', '주차장법 시행령 제6조 (별표 1)')],
    ordinanceText: park.table ? { label: `주차장법 시행령 ${park.table.title}`, text: park.table.text, url: park.url ?? '' } : undefined,
    unknown: true,
  })

  // ── 장애인 편의
  const AC = '장애인ㆍ노인ㆍ임산부 등의 편의증진 보장에 관한 법률 시행령'
  const ac1 = useRows(ctx, AC, 1)
  const ac2 = useRows(ctx, AC, 2)
  items.push({
    id: 'access',
    group: '장애인 편의',
    title: '장애인·노인·임산부 편의시설',
    what: '대상 시설이면 주출입구 접근로·장애인 전용 주차구역·출입구·승강기·화장실 등 편의시설 (용도·규모별, 시행령 별표 1 대상 · 별표 2 종류와 기준)',
    values: !ctx.use
      ? ['주용도를 고르면 별표에서 그 용도 줄을 보여 줌']
      : ac1.rows.length || ac2.rows.length
        ? [`시행령 별표 1·2에서 '${useName}'이 들어간 줄:`, ...ac1.rows.slice(0, 5), ...ac2.rows.slice(0, 5)]
        : [ctx.table?.lawTables ? `별표에서 '${useName}' 줄을 찾지 못함 — 표 전체를 펼쳐 확인` : '편의증진법 시행령 별표를 아직 받지 못함 — 원문 확인'],
    basis: [
      law('장애인ㆍ노인ㆍ임산부 등의 편의증진 보장에 관한 법률', '제7조', '편의증진법 제7조'),
      { label: '편의증진법 시행령 (별표 1·2)', url: 'https://www.law.go.kr/법령/장애인ㆍ노인ㆍ임산부등의편의증진보장에관한법률시행령' },
    ],
    ordinanceText: ac2.table ? { label: `편의증진법 시행령 ${ac2.table.title}`, text: ac2.table.text, url: ac2.url ?? '' } : undefined,
    unknown: true,
  })

  // ── 피난·방화·설비 (다중이용 건축물: 건축법 시행령 제2조 제17호)
  const sub = ctx.use?.sub ?? ''
  const multiUse =
    (isUse(ctx, '5') && !/동·식물원/.test(sub)) || isUse(ctx, '6', '7', '8') || (isUse(ctx, '9') && /병원/.test(sub)) || (isUse(ctx, '15') && /관광숙박/.test(sub))
  const multi = (multiUse && gfa >= 5000) || floors >= 16
  items.push({
    id: 'multi',
    group: '피난·방화·설비',
    title: '다중이용 건축물 여부',
    what: '문화·집회(동·식물원 제외)·종교·판매·운수(여객용)·종합병원·관광숙박 용도 바닥면적 합계 5,000㎡ 이상이거나 16층 이상이면 다중이용 건축물 — 구조 안전·건축위원회 심의 등 기준이 더 붙음',
    values: [
      ctx.use || ctx.floors
        ? `${useName}${gfa ? ` · 연면적 ${fmt(gfa)}㎡` : ''}${floors ? ` · 지상 ${floors}층` : ''} → ${multi ? '해당할 수 있음 (그 용도 바닥면적 합계로 확인)' : '해당하지 않을 수 있음'}`
        : '용도·연면적·층수를 넣으면 보여 줌',
    ],
    basis: [law('건축법 시행령', '제2조', '건축법 시행령 제2조 제17호')],
    unknown: !ctx.use,
  })
  if (floors >= 6 && gfa >= 2000) {
    items.push({
      id: 'elevator',
      group: '피난·방화·설비',
      title: '승강기',
      what: '6층 이상으로 연면적 2,000㎡ 이상이면 승용 승강기, 높이 31m를 넘으면 비상용 승강기',
      values: [`지상 ${floors}층 · 연면적 ${fmt(gfa)}㎡ → 승용 승강기 대상`, '높이 31m 넘는지(층고에 따라) 확인 — 넘으면 비상용 승강기'],
      basis: [law('건축법', '제64조')],
    })
  }
  if (gfa > 1000) {
    items.push({
      id: 'fire-compartment',
      group: '피난·방화·설비',
      title: '방화구획',
      what: '주요구조부가 내화구조·불연재료인 연면적 1,000㎡ 넘는 건축물은 층·면적마다 방화구획 (자동식 소화설비가 있으면 면적 완화)',
      values: [`연면적 ${fmt(gfa)}㎡ → 대상 — 층마다·면적마다 구획 계획 확인 필요`],
      basis: [law('건축법', '제49조'), law('건축법 시행령', '제46조')],
      unknown: true,
    })
  }
  items.push({
    id: 'egress',
    group: '피난·방화·설비',
    title: '직통계단·피난계단',
    what: '거실 각 부분에서 직통계단까지 보행거리, 5층 이상·지하 2층 이하는 피난계단·특별피난계단 — 용도·규모에 따라 다름',
    values: [
      floors >= 5 || (ctx.basement ?? 0) >= 2
        ? `지상 ${floors}층${ctx.basement ? ` · 지하 ${ctx.basement}층` : ''} → 피난계단·특별피난계단 검토 대상`
        : floors
          ? `지상 ${floors}층 — 직통계단 보행거리 확인`
          : '층수를 넣으면 보여 줌',
    ],
    basis: [law('건축법', '제49조'), law('건축법 시행령', '제34조'), law('건축법 시행령', '제35조')],
    unknown: true,
  })
  items.push({
    id: 'fire-system',
    group: '피난·방화·설비',
    title: '소방시설 (소화·경보·피난 설비)',
    what: '용도·연면적·층수에 따라 스프링클러·자동화재탐지설비 등 설치 대상 — 소방시설법 시행령 별표',
    values: ['용도·규모가 정해지면 소방 설계 기준 확인 필요'],
    basis: [{ label: '소방시설 설치 및 관리에 관한 법률 시행령 (별표 4)', url: 'https://www.law.go.kr/법령/소방시설설치및관리에관한법률시행령' }],
    unknown: true,
  })

  // ── 에너지·친환경
  items.push({
    id: 'energy',
    group: '에너지·친환경',
    title: '에너지절약계획서·친환경 인증',
    what: '연면적 합계 500㎡ 이상이면 에너지절약계획서 제출 — 규모·용도(공공·공동주택 등)에 따라 녹색건축·제로에너지건축물 인증이 더 붙을 수 있음',
    values: [gfa ? `연면적 ${fmt(gfa)}㎡ → ${gfa >= 500 ? '에너지절약계획서 대상' : '500㎡ 미만 — 대상 아님일 수 있음'}` : '연면적을 넣으면 보여 줌', '인증 의무 대상(공공·규모)은 확인 필요'],
    basis: [law('녹색건축물 조성 지원법', '제14조'), law('녹색건축물 조성 지원법 시행령', '제10조')],
    unknown: !gfa,
  })

  // ── 주변 보호구역
  const near = (ctx.schools ?? []).filter((x) => x.dist <= 200)
  items.push({
    id: 'school-zone',
    group: '주변 보호구역',
    title: '교육환경보호구역 (학교 둘레 200m)',
    what: '학교 경계에서 200m 안(출입문에서 50m 안은 절대보호구역)에서는 금지되는 행위·시설이 있음 — 고른 용도가 해당하는지',
    values: near.length
      ? [`대지에서 200m 안 학교·유치원 등 ${near.length}곳 (위치 점 기준 어림): ${near.slice(0, 5).map((x) => `${x.name} 약 ${Math.round(x.dist)}m`).join(', ')}`, `${useName}이 금지 시설에 해당하는지 확인 필요`]
      : [(ctx.schools ?? []).length ? '200m 안에 수집된 학교가 없음 (위치 점 기준 — 학교 경계로는 확인 필요)' : '수집한 생활 시설 자료가 없어 확인 필요'],
    basis: [law('교육환경 보호에 관한 법률', '제8조'), law('교육환경 보호에 관한 법률', '제9조')],
    unknown: true,
  })
  const heritage = ctx.overlays.filter((n) => /문화재|문화유산|국가유산|역사문화환경/.test(n))
  items.push({
    id: 'heritage',
    group: '주변 보호구역',
    title: '역사문화환경 보존지역 (문화유산 둘레)',
    what: '지정문화유산 둘레(외곽에서 500m 안에서 시·도 조례로 정한 범위)에서 건설공사를 하면 문화유산 영향 검토·허가가 필요할 수 있음',
    values: heritage.length ? [`대지에 걸친 구역: ${heritage.join(', ')}`, '허용기준 확인 필요'] : ['수집 자료에서 문화유산 관련 구역을 찾지 못함 — 국가유산 공간정보에서 확인 필요'],
    basis: [law('문화유산의 보존 및 활용에 관한 법률', '제13조')],
    unknown: true,
  })

  // ── 그 밖
  if (gfa >= 10000) {
    items.push({
      id: 'art',
      group: '그 밖',
      title: '건축물 미술작품',
      what: '연면적 10,000㎡ 이상인 건축물(용도별 대상은 시행령)은 건축비용의 일정 비율로 미술작품을 설치하거나 기금에 출연',
      values: [`연면적 ${fmt(gfa)}㎡ → ${c ? `${c.name} 용도가 대상인지 확인` : '대상일 수 있음'}`],
      basis: [law('문화예술진흥법', '제9조'), law('문화예술진흥법 시행령', '제12조')],
      unknown: true,
    })
  }
}

/** 체크리스트 전체 상태 요약 */
export function checklistSummary(items: CheckItem[], status: Record<string, CheckStatus | undefined>): { ok: number; na: number; todo: number } {
  let ok = 0
  let na = 0
  let todo = 0
  for (const it of items) {
    const s = status[it.id] ?? 'todo'
    if (s === 'ok') ok++
    else if (s === 'na') na++
    else todo++
  }
  return { ok, na, todo }
}
