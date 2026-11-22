// 법 글 지문 (2026-11-21 묶음 F3): 판정 규칙을 만들 때 본 조문·별표 글과 매주 받는 글이 같은지 보려고 짧은 해시를 만든다.
// 띄어쓰기·줄바꿈은 빼고 잼(받을 때 글 모양이 조금 달라도 같은 글로 보게). 다른 파일을 가져오지 않음 — node로 기준 지문을 만들 수 있게.

/** 글의 지문 (공백을 뺀 글의 FNV-1a 32비트 + 길이) */
export function fingerprint(text: string): string {
  const s = text.replace(/\s+/g, '')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `${(h >>> 0).toString(36)}-${s.length.toString(36)}`
}

/** 조문 글에서 규칙이 쓰는 부분만 (예: 제2조의 17호) — 같은 조의 다른 호가 바뀌어도 경고하지 않게 */
export function partOf(text: string, part?: string): string {
  if (!part) return text
  const m = text.match(new RegExp(part, 's'))
  return m ? m[0] : text
}
