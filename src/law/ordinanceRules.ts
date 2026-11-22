// 조례 조문 읽기 (2026-11-22 묶음 F2): 건축 조례의 대지 안의 조경·공개공지, 주차장 조례의 부설주차장 설치기준을
// 받아 둔 조문 글에서 숫자로 읽는다. 시·군마다 쓰는 법이 비슷해(연면적 ○㎡ 이상 … 대지면적의 ○퍼센트) 틀로 읽고,
// 못 읽으면 null(검토서는 흔한 조례 기준을 '가정'으로).
// 다른 파일을 가져오지 않음 — node로 37곳 조례에 시험할 수 있게.

export interface Bundle {
  articles: { article: string; title: string; text: string }[]
  tables: Record<string, { title: string; text: string; why?: string }>
}

const squash = (s: string) => s.replace(/\s+/g, '')

/** 숫자 쓰는 법 맞추기: '2천제곱미터' → '2000제곱미터', '2,000' → '2000', '퍼센트'·'%'·'100분의 n' → 'n퍼센트' */
export function normRuleText(s: string): string {
  return s
    .replace(/\r/g, '')
    .replace(/[｢「」｣]/g, '')
    .replace(/제\s*곱\s*미\s*터|㎡|m2|m²/g, '제곱미터')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/(\d+)\s*만\s*(\d+)\s*천\s*제곱미터/g, (_, a, b) => `${Number(a) * 10000 + Number(b) * 1000}제곱미터`)
    .replace(/(\d+)\s*만\s*제곱미터/g, (_, a) => `${Number(a) * 10000}제곱미터`)
    .replace(/(\d+)\s*천\s*(\d+)\s*백\s*제곱미터/g, (_, a, b) => `${Number(a) * 1000 + Number(b) * 100}제곱미터`)
    // '1천500제곱미터'(무안) = 1500
    .replace(/(\d+)\s*천\s*(\d{1,3})\s*제곱미터/g, (_, a, b) => `${Number(a) * 1000 + Number(b)}제곱미터`)
    .replace(/(\d+)\s*천\s*제곱미터/g, (_, a) => `${Number(a) * 1000}제곱미터`)
    .replace(/100\s*분의\s*(\d+(?:\.\d+)?)/g, '$1퍼센트')
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1퍼센트')
}

/** 조문 글을 호('1.', '2.')마다 */
function items(text: string): string[] {
  return text.split(/(?<=\s|^)(?=\d{1,2}\.\s)/).map((x) => x.trim()).filter(Boolean)
}

/** 첫 항(①)만 — 뒤 항의 다른 기준이 섞이지 않게 */
const firstPara = (t: string) => {
  const m = t.search(/\s②/)
  return m > 0 ? t.slice(0, m) : t
}

export interface RatioAnswer {
  pct: number
  /** 근거 줄 */
  line: string
  article: string
  /** 의무 없음(빼 주는 경우) */
  exempt?: string
}

/** 대지 안의 조경: 연면적 구간별 대지면적의 ○퍼센트 + 작은 대지·상업지역 작은 대지 예외 */
export function readLandscape(b: Bundle | undefined, q: { gfa: number; siteArea: number; zone: string }): RatioAnswer | null {
  if (!b) return null
  for (const a of b.articles) {
    const all = normRuleText(a.text)
    const t = firstPara(all)
    let pick: RatioAnswer | null = null
    for (const it of items(t)) {
      const m = it.match(/대지\s*면적의?\s*(\d+(?:\.\d+)?)퍼센트/)
      if (!m) continue
      const lo = it.match(/(\d+)제곱미터\s*이상/)
      const hi = it.match(/(\d+)제곱미터\s*미만/)
      // 용도지역을 적은 호는 그 지역일 때만
      const zoneWord = it.match(/(주거|상업|공업|녹지|관리)지역/)
      if (zoneWord && !squash(q.zone).includes(zoneWord[1])) continue
      const okLo = !lo || q.gfa >= Number(lo[1])
      const okHi = !hi || q.gfa < Number(hi[1])
      if (okLo && okHi && (!pick || Number(m[1]) > pick.pct)) pick = { pct: Number(m[1]), line: it.replace(/\s+/g, ' ').slice(0, 120), article: `${a.article}(${a.title}) ①` }
    }
    if (!pick) continue
    // 작은 대지 (200~300㎡ 등은 대지면적의 ○퍼센트)
    const small = all.match(/(?:대지)?면적\s*(\d+)제곱미터\s*이상\s*(\d+)제곱미터\s*미만인\s*대지에\s*건축하는\s*건축물의\s*조경면적은\s*대지\s*면적의?\s*(\d+(?:\.\d+)?)퍼센트/)
    if (small && q.siteArea >= Number(small[1]) && q.siteArea < Number(small[2])) pick = { ...pick, pct: Number(small[3]), line: small[0].slice(0, 120) }
    // 상업지역 작은 대지는 조경 의무 없음
    // '상업지역 안의 건축물로서 대지면적 500㎡ 이하'(목포) · '일반상업지역에서 대지면적이 300㎡ 이하'(강진)
    const ex = all.match(/상업지역\s*(?:안의\s*건축물로[서써]|안에서|에서)\s*대지면적(?:이)?\s*(\d+)제곱미터\s*(이하|미만)/)
    if (ex && /상업지역/.test(q.zone) && (ex[2] === '이하' ? q.siteArea <= Number(ex[1]) : q.siteArea < Number(ex[1]))) return { ...pick, pct: 0, exempt: ex[0].slice(0, 100) }
    return pick
  }
  return null
}

/** 별표 1 호 → 이름 (공개공지 대상 용도 읽기) */
const USE_WORDS: [string, string][] = [
  ['문화및집회', '5'], ['종교', '6'], ['판매', '7'], ['운수', '8'], ['의료', '9'], ['교육연구', '10'], ['노유자', '11'], ['수련', '12'], ['운동', '13'],
  ['업무', '14'], ['숙박', '15'], ['위락', '16'], ['장례', '28'], ['관광휴게', '27'], ['방송통신', '24'], ['공동주택', '2'], ['근린생활', '3'],
]

export interface OpenSpaceAnswer {
  /** 조례가 더한 대상 용도인지 */
  ordinanceTarget: boolean
  /** 비율(퍼센트) — 못 읽으면 null */
  pct: number | null
  minGfa: number | null
  line: string
  article: string
}

/** 공개공지: 조례가 더한 대상 용도(2호)와 면적 비율(연면적 구간별·대상별·하나) */
export function readOpenSpace(b: Bundle | undefined, q: { useNo: string | null; gfa: number; lawTarget: boolean }): OpenSpaceAnswer | null {
  if (!b) return null
  for (const a of b.articles) {
    const t = normRuleText(a.text)
    // 대상은 첫 항(①)에: '연면적 합계가 5천㎡ 이상인 의료시설·운동시설' 또는 '… 건축물은 다음 각 호와 같다. 1. 의료시설 2. 운동시설 …'
    const p1 = firstPara(t)
    const mg = p1.match(/(\d+)제곱미터\s*이상/)
    const minGfa = mg ? Number(mg[1]) : null
    const words = squash(p1)
    const ordinanceTarget = !!q.useNo && USE_WORDS.some(([w, no]) => no === q.useNo && words.includes(w))
    if (!ordinanceTarget && !q.lawTarget) continue
    let pct: number | null = null
    let line = ''
    // 용도마다 비율 ('1. 판매시설 : 10퍼센트 2. 업무시설 : 8퍼센트' — 화순·해남·정읍)
    const myWords = USE_WORDS.filter(([, no]) => no === q.useNo).map(([w]) => w)
    for (const it of items(firstPara(t))) {
      const m = it.match(/^\d{1,2}\.\s*([^:：\d]{2,60}?)\s*[:：]\s*(\d+(?:\.\d+)?)퍼센트/)
      if (m && myWords.some((w) => squash(m[1]).includes(w))) {
        pct = Number(m[2])
        line = it.replace(/\s+/g, ' ').slice(0, 120)
        break
      }
    }
    // 비율: 연면적 구간 ('연면적의 합계가 5천㎡ 이상 1만㎡ 미만인 경우 : 6퍼센트' — 완도처럼 '대지면적의'가 없어도)
    if (pct === null)
      for (const it of items(t)) {
        const lo = it.match(/(\d+)제곱미터\s*이상/)
        const hi = it.match(/(\d+)제곱미터\s*미만/)
        const m = it.match(/대지\s*면적의?\s*(\d+(?:\.\d+)?)퍼센트/) ?? (lo ? it.match(/[:：]\s*(\d+(?:\.\d+)?)퍼센트/) : null)
        if (!m) continue
        if (lo && !(q.gfa >= Number(lo[1]) && (!hi || q.gfa < Number(hi[1])))) continue
        pct = Number(m[1])
        line = it.replace(/\s+/g, ' ').slice(0, 120)
        break
      }
    // 대상별 ('가. 제1호에 해당하는 건축물: 8퍼센트 나. 영 제27조의2제1항제1호에 해당하는 건축물: 10퍼센트')
    const byGroup = [...t.matchAll(/([가-하])\.\s*([^:：]{0,40}?)(?:에\s*해당하는\s*건축물)\s*[:：]\s*대지면적의\s*(\d+(?:\.\d+)?)퍼센트/g)]
    if (byGroup.length >= 2) {
      const g = byGroup.find((x) => (q.lawTarget ? /영\s*제27조의2/.test(x[2]) : !/영\s*제27조의2/.test(x[2])))
      if (g) {
        pct = Number(g[3])
        line = g[0].replace(/\s+/g, ' ').slice(0, 120)
      }
    }
    // '공개 공지 … 10퍼센트를 확보하여야 하는 건축물' (강진·영광)
    if (pct === null) {
      const inHead = p1.match(/공개\s*공지[^.]{0,40}?(\d+(?:\.\d+)?)퍼센트/)
      if (inHead) {
        pct = Number(inHead[1])
        line = inHead[0].replace(/\s+/g, ' ').slice(0, 120)
      }
    }
    if (pct === null) {
      const one = t.match(/대지\s*면적의?\s*(\d+(?:\.\d+)?)퍼센트/)
      if (one) {
        pct = Number(one[1])
        line = t.slice(Math.max(0, (one.index ?? 0) - 40), (one.index ?? 0) + 20).replace(/\s+/g, ' ')
      }
    }
    return { ordinanceTarget, pct, minGfa, line, article: `${a.article}(${a.title})` }
  }
  return null
}

export interface ParkingAnswer {
  /** 시설면적 ○㎡당 1대 */
  per: number | null
  line: string
  source: string
}

/** 주차장 조례: '부설주차장의 설치대상 시설물 종류 및 설치기준' 별표가 있으면 그 용도 줄의 '시설면적 ○㎡당 1대' */
export function readParking(b: Bundle | undefined, q: { rowWords: string[] }): ParkingAnswer | { none: true } | null {
  if (!b) return null
  const table = Object.entries(b.tables).find(([, v]) => v.text && /부설주차장의?설치대상시설물|부설주차장의?설치기준/.test(squash(v.title + v.text.slice(0, 400))))
  if (!table) return { none: true }
  const [no, v] = table
  const t = normRuleText(v.text)
  const lines = t.split('\n').map((l) => l.replace(/[┃│├┤┼─━┌┐└┘┬┴╋┠┨┯┷┏┓┗┛]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean)
  for (let i = 0; i < lines.length; i++) {
    const l = squash(lines[i])
    if (!q.rowWords.some((w) => l.includes(w))) continue
    for (let j = i; j < Math.min(lines.length, i + 6); j++) {
      const m = lines[j].match(/시설면적\s*(\d+(?:\.\d+)?)제곱미터\s*당\s*1\s*대/)
      if (m) return { per: Number(m[1]), line: lines.slice(i, j + 1).join(' ').slice(0, 140), source: `별표 ${no} ${v.title}`.trim() }
    }
  }
  return { per: null, line: '', source: `별표 ${no} ${v.title}`.trim() }
}

/** 주차장 조례가 공동주택 면적당 대수를 강화했으면 ('85㎡ 이하 1/65 · 85㎡ 초과 1/57' — 여수·영광) */
export function readParkingApt(b: Bundle | undefined): { small: number; large: number; source: string } | null {
  if (!b) return null
  for (const [no, v] of Object.entries(b.tables)) {
    if (!v.text) continue
    const t = normRuleText(v.text).replace(/\s+/g, '')
    const m = t.match(/85제곱미터이하1\/(\d+)85제곱미터초과1\/(\d+)/)
    if (m) return { small: Number(m[1]), large: Number(m[2]), source: `별표 ${no} ${v.title}`.trim() }
  }
  return null
}

export interface ScenicHeight {
  /** 경관지구 이름 (예: '자연경관지구') */
  district: string
  maxFloors: number | null
  maxM: number | null
  /** 최저 층수 ('2층 이상' — 시가지경관지구) */
  minFloors: number | null
  line: string
  article: string
  assumed: string[]
  /** 심의를 거치면 완화 ('기준높이의 1.5배까지') */
  relax?: string
}

const ZONE_WORDS = ['주거', '상업', '공업', '녹지', '관리']

/**
 * 경관지구 안 건축물 높이·층수 (묶음 F5, 2026-11-22): 도시계획 조례의 '경관지구 안에서의 높이' 조문에서
 * 그 경관지구 종류의 호('자연경관지구 : 3층 또는 12미터 이하')를 찾고, 괄호의 용도지역 예외('주거·상업·공업지역 이외의 용도지역에서는 …')를 반영.
 * 종류를 나누지 않은 조례('경관지구 안에서 … 3층 이하 … 12미터 이하')와 용도지역별 조례('주거지역은 12미터, 상업지역은 20미터')도 읽음
 */
export function readScenicHeight(b: Bundle | undefined, q: { district: string; zone: string }): ScenicHeight | null {
  if (!b) return null
  const kind = squash(q.district).replace(/^\d종/, '')
  const zoneIn = (txt: string) => ZONE_WORDS.filter((w) => txt.includes(w)).some((w) => squash(q.zone).includes(w))
  const nums = (s: string) => ({
    maxFloors: Number(s.match(/(\d+)\s*층\s*(?:이하|까지)?(?:\s*(?:또는|,|로\s*하고|이하로\s*하고))/)?.[1] ?? s.match(/(\d+)\s*층\s*(?:이하|까지)/)?.[1] ?? NaN),
    maxM: Number(s.match(/(\d+(?:\.\d+)?)\s*미터\s*(?:이하|까지)/)?.[1] ?? NaN),
    minFloors: Number(s.match(/(\d+)\s*층\s*이상/)?.[1] ?? NaN),
  })
  const fin = (v: number) => (Number.isFinite(v) ? v : null)
  for (const a of b.articles.filter((x) => /높이|층수/.test(x.title))) {
    const t = normRuleText(a.text).replace(/<[^>]*>/g, '')
    const relax = t.match(/기준\s*높이의\s*(\d+(?:\.\d+)?)배/)?.[0]
    const assumed: string[] = []
    // 1) 그 종류를 적은 호
    for (const it of items(t)) {
      const s = squash(it)
      if (!kind || !s.includes(kind)) continue
      const head = it.replace(/\([^()]*\)/g, '')
      let n = nums(head)
      // 괄호 예외: '(주거지역, 상업지역, 공업지역 이외의 용도지역에서는 3층 또는 12미터 이하)' / '(… 안에서는 5층 또는 20미터 이하)'
      const par = it.match(/\(([^()]*?(?:이외의\s*용도지역|지역\s*안에서는|지역에서는)[^()]*?)\)/)
      if (par) {
        const inside = par[1]
        const outsideRule = /이외의\s*용도지역/.test(inside)
        const listed = inside.split(/이외의|안에서는|에서는/)[0]
        const hit = outsideRule ? !zoneIn(listed) : zoneIn(listed)
        if (hit) {
          n = nums(inside)
          assumed.push(`대지가 ${q.zone}라 괄호의 기준을 씀`)
        }
      }
      if (n.maxFloors || n.maxM || n.minFloors) {
        if (/또는/.test(it) && n.maxFloors && n.maxM) assumed.push('층수와 높이 중 낮은 쪽으로 봄')
        return { district: q.district, maxFloors: fin(n.maxFloors), maxM: fin(n.maxM), minFloors: fin(n.minFloors), line: it.replace(/^제\d+조(?:의\d+)?\([^)]*\)\s*/, '').replace(/\s+/g, ' ').slice(0, 140), article: `${a.article}(${a.title})`, assumed, relax }
      }
    }
    // 2) 종류를 나누지 않은 조문: '경관지구 안에서 건축하는 건축물의 (높이·)?층수는 3층 이하 … 12미터 이하'
    //    — 호마다 종류를 적은 조례('자연경관지구 : …')나 제목이 종류를 정한 조문('자연경관지구 및 특화경관지구에서의 …')에서는 쓰지 않음
    const typed = items(t).some((it) => /[가-힣]+경관지구\s*[:：]/.test(it))
    const titleKinds = [...a.title.matchAll(/([가-힣]+경관지구)/g)].map((m) => squash(m[1]))
    if (typed || (titleKinds.length && !titleKinds.some((k) => k === kind))) continue
    const any = squash(t).match(/경관지구(?:안에서|에서|안)건축하는건축물의(?:높이[·ㆍ]?)?층수(?:[·ㆍ]높이)?는/)
    const zoneRule = [...t.matchAll(/([가-힣]+지역)(?:\s*및\s*([가-힣]+지역))?(?:은|는)\s*(\d+(?:\.\d+)?)\s*미터\s*이하/g)]
    if (zoneRule.length && /경관지구/.test(t)) {
      const z = zoneRule.find((m) => [m[1], m[2]].filter(Boolean).some((w) => ZONE_WORDS.some((zw) => w.includes(zw) && squash(q.zone).includes(zw))))
      if (z) return { district: q.district, maxFloors: null, maxM: Number(z[3]), minFloors: null, line: z[0], article: `${a.article}(${a.title})`, assumed: ['조례가 경관지구 종류를 나누지 않아 이 경관지구에도 적용으로 봄'], relax }
    }
    if (any) {
      const n = nums(t)
      if (n.maxFloors || n.maxM)
        return {
          district: q.district,
          maxFloors: fin(n.maxFloors),
          maxM: fin(n.maxM),
          minFloors: null,
          line: t.slice(0, 160).replace(/\s+/g, ' '),
          article: `${a.article}(${a.title})`,
          assumed: ['조례가 경관지구 종류를 나누지 않아 이 경관지구에도 적용으로 봄', ...(n.maxFloors && n.maxM ? ['층수와 높이 중 낮은 쪽으로 봄'] : [])],
          relax,
        }
    }
  }
  return null
}
