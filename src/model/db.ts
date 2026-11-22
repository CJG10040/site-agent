// 브라우저 저장소 (IndexedDB).
// 사생활 보호 모드 등에서 IndexedDB를 쓸 수 없으면 모든 함수가 실패를 알리고, 앱은 메모리에서만 동작한다.

import Dexie, { type EntityTable } from 'dexie'
import type { Project } from './types'
import type { PanelOutput } from '../diagrams/compose'
import { sameSnap, snapshotOf, type VersionRecord, type VersionTrigger } from './versions'

/** 현장 사진 — 프로젝트 문서와 따로 저장 (크기가 커서) */
export interface PhotoRecord {
  id: string
  projectId: string
  blob: Blob // 긴 변 2048px JPEG
  thumb: Blob // 긴 변 360px JPEG
  width: number
  height: number
  /** 사진 정보(EXIF)에서 읽은 촬영 시각 "YYYY-MM-DDTHH:mm" */
  takenAt: string | null
  lon: number | null
  lat: number | null
  originalName: string
  createdAt: string
}

/** 올린 글꼴 (2026-11-21 묶음 D3) — 프로젝트와 따로, 이 브라우저에만 */
export interface FontRecord {
  id: string
  /** 글꼴 집안 이름 (파일에서 읽음, 못 읽으면 파일 이름에서 — 목록에서 골라 맞출 수 있음) */
  family: string
  /** 처음 읽은 이름 */
  readName?: string
  /** 파일 안 이름을 못 읽어 파일 이름에서 짐작함 (woff2 등) */
  guessed?: boolean
  fileName: string
  /** 100~900 */
  weight: number
  italic: boolean
  /** ttf·otf·woff·woff2 */
  ext: string
  size: number
  data: Blob
  addedAt: string
}

/** 그려 둔 도판 (2026-11-22 사용자 결정: 새로고침 뒤에도 다시 그리지 않고 바로 보이게) — 프로젝트·보기(보통/패널)·도판마다 마지막 한 장 */
export interface PanelImageRecord {
  /** `${projectId}|${mode}|${panelId}` */
  id: string
  projectId: string
  /** n = 보통 도판, p = 패널 모드 */
  mode: 'n' | 'p'
  panelId: string
  /** 그릴 때의 자료·설정 열쇠 — 지금 열쇠와 다르면 '바뀜' */
  key: string
  svg: string
  out: PanelOutput
  savedAt: string
}

const db = new Dexie('site-agent') as Dexie & {
  projects: EntityTable<Project, 'id'>
  photos: EntityTable<PhotoRecord, 'id'>
  versions: EntityTable<VersionRecord, 'id'>
  fonts: EntityTable<FontRecord, 'id'>
  panelImages: EntityTable<PanelImageRecord, 'id'>
  kv: EntityTable<{ key: string; value: unknown }, 'key'>
}

db.version(1).stores({
  projects: 'id, updatedAt',
})
db.version(2).stores({
  projects: 'id, updatedAt',
  photos: 'id, projectId',
})
// Phase 12: 조사 버전 (해석의 시점별 기록)
db.version(3).stores({
  projects: 'id, updatedAt',
  photos: 'id, projectId',
  versions: 'id, projectId, createdAt',
})
// 묶음 D3: 올린 글꼴
db.version(4).stores({
  projects: 'id, updatedAt',
  photos: 'id, projectId',
  versions: 'id, projectId, createdAt',
  fonts: 'id, family',
})
// 그려 둔 도판 (2026-11-22)
db.version(5).stores({
  projects: 'id, updatedAt',
  photos: 'id, projectId',
  versions: 'id, projectId, createdAt',
  fonts: 'id, family',
  panelImages: 'id, projectId',
})
// 이 브라우저의 설정값 (2026-11-22 묶음 H2: 연결한 자료 폴더 — 폴더 핸들은 IndexedDB에만 넣을 수 있음)
db.version(6).stores({
  projects: 'id, updatedAt',
  photos: 'id, projectId',
  versions: 'id, projectId, createdAt',
  fonts: 'id, family',
  panelImages: 'id, projectId',
  kv: 'key',
})

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
  lastExportedAt: string | null
  address: string
  factCount: number
  observationCount: number
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await db.projects.orderBy('updatedAt').reverse().toArray()
  return all.map((p) => ({
    id: p.id,
    name: p.brief.projectName || '이름 없는 프로젝트',
    updatedAt: p.updatedAt,
    lastExportedAt: p.lastExportedAt,
    address: p.site.address?.road || p.site.address?.parcel || p.site.parcels[0]?.addr || '',
    factCount: p.cards.filter((c) => c.type === 'FACT' && c.status === 'confirmed').length,
    observationCount: p.cards.filter((c) => c.type === 'OBSERVATION' && c.status !== 'rejected').length,
  }))
}

export async function getProject(id: string): Promise<Project | undefined> {
  return db.projects.get(id)
}

export async function putProject(project: Project): Promise<void> {
  await db.projects.put(project)
}

export async function deleteProject(id: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.photos, db.versions, db.panelImages], async () => {
    await db.projects.delete(id)
    await db.photos.where('projectId').equals(id).delete()
    await db.versions.where('projectId').equals(id).delete()
    await db.panelImages.where('projectId').equals(id).delete()
  })
}

// ───────────────────────── 조사 버전 ─────────────────────────

/** 자동 버전은 프로젝트마다 이만큼만 남긴다 (직접 저장한 것은 다 남김) */
const AUTO_KEEP = 20

export async function listVersions(projectId: string): Promise<VersionRecord[]> {
  const all = await db.versions.where('projectId').equals(projectId).toArray()
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * 지금 해석을 버전으로 저장한다. 자동 저장은 바로 앞 버전과 해석이 같으면 건너뛴다(null).
 */
export async function saveVersion(project: Project, name: string, trigger: VersionTrigger): Promise<VersionRecord | null> {
  const snap = snapshotOf(project)
  const list = await listVersions(project.id)
  if (trigger !== 'manual' && list[0] && sameSnap(list[0].snap, snap)) return null
  const rec: VersionRecord = {
    id: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    projectId: project.id,
    name: name.trim() || new Date().toLocaleString('ko-KR'),
    createdAt: new Date().toISOString(),
    trigger,
    snap,
  }
  await db.versions.put(rec)
  const autos = [rec, ...list].filter((v) => v.trigger !== 'manual')
  if (autos.length > AUTO_KEEP) await db.versions.bulkDelete(autos.slice(AUTO_KEEP).map((v) => v.id))
  return rec
}

export async function renameVersion(id: string, name: string): Promise<void> {
  await db.versions.update(id, { name })
}

export async function deleteVersion(id: string): Promise<void> {
  await db.versions.delete(id)
}

/** 프로젝트 파일 가져오기: 버전을 그 프로젝트에 넣는다 (같은 id는 덮어씀) */
export async function putVersions(records: VersionRecord[]): Promise<void> {
  if (records.length) await db.versions.bulkPut(records)
}

export async function putPhoto(photo: PhotoRecord): Promise<void> {
  await db.photos.put(photo)
}

export async function getPhoto(id: string): Promise<PhotoRecord | undefined> {
  return db.photos.get(id)
}

export async function getPhotos(ids: string[]): Promise<PhotoRecord[]> {
  const res = await db.photos.bulkGet(ids)
  return res.filter((p): p is PhotoRecord => !!p)
}

export async function deletePhotos(ids: string[]): Promise<void> {
  await db.photos.bulkDelete(ids)
}

/** 브라우저가 이 사이트에 허락한 저장공간과 사용량 (지원하지 않으면 null) */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.()
    if (!e || e.usage === undefined || e.quota === undefined) return null
    return { usage: e.usage, quota: e.quota }
  } catch {
    return null
  }
}

// ───────────────────────── 올린 글꼴 (2026-11-21 묶음 D3) ─────────────────────────

export async function listFontRecords(): Promise<FontRecord[]> {
  try {
    return (await db.fonts.toArray()).sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight)
  } catch {
    return []
  }
}

export async function putFont(rec: FontRecord): Promise<void> {
  await db.fonts.put(rec)
}

export async function deleteFont(id: string): Promise<void> {
  await db.fonts.delete(id)
}

// ───────────────────────── 그려 둔 도판 (2026-11-22) ─────────────────────────

export async function listPanelImages(projectId: string, mode: 'n' | 'p'): Promise<PanelImageRecord[]> {
  const all = await db.panelImages.where('projectId').equals(projectId).toArray()
  return all.filter((r) => r.mode === mode)
}

export async function putPanelImage(rec: PanelImageRecord): Promise<void> {
  await db.panelImages.put(rec)
}

// ───────────────────────── 이 브라우저 설정값 (2026-11-22) ─────────────────────────

export async function getKv<T>(key: string): Promise<T | undefined> {
  try {
    return (await db.kv.get(key))?.value as T | undefined
  } catch {
    return undefined
  }
}

export async function putKv(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value })
}

export async function deleteKv(key: string): Promise<void> {
  await db.kv.delete(key)
}
