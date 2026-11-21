// 올린 글꼴 (2026-11-21 묶음 D3): .ttf·.otf·.woff·.woff2를 이 브라우저 저장소에만 둔다 (저장소·다른 기기로 안 감).
// 도판 화면(그림으로 보여 주는 SVG)과 PNG에는 글꼴을 SVG 안에 넣어 그리고, 받는 SVG에는 글꼴 이름만 적는다
// (일러스트레이터는 컴퓨터에 깔린 같은 이름의 글꼴로 엶). 큰 보기 편집기처럼 화면에 바로 그리는 곳은 FontFace로 등록한 글꼴을 씀.

import { deleteFont, listFontRecords, putFont, type FontRecord } from '../model/db'

export type { FontRecord }

const FORMAT: Record<string, { format: string; mime: string }> = {
  ttf: { format: 'truetype', mime: 'font/ttf' },
  otf: { format: 'opentype', mime: 'font/otf' },
  woff: { format: 'woff', mime: 'font/woff' },
  woff2: { format: 'woff2', mime: 'font/woff2' },
}

export const FONT_ACCEPT = '.ttf,.otf,.woff,.woff2'
/** 한 파일 최대 (한글 글꼴은 수 MB — 너무 크면 도판 화면이 무거워짐) */
export const FONT_MAX_BYTES = 25 * 1024 * 1024

// ───────────────────────── 글꼴 파일에서 이름·굵기 읽기 ─────────────────────────

interface Table {
  offset: number
  length: number
  /** woff: 압축된 길이 (같으면 압축 안 됨) */
  comp?: number
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate')
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(ds))
  return new Uint8Array(await out.arrayBuffer())
}

/** 표 하나의 바이트 (woff는 풀어서) */
async function tableBytes(buf: ArrayBuffer, t: Table): Promise<DataView> {
  const raw = new Uint8Array(buf, t.offset, t.comp ?? t.length)
  if (t.comp !== undefined && t.comp < t.length) return new DataView((await inflate(raw)).buffer)
  return new DataView(raw.slice().buffer)
}

function tablesOf(buf: ArrayBuffer): Map<string, Table> | null {
  const dv = new DataView(buf)
  if (buf.byteLength < 12) return null
  const sig = dv.getUint32(0)
  const tag = (o: number) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3))
  const out = new Map<string, Table>()
  if (sig === 0x774f4646) {
    // woff: 머리 44바이트, 표 목록 20바이트씩
    const n = dv.getUint16(12)
    for (let i = 0; i < n; i++) {
      const o = 44 + i * 20
      out.set(tag(o), { offset: dv.getUint32(o + 4), comp: dv.getUint32(o + 8), length: dv.getUint32(o + 12) })
    }
    return out
  }
  if (sig === 0x00010000 || sig === 0x4f54544f || sig === 0x74727565) {
    // ttf·otf: 표 목록 16바이트씩
    const n = dv.getUint16(4)
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16
      out.set(tag(o), { offset: dv.getUint32(o + 8), length: dv.getUint32(o + 12) })
    }
    return out
  }
  return null // woff2(브로틀리 압축)는 못 읽음 → 파일 이름으로
}

/** name 표: 글꼴 집안 이름 (영문 우선 — 일러스트레이터·브라우저가 찾기 쉬움) */
function familyFrom(dv: DataView): string | null {
  const count = dv.getUint16(2)
  const strOff = dv.getUint16(4)
  const found: { id: number; lang: number; plat: number; text: string }[] = []
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 12
    const plat = dv.getUint16(o)
    const lang = dv.getUint16(o + 4)
    const id = dv.getUint16(o + 6)
    const len = dv.getUint16(o + 8)
    const off = dv.getUint16(o + 10)
    if (id !== 1 && id !== 16) continue
    const start = strOff + off
    if (start + len > dv.byteLength) continue
    let text = ''
    if (plat === 3 || plat === 0) for (let k = 0; k + 1 < len; k += 2) text += String.fromCharCode(dv.getUint16(start + k))
    else if (plat === 1) for (let k = 0; k < len; k++) text += String.fromCharCode(dv.getUint8(start + k))
    if (text.trim()) found.push({ id, lang, plat, text: text.trim() })
  }
  const pick = (id: number) =>
    found.find((f) => f.id === id && f.plat === 3 && f.lang === 0x0409) ?? found.find((f) => f.id === id && f.plat === 1 && f.lang === 0) ?? found.find((f) => f.id === id)
  return (pick(16) ?? pick(1))?.text ?? null
}

const WEIGHT_WORDS: [RegExp, number][] = [
  [/thin|hairline/i, 100],
  [/extra.?light|ultra.?light/i, 200],
  [/light/i, 300],
  [/medium/i, 500],
  [/semi.?bold|demi.?bold/i, 600],
  [/extra.?bold|ultra.?bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
]

function weightFromName(name: string): number {
  for (const [re, w] of WEIGHT_WORDS) if (re.test(name)) return w
  return 400
}

/** 파일 이름에서 집안 이름 어림 (woff2 등): 굵기·모양 낱말을 뺌 */
function familyFromFileName(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[-_ ]?(thin|hairline|extra.?light|ultra.?light|light|regular|book|normal|medium|semi.?bold|demi.?bold|extra.?bold|ultra.?bold|bold|black|heavy|italic|oblique|variable|vf)\b/gi, '')
      .replace(/[-_]+$/, '')
      .trim() || name
  )
}

export async function readFontInfo(file: File): Promise<{ family: string; guessed: boolean; weight: number; italic: boolean; ext: string }> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  const buf = await file.arrayBuffer()
  let family: string | null = null
  let weight: number | null = null
  let italic = /italic|oblique/i.test(file.name)
  try {
    const tables = tablesOf(buf)
    const name = tables?.get('name')
    if (tables && name) family = familyFrom(await tableBytes(buf, name))
    const os2 = tables?.get('OS/2')
    if (tables && os2) {
      const dv = await tableBytes(buf, os2)
      const w = dv.getUint16(4)
      if (w >= 100 && w <= 1000) weight = w
      italic = italic || (dv.getUint16(62) & 1) === 1
    }
  } catch {
    // 못 읽으면 파일 이름으로
  }
  return { family: family ?? familyFromFileName(file.name), guessed: !family, weight: weight ?? weightFromName(file.name), italic, ext }
}

// ───────────────────────── 저장·등록 ─────────────────────────

const listeners = new Set<() => void>()
export function onFontsChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const changed = () => listeners.forEach((fn) => fn())

export async function listFonts(): Promise<FontRecord[]> {
  return listFontRecords()
}

export async function addFontFiles(files: File[]): Promise<{ added: FontRecord[]; skipped: string[] }> {
  const added: FontRecord[] = []
  const skipped: string[] = []
  for (const f of files) {
    const ext = (f.name.split('.').pop() ?? '').toLowerCase()
    if (!FORMAT[ext]) {
      skipped.push(`${f.name} (글꼴 파일이 아님)`)
      continue
    }
    if (f.size > FONT_MAX_BYTES) {
      skipped.push(`${f.name} (${Math.round(f.size / 1048576)}MB — 25MB까지)`)
      continue
    }
    const info = await readFontInfo(f)
    const rec: FontRecord = {
      id: `font-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      family: info.family,
      readName: info.family,
      guessed: info.guessed,
      fileName: f.name,
      weight: info.weight,
      italic: info.italic,
      ext,
      size: f.size,
      data: new Blob([await f.arrayBuffer()], { type: FORMAT[ext].mime }),
      addedAt: new Date().toISOString(),
    }
    await putFont(rec)
    added.push(rec)
  }
  if (added.length) {
    registered.clear()
    cssCache.clear()
    changed()
  }
  return { added, skipped }
}

export async function removeFont(id: string): Promise<void> {
  await deleteFont(id)
  registered.clear()
  cssCache.clear()
  changed()
}

export async function renameFamily(from: string, to: string): Promise<void> {
  const name = to.replace(/['"<>&;{}]/g, '').trim()
  if (!name || name === from) return
  for (const r of await listFontRecords()) if (r.family === from) await putFont({ ...r, family: name })
  registered.clear()
  cssCache.clear()
  changed()
}

/** 화면에 바로 그리는 곳(큰 보기 편집기 등)에서 쓰도록 FontFace로 등록 */
const registered = new Map<string, FontFace>()
export async function registerFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  for (const r of await listFontRecords()) {
    const key = `${r.id}|${r.family}`
    if (registered.has(key)) continue
    try {
      const face = new FontFace(r.family, await r.data.arrayBuffer(), { weight: String(r.weight), style: r.italic ? 'italic' : 'normal' })
      await face.load()
      document.fonts.add(face)
      registered.set(key, face)
    } catch {
      // 깨진 파일은 건너뜀
    }
  }
}

function dataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader()
    fr.onload = () => res(String(fr.result))
    fr.onerror = () => rej(fr.error)
    fr.readAsDataURL(b)
  })
}

/** SVG 안에 넣을 글꼴 (<style>@font-face…</style>) — 같은 집안 이름의 올린 글꼴 모두. 없으면 null */
const cssCache = new Map<string, Promise<Blob | null>>()
export function fontStyleBlob(family: string): Promise<Blob | null> {
  if (!family) return Promise.resolve(null)
  let hit = cssCache.get(family)
  if (!hit) {
    hit = (async () => {
      const recs = (await listFontRecords()).filter((r) => r.family === family)
      if (!recs.length) return null
      const rules: string[] = []
      for (const r of recs) {
        const url = (await dataUrl(r.data)).replace(/^data:[^;]*;/, `data:${FORMAT[r.ext]?.mime ?? 'font/ttf'};`)
        rules.push(`@font-face{font-family:'${r.family}';src:url(${url}) format('${FORMAT[r.ext]?.format ?? 'truetype'}');font-weight:${r.weight};font-style:${r.italic ? 'italic' : 'normal'}}`)
      }
      return new Blob([`<style>${rules.join('')}</style>`], { type: 'text/plain' })
    })()
    cssCache.set(family, hit)
  }
  return hit
}

/** SVG 글 + 글꼴 → 그림용 Blob (글꼴 바이트는 Blob 조각으로 함께 써서 도판마다 복사하지 않음) */
export function svgBlobWithFont(svg: string, font: Blob | null): Blob {
  const head = '<?xml version="1.0" encoding="UTF-8"?>\n'
  if (!font) return new Blob([head, svg], { type: 'image/svg+xml;charset=utf-8' })
  const i = svg.indexOf('>', svg.indexOf('<svg')) + 1
  return new Blob([head, svg.slice(0, i), font, svg.slice(i)], { type: 'image/svg+xml;charset=utf-8' })
}

/** 올린 글꼴 서명 (도판 다시 그리기 열쇠) */
export function fontsSig(list: FontRecord[]): string {
  return list.map((r) => `${r.id}:${r.family}`).join(',')
}
