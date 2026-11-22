// 용도지역에 지을 수 있는지 (2026-11-22 묶음 F2): 국토계획법 시행령 별표 2~22(용도지역 안에서 건축할 수 있는/없는 건축물)와
// 시·군 도시계획 조례의 같은 별표를 읽어 고른 용도(건축법 시행령 별표 1 호)를 판정한다.
//  - 시행령 표: 1호 = 법으로 건축할 수 있는(또는 없는) 건축물, 2호 = 도시·군계획조례로 정하는 바에 따라 건축할 수 있는(없는) 건축물
//  - 2호에 든 용도는 그 시·군 조례 별표에 들었는지로 가림
//  - 목마다 괄호 안 '제외'·'중 ○○'·층수·면적 조건을 읽어 세부 용도와 맞춰 보고, 모르면 가정으로 밝힘
// 사용자 결정: 앱이 판정하고 근거 줄을 보여 줌(학생은 재확인만). 다른 파일을 가져오지 않음 — node로 표 전체에 시험할 수 있게.

export interface ZoneUseQuery {
  /** 건축법 시행령 별표 1 호 번호 ('2', '23의2' …) */
  useNo: string
  /** 큰 분류 이름 (예: '공동주택') */
  useName: string
  sub?: string
  floors: number
}

export type ZoneUseVerdict = 'yes' | 'ordinance-yes' | 'ordinance-no' | 'no' | 'unknown'

export interface ZoneUseAnswer {
  verdict: ZoneUseVerdict
  /** 근거 줄 (시행령 별표 n 몇 호 몇 목 …) */
  cite: string[]
  /** 지켜야 할 조건 (층수 이하 등) */
  conditions: string[]
  assumed: string[]
  /** 금지 목의 예외 ('주상복합으로서 … 은 제외') — 불가여도 이 경우는 지을 수 있음 */
  exceptions?: string[]
}

/** 목 글의 괄호(( ) [ ] 〔 〕) 안 '제외' 글 → 예외 한 줄씩 */
function exceptionsOf(text: string): string[] {
  // 괄호 안에 괄호가 또 들어 있어('〔공동주택과 … 건축물(다수의 … 포함한다)로서 … 제외한다〕') 한 겹 바깥 괄호를 세며 읽음
  const out: string[] = []
  const open = '([〔'
  const close = ')]〕'
  let depth = 0
  let start = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (open.includes(ch)) {
      if (depth === 0) start = i + 1
      depth++
    } else if (close.includes(ch) && depth > 0) {
      depth--
      if (depth === 0 && start >= 0) {
        const inner = text.slice(start, i)
        if (/제외/.test(inner)) {
          // 안쪽 괄호 설명은 빼고 짧게
          const t = inner.replace(/\([^()]*\)/g, '').replace(/\s+/g, ' ').replace(/(은|는|을|를)?\s*제외(한다|하며)?\.?\s*$/, '').trim()
          if (t.length > 4) out.push(cut(t, 120))
        }
        start = -1
      }
    }
  }
  return out
}

interface Item {
  letter: string
  text: string
  /** 이 목이 가리키는 별표 1 호 번호들 */
  hos: string[]
}

interface Section {
  /** 1호(법) 또는 2호(조례) */
  no: 1 | 2
  /** true = 건축할 수 있는, false = 건축할 수 없는 */
  allow: boolean
  head: string
  items: Item[]
}

const squash = (s: string) => s.replace(/\s+/g, '')

/** 건축법 시행령 별표 1 호 → 이름 앞부분 (목 안에서 둘째 이후 '제N호의 ○○'가 정말 그 용도인지 볼 때) */
const HO_NAME: Record<string, string> = {
  '1': '단독주택', '2': '공동주택', '3': '제1종근린', '4': '제2종근린', '5': '문화및집회', '6': '종교시설', '7': '판매시설', '8': '운수시설',
  '9': '의료시설', '10': '교육연구', '11': '노유자', '12': '수련시설', '13': '운동시설', '14': '업무시설', '15': '숙박시설', '16': '위락시설',
  '17': '공장', '18': '창고', '19': '위험물', '20': '자동차', '21': '동물및식물', '22': '자원순환', '23': '교정', '23의2': '국방', '24': '방송통신',
  '25': '발전시설', '26': '묘지', '27': '관광휴게', '28': '장례', '29': '야영장',
}

export function normZoneText(s: string): string {
  return s
    .replace(/\r/g, '')
    .replace(/[｢「」｣『』]/g, '')
    .replace(/[ㆍ‧·]/g, '·')
    .replace(/(\d)\s*천\s*제곱\s*미터/g, '$1000제곱미터')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/제\s*곱\s*미\s*터/g, '제곱미터')
}

/** '별표 1 제2호', '제3호가목부터 라목까지', '및 제4호의' … 에서 호 번호들 — '제10조제1항제2호'처럼 다른 법의 조·항 뒤 호는 뺌 */
function hosOf(t: string): string[] {
  const out: string[] = []
  // 괄호 안('(제1호다목에 해당하는 것은 제외)')과 다른 별표('별표 4 제2호차목')를 가리키는 호는 이 목의 용도가 아님
  let s = t
  for (let prev = ''; prev !== s; ) {
    prev = s
    s = s.replace(/\([^()]*\)/g, ' ').replace(/\[[^[\]]*\]/g, ' ')
  }
  let first = true
  for (const m of s.matchAll(/(?<![조항]\s?)(?<!별표\s*(?:[2-9]|\d{2,})\s*)제\s*(\d+)\s*호(?:의\s*(\d+))?/g)) {
    const no = m[2] ? `${m[1]}의${m[2]}` : m[1]
    // 첫 호는 그 목의 용도, 그 뒤 호는 '및 제4호의 제2종 근린생활시설'처럼 용도 이름이 바로 붙을 때만
    const after = squash(s.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 24))
    const named = HO_NAME[no] && after.replace(/^의/, '').startsWith(HO_NAME[no])
    if ((first || named) && !out.includes(no)) out.push(no)
    first = false
  }
  return out
}

/** 법령 별표는 고정 폭 글이라 낱말이 줄 끝에서 끊김(예: '초등학\n교') → 줄을 붙일 때 띄우지 않음 */
function isWrapped(t: string): boolean {
  const lines = t.split('\n').filter((l) => l.trim())
  return lines.length > 5 && lines.filter((l) => / {3,}$/.test(l)).length > lines.length / 2
}

/** 표 글 → 1호·2호 묶음 (줄 단위: '1.'·'2.' 머리, '가.'~'하.' 목, 나머지는 이어지는 글) */
export function parseZoneTable(text: string): Section[] {
  const t = normZoneText(text)
  const wrapped = isWrapped(t)
  const join = (xs: string[]) => (wrapped ? xs.map((x) => x.trim()).join('') : xs.map((x) => x.trim()).join(' ')).replace(/\s+/g, ' ').trim()
  const lines = t.split('\n')
  const out: Section[] = []
  let sec: (Section & { headLines: string[] }) | null = null
  let item: { letter: string; lines: string[] } | null = null
  const closeItem = () => {
    if (sec && item) {
      const txt = join(item.lines)
      sec.items.push({ letter: item.letter, text: txt, hos: hosOf(txt) })
    }
    item = null
  }
  const closeSec = () => {
    closeItem()
    if (sec) {
      sec.head = join(sec.headLines)
      const { headLines: _h, ...rest } = sec
      void _h
      out.push(rest)
    }
    sec = null
  }
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim()
    if (!ln) continue
    if (/^(비\s*고|※)/.test(ln)) break
    const hm = ln.match(/^([12])\.\s*(.*)$/)
    if (hm) {
      // 머리가 다음 줄로 이어질 수 있어 빈 줄을 건너 세 줄을 붙여 봄
      const next = lines.slice(i + 1).filter((x) => x.trim()).slice(0, 2)
      const look = join([ln, ...next])
      const kind = look.match(/건축(?:할|하는)?\s*수\s*(있는|없는)/)
      if (kind) {
        closeSec()
        sec = { no: Number(hm[1]) as 1 | 2, allow: kind[1] === '있는', head: '', headLines: [hm[2]], items: [] }
        continue
      }
    }
    const im = ln.match(/^([가-하])\.\s*(.*)$/)
    if (im && sec) {
      closeItem()
      item = { letter: im[1], lines: [im[2]] }
      continue
    }
    if (item) item.lines.push(lines[i])
    else if (sec) sec.headLines.push(lines[i])
  }
  closeSec()
  return out
}

const subWord = (sub?: string) => (sub ? squash(sub.replace(/\(.*?\)/g, '')) : '')

/** 목 안에서 이 용도를 다루는 부분 (같은 목에 여러 호가 있으면 이 호 앞뒤만) */
function partFor(item: Item, useNo: string): string {
  const t = item.text
  const re = new RegExp(`제\\s*${useNo.replace('의', '호의')}(?:호)?`)
  const i = t.search(re)
  if (i < 0) return t
  const next = t.slice(i + 3).search(/(?:별표\s*1\s*|같은\s*표\s*)?제\s*\d+\s*호/)
  return t.slice(i, next < 0 ? t.length : i + 3 + next)
}

interface Hit {
  sec: Section
  item: Item
  /** 세부 용도로 보아 이 목에서 빠짐 */
  excluded: boolean
  /** 세부 용도를 몰라 가정함 */
  assumed?: string
  /** 이 목에 붙은 조건(층수·면적) */
  conds: string[]
  /** '○○ 중 △△'처럼 그 용도의 일부만 다루는 목: △△ (세부 용도를 몰라 맞는지 모름) */
  only?: string
  /** 괄호 안 '제외' 글 (화면에 덧붙임) */
  excl: string[]
}

function hitsFor(secs: Section[], q: ZoneUseQuery): Hit[] {
  const sub = subWord(q.sub)
  const out: Hit[] = []
  for (const sec of secs)
    for (const item of sec.items) {
      if (!item.hos.includes(q.useNo)) continue
      const part = partFor(item, q.useNo)
      const p = squash(part)
      const conds: string[] = []
      for (const m of part.matchAll(/(\d+)\s*층\s*이하/g)) conds.push(`${m[1]}층 이하`)
      for (const m of part.matchAll(/바닥면적의\s*합계가\s*(\d+)\s*제곱미터\s*(미만|이하|이상)/g)) conds.push(`바닥면적 합계 ${Number(m[1]).toLocaleString('ko-KR')}㎡ ${m[2]}`)
      // 괄호 안 '○○을 제외한다' / '○○는 제외'
      const excl = [...p.matchAll(/\(([^()]*제외[^()]*)\)/g)].map((m) => m[1])
      // '○○ 중 △△' (그 용도 가운데 △△만)
      const only = p.match(new RegExp(`${squash(q.useName)}중([^()]+?)(?:\\(|$|으로|로서)`))
      let excluded = false
      let assumed: string | undefined
      let onlyText: string | undefined
      if (sub) {
        if (excl.some((e) => e.includes(sub))) excluded = true
        if (only && !only[1].includes(sub)) excluded = true
      } else {
        if (excl.length) assumed = `세부 용도를 몰라 '${cut(excl[0].replace(/[은는을를]?제외(한다)?\.?$/, ''), 40)}'이 아닌 것으로 봄`
        if (only) onlyText = cut(only[1], 50)
      }
      out.push({ sec, item, excluded, assumed, conds, only: onlyText, excl })
    }
  return out
}

const cut = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * 판정: lawTable = 시행령 그 용도지역 별표 글, ordTables = 그 시·군 조례에서 같은 용도지역 별표 글들
 * - 허용 표: 1호에 들면 가능, 2호에 들면 조례 별표에 들었는지로, 어디에도 없으면 불가
 * - 금지 표(상업·준주거 등): 1호에 들면 불가, 2호에 들면 조례가 금지로 정했는지로, 어디에도 없으면 가능
 */
export function judgeZoneUse(lawTable: string, lawLabel: string, ordTables: { title: string; text: string }[], q: ZoneUseQuery): ZoneUseAnswer {
  const secs = parseZoneTable(lawTable)
  const cite: string[] = []
  const conditions: string[] = []
  const assumed: string[] = []
  if (!secs.length) return { verdict: 'unknown', cite, conditions, assumed: ['시행령 별표 글을 나누지 못함'] }
  const allowTable = secs[0].allow
  let hits = hitsFor(secs, q).filter((h) => !h.excluded)
  // 금지 목록에서 '○○ 중 △△'만 금지하는데 세부 용도를 모르면: △△가 아닌 것으로 보고 금지에서 뺌(가정으로 밝힘)
  if (!allowTable) {
    for (const h of hits.filter((x) => x.only)) assumed.push(`세부 용도를 몰라 '${h.only}'이 아닌 것으로 봄 (그것이면 불가 — ${lawLabel} ${h.sec.no}호 ${h.item.letter}목)`)
    hits = hits.filter((x) => !x.only)
  }
  for (const h of hits) {
    if (h.assumed) assumed.push(h.assumed)
    conditions.push(...h.conds)
    // 허용 목록의 '○○ 중 △△' → 지을 수 있는 것은 △△일 때만
    if (allowTable && h.only) conditions.push(`${h.only}일 때만`)
  }
  // 1호(법)의 머리 조건 (예: 4층 이하의 건축물만)
  const head1 = secs.find((s) => s.no === 1)
  const headFloors = head1?.head.match(/(\d+)\s*층\s*이하/)
  const sec1 = hits.find((h) => h.sec.no === 1)
  const sec2 = hits.find((h) => h.sec.no === 2)
  const label = (h: Hit) => `${lawLabel} ${h.sec.no}호 ${h.item.letter}목: ${cut(h.item.text)}`
  if (allowTable) {
    if (sec1) {
      cite.push(label(sec1))
      if (headFloors) conditions.unshift(`${headFloors[1]}층 이하 (${lawLabel} 1호)`)
      return { verdict: 'yes', cite, conditions: [...new Set(conditions)], assumed }
    }
    if (sec2) {
      cite.push(label(sec2))
      const ord = ordHit(ordTables, q, true)
      if (ord) {
        cite.push(ord.cite)
        assumed.push(...ord.assumed)
        return { verdict: 'ordinance-yes', cite, conditions: [...new Set([...conditions, ...ord.conds])], assumed }
      }
      return { verdict: ordTables.length ? 'ordinance-no' : 'unknown', cite, conditions, assumed: ordTables.length ? assumed : [...assumed, '이 시·군 조례의 용도지역 별표를 받지 못함'] }
    }
    return { verdict: 'no', cite: [`${lawLabel}에 ${q.useName}이 없음 (1호·2호 모두)`], conditions, assumed }
  }
  // 금지 표
  if (sec1) {
    cite.push(label(sec1))
    return { verdict: 'no', cite, conditions, assumed, exceptions: exceptionsOf(sec1.item.text) }
  }
  if (sec2) {
    cite.push(label(sec2))
    const ord = ordHit(ordTables, q, false)
    if (ord) {
      cite.push(ord.cite)
      assumed.push(...ord.assumed)
      return { verdict: 'ordinance-no', cite, conditions, assumed, exceptions: ord.exceptions }
    }
    return { verdict: ordTables.length ? 'ordinance-yes' : 'unknown', cite, conditions, assumed: ordTables.length ? [...assumed, '조례가 금지로 정하지 않아 지을 수 있는 것으로 봄'] : [...assumed, '이 시·군 조례의 용도지역 별표를 받지 못함'] }
  }
  return { verdict: 'yes', cite: [`${lawLabel}의 건축할 수 없는 건축물에 ${q.useName}이 없음`], conditions, assumed }
}

/** 조례 별표에서 이 용도가 든 목 */
function ordHit(tables: { title: string; text: string }[], q: ZoneUseQuery, allow: boolean): { cite: string; conds: string[]; assumed: string[]; exceptions: string[] } | null {
  for (const t of tables) {
    const secs = parseZoneTable(t.text).filter((s) => s.items.length)
    // 조례 별표는 1·2호로 나뉘지 않고 '1. 「건축법 시행령」 별표 1 제4호의 …'처럼 호만 있는 경우가 많음(광주) → 표 전체를 한 묶음으로
    const all: Section[] = secs.length ? secs.filter((s) => s.allow === allow || secs.length === 1) : []
    const flatSecs: Section[] = all.length ? all : [{ no: 2, allow, head: t.title, items: itemsOf(normZoneText(t.text)) }]
    const hits = hitsFor(flatSecs, q).filter((h) => !h.excluded)
    if (hits.length) {
      const h = hits[0]
      const mark = /^\d/.test(h.item.letter) ? `${h.item.letter}호` : `${h.item.letter}목`
      // 표 머리의 층수 조건 ('※ 평균 18층 이하의 건축물에 한한다')
      const firstItem = normZoneText(t.text).search(/(?:^|\n)\s*(?:\d{1,2}|[가-하])\.\s/)
      const headFl = normZoneText(t.text).slice(0, firstItem > 0 ? firstItem : 400).match(/(평균\s*)?(\d+)\s*층\s*이하/)
      const conds = [...h.conds, ...(headFl ? [`${headFl[2]}층 이하${headFl[1] ? ' (평균)' : ''}`] : [])]
      return { cite: `${t.title.replace(/\s+/g, ' ')} ${mark}: ${cut(h.item.text)}`, conds, assumed: h.assumed ? [h.assumed] : [], exceptions: allow ? [] : exceptionsOf(h.item.text) }
    }
  }
  return null
}

/** 조례 별표의 목록: 줄 맨 앞 '1.'이 '별표 1 제○호'를 가리키면 호가 맨 위 (아래 '가.'는 그 호의 세부), 아니면 '가.'가 맨 위 */
function itemsOf(t: string): Item[] {
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean)
  const numbered = lines.some((l) => /^\d{1,2}\.\s*.*(별표\s*1|제\s*\d+\s*호)/.test(l))
  const top = numbered ? /^(\d{1,2})\.\s*(.*)$/ : /^([가-하])\.\s*(.*)$/
  const items: Item[] = []
  let cur: { letter: string; lines: string[] } | null = null
  const close = () => {
    if (cur) {
      const txt = cur.lines.join(' ').replace(/\s+/g, ' ').trim()
      items.push({ letter: cur.letter, text: txt, hos: hosOf(txt) })
    }
    cur = null
  }
  for (const l of lines) {
    // 표 맨 위 '※ 평균 18층 이하의 건축물에 한한다'(순천)는 머리 — 목록이 시작된 뒤의 '비고'에서 끝
    if (/^비\s*고/.test(l) && cur) break
    if (/^※/.test(l)) {
      if (cur) cur.lines.push(l)
      continue
    }
    const m = l.match(top)
    if (m) {
      close()
      cur = { letter: m[1], lines: [m[2]] }
    } else if (cur) cur.lines.push(l)
  }
  close()
  return items
}

/** 별표 제목에서 용도지역 이름 (띄어쓰기 뺀) */
export function zoneOfTitle(title: string): string | null {
  const m = squash(title).match(/(제[12]종전용주거지역|제[123]종일반주거지역|준주거지역|중심상업지역|일반상업지역|근린상업지역|유통상업지역|전용공업지역|일반공업지역|준공업지역|보전녹지지역|생산녹지지역|자연녹지지역|보전관리지역|생산관리지역|계획관리지역|농림지역|자연환경보전지역)/)
  return m ? m[1] : null
}
