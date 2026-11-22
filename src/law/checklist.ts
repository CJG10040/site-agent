// 법규 검토서 (2026-11-21 묶음 F1 — E3·E4 체크리스트를 다시 씀): 앱이 항목마다 판정하고, 학생은 가볍게 재확인한다.
// 줄마다 항목 · 기준(쉬운 말 한 줄) · 이 계획(앱이 낸 값) · 판정 · 가정 · (정말 모를 때만) 직접 확인 · 근거 링크 · 원문(접기).
// 사용자 결정(2026-11-21, ⑪을 써 본 뒤): 법규 검토서 한 표 / 모르는 값은 가정하고 판정 + 가정 표시 / 법 기준은 앱 규칙 + 법 바뀌면 경고 /
// 매스 항목 먼저 / 설계안 점검은 안 함. 참고용 — 법적 판정이 아님.
// 법 기준 숫자는 여기 코드에 두고, 만들 때 받아 둔 조문 글(조례 표의 laws)로 확인함.

import type { ZoneRule } from '../diagrams/panelsLaw'
import type { EnvelopeRun } from './envelopeData'
import { lawArticleUrl, type OrdinanceTable, type RegionTable } from './ordinances'
import { round1, type Plan } from './plan'
import { changedRefs } from './ruleRefs'
import { judgeZoneUse, zoneOfTitle } from './zoneUse'
import { readLandscape, readOpenSpace, readParking, readParkingApt } from './ordinanceRules'

export type CheckStatus = 'todo' | 'ok' | 'na'

export interface Basis {
  label: string
  url: string
  /** 받아 둔 조문 글 (법령: '건축법'·'건축법 시행령'… / 조문: '제58조') */
  law?: string
  article?: string
}

/** 판정 칸 — tone: ok = 가능·해당 없음·충족, need = 대상·적용(지켜야 함), warn = 불가·부족·초과, limit = 한도 숫자, check = 직접 확인 */
export interface Verdict {
  label: string
  tone: 'ok' | 'need' | 'warn' | 'limit' | 'check'
}

export interface ReviewRow {
  id: string
  group: string
  item: string
  /** 기준 한 줄 (쉬운 말) */
  rule: string
  /** 이 계획에 대한 앱의 답 (숫자·결과) */
  result: string
  verdict: Verdict
  /** 앱이 가정한 것 (이 줄에만 해당하는 것) */
  assumed?: string[]
  /** 이 줄 판정에 쓴 계획 값 — 넣지 않아 가정한 값이면 화면이 '가정한 계획 값' 한 줄로 알림 */
  uses?: PlanKey[]
  /** 정말 판정 못 할 때만: 어디서 무엇을 보면 되는지 */
  check?: string
  /** 근거 줄 (조례 별표의 그 줄 등, 짧게) */
  cite?: string
  basis: Basis[]
  /** 원문 (접어 둠) */
  source?: { label: string; text: string; url: string }
  /** '법 바뀜' (묶음 F3): 규칙을 만든 뒤 글이 바뀐 조문·별표 */
  changed?: string[]
  /** 지문 묶음 이름이 줄 id와 다를 때 (용도지역 줄은 'zone-use:별표번호') */
  refId?: string
}

export type PlanKey = 'gfa' | 'floors' | 'basement' | 'units'

export interface ReviewCtx {
  zones: { name: string; share: number; rule: ZoneRule | null }[]
  siteArea: number
  overlays: string[]
  plan: Plan
  table: OrdinanceTable | null
  region: RegionTable | null
  /** 건축 가능 영역 계산 (도로에 접한 변·좁은 도로·정북 일조) */
  env: (EnvelopeRun & { edgesValid: boolean }) | null
  /** 층고 (가능 영역 입력, 기본 3.5m) */
  floorH: number
  /** 넣은 최고 높이 */
  maxHeight?: number
  /** 대지 둘레 학교·유치원 등과 거리(m, 점 기준) */
  schools?: { name: string; kind: string; dist: number }[]
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

const law = (name: string, article: string, label?: string): Basis => ({ label: label ?? `${name} ${article}`, url: lawArticleUrl(name, article), law: name, article })
const ordin = (o: { name: string; url: string } | undefined, what?: string): Basis[] => (o ? [{ label: `${o.name}${what ? ` ${what}` : ''}`, url: o.url }] : [])

const zoneLabel = (z: ReviewCtx['zones'][number]) => z.rule?.label ?? z.name
const isUse = (p: Plan, ...nos: string[]) => !!p.use && nos.includes(p.use.no)
const sub = (p: Plan) => p.use?.sub ?? ''
const residential = (c: ReviewCtx) => c.zones.some((z) => z.rule && /전용주거|일반주거/.test(z.rule.label))
const push = (a: string[], ...xs: (string | undefined | false)[]) => {
  for (const x of xs) if (x && !a.includes(x)) a.push(x)
}

/** 법규 검토서 줄 (해당하는 것만, 판정 포함) */
export function buildReview(c: ReviewCtx): ReviewRow[] {
  const rows: ReviewRow[] = []
  const p = c.plan
  const reg = c.region
  const urban = reg?.urban
  const building = reg?.building
  const zonesText = c.zones.length ? c.zones.map((z) => `${zoneLabel(z)}${c.zones.length > 1 ? ` ${Math.round(z.share * 100)}%` : ''}`).join(', ') : '모름'
  const gfa = p.gfa?.v ?? 0
  const floors = p.floors?.v ?? 0

  // ───────── 국토계획법 (용도지역)
  rows.push(zoneUseRow(c, zonesText))

  for (const kind of ['bcr', 'far'] as const) {
    const lim = kind === 'bcr' ? p.bcr : p.far
    const name = kind === 'bcr' ? '건폐율' : '용적률'
    const what = kind === 'bcr' ? '건축면적' : '지상 연면적'
    if (!lim) {
      rows.push({
        id: kind,
        group: '용도지역',
        item: name,
        rule: '용도지역별로 법 범위 안에서 시·군 조례가 정함',
        result: '대지의 용도지역 자료가 없음',
        verdict: { label: '직접 확인', tone: 'check' },
        check: '④에서 공간정보(규제·계획)를 수집하면 자동으로',
        basis: [law('국토의 계획 및 이용에 관한 법률 시행령', kind === 'bcr' ? '제84조' : '제85조')],
      })
      continue
    }
    const max = (c.siteArea * lim.pct) / 100
    const assumed: string[] = []
    const lawOnly = lim.zones.filter((z) => !z.fromOrdinance)
    if (lawOnly.length) push(assumed, `${lawOnly.map((z) => z.zone).join('·')}의 조례 값을 못 읽어 법 상한으로 봄`)
    if (lim.zones.length > 1) push(assumed, '용도지역이 둘 이상이라 면적 비율로 나눈 평균 (가장 작은 부분이 330㎡를 넘으면 부분마다 따로 — 국토계획법 제84조)')
    let verdict: Verdict = { label: '한도', tone: 'limit' }
    let result = `${what} ${fmt(max)}㎡ 이하`
    if (kind === 'far' && p.gfa && !p.gfa.assumed) {
      const used = (p.gfa.v / c.siteArea) * 100
      result = `연면적 ${fmt(p.gfa.v)}㎡ → ${round1(used)}% (한도 ${fmt(max)}㎡)`
      verdict = used <= lim.pct + 1e-6 ? { label: '충족', tone: 'ok' } : { label: '초과', tone: 'warn' }
    }
    rows.push({
      id: kind,
      group: '용도지역',
      item: name,
      rule: lim.zones.map((z) => `${z.zone} ${round1(z.pct)}% 이하${z.fromOrdinance ? '' : ' (법 상한)'}`).join(' · '),
      result,
      verdict,
      assumed,
      cite: lim.zones.filter((z) => z.fromOrdinance).length ? `${urban?.name ?? '도시계획 조례'} ${[...new Set(lim.zones.map((z) => z.article).filter(Boolean))].join('·')}` : undefined,
      basis: [
        law('국토의 계획 및 이용에 관한 법률 시행령', kind === 'bcr' ? '제84조' : '제85조', `국토계획법 시행령 ${kind === 'bcr' ? '제84조' : '제85조'}`),
        law('건축법', kind === 'bcr' ? '제55조' : '제56조'),
        ...(kind === 'far' ? [law('건축법 시행령', '제119조', '건축법 시행령 제119조 (지하층·주차 등 빼는 면적)')] : []),
        ...ordin(urban),
      ],
    })
  }

  // 지구·구역
  const unit = c.overlays.filter((n) => /지구단위계획/.test(n))
  if (unit.length)
    rows.push({
      id: 'district-plan',
      group: '용도지역',
      item: '지구단위계획',
      rule: '지구단위계획구역은 결정된 계획(건폐율·용적률·높이·배치·건축한계선 등)이 우선',
      result: `대지가 ${unit[0]}에 걸침`,
      verdict: { label: '직접 확인', tone: 'check' },
      check: "토지이음(eum.go.kr) → 이 필지 → '지구단위계획' 결정도·시행지침에서 이 획지의 건폐율·용적률·최고높이·건축한계선 (이 값은 공개 자료로 내려받을 수 없음)",
      basis: [law('국토의 계획 및 이용에 관한 법률', '제54조', '국토계획법 제54조')],
    })
  const fire = c.overlays.filter((n) => /방화지구/.test(n))
  if (fire.length)
    rows.push({
      id: 'fire-district',
      group: '용도지역',
      item: '방화지구',
      rule: '방화지구 안 건축물은 주요구조부와 외벽을 내화구조로 (연면적 30㎡ 미만 부속건축물 등 예외)',
      result: '대지가 방화지구에 걸침',
      verdict: { label: '적용', tone: 'need' },
      basis: [law('건축법', '제51조')],
    })
  const scenic = c.overlays.filter((n) => /경관지구|고도지구/.test(n))
  const height: string[] = []
  if (scenic.length) push(height, `${scenic.join(', ')} — 조례로 높이·층수를 정했을 수 있음`)

  // ───────── 건축법 (대지·도로·배치)
  const env = c.env
  const r = env?.result ?? null
  const roadEdges = r ? r.edges.filter((e) => e.kind === 'road') : []
  const contact = roadEdges.reduce((s, e) => s + Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]), 0)
  const widths = roadEdges.map((e) => e.roadWidth).filter((w): w is number => w !== null)
  const maxW = widths.length ? Math.max(...widths) : null
  const big = gfa >= (isUse(p, '17') ? 3000 : 2000)
  const needW = big ? 6 : 4
  const needL = big ? 4 : 2
  {
    const assumed: string[] = []
    push(assumed, '도로에 접한 변은 앱이 도로 자료로 찾음 (아래 평면도에서 변을 눌러 고침)', maxW !== null ? '도로 너비는 도로 자료의 대략 값' : '도로 너비를 몰라 4m 이상으로 봄')
    const w = maxW ?? 4
    const ok = roadEdges.length > 0 && w >= needW && contact >= needL
    // 공동주택 진입도로 (주택건설기준 등에 관한 규정 제25조 ①)
    let extra = ''
    if (p.units && isUse(p, '2')) {
      const n = p.units.v
      const needEntry = n < 300 ? 6 : n < 500 ? 8 : n < 1000 ? 12 : n < 2000 ? 15 : 20
      extra = ` · ${fmt(n)}세대 → 진입도로 ${needEntry}m 이상 (주택건설기준 제25조)${maxW !== null ? (maxW >= needEntry ? ' 충족으로 보임' : ' — 부족할 수 있음') : ''}`
    }
    rows.push({
      id: 'road',
      group: '대지·도로',
      item: '접도 (대지와 도로)',
      rule: `대지가 너비 4m 이상 도로에 2m 이상 접함 · 연면적 2,000㎡(공장 3,000㎡) 이상이면 6m 이상 도로에 4m 이상`,
      result: r
        ? roadEdges.length
          ? `도로에 접한 길이 약 ${fmt(contact)}m · 가장 넓은 도로 ${maxW !== null ? `약 ${fmt(maxW, 1)}m` : '너비 모름'} → 기준 ${needW}m 도로에 ${needL}m${extra}`
          : '도로에 접한 변을 찾지 못함 (아래 평면도에서 도로 쪽 변을 누르세요)'
        : '대지 경계·도로 자료가 없음',
      verdict: !r ? { label: '직접 확인', tone: 'check' } : ok ? { label: '충족', tone: 'ok' } : { label: '부족', tone: 'warn' },
      check: !r ? '③ 대지 경계를 정하고 공간정보를 수집하면 자동으로' : undefined,
      assumed,
      uses: ['gfa', 'units'],
      basis: [law('건축법', '제44조'), law('건축법 시행령', '제28조'), ...(isUse(p, '2') ? [{ label: '주택건설기준 등에 관한 규정 제25조', url: lawArticleUrl('주택건설기준등에관한규정', '제25조') }] : [])],
    })
  }
  {
    const narrow = r?.narrowRoads ?? 0
    const unknown = r?.unknownWidthRoads ?? 0
    const corner = roadEdges.length >= 2 && widths.some((w) => w < 8)
    const assumed: string[] = []
    if (unknown) push(assumed, `너비를 모르는 도로 ${unknown}곳은 4m 이상으로 봄`)
    if (corner) push(assumed, '너비 8m 미만 도로 모퉁이의 가각 건축선(시행령 제31조)은 가능 영역에 넣지 않음')
    rows.push({
      id: 'line',
      group: '대지·도로',
      item: '건축선 (좁은 도로)',
      rule: '도로 너비가 4m에 못 미치면 중심선에서 2m 물러난 선이 건축선 — 그 사이는 대지 면적에서 빠짐',
      result: !r ? '대지·도로 자료가 없음' : narrow ? `4m 미만 도로에 접한 변 ${narrow}곳 → 건축선을 물려 가능 영역에 반영` : '4m 미만 도로에 접한 변 없음 → 대지 경계가 건축선',
      verdict: !r ? { label: '직접 확인', tone: 'check' } : narrow ? { label: '적용', tone: 'need' } : { label: '해당 없음', tone: 'ok' },
      check: !r ? '③ 대지 경계를 정하고 공간정보를 수집하면 자동으로' : undefined,
      assumed,
      basis: [law('건축법', '제46조'), law('건축법 시행령', '제31조')],
    })
  }
  {
    const a = env?.auto
    const used = env?.used
    const assumed: string[] = []
    if (a) push(assumed, ...a.assumed)
    if (a?.source === 'ordinance') push(assumed, '그 용도로 쓰는 바닥면적을 연면적 전부로 봄')
    const cite = [a?.roadPick ? `건축선: ${a.roadPick.line}` : '', a?.sidePick ? `인접: ${a.sidePick.line}` : ''].filter(Boolean).join(' / ')
    const overridden = used && (used.roadFrom === 'input' || used.sideFrom === 'input')
    rows.push({
      id: 'setback',
      group: '대지·도로',
      item: '대지 안의 공지',
      rule: '용도·규모·지역에 따라 건축선과 인접 대지경계선에서 조례가 정한 거리 이상 띄움 (6m 이내)',
      result: a
        ? `건축선에서 ${a.road}m · 인접 대지경계선에서 ${a.side}m${a.road === 0 && a.side === 0 ? ' (조례가 이 용도·규모에 정하지 않음)' : ''}${overridden ? ` — 가능 영역은 넣은 값(${used!.road}m · ${used!.side}m)으로 계산` : ' → 가능 영역에 반영'}`
        : '조례 표를 아직 못 받음',
      verdict: a ? (a.road || a.side ? { label: '적용', tone: 'need' } : { label: '해당 없음', tone: 'ok' }) : { label: '직접 확인', tone: 'check' },
      check: a ? undefined : '사이트 배포 때 받는 조례 표가 없음 — 잠시 뒤 다시 열기',
      assumed,
      cite: cite || undefined,
      uses: ['gfa', 'floors'],
      basis: [law('건축법', '제58조'), law('건축법 시행령', '제80조의2', '건축법 시행령 제80조의2 (별표 2)'), ...ordin(building, building?.setback?.table)],
      source: building?.setback?.tableText ? { label: `${building.name} ${building.setback.table ?? ''}`, text: building.setback.tableText, url: building.url } : undefined,
    })
  }
  if (residential(c)) {
    const assumed: string[] = []
    if (r?.sunUnknownNeighbor) push(assumed, '북쪽 대지의 용도지역을 자료로 알 수 없는 곳은 주거지역으로 봄')
    if (isUse(p, '2')) push(assumed, '공동주택이라 북쪽 도로·공원은 가운데 선부터 잼')
    rows.push({
      id: 'north',
      group: '배치·높이',
      item: '정북 일조',
      rule: '정북 인접 대지경계선에서 높이 10m 이하 부분 1.5m · 10~17m 부분 5m · 17m 넘는 부분은 높이의 1/2 이상 띄움 (북쪽이 도로·공원이면 그 반대편부터, 북쪽 대지가 주거지역이 아니면 적용 안 함)',
      result: r
        ? `가능 영역에 반영 — 가장 높은 곳 ${fmt(r.maxHeight, 1)}m${r.sunExemptCells ? ' · 북쪽이 주거지역 아닌 곳은 빼 줌' : ''}`
        : '아래 건축 가능 영역에서 계산',
      verdict: { label: '적용', tone: 'need' },
      assumed,
      cite: building?.sunlight ? `${building.name} ${building.sunlight.article}(${building.sunlight.title})` : undefined,
      basis: [law('건축법', '제61조'), law('건축법 시행령', '제86조'), ...ordin(building, building?.sunlight?.article)],
      source: building?.sunlight ? { label: `${building.name} ${building.sunlight.article}`, text: building.sunlight.text, url: building.url } : undefined,
    })
  } else {
    rows.push({
      id: 'north',
      group: '배치·높이',
      item: '정북 일조',
      rule: '전용·일반주거지역 안의 건축물만',
      result: `대지가 ${zonesText} — 주거지역이 아님`,
      verdict: { label: '해당 없음', tone: 'ok' },
      basis: [law('건축법', '제61조')],
    })
  }
  if (isUse(p, '2') && !/기숙사/.test(sub(p))) {
    const near = c.zones.some((z) => /근린상업|준주거/.test(zoneLabel(z)))
    rows.push({
      id: 'apt-light',
      group: '배치·높이',
      item: '공동주택 채광·동 사이 거리',
      rule: `건물 각 부분 높이 ≤ 채광창 쪽 인접 대지경계선까지 거리의 ${near ? 4 : 2}배 · 마주 보는 동은 높이의 0.5배 이상(조례), 측벽끼리 4m · 창 없는 벽과 측벽 8m`,
      result: `배치할 때 적용 — 예: 높이 ${fmt(floors * c.floorH || 30)}m 동이면 채광 방향 인접 대지경계선에서 ${fmt((floors * c.floorH || 30) / (near ? 4 : 2), 1)}m 이상`,
      verdict: { label: '대상', tone: 'need' },
      assumed: floors ? [`높이 = 층수 ${floors} × 층고 ${c.floorH}m`] : ['층수를 몰라 높이 30m로 예를 듦'],
      uses: ['floors'],
      basis: [law('건축법', '제61조'), law('건축법 시행령', '제86조', '건축법 시행령 제86조 ③')],
    })
  }
  {
    const assumed: string[] = []
    let verdict: Verdict
    let result: string
    if (c.maxHeight) {
      verdict = { label: '적용', tone: 'need' }
      result = `넣은 최고 높이 ${fmt(c.maxHeight)}m → 가능 영역에 반영`
    } else if (height.length || unit.length) {
      verdict = { label: '직접 확인', tone: 'check' }
      result = [...height, ...(unit.length ? ['지구단위계획의 최고높이'] : [])].join(' · ')
    } else {
      verdict = { label: '해당 없음', tone: 'ok' }
      result = '대지에 걸친 높이 지구(고도·경관지구)·지구단위계획 없음'
      push(assumed, '가로구역별 최고높이(건축법 제60조)는 지정되지 않은 것으로 봄 — 지정 여부는 공개 자료로 확인 못 함')
    }
    rows.push({
      id: 'height',
      group: '배치·높이',
      item: '높이 제한',
      rule: '고도·경관지구, 지구단위계획, 가로구역별 최고높이가 있으면 그 높이 이하',
      result,
      verdict,
      assumed,
      check: verdict.tone === 'check' ? "토지이음 → 이 필지 → 지구·지구단위계획 결정도의 최고높이를 아래 '최고 높이' 칸에 넣으면 가능 영역에 반영" : undefined,
      basis: [law('건축법', '제60조'), ...ordin(urban, '(경관·고도지구 높이)')],
    })
  }

  // ───────── 대지 (조경·공개공지)
  if (c.siteArea >= 200) {
    const green = c.zones.every((z) => /녹지지역/.test(zoneLabel(z)))
    const factory = isUse(p, '17') && (c.siteArea < 5000 || gfa < 1500)
    if (green || factory) {
      rows.push({
        id: 'landscape',
        group: '대지',
        item: '조경',
        rule: '대지 200㎡ 이상은 조례 기준만큼 조경 — 녹지지역, 작은 공장 등은 빼 줌',
        result: green ? '녹지지역 — 조경 의무 없음' : '대지 5천㎡ 미만 또는 연면적 1,500㎡ 미만 공장 — 조경 의무 없음',
        verdict: { label: '해당 없음', tone: 'ok' },
        uses: factory ? ['gfa'] : [],
        basis: [law('건축법', '제42조'), law('건축법 시행령', '제27조')],
      })
    } else {
      // 묶음 F2: 이 지역 건축 조례의 조경 조문을 읽음 — 못 읽으면 흔한 조례 기준을 가정
      const lr = readLandscape(building?.landscape, { gfa, siteArea: c.siteArea, zone: c.zones[0] ? zoneLabel(c.zones[0]) : '' })
      const art = building?.landscape?.articles[0]
      const src = art && building ? { label: `${building.name} ${art.article}(${art.title})`, text: art.text, url: building.url } : undefined
      if (lr?.exempt) {
        rows.push({
          id: 'landscape',
          group: '대지',
          item: '조경',
          rule: '대지 200㎡ 이상은 조례가 정한 면적 이상 조경 — 조례가 빼 주는 건축물이 있음',
          result: `조례가 빼 주는 경우 — 조경 의무 없음`,
          verdict: { label: '해당 없음', tone: 'ok' },
          cite: `${building?.name ?? '건축 조례'} ${lr.article}: ${lr.exempt}`,
          basis: [law('건축법', '제42조'), law('건축법 시행령', '제27조'), ...ordin(building, '(대지 안의 조경)')],
          source: src,
        })
      } else {
        const ratio = lr?.pct ?? (gfa >= 2000 ? 15 : gfa >= 1000 ? 10 : 5)
        rows.push({
          id: 'landscape',
          group: '대지',
          item: '조경',
          rule: '대지 200㎡ 이상은 용도지역·규모에 따라 조례가 정한 면적 이상 조경',
          result: `조경 면적 약 ${fmt((c.siteArea * ratio) / 100)}㎡ 이상 (대지의 ${ratio}%)`,
          verdict: { label: '대상', tone: 'need' },
          assumed: lr ? [] : ['이 지역 조례의 조경 조문을 읽지 못해 흔한 조례 기준(연면적 2천㎡ 이상 15% · 1천~2천㎡ 10% · 그 아래 5%)으로 봄'],
          cite: lr ? `${building?.name ?? '건축 조례'} ${lr.article}: ${lr.line}` : undefined,
          uses: ['gfa'],
          basis: [law('건축법', '제42조'), law('건축법 시행령', '제27조'), ...ordin(building, '(대지 안의 조경)')],
          source: src,
        })
      }
    }
  }
  {
    const zoneOk = c.zones.some((z) => /일반주거|준주거|상업|준공업/.test(zoneLabel(z)))
    const lawUse = isUse(p, '5', '6', '7', '8', '14', '15') && !/농수산물/.test(sub(p))
    // 묶음 F2: 조례가 더한 대상 용도(시행령 제27조의2 ① 2호)와 비율을 이 지역 건축 조례에서 읽음
    const or = readOpenSpace(building?.openSpace, { useNo: p.use?.no ?? null, gfa, lawTarget: lawUse })
    const ordUse = !lawUse && !!or?.ordinanceTarget
    const useOk = lawUse || ordUse
    const minGfa = ordUse ? (or?.minGfa ?? 5000) : 5000
    const need = zoneOk && useOk && gfa >= minGfa
    const ratio = or?.pct ?? (gfa >= 30000 ? 10 : gfa >= 10000 ? 7 : 5)
    const art = building?.openSpace?.articles[0]
    rows.push({
      id: 'openspace',
      group: '대지',
      item: '공개공지',
      rule: '일반주거·준주거·상업·준공업지역에서 문화·집회, 종교, 판매, 운수(여객), 업무, 숙박 시설(+ 조례가 더한 용도)로 그 바닥면적 5,000㎡ 이상이면 대지의 10% 이하에서 조례가 정한 공개공지',
      result: need
        ? `공개공지 약 ${fmt((c.siteArea * ratio) / 100)}㎡ 이상 (대지의 ${ratio}%)${ordUse ? ' — 조례가 더한 대상 용도' : ''} — 설치하면 건폐율·용적률·높이 완화 가능`
        : !zoneOk
          ? '대지가 대상 용도지역이 아님'
          : !useOk
            ? `${p.useName} — 법과 조례의 대상 용도가 아님`
            : `그 용도 바닥면적 ${fmt(gfa)}㎡ — ${fmt(minGfa)}㎡ 미만`,
      verdict: need ? { label: '대상', tone: 'need' } : { label: '해당 없음', tone: 'ok' },
      assumed: [
        ...(need && or?.pct == null ? ['이 지역 조례의 공개공지 비율을 읽지 못해 흔한 조례 기준(5천㎡ 이상 5% · 1만㎡ 이상 7% · 3만㎡ 이상 10%)으로 봄'] : []),
        ...(zoneOk && useOk ? ['그 용도 바닥면적을 연면적 전부로 봄'] : []),
      ],
      cite: or?.line ? `${building?.name ?? '건축 조례'} ${or.article}: ${or.line}` : undefined,
      uses: zoneOk && useOk ? ['gfa'] : [],
      basis: [law('건축법', '제43조'), law('건축법 시행령', '제27조의2'), ...ordin(building, '(공개공지 등의 확보)')],
      source: art && building ? { label: `${building.name} ${art.article}(${art.title})`, text: art.text, url: building.url } : undefined,
    })
  }

  // ───────── 주차
  rows.push(parkingRow(c))

  // ───────── 피난·설비
  {
    const multiUse = (isUse(p, '5') && !/동·식물원/.test(sub(p))) || isUse(p, '6', '7', '8') || (isUse(p, '9') && /병원/.test(sub(p))) || (isUse(p, '15') && /관광숙박/.test(sub(p)))
    const multi = (multiUse && gfa >= 5000) || floors >= 16
    rows.push({
      id: 'multi',
      group: '피난·설비',
      item: '다중이용 건축물',
      rule: '문화·집회(동·식물원 제외)·종교·판매·운수(여객)·종합병원·관광숙박 용도 바닥면적 5,000㎡ 이상, 또는 16층 이상',
      result: multi ? (floors >= 16 ? `지상 ${floors}층 — 16층 이상` : `${p.useName} ${fmt(gfa)}㎡ — 5,000㎡ 이상`) : `${p.useName}${gfa ? ` · ${fmt(gfa)}㎡` : ''}${floors ? ` · ${floors}층` : ''} — 기준에 못 미침`,
      verdict: multi ? { label: '해당', tone: 'need' } : { label: '해당 없음', tone: 'ok' },
      uses: ['gfa', 'floors'],
      basis: [law('건축법 시행령', '제2조', '건축법 시행령 제2조 제17호')],
    })
  }
  {
    const hgt = floors * c.floorH
    const lift = floors >= 6 && gfa >= 2000
    rows.push({
      id: 'elevator',
      group: '피난·설비',
      item: '승강기',
      rule: '6층 이상 · 연면적 2,000㎡ 이상이면 승용 승강기, 높이 31m를 넘으면 비상용 승강기도',
      result: lift ? `${floors}층 · ${fmt(gfa)}㎡ → 승용 승강기${hgt > 31 ? ` · 높이 약 ${fmt(hgt)}m → 비상용 승강기` : ''}` : `${floors || '?'}층 · ${fmt(gfa)}㎡ — 기준에 못 미침`,
      verdict: lift ? { label: hgt > 31 ? '대상 (비상용 포함)' : '대상', tone: 'need' } : { label: '해당 없음', tone: 'ok' },
      assumed: lift ? [`높이 = 층수 × 층고 ${c.floorH}m`] : [],
      uses: ['gfa', 'floors'],
      basis: [law('건축법', '제64조')],
    })
  }
  rows.push({
    id: 'fire-compartment',
    group: '피난·설비',
    item: '방화구획',
    rule: '주요구조부가 내화구조·불연재료이고 연면적 1,000㎡를 넘으면 층·면적마다 방화구획',
    result: gfa > 1000 ? `연면적 ${fmt(gfa)}㎡ → 층마다 · 바닥면적 1,000㎡(스프링클러 있으면 3,000㎡)마다 구획` : `연면적 ${fmt(gfa)}㎡ — 1,000㎡ 이하`,
    verdict: gfa > 1000 ? { label: '대상', tone: 'need' } : { label: '해당 없음', tone: 'ok' },
    assumed: gfa > 1000 ? ['주요구조부를 내화구조로 봄'] : [],
    uses: ['gfa'],
    basis: [law('건축법', '제49조'), law('건축법 시행령', '제46조')],
  })
  {
    const bsm = p.basement.v
    const special = floors >= (isUse(p, '2') ? 16 : 11) || bsm >= 3
    const stair = floors >= 5 || bsm >= 2
    rows.push({
      id: 'egress',
      group: '피난·설비',
      item: '직통계단·피난계단',
      rule: '거실에서 직통계단까지 보행거리 30m(내화구조 50m) 이하 · 5층 이상·지하 2층 이하는 피난계단 · 11층(공동주택 16층) 이상·지하 3층 이하는 특별피난계단',
      result: special ? '특별피난계단 대상' : stair ? '피난계단(또는 특별피난계단) 대상' : '직통계단 보행거리만',
      verdict: special || stair ? { label: '대상', tone: 'need' } : { label: '해당 없음', tone: 'ok' },
      uses: ['floors', 'basement'],
      basis: [law('건축법', '제49조'), law('건축법 시행령', '제34조'), law('건축법 시행령', '제35조')],
    })
  }
  rows.push({
    id: 'sprinkler',
    group: '피난·설비',
    item: '스프링클러',
    rule: '6층 이상 건축물은 모든 층 (그 밖에 용도·면적별 기준)',
    result: floors >= 6 ? `지상 ${floors}층 → 모든 층에 스프링클러` : `지상 ${floors || '?'}층 — 층수 기준은 해당 없음`,
    verdict: floors >= 6 ? { label: '대상', tone: 'need' } : { label: '해당 없음', tone: 'ok' },
    assumed: ['용도·면적별 기준(판매·숙박·노유자 등)과 다른 소방 설비는 다음 업데이트(묶음 F4)'],
    uses: ['floors'],
    basis: [{ label: '소방시설 설치 및 관리에 관한 법률 시행령 (별표 4)', url: 'https://www.law.go.kr/법령/소방시설설치및관리에관한법률시행령' }],
  })
  {
    const exempt = isUse(p, '1') || /동·식물원/.test(sub(p))
    const need = gfa >= 500 && !exempt
    rows.push({
      id: 'energy',
      group: '피난·설비',
      item: '에너지절약계획서',
      rule: '연면적 500㎡ 이상 (단독주택, 동·식물원 등 빼 줌)',
      result: exempt ? `${p.useName} — 제출 안 함` : `연면적 ${fmt(gfa)}㎡ ${need ? '→ 허가 때 제출' : '— 500㎡ 미만'}`,
      verdict: need ? { label: '대상', tone: 'need' } : { label: '해당 없음', tone: 'ok' },
      uses: ['gfa'],
      basis: [law('녹색건축물 조성 지원법', '제14조'), law('녹색건축물 조성 지원법 시행령', '제10조')],
    })
  }

  // ───────── 주변 보호구역
  {
    const near = (c.schools ?? []).filter((x) => x.dist <= 200)
    const bad = schoolBanned(p)
    rows.push({
      id: 'school-zone',
      group: '주변 보호구역',
      item: '교육환경보호구역',
      rule: '학교 경계에서 200m 안(출입문 50m 안은 절대보호구역)에서는 유흥·단란주점, 숙박업, 노래연습장·PC방 등 금지 시설',
      result: near.length
        ? `200m 안 ${near.length}곳: ${near.slice(0, 3).map((x) => `${x.name} 약 ${Math.round(x.dist)}m`).join(', ')}${near.length > 3 ? ' …' : ''} → ${bad ?? `${p.useName}은 금지 시설이 아님`}`
        : (c.schools ?? []).length
          ? '200m 안에 학교·유치원 없음'
          : '생활 시설 자료가 없어 학교 위치를 모름',
      verdict: near.length ? (bad ? { label: '불가할 수 있음', tone: 'warn' } : { label: '문제 없음', tone: 'ok' }) : (c.schools ?? []).length ? { label: '해당 없음', tone: 'ok' } : { label: '직접 확인', tone: 'check' },
      check: (c.schools ?? []).length ? undefined : "④에서 생활 시설(카카오)을 수집하면 자동으로 — 또는 토지이음 '교육환경보호구역'",
      assumed: near.length ? ['학교 위치는 점(카카오) 기준 — 실제 학교 경계에서 재면 조금 더 가까움'] : [],
      basis: [law('교육환경 보호에 관한 법률', '제8조'), law('교육환경 보호에 관한 법률', '제9조')],
    })
  }
  {
    const heritage = c.overlays.filter((n) => /문화재|문화유산|국가유산|역사문화환경/.test(n))
    rows.push({
      id: 'heritage',
      group: '주변 보호구역',
      item: '역사문화환경 보존지역',
      rule: '지정 문화유산 둘레(조례로 정한 범위, 보통 200~500m)에서 공사하면 허용기준 안에서만',
      result: heritage.length ? `대지에 걸침: ${heritage.join(', ')}` : '수집한 지구·구역에 없음',
      verdict: heritage.length ? { label: '직접 확인', tone: 'check' } : { label: '해당 없음', tone: 'ok' },
      check: heritage.length ? "국가유산청 '국가유산 공간정보'(gis-heritage.go.kr) 또는 토지이음에서 이 필지가 몇 구역인지와 그 구역의 높이·형태 허용기준 — 구역 도면은 공개 API로 받을 수 없음" : undefined,
      assumed: heritage.length ? [] : ['수집한 용도지구·구역 자료에 없으면 해당 없음으로 봄'],
      basis: [law('문화유산의 보존 및 활용에 관한 법률', '제13조')],
    })
  }
  {
    const artUse = (isUse(p, '2') && !/기숙사/.test(sub(p))) || isUse(p, '3', '4', '7', '8', '14', '15', '16', '24') || (isUse(p, '5') && /공연장|집회장|관람장/.test(sub(p))) || (isUse(p, '9') && /병원/.test(sub(p)))
    const need = artUse && gfa >= 10000
    rows.push({
      id: 'art',
      group: '그 밖',
      item: '건축물 미술작품',
      rule: '공동주택·근린생활·판매·운수·병원·업무·숙박·위락 등으로 연면적 1만㎡ 이상 (주차장·기계실 등 빼고)',
      result: need ? `연면적 ${fmt(gfa)}㎡ → 건축비의 일정 비율로 미술작품 설치 또는 기금 출연` : !artUse ? `${p.useName} — 대상 용도가 아님` : `연면적 ${fmt(gfa)}㎡ — 1만㎡ 미만`,
      verdict: need ? { label: '대상', tone: 'need' } : { label: '해당 없음', tone: 'ok' },
      uses: ['gfa'],
      basis: [law('문화예술진흥법', '제9조'), law('문화예술진흥법 시행령', '제12조')],
    })
  }
  // '법 바뀜' — 규칙을 만들 때 본 글과 지금 받은 글이 다르면
  const ymd = (s?: string) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s ?? '')
  for (const r of rows) {
    const ch = changedRefs(c.table, r.refId ?? r.id)
    if (ch.length) r.changed = ch.map((x) => `${x.ref.law} ${x.ref.where}${x.ref.part ? '(이 규칙이 쓰는 부분)' : ''}${x.effective ? ` — 지금 시행 ${ymd(x.effective)}` : ''}`)
  }
  return rows
}

/** 용도지역에 지을 수 있는지 (묶음 F2): 시행령 별표 2~22 + 시·군 조례 별표 */
function zoneUseRow(c: ReviewCtx, zonesText: string): ReviewRow {
  const p = c.plan
  const urban = c.region?.urban
  const LAW = '국토의 계획 및 이용에 관한 법률 시행령'
  const base = {
    id: 'zone-use',
    group: '용도지역',
    item: '용도지역에 지을 수 있는지',
    rule: '용도지역마다 법(시행령 별표 2~22)이 정하고, 일부는 시·군 조례가 정함',
    basis: [law('국토의 계획 및 이용에 관한 법률', '제76조'), law(LAW, '제71조', '국토계획법 시행령 제71조 (별표 2~22)'), ...ordin(urban)],
  }
  if (!p.use) return { ...base, result: `${zonesText}`, verdict: { label: '직접 확인', tone: 'check' }, check: '먼저 위에서 주용도를 고르세요' }
  const tables = c.table?.lawTables?.[LAW]?.tables ?? {}
  const zone = c.zones[0]
  const zname = zone ? (zone.rule?.label ?? zone.name).replace(/\s+/g, '') : ''
  const lawEntry = Object.entries(tables).find(([, t]) => zoneOfTitle(t.title) === zname)
  if (!zone || !lawEntry)
    return {
      ...base,
      result: `${zonesText}에 ${p.useName}`,
      verdict: { label: '직접 확인', tone: 'check' },
      check: zone ? `시행령 별표를 아직 받지 못함 — 토지이음(eum.go.kr) → 이 필지 → '행위가능여부'에서 '${p.useName}'` : '용도지역 자료가 없음 — ④에서 공간정보(규제·계획)를 수집하세요',
    }
  const [no, lt] = lawEntry
  const ords = (urban?.zoneUses ?? []).filter((t) => zoneOfTitle(t.title + ' ' + t.text.slice(0, 200)) === zname)
  const a = judgeZoneUse(lt.text, `시행령 별표 ${no}`, ords, { useNo: p.use.no, useName: USE_NAME_OF(p), sub: p.use.sub, floors: p.floors?.v ?? 0 })
  const floorsCap = a.conditions.map((x) => x.match(/^(\d+)층 이하/)).find(Boolean)
  const tooTall = floorsCap && p.floors && p.floors.v > Number(floorsCap[1])
  const assumed = [...a.assumed]
  if (c.zones.length > 1) assumed.push(`대지가 ${zonesText}에 걸쳐 가장 넓은 ${zone.rule?.label ?? zone.name}로 판정 — 건축물이 걸치면 각 지역 기준을 함께 봐야 함`)
  const L: Record<string, ReviewRow['verdict']> = {
    yes: { label: '가능', tone: 'ok' },
    'ordinance-yes': { label: '가능 (조례)', tone: 'ok' },
    'ordinance-no': { label: '불가 (조례)', tone: 'warn' },
    no: { label: '불가', tone: 'warn' },
    unknown: { label: '직접 확인', tone: 'check' },
  }
  let verdict = L[a.verdict]
  if (tooTall && (a.verdict === 'yes' || a.verdict === 'ordinance-yes')) verdict = { label: `${floorsCap![1]}층 이하만`, tone: 'warn' }
  const verdictWord = { yes: '지을 수 있음', 'ordinance-yes': '조례로 지을 수 있음', 'ordinance-no': '조례로 지을 수 없음', no: '지을 수 없음', unknown: '조례를 읽지 못함' }[a.verdict]
  return {
    ...base,
    result: `${zone.rule?.label ?? zone.name}에 ${p.useName} → ${verdictWord}${a.conditions.length ? ` (조건: ${[...new Set(a.conditions)].join(', ')})` : ''}${a.exceptions?.length ? ` — 단, 예외: ${a.exceptions[0]}` : ''}`,
    verdict,
    assumed,
    uses: a.conditions.some((x) => /층 이하/.test(x)) ? ['floors'] : [],
    check: a.verdict === 'unknown' ? `토지이음(eum.go.kr) → 이 필지 → '행위가능여부'에서 '${p.useName}'` : undefined,
    cite: a.cite.join(' / '),
    refId: `zone-use:${no}`,
    source: { label: `국토계획법 시행령 별표 ${no}`, text: lt.text, url: c.table?.lawTables?.[LAW]?.url ?? '' },
  }
}

/** 별표 1 큰 분류 이름 (세부 용도가 있으면 큰 분류) */
const USE_NAME_OF = (p: Plan) => p.useName.split(' · ')[0]

/** 교육환경보호구역 금지 시설에 해당하는 용도 (교육환경법 제9조 — 상대보호구역은 심의로 허용될 수 있음) */
function schoolBanned(p: Plan): string | null {
  if (isUse(p, '16')) return '위락시설(유흥·단란주점 등) — 금지 시설'
  if (isUse(p, '15') && !/관광숙박/.test(sub(p))) return '숙박업 — 금지 시설 (상대보호구역은 심의로 허용될 수 있음)'
  if (isUse(p, '15')) return '관광숙박업 — 금지 시설 (상대보호구역은 심의로 허용될 수 있음)'
  if (isUse(p, '26', '28')) return '화장·봉안시설 등 — 금지 시설일 수 있음'
  return null
}

// ───────────────────────── 주차 (주차장법 시행령 별표 1 · 주택건설기준 등에 관한 규정 제27조) ─────────────────────────

/** 별표 1 시설면적당 1대 (㎡) — 2026-08-25 개정 별표로 확인 */
function parkingUnitArea(p: Plan): { per: number; row: string } | null {
  const s = sub(p)
  if (isUse(p, '16')) return { per: 100, row: '1. 위락시설' }
  if ((isUse(p, '5') && !/관람장/.test(s)) || isUse(p, '6', '7', '8', '28') || (isUse(p, '9') && !/격리/.test(s)) || isUse(p, '13') || (isUse(p, '14') && !/오피스텔/.test(s)))
    return { per: 150, row: '2. 문화·집회, 종교, 판매, 운수, 의료, 운동, 업무 등' }
  if (isUse(p, '3', '4', '15')) return { per: 200, row: '3. 근린생활시설, 숙박시설' }
  if (isUse(p, '12', '17', '25')) return { per: 350, row: '7. 수련시설, 공장, 발전시설' }
  if (isUse(p, '18')) return { per: 400, row: '8. 창고시설' }
  if (isUse(p, '2') && /기숙사/.test(s)) return { per: 400, row: '9. 학생용 기숙사' }
  return { per: 300, row: '11. 그 밖의 건축물' }
}

/** 주택건설기준 제27조 ① 면적당 대수 (전용 85㎡ 이하 / 초과): 특별시 75·65, 광역시 등 85·70, 그 밖의 시 95·75, 그 밖 110·85 */
function aptAreaPer(regionId: string | null): { small: number; large: number; kind: string } {
  if (regionId === 'gwangju') return { small: 85, large: 70, kind: '광역시(광주)' }
  if (regionId && /시$/.test(regionId)) return { small: 95, large: 75, kind: '시 지역' }
  return { small: 110, large: 85, kind: '그 밖의 지역(군)' }
}

function parkingRow(c: ReviewCtx): ReviewRow {
  const p = c.plan
  const gfa = p.gfa?.v ?? 0
  const base: Omit<ReviewRow, 'rule' | 'result' | 'verdict'> = {
    id: 'parking',
    group: '주차',
    item: '부설주차장',
    assumed: [],
    basis: [law('주차장법', '제19조'), law('주차장법 시행령', '제6조', '주차장법 시행령 제6조 (별표 1)')],
  }
  const lt = c.table?.lawTables?.['주차장법 시행령']?.tables?.['1']
  const source = lt ? { label: `주차장법 시행령 ${lt.title}`, text: lt.text, url: c.table?.lawTables?.['주차장법 시행령']?.url ?? '' } : undefined
  if (!p.use)
    return { ...base, rule: '용도·시설면적에 따라 대수 (주차장법 시행령 별표 1)', result: '주용도를 고르면 계산', verdict: { label: '직접 확인', tone: 'check' }, check: '위에서 주용도를 고르세요', source }
  const a = base.assumed!
  // 단독주택 (다가구 제외)
  if (isUse(p, '1') && sub(p) !== '다가구주택') {
    const n = gfa <= 50 ? 0 : gfa <= 150 ? 1 : 1 + Math.ceil((gfa - 150) / 100)
    push(a, '시설면적을 연면적으로 봄')
    return { ...base, uses: ['gfa'], rule: '단독주택: 50~150㎡ 1대, 150㎡ 넘으면 100㎡마다 1대 더', result: `약 ${n}대`, verdict: { label: `${n}대 이상`, tone: 'need' }, cite: '별표 1 · 4. 단독주택', source }
  }
  // 공동주택(기숙사 제외)·다가구·오피스텔 — 주택건설기준 제27조
  if (p.units) {
    const n = p.units.v
    const nat = aptAreaPer(c.region?.id ?? null)
    // 묶음 F2: 주차장 조례가 면적당 대수를 강화했으면 그 값 (여수·영광)
    const ordApt = readParkingApt(c.region?.parking)
    const per = ordApt && ordApt.small < nat.small ? { small: ordApt.small, large: Math.min(ordApt.large, nat.large), kind: `${c.region?.parking?.name} ${ordApt.source} (강화)` } : nat
    const excl = (gfa * 0.75) / n // 공급 대비 전용 약 75% 어림
    const exclTotal = excl * n
    const byArea = Math.ceil(exclTotal / (excl <= 85 ? per.small : per.large))
    const byUnit = Math.ceil(n * (excl <= 60 ? 0.7 : 1))
    const need = Math.max(byArea, byUnit)
    push(a, `전용면적 합계를 연면적의 75%로 봄 (세대당 전용 약 ${fmt(excl)}㎡)`, ordApt && per !== nat ? undefined : `${per.kind} 기준으로 봄`, ordApt && per !== nat ? undefined : ordNote(c, null))
    return {
      ...base,
      rule: `세대당 1대(전용 60㎡ 이하 0.7대) 이상, 그리고 전용면적 합계 ÷ ${per.small}㎡(85㎡ 넘는 세대 ${per.large}㎡) 이상`,
      result: `${fmt(n)}세대 → 세대 기준 ${fmt(byUnit)}대 · 면적 기준 ${fmt(byArea)}대 → 약 ${fmt(need)}대`,
      verdict: { label: `${fmt(need)}대 이상`, tone: 'need' },
      cite: per !== nat ? `${per.kind}` : '주택건설기준 등에 관한 규정 제27조 ① 1호',
      uses: ['gfa', 'units'],
      basis: [...base.basis, { label: '주택건설기준 등에 관한 규정 제27조', url: lawArticleUrl('주택건설기준등에관한규정', '제27조') }],
      source,
    }
  }
  const u = parkingUnitArea(p)!
  // 묶음 F2: 이 지역 주차장 조례가 설치기준 별표로 강화했으면 그 값
  const pr = readParking(c.region?.parking, { rowWords: [USE_NAME_OF(p).replace(/\s+/g, '')] })
  const ordPer = pr && !('none' in pr) && pr.per ? pr.per : null
  const per = ordPer && ordPer < u.per ? ordPer : u.per
  const n = Math.ceil(gfa / per)
  push(a, '시설면적을 연면적으로 봄 (주차장 면적은 빼야 하므로 조금 적어짐)', ordNote(c, pr))
  return {
    ...base,
    uses: ['gfa'],
    rule: ordPer && ordPer < u.per ? `${c.region?.parking?.name ?? '주차장 조례'}: 시설면적 ${per}㎡당 1대 (시행령 ${u.per}㎡보다 강화)` : `${u.row}: 시설면적 ${u.per}㎡당 1대`,
    result: `연면적 ${fmt(gfa)}㎡ ÷ ${per}㎡ → 약 ${fmt(n)}대`,
    verdict: { label: `${fmt(n)}대 이상`, tone: 'need' },
    cite: ordPer && ordPer < u.per && pr && !('none' in pr) ? `${c.region?.parking?.name} ${pr.source}: ${pr.line}` : `주차장법 시행령 별표 1 · ${u.row}`,
    source,
  }
}

/** 주차장 조례를 읽은 결과 한 줄 (가정이면 가정으로) */
function ordNote(c: ReviewCtx, pr: ReturnType<typeof readParking> | null): string | undefined {
  const name = c.region?.parking?.name
  if (!c.region?.parking) return '이 지역 주차장 조례를 찾지 못해 시행령 기준 그대로로 봄'
  if (pr && 'none' in pr) return `${name}에 따로 강화한 설치기준 표가 없어 시행령 기준 그대로로 봄`
  if (pr && !pr.per) return `${name} ${pr.source}에서 이 용도 줄을 찾지 못해 시행령 기준 그대로로 봄`
  return pr ? undefined : `${name}에 공동주택 면적당 대수를 강화한 표가 없어 주택건설기준 그대로로 봄`
}

/** 검토서 요약: 판정 수 · 직접 확인 수 · 가정이 들어간 줄 수 · 내가 확인한 줄 수 */
export function reviewSummary(rows: ReviewRow[], checked: Record<string, boolean>, plan?: Plan): { decided: number; check: number; assumed: number; mine: number; changed: number } {
  let changed = 0
  let decided = 0
  let check = 0
  let assumed = 0
  let mine = 0
  for (const r of rows) {
    if (r.verdict.tone === 'check') check++
    else decided++
    if (r.assumed?.length || (plan && r.uses?.some((k) => planAssumed(plan, k)))) assumed++
    if (checked[r.id]) mine++
    if (r.changed?.length) changed++
  }
  return { decided, check, assumed, mine, changed }
}

/** 계획 값 하나가 가정인지 */
export function planAssumed(p: Plan, k: PlanKey): string | null {
  const v = k === 'basement' ? p.basement : p[k]
  return v?.assumed ?? null
}
