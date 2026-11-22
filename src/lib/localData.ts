// 내 PC 자료 폴더 (2026-11-22 묶음 H2, 사용자 결정 D안): 국토지리정보원 자료(1:5,000 도엽·시군구 묶음·1:1,000·10m 지형 타일)와
// 정밀도로지도를 학생 PC 폴더에서만 읽는다 — 크롬·엣지의 폴더 접근 기능. 자료는 PC 밖으로 나가지 않는다(GitHub·서버에 안 올림).
// 폴더 핸들은 이 브라우저 IndexedDB에 두고, 허락이 살아 있으면 앱을 열 때 알아서 훑는다(허락이 풀리면 단추 한 번).

import { useEffect, useState } from 'react'
import { getKv, putKv, deleteKv } from '../model/db'
import { sheets1000Around, sheetsAround } from './mapSheet'
import { setLocalTerrain } from './terrain'
import { clearTerrainAnalysis } from './terrainSite'
import { listZip, readZipEntry } from './zipRandom'

// ── 폴더 접근 API (타입 정의가 아직 표준 lib에 다 없음)
interface FsHandle {
  kind: 'file' | 'directory'
  name: string
}
interface FsFile extends FsHandle {
  kind: 'file'
  getFile(): Promise<File>
}
export interface FsDir extends FsHandle {
  kind: 'directory'
  values(): AsyncIterable<FsFile | FsDir>
  getFileHandle(name: string): Promise<FsFile>
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<FsDir>
  queryPermission(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}
type Picker = (o?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FsDir>

export const folderSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window

export type LocalKind = 'ngii5' | 'ngii1' | 'hd'

export interface LocalItem {
  kind: LocalKind
  /** 폴더 안 경로 (묶음 안이면 '묶음.zip › 안 파일') */
  path: string
  name: string
  /** 1:5,000 8자리 · 1:1,000 9자리 */
  code?: string
  year?: number
  size: number
  get: () => Promise<File>
}

export interface LocalIndex {
  folder: string
  items: LocalItem[]
  /** 10m 지형 타일 (manifest.json이 있는 폴더) */
  dem: { path: string; tiles: number; version: string } | null
  bundles: number
  problems: string[]
  scannedAt: string
}

export type FolderState = 'unsupported' | 'none' | 'prompt' | 'scanning' | 'ready' | 'error'

interface Store {
  state: FolderState
  index: LocalIndex | null
  message: string | null
  progress: string | null
}

let store: Store = { state: folderSupported ? 'none' : 'unsupported', index: null, message: null, progress: null }
const listeners = new Set<() => void>()
const set = (patch: Partial<Store>) => {
  store = { ...store, ...patch }
  listeners.forEach((l) => l())
}

export function useLocalData(): Store {
  const [, tick] = useState(0)
  useEffect(() => {
    const l = () => tick((t) => t + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return store
}

export function localDataNow(): Store {
  return store
}

const KEY = 'dataFolder'
let handle: FsDir | null = null

const yearOf = (name: string) => {
  const m = name.match(/_(19|20)(\d{2})_/)
  return m ? Number(`${m[1]}${m[2]}`) : undefined
}
const code8 = (name: string) => name.match(/(?<!\d)(\d{8})(?!\d)/)?.[1]
const code9 = (name: string) => name.match(/(?<!\d)(\d{9})(?!\d)/)?.[1]

/** 폴더를 훑어 알아보는 자료 목록 */
async function scan(root: FsDir): Promise<LocalIndex> {
  const items: LocalItem[] = []
  const problems: string[] = []
  let dem: LocalIndex['dem'] = null
  let bundles = 0
  let seen = 0
  const walk = async (dir: FsDir, path: string, depth: number): Promise<void> => {
    const kids: (FsFile | FsDir)[] = []
    for await (const h of dir.values()) kids.push(h)
    // 10m 지형 타일: manifest.json + 타일 PNG — 안은 하나하나 훑지 않음
    const man = kids.find((h) => h.kind === 'file' && h.name === 'manifest.json') as FsFile | undefined
    if (man) {
      try {
        const j = JSON.parse(await (await man.getFile()).text()) as { tiles?: string[]; version?: string }
        if (Array.isArray(j.tiles) && j.tiles.length) {
          if (!dem) {
            dem = { path: path || '(폴더 바로 아래)', tiles: j.tiles.length, version: j.version ?? '' }
            demDir = dir
          }
          return
        }
      } catch {
        // 다른 manifest
      }
    }
    for (const h of kids) {
      if (h.name.startsWith('.') || h.name === 'node_modules') continue
      const p = path ? `${path}/${h.name}` : h.name
      if (h.kind === 'directory') {
        if (depth < 6) await walk(h, p, depth + 1)
        continue
      }
      if (++seen % 200 === 0) set({ progress: `훑는 중 · 파일 ${seen.toLocaleString('ko-KR')}개` })
      const lower = h.name.toLowerCase()
      const isZip = lower.endsWith('.zip')
      if (isZip && /정밀도로지도/.test(h.name)) {
        const f = await h.getFile()
        items.push({ kind: 'hd', path: p, name: h.name, size: f.size, get: () => h.getFile() })
      } else if ((isZip || /\.(ngi|nda)$/.test(lower)) && code9(h.name)) {
        const f = await h.getFile()
        items.push({ kind: 'ngii1', path: p, name: h.name, code: code9(h.name), year: yearOf(h.name), size: f.size, get: () => h.getFile() })
      } else if (isZip && code8(h.name)) {
        const f = await h.getFile()
        items.push({ kind: 'ngii5', path: p, name: h.name, code: code8(h.name), year: yearOf(h.name), size: f.size, get: () => h.getFile() })
      } else if (isZip) {
        // 시군구 묶음 등: 안에 도엽 ZIP·NGI가 들었는지 목록만 봄
        const f = await h.getFile()
        if (f.size < 1_000_000) continue
        try {
          const ents = await listZip(f)
          let n = 0
          for (const e of ents) {
            const base = e.name.split('/').pop() ?? e.name
            const lb = base.toLowerCase()
            const get = async () => new File([(await readZipEntry(await h.getFile(), e)) as BlobPart], base)
            if (lb.endsWith('.zip') && code9(base) === undefined && code8(base)) {
              items.push({ kind: 'ngii5', path: `${p} › ${base}`, name: base, code: code8(base), year: yearOf(base), size: e.size, get })
              n++
            } else if (/\.(ngi|nda)$/.test(lb) && code9(base)) {
              items.push({ kind: 'ngii1', path: `${p} › ${base}`, name: base, code: code9(base), year: yearOf(base), size: e.size, get })
              n++
            }
          }
          if (n) bundles++
          else if (ents.some((e) => /\.shp$/i.test(e.name))) problems.push(`${p}: 도엽별 ZIP이 아닌 SHP 묶음 — 아직 못 읽음(도엽 ZIP으로 받아 주세요)`)
        } catch (e) {
          problems.push(`${p}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  }
  demDir = null
  await walk(root, '', 0)
  return { folder: root.name, items, dem, bundles, problems, scannedAt: new Date().toISOString() }
}

let demDir: FsDir | null = null

function applyTerrain(index: LocalIndex | null) {
  const dir = index?.dem ? demDir : null
  setLocalTerrain(dir ? (name) => dir.getFileHandle(name).then((h) => h.getFile()).catch(() => null) : null)
  clearTerrainAnalysis()
}

async function rescan(): Promise<void> {
  if (!handle) return
  set({ state: 'scanning', progress: '훑는 중', message: null })
  try {
    const index = await scan(handle)
    applyTerrain(index)
    set({ state: 'ready', index, progress: null })
  } catch (e) {
    set({ state: 'error', progress: null, message: `폴더를 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}` })
  }
}

/** 앱을 열 때: 저장한 폴더가 있고 허락이 살아 있으면 훑음 (묻지 않음) */
export async function initLocalData(): Promise<void> {
  if (!folderSupported) return
  const h = await getKv<FsDir>(KEY)
  if (!h) return
  handle = h
  try {
    const p = await h.queryPermission({ mode: 'readwrite' })
    if (p === 'granted') await rescan()
    else set({ state: 'prompt' })
  } catch {
    set({ state: 'prompt' })
  }
}

/** [자료 폴더 연결] — 사용자가 누를 때만 */
export async function connectFolder(): Promise<void> {
  const picker = (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker
  if (!picker) return
  try {
    const h = await picker({ id: 'site-agent-data', mode: 'readwrite' })
    handle = h
    await putKv(KEY, h)
    await rescan()
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return
    set({ state: 'error', message: `폴더를 연결하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` })
  }
}

/** [폴더 다시 허락] — 브라우저를 다시 열면 허락이 풀릴 때가 있음 (사용자가 누를 때만) */
export async function regrantFolder(): Promise<void> {
  if (!handle) return
  try {
    const p = await handle.requestPermission({ mode: 'readwrite' })
    if (p === 'granted') await rescan()
  } catch (e) {
    set({ state: 'error', message: `허락을 받지 못했습니다: ${e instanceof Error ? e.message : String(e)}` })
  }
}

export async function rescanFolder(): Promise<void> {
  await rescan()
}

export async function disconnectFolder(): Promise<void> {
  handle = null
  await deleteKv(KEY)
  applyTerrain(null)
  set({ state: 'none', index: null, message: null })
}

/** 같은 도엽이 여러 판이면 최신 연도 */
function latest(items: LocalItem[]): LocalItem[] {
  const by = new Map<string, LocalItem>()
  for (const it of items) {
    const k = `${it.kind}|${it.code}|${it.kind === 'ngii1' ? it.name.slice(-4).toLowerCase() : ''}`
    const cur = by.get(k)
    if (!cur || (it.year ?? 0) > (cur.year ?? 0)) by.set(k, it)
  }
  return [...by.values()]
}

/** 이 대지에 걸치는 자료 */
export function itemsForSite(index: LocalIndex, center: [number, number], radiusM: number): { sheets5: LocalItem[]; sheets1: LocalItem[]; hd: LocalItem[]; missing5: string[] } {
  const need5 = sheetsAround(center[0], center[1], radiusM)
  const need1 = new Set(sheets1000Around(center[0], center[1], radiusM))
  const s5 = latest(index.items.filter((i) => i.kind === 'ngii5' && i.code && need5.includes(i.code)))
  const s1raw = index.items.filter((i) => i.kind === 'ngii1' && i.code && need1.has(i.code))
  // 1:1,000은 같은 도엽의 .ngi·.nda가 같은 연도로 짝
  const s1 = latest(s1raw)
  return { sheets5: s5, sheets1: s1, hd: index.items.filter((i) => i.kind === 'hd'), missing5: need5.filter((c) => !s5.some((i) => i.code === c)) }
}

// 개발 중 시험용 (폴더 고르기 창은 운영체제 창이라 자동 시험이 못 누름) — 배포본에는 없음
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __localDataTest?: unknown }).__localDataTest = {
    use: async (h: FsDir) => {
      handle = h
      await rescan()
    },
  }
}
