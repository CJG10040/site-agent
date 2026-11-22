// 대지 안의 공지 표 읽기 (2026-11-21 묶음 F1): 시·군 건축조례 별표(건축법 시행령 별표 2 틀 — 1. 건축선 / 2. 인접 대지경계선, 가~바목)를
// 용도·면적·층수·용도지역으로 골라 띄울 거리(m)를 낸다. 조례마다 줄바꿈·띄어쓰기·숫자 쓰는 법이 달라 글을 먼저 고르게 맞춘다.
// 사용자 결정: 앱이 판정하고 근거 줄을 한 줄로 보여 줌(학생은 재확인만), 모르는 값은 가정하고 '가정'으로 표시.
// 다른 파일을 가져오지 않음 — node로 바로 돌려 37곳 표에 시험할 수 있게.

export interface SetbackQuery {
  /** 건축법 시행령 별표 1 호 번호 (없으면 용도 미정) */
  useNo: string | null
  /** 세부 용도 (예: '아파트', '일반숙박시설') */
  sub?: string
  /** 그 용도로 쓰는 바닥면적 합계 ㎡ (주용도로 연면적 전부라고 봄) */
  area: number
  floors: number
  /** 대지 용도지역 이름 (가장 넓은 것) */
  zone: string
}

export interface SetbackPick {
  m: number
  /** '마목' */
  item: string
  /** 근거 한 줄 (짧게) */
  line: string
  /** 앱이 가정한 것 (예: 세부 용도를 몰라 아파트로 봄) */
  assumed?: string
}

export interface SetbackResult {
  road: SetbackPick | null
  side: SetbackPick | null
  /** 표에서 1·2호를 찾지 못함 */
  unread: boolean
  /** 앱이 가정한 것 (예: 상업지역 스프링클러 설치로 봐 빼 줌) */
  notes: string[]
}

/** 용도 번호 → 표 머리에서 찾을 말 (띄어쓰기 뺀 글) */
const USE_WORDS: Record<string, string[]> = {
  '1': ['단독주택', '다중주택', '다가구주택'],
  '2': ['공동주택'],
  '4': ['다중생활시설'],
  '5': ['문화및집회시설'],
  '6': ['종교시설'],
  '7': ['판매시설'],
  '8': ['운수시설'],
  '9': ['의료시설', '종합병원'],
  '10': ['교육연구시설'],
  '11': ['노유자시설'],
  '13': ['운동시설'],
  '14': ['업무시설'],
  '15': ['숙박시설'],
  '16': ['위락시설'],
  '17': ['공장'],
  '18': ['창고'],
  '19': ['위험물'],
  '20': ['자동차관련', '자동차관계'],
  '21': ['동물및식물'],
  '22': ['분뇨', '쓰레기', '자원순환'],
  '26': ['묘지'],
  '27': ['관광휴게'],
  '28': ['장례식장', '장례시설'],
}

const squash = (s: string) => s.replace(/\s+/g, '')

/** 숫자·단위 쓰는 법 맞추기: '1천 제곱 미터' → '1000제곱미터', '3미 터' → '3미터', '1,000' → '1000' */
export function normText(s: string): string {
  return s
    .replace(/\r/g, '')
    .replace(/[｢「」｣“”"]/g, '')
    .replace(/제\s*곱\s*미\s*터/g, '제곱미터')
    .replace(/(\d)\s*천\s*제곱미터/g, '$1000제곱미터')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/(\d)\s+(제곱미터)/g, '$1$2')
    .replace(/(\d(?:\.\d+)?)\s*미\s*터/g, '$1미터')
    // 원문 오타 '2터 이상'
    .replace(/(\d(?:\.\d+)?)\s*터(\s*이상)/g, '$1미터$2')
    // '3m'(완주) → '3미터' (㎡·m2는 위에서 제곱미터로 바꾸지 않았으면 그대로 두지 않게 먼저)
    .replace(/(\d)\s*(?:㎡|m2|m²)/g, '$1제곱미터')
    .replace(/(\d(?:\.\d+)?)\s*m(?![a-zA-Z²2])/g, '$1미터')
}

interface Clause {
  label: string
  m: number | null
  raw: string
  /** '1) 동물 및 식물 관련시설'처럼 목 안의 작은 묶음 이름 (진도) */
  sub?: string
  /** '3m(준공업지역에서 건축하는 경우에는 1.5m)'(완주) — 그 지역이면 이 값 */
  alt?: { zone: string; m: number }
}
interface Item {
  letter: string
  header: string
  clauses: Clause[]
}

const BULLET = /^[․ㆍ•·○◦▪\-‧]\s*/

function parseSection(text: string): Item[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const items: Item[] = []
  let cur: Item | null = null
  let clause: Clause | null = null
  let subGroup: string | undefined
  const close = () => {
    if (clause && cur) {
      const after = clause.raw.includes(':') ? clause.raw.slice(clause.raw.indexOf(':') + 1) : clause.raw
      const mm = after.match(/(\d+(?:\.\d+)?)미터/)
      clause.m = mm ? Number(mm[1]) : null
      clause.label = clause.raw.includes(':') ? clause.raw.slice(0, clause.raw.indexOf(':')).trim() : mm ? '' : clause.raw.trim()
      const alt = squash(clause.raw).match(/\(([^()]*?지역)(?:에서|안에서)건축하는경우(?:에는)?(\d+(?:\.\d+)?)미터\)/)
      if (alt) clause.alt = { zone: alt[1], m: Number(alt[2]) }
      if (subGroup) clause.sub = subGroup
      cur.clauses.push(clause)
    }
    clause = null
  }
  for (const line of lines) {
    if (/^비\s*고/.test(line)) break
    const m = line.match(/^([가-하])\.\s*(.*)$/)
    if (m) {
      close()
      subGroup = undefined
      cur = { letter: m[1], header: m[2], clauses: [] }
      items.push(cur)
      continue
    }
    if (!cur) continue
    // '※단, 상업지역은 제외'(완주)는 이 목의 조건 — 머리에 붙임
    if (/^※/.test(line)) {
      close()
      cur.header += ` ${line}`
      continue
    }
    // 목 안의 작은 묶음 '1) 동물 및 식물 관련시설'·'2) 1)에 해당하지 않는 건축물'(진도)
    const sg = line.match(/^(\d+)\)\s*(.+)$/)
    if (sg && !/미터/.test(line)) {
      close()
      subGroup = sg[2]
      continue
    }
    if (BULLET.test(line)) {
      close()
      clause = { label: '', m: null, raw: line.replace(BULLET, '') }
      continue
    }
    if (clause) clause.raw += ` ${line}`
    else if (/^\d+(?:\.\d+)?미터/.test(line)) clause = { label: '', m: null, raw: line }
    else cur.header += ` ${line}`
  }
  close()
  return items
}

/** 표 글 → 1호(건축선)·2호(인접 대지경계선) 목록 */
export function parseSetbackTable(tableText: string): { road: Item[]; side: Item[] } | null {
  const t = normText(tableText)
  const a = t.search(/1\.\s*건축선/)
  const b = t.search(/2\.\s*인접\s*대지\s*경계선/)
  if (a < 0 || b < 0 || b < a) return null
  return { road: parseSection(t.slice(a, b)), side: parseSection(t.slice(b)) }
}

const subWord = (sub?: string) => (sub ? squash(sub.replace(/\(.*?\)/g, '')) : '')

/** 머리 괄호 안 '제외' 글 */
const exclusions = (header: string) => [...header.matchAll(/\(([^()]*제외[^()]*)\)/g)].map((m) => squash(m[1]))

function zoneIs(zone: string, word: string): boolean {
  const z = squash(zone)
  if (word === '준공업지역') return z.includes('준공업')
  if (word === '상업지역') return /상업지역/.test(z)
  if (word === '전용주거지역') return z.includes('전용주거')
  if (word === '전용공업지역') return z.includes('전용공업')
  if (word === '일반공업지역') return z.includes('일반공업')
  return z.includes(word.replace(/지역$/, ''))
}

interface Match {
  item: Item
  /** 머리가 이 용도를 직접 다룸(그 밖에 목이 아님) */
  direct: boolean
  assumed?: string
}

/** 머리가 이 용도·규모·지역을 다루는지 (빼 준 까닭은 notes에) */
function covers(item: Item, q: SetbackQuery, notes: string[] = []): Match | null {
  const h = squash(item.header)
  const sub = subWord(q.sub)
  const excl = exclusions(item.header)
  // '그 밖에 건축물'·'가목부터 마목 이외' 같은 나머지 목 ('스프링클러나 그 밖에 이와 비슷한'은 아님)
  const catchAll = /^그밖|^“?가”?~|^가목부터|그밖에건축물|그밖의건축물|이외(의)?(용도|건축물)|의이외건축물/.test(h)
  // 시장정비사업구역 등 특별한 구역에만 쓰는 목은 뺌
  if (/시장정비사업구역/.test(h)) return null
  // 면적·층수 문턱 (머리에 있으면)
  const area = h.match(/(?:바닥면적의합계가|연면적이|연면적의합계가)(\d+)제곱미터이상/)
  const floorsAlt = h.match(/(\d+)층이상인건축물/)
  const areaOk = !area || q.area >= Number(area[1])
  // 지역 조건
  if (/상업지역이아닌지역/.test(h) && zoneIs(q.zone, '상업지역')) return null
  // '※다만, 상업지역은 제외'·'※단, 전용공업지역 및 일반공업지역 … 제외'(완주 — 괄호 밖 ※ 줄)
  if (/※(다만|단),?상업지역(은|에서건축하는건축물은|안의건축물은)?제외/.test(h) && zoneIs(q.zone, '상업지역')) return null
  if (/※(다만|단),?전용공업지역및일반공업지역/.test(h) && (zoneIs(q.zone, '전용공업지역') || zoneIs(q.zone, '일반공업지역'))) return null
  if (/상업지역에서건축하는(건축물|공동주택)을제외|상업지역에건축하는(건축물|공동주택)으로서스프링클러/.test(h) && zoneIs(q.zone, '상업지역')) {
    const mine = (q.useNo ? (USE_WORDS[q.useNo] ?? []) : []).some((w) => h.includes(w))
    if (mine && /스프링클러/.test(h)) notes.push(`상업지역 건축물은 스프링클러 등 자동식 소화설비를 설치하는 것으로 봐 ${item.letter}목 거리를 빼 줌`)
    return null
  }
  for (const e of excl) {
    if (/전용공업지역/.test(e) && zoneIs(q.zone, '전용공업지역')) return null
    if (/일반공업지역/.test(e) && zoneIs(q.zone, '일반공업지역')) return null
    if (sub && e.includes(sub)) return null
    // '(공동주택을 제외한다)'만 — '(상업지역에서 건축하는 공동주택을 제외)'는 위 지역 조건으로
    if (q.useNo === '2' && /^공동주택(을|은)제외/.test(e)) return null
    if (q.useNo === '15' && /여관|여인숙/.test(e) && /일반숙박/.test(sub)) return null
  }
  // '전용주거지역에 건축하는 건축물(공동주택 제외)' · '전용주거지역'(완주)
  if (/^전용주거지역/.test(h)) return zoneIs(q.zone, '전용주거지역') && !(q.useNo === '2' && /공동주택/.test(h)) ? { item, direct: true } : null
  const words = q.useNo ? (USE_WORDS[q.useNo] ?? []) : []
  const hit = words.some((w) => h.includes(w))
  if (hit && !catchAll) {
    if (!areaOk && !(floorsAlt && q.floors >= Number(floorsAlt[1]))) return null
    if (q.useNo === '9' && h.includes('종합병원') && !/종합병원/.test(sub)) return { item, direct: true, assumed: '의료시설을 종합병원으로 봄' }
    return { item, direct: true }
  }
  if (floorsAlt && q.floors >= Number(floorsAlt[1]) && !(q.useNo === '2' && /공동주택은제외|공동주택을제외/.test(h))) return { item, direct: true }
  if (catchAll) return { item, direct: false }
  return null
}

/** 목 안에서 이 계획에 맞는 줄 */
function pickClause(item: Item, q: SetbackQuery, direct: boolean): { c: Clause; assumed?: string } | null {
  const sub = subWord(q.sub)
  const cs = item.clauses
  if (!cs.length) return null
  // 값 없는 줄(조건만)은 다음 값 줄의 조건으로 묶음
  const groups: { conds: string[]; c: Clause }[] = []
  let pend: string[] = []
  for (const c of cs) {
    if (c.m === null) {
      pend.push(c.label || c.raw)
      continue
    }
    groups.push({ conds: c.label ? [...pend, c.label] : pend, c })
    pend = []
  }
  /** 면적·층수 문턱은 꼭 맞아야 하는 조건(gate), 지역·용도 이름은 하나만 맞으면 되는 조건(alt) */
  // 문턱만 적힌 줄('500제곱미터 이상')은 꼭 맞아야 하고, '연면적 5천㎡ 이상인 건축물'처럼 설명이 붙은 줄은 다른 조건과 '또는'
  const isGate = (label: string) => /^(\d+제곱미터(이상|초과|미만|이하)|\d+층이상)$/.test(squash(label))
  // 작은 묶음('1) 동물 및 식물 관련시설' / '2) 1)에 해당하지 않는 건축물')이 이 용도인지
  const words = q.useNo ? (USE_WORDS[q.useNo] ?? []) : []
  const subs = [...new Set(cs.map((c) => c.sub).filter(Boolean))] as string[]
  const mineSub = subs.find((s) => words.some((w) => squash(s).includes(w)))
  const subOk = (s?: string): boolean => {
    if (!s) return true
    if (mineSub) return s === mineSub
    return /해당하지\s*않는|그\s*밖|이외/.test(s)
  }
  const condOk = (label: string): boolean | null => {
    const l = squash(label)
    // 지역
    if (/지역/.test(l) && !/면적/.test(l)) {
      const base = l.match(/(준공업지역|상업지역|전용주거지역|주거지역|공업지역)/)?.[1]
      if (!base) return null
      return /외의지역|외지역|이외/.test(l) ? !zoneIs(q.zone, base) : zoneIs(q.zone, base)
    }
    // 공동주택 세부
    for (const w of ['아파트', '연립주택', '다세대주택']) if (l.includes(w)) return q.useNo === '2' ? (sub ? sub.includes(w) || w.includes(sub) : w === '아파트') : false
    if (/장례식장/.test(l)) return q.useNo === '28' || /장례/.test(sub)
    if (/묘지/.test(l)) return q.useNo === '26'
    if (/한옥/.test(l)) return false
    const area = l.match(/(\d+)제곱미터(이상|초과|미만|이하)/)
    if (area) {
      const n = Number(area[1])
      const ok = area[2] === '미만' ? q.area < n : area[2] === '이하' ? q.area <= n : q.area >= n
      return ok && (!/공장|창고/.test(l) || !['17', '18'].includes(q.useNo ?? ''))
    }
    const fl = l.match(/(\d+)층이상/)
    if (fl) return q.floors >= Number(fl[1])
    // 용도 이름이 든 조건
    const words = q.useNo ? (USE_WORDS[q.useNo] ?? []) : []
    if (words.some((w) => l.includes(w))) return true
    return null
  }
  let best: { c: Clause; assumed?: string } | null = null
  for (const g0 of groups) {
    if (!subOk(g0.c.sub)) continue
    // '3m(준공업지역에서 건축하는 경우에는 1.5m)' — 그 지역이면 괄호 값
    const g = g0.c.alt && zoneIs(q.zone, g0.c.alt.zone) ? { ...g0, c: { ...g0.c, m: g0.c.alt.m } } : g0
    if (!g.conds.length) {
      // 조건 없는 값: 직접 다루는 목이면 그대로
      if (direct || !best) best = best && best.c.m! >= g.c.m! ? best : { c: g.c }
      continue
    }
    const gates = g.conds.filter(isGate)
    const alts = g.conds.filter((c) => !isGate(c))
    const gateOk = gates.every((c) => condOk(c) !== false)
    const altOk = !alts.length || alts.some((c) => condOk(c) === true)
    if (gateOk && altOk && (gates.length || alts.length)) {
      const assumed = q.useNo === '2' && !sub && g.conds.some((c) => /아파트/.test(c)) ? '세부 용도를 몰라 아파트로 봄' : undefined
      if (!best || g.c.m! > best.c.m!) best = { c: g.c, assumed }
    }
  }
  return best
}

function pickSection(items: Item[], q: SetbackQuery, notes: string[] = []): SetbackPick | null {
  const matches = items.map((it) => covers(it, q, notes)).filter((m): m is Match => !!m)
  const direct = matches.filter((m) => m.direct)
  const use = direct.length ? direct : matches.filter((m) => !m.direct)
  let best: SetbackPick | null = null
  for (const m of use) {
    const p = pickClause(m.item, q, m.direct)
    if (!p || p.c.m === null) continue
    if (!best || p.c.m > best.m) {
      const head = m.item.header.replace(/\s+/g, ' ').trim()
      best = {
        m: p.c.m,
        item: `${m.item.letter}목`,
        line: `${m.item.letter}. ${head.length > 60 ? `${head.slice(0, 58)}…` : head}${p.c.label ? ` · ${p.c.label.replace(/\s+/g, ' ')}` : ''}: ${p.c.m}m 이상`,
        assumed: m.assumed ?? p.assumed,
      }
    }
  }
  return best
}

/** 조례 표에서 이 계획의 띄울 거리. 맞는 목이 없으면 null(조례가 정하지 않음 → 띄울 거리 없음) */
export function readSetback(tableText: string, q: SetbackQuery): SetbackResult {
  const t = parseSetbackTable(tableText)
  if (!t || (!t.road.length && !t.side.length)) return { road: null, side: null, unread: true, notes: [] }
  const notes: string[] = []
  const road = pickSection(t.road, q, notes)
  const side = pickSection(t.side, q, notes)
  return { road, side, unread: false, notes: [...new Set(notes)] }
}

export interface SetbackAnswer {
  road: number
  side: number
  roadPick: SetbackPick | null
  sidePick: SetbackPick | null
  /** 'ordinance' = 이 지역 조례 표 · 'common' = 표를 못 읽어 다른 시·군에서 가장 흔한 값 · 'none' = 조례 표가 없음 */
  source: 'ordinance' | 'common' | 'none'
  assumed: string[]
}

type RegionLike = { name?: string; building?: { setback?: { tableText?: string } } }

/** 이 지역 조례 표로 띄울 거리. 표를 못 읽으면 다른 시·군 표에서 같은 조건으로 가장 흔한 값을 가정 */
export function setbackFor(region: RegionLike | null, all: RegionLike[], q: SetbackQuery): SetbackAnswer {
  const assumed: string[] = []
  const tt = region?.building?.setback?.tableText
  const r = tt ? readSetback(tt, q) : null
  if (r && !r.unread) {
    for (const p of [r.road, r.side]) if (p?.assumed && !assumed.includes(p.assumed)) assumed.push(p.assumed)
    for (const n of r.notes) if (!assumed.includes(n)) assumed.push(n)
    return { road: r.road?.m ?? 0, side: r.side?.m ?? 0, roadPick: r.road, sidePick: r.side, source: 'ordinance', assumed }
  }
  // 다른 시·군 표에서 같은 용도·규모·지역으로 고른 값의 최빈값
  const roads: number[] = []
  const sides: number[] = []
  for (const o of all) {
    const t = o.building?.setback?.tableText
    if (!t || o === region) continue
    const x = readSetback(t, q)
    if (x.unread) continue
    roads.push(x.road?.m ?? 0)
    sides.push(x.side?.m ?? 0)
  }
  if (!roads.length) return { road: 0, side: 0, roadPick: null, sidePick: null, source: 'none', assumed: ['조례 표가 없어 띄울 거리 없음(0m)으로 봄'] }
  const mode = (xs: number[]) => {
    const c = new Map<number, number>()
    for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
  }
  assumed.push(`이 지역 조례 별표를 아직 읽지 못해 다른 ${roads.length}개 시·군 조례에서 가장 흔한 값으로 봄`)
  return { road: mode(roads), side: mode(sides), roadPick: null, sidePick: null, source: 'common', assumed }
}
