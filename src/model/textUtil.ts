// 사실 문장을 만들 때 쓰는 작은 도우미들

export function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

export function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}

/** 이름 목록 정리: 빈 값·"-" 같은 자리표시 제거, 띄어쓰기만 다른 중복 제거 */
export function cleanNames(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (!name || /^[-–—_.\s]+$/.test(name)) continue
    const key = name.replace(/\s+/g, '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

export function fmt(n: number, digits = 0): string {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

/** 변화율(%) — 소수 첫째 자리, 부호 포함 */
export function changePct(from: number, to: number): string {
  if (!from) return '—'
  const c = ((to - from) / from) * 100
  return `${c >= 0 ? '+' : ''}${c.toFixed(1)}%`
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function listText(items: string[], max = 6, unit = '곳'): string {
  const shown = items.slice(0, max).join(', ')
  return items.length > max ? `${shown} 외 ${items.length - max}${unit}` : shown
}

/** 원 단위 금액을 "836만 원" 식으로 */
export function won(n: number): string {
  if (n >= 100_000_000) return `${fmt(n / 100_000_000, 2)}억 원`
  if (n >= 10_000) return `${fmt(n / 10_000, 0)}만 원`
  return `${fmt(n)}원`
}

export function countBy(values: string[]): [string, number][] {
  const m = new Map<string, number>()
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

/** 받침에 맞춰 조사를 붙인다: josa('역', '이', '가') → '역이', josa('마트', '이', '가') → '마트가' */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const last = word.trim().slice(-1)
  const code = last.charCodeAt(0)
  if (code >= 0xac00 && code <= 0xd7a3) return `${word}${(code - 0xac00) % 28 > 0 ? withFinal : withoutFinal}`
  return `${word}${withFinal}(${withoutFinal})`
}
