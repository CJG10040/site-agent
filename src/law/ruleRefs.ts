// '법 바뀜' 경고 (2026-11-21 묶음 F3): 검토서 줄마다 판정 규칙을 만들 때 본 조문·별표 글의 지문(fingerprint.ts)을 둔다.
// 매주 받는 조례 표의 글이 이 지문과 다르면 그 줄에 '법 바뀜 — 규칙 다시 확인'을 띄운다(사용자 결정: 앱 규칙 + 법 바뀌면 경고).
// 지문은 2026-11-21에 받은 표(법령 시행일은 effective)로 만듦 — 묶음 F2(2026-11-22)에서 시행령 별표 2~22(용도지역별, 줄 id 'zone-use:별표번호')·주택건설기준·건축법 제51조·시행령 별표 2를 더함. 규칙을 고친 뒤에는 지문도 새 글로 다시 만든다.

import { fingerprint, partOf } from './fingerprint'
import type { OrdinanceTable } from './ordinances'

export interface RuleRef {
  law: string
  /** '제58조' 또는 '별표 1' */
  where: string
  /** 조문에서 규칙이 쓰는 부분 (정규식) */
  part?: string
  fp: string
  /** 규칙을 만들 때 법령 시행일 */
  effective: string
}

export const RULE_REFS: Record<string, RuleRef[]> = {
  'bcr': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "제84조", fp: "4yla1o-37d", effective: "20260918" },
  ],
  'far': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "제85조", fp: "1apa6u4-2qv", effective: "20260918" },
  ],
  'road': [
    { law: "건축법", where: "제44조", fp: "yoyneo-6p", effective: "20261112" },
    { law: "건축법 시행령", where: "제28조", fp: "14q3euv-7j", effective: "20261112" },
    { law: "주택건설기준 등에 관한 규정", where: "제25조", fp: "qimuqv-vx", effective: "20261107" },
  ],
  'line': [
    { law: "건축법", where: "제46조", fp: "1ucruqc-bp", effective: "20261112" },
  ],
  'setback': [
    { law: "건축법", where: "제58조", fp: "3cdixg-3y", effective: "20261112" },
    { law: "건축법 시행령", where: "제80조의2", fp: "cs3y4r-4o", effective: "20261112" },
    { law: "건축법 시행령", where: "별표 2", fp: "hqixyf-1vz", effective: "20261112" },
  ],
  'north': [
    { law: "건축법", where: "제61조", fp: "ntobd8-q7", effective: "20261112" },
    { law: "건축법 시행령", where: "제86조", part: "②.*?(?=③)", fp: "l31olv-df", effective: "20261112" },
  ],
  'apt-light': [
    { law: "건축법 시행령", where: "제86조", part: "③.*?(?=④)", fp: "xhxwyh-qv", effective: "20261112" },
  ],
  'height': [
    { law: "건축법", where: "제60조", fp: "1tg3gks-bi", effective: "20261112" },
  ],
  'landscape': [
    { law: "건축법", where: "제42조", fp: "mwvqp9-6w", effective: "20261112" },
    { law: "건축법 시행령", where: "제27조", fp: "vprc0t-115", effective: "20261112" },
  ],
  'openspace': [
    { law: "건축법", where: "제43조", fp: "lsbdxb-er", effective: "20261112" },
    { law: "건축법 시행령", where: "제27조의2", fp: "1cijxsv-10g", effective: "20261112" },
  ],
  'parking': [
    { law: "주차장법 시행령", where: "별표 1", fp: "1h31el3-36v", effective: "20260828" },
    { law: "주택건설기준 등에 관한 규정", where: "제27조", fp: "1xuicei-2cb", effective: "20261107" },
  ],
  'multi': [
    { law: "건축법 시행령", where: "제2조", part: "17\\.\\s*\"다중이용 건축물\".*?(?=\\s18\\.)", fp: "glnl3v-9k", effective: "20261112" },
  ],
  'elevator': [
    { law: "건축법", where: "제64조", fp: "1w1id6u-84", effective: "20261112" },
  ],
  'fire-compartment': [
    { law: "건축법 시행령", where: "제46조", part: "①.*?(?=②)", fp: "1iad8ec-6p", effective: "20261112" },
  ],
  'egress': [
    { law: "건축법 시행령", where: "제34조", fp: "iskqyx-196", effective: "20261112" },
    { law: "건축법 시행령", where: "제35조", fp: "1wk1diz-ke", effective: "20261112" },
  ],
  'energy': [
    { law: "녹색건축물 조성 지원법 시행령", where: "제10조", fp: "133y3mf-ey", effective: "20260331" },
  ],
  'school-zone': [
    { law: "교육환경 보호에 관한 법률", where: "제8조", fp: "149x6if-f0", effective: "20260603" },
    { law: "교육환경 보호에 관한 법률", where: "제9조", fp: "10ua3oj-20x", effective: "20260603" },
  ],
  'heritage': [
    { law: "문화유산의 보존 및 활용에 관한 법률", where: "제13조", fp: "1pq049i-xp", effective: "20260624" },
  ],
  'art': [
    { law: "문화예술진흥법 시행령", where: "제12조", fp: "1hde4jt-xj", effective: "20260324" },
  ],
  'zone-use:2': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 2", fp: "13klyr7-ja", effective: "20260918" },
  ],
  'zone-use:3': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 3", fp: "1i88dtf-e2", effective: "20260918" },
  ],
  'zone-use:4': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 4", fp: "1a3be1h-1sl", effective: "20260918" },
  ],
  'zone-use:5': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 5", fp: "1t2vhvd-115", effective: "20260918" },
  ],
  'zone-use:6': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 6", fp: "1kcr5dg-xq", effective: "20260918" },
  ],
  'zone-use:7': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 7", fp: "s0fhbi-wq", effective: "20260918" },
  ],
  'zone-use:8': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 8", fp: "1fvw85u-13a", effective: "20260918" },
  ],
  'zone-use:9': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 9", fp: "15yfx2j-wx", effective: "20260918" },
  ],
  'zone-use:10': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 10", fp: "1cxl86h-13q", effective: "20260918" },
  ],
  'zone-use:11': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 11", fp: "odkurr-yv", effective: "20260918" },
  ],
  'zone-use:12': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 12", fp: "85u1iw-mz", effective: "20260918" },
  ],
  'zone-use:13': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 13", fp: "1bdte6g-nl", effective: "20260918" },
  ],
  'zone-use:14': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 14", fp: "199wa1g-fl", effective: "20260918" },
  ],
  'zone-use:15': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 15", fp: "146k06e-pp", effective: "20260918" },
  ],
  'zone-use:16': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 16", fp: "144hp6c-1dt", effective: "20260918" },
  ],
  'zone-use:17': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 17", fp: "1j8l2xj-1cu", effective: "20260918" },
  ],
  'zone-use:18': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 18", fp: "qjpvjt-ql", effective: "20260918" },
  ],
  'zone-use:19': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 19", fp: "217p7o-17k", effective: "20260918" },
  ],
  'zone-use:20': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 20", fp: "1g51zbp-2hs", effective: "20260918" },
  ],
  'zone-use:21': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 21", fp: "5lx49j-sd", effective: "20260918" },
  ],
  'zone-use:22': [
    { law: "국토의 계획 및 이용에 관한 법률 시행령", where: "별표 22", fp: "3i73hf-lu", effective: "20260918" },
  ],
  'fire-district': [
    { law: "건축법", where: "제51조", fp: "el6ddr-89", effective: "20261112" },
  ],
}

/** 받아 둔 표에서 그 조문·별표의 지금 글 (없으면 null — 비교하지 않음) */
function currentText(table: OrdinanceTable, r: RuleRef): { text: string; effective?: string } | null {
  if (r.where.startsWith('별표')) {
    const lt = table.lawTables?.[r.law]
    const t = lt?.tables?.[r.where.replace(/\D/g, '')]?.text
    return t ? { text: t, effective: lt?.effective } : null
  }
  const l = table.laws?.[r.law]
  const t = l?.articles?.[r.where]?.text
  return t ? { text: t, effective: l?.effective } : null
}

/** 이 줄의 규칙을 만든 뒤 바뀐 조문·별표 */
export function changedRefs(table: OrdinanceTable | null, rowId: string): { ref: RuleRef; effective?: string }[] {
  if (!table) return []
  const out: { ref: RuleRef; effective?: string }[] = []
  for (const r of RULE_REFS[rowId] ?? []) {
    const cur = currentText(table, r)
    if (cur && fingerprint(partOf(cur.text, r.part)) !== r.fp) out.push({ ref: r, effective: cur.effective })
  }
  return out
}
