// 브라우저 저장소 (IndexedDB).
// 사생활 보호 모드 등에서 IndexedDB를 쓸 수 없으면 모든 함수가 실패를 알리고, 앱은 메모리에서만 동작한다.

import Dexie, { type EntityTable } from 'dexie'
import type { Project } from './types'
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

const db = new Dexie('site-agent') as Dexie & {
  projects: EntityTable<Project, 'id'>
  photos: EntityTable<PhotoRecord, 'id'>
  versions: EntityTable<VersionRecord, 'id'>
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
  await db.transaction('rw', db.projects, db.photos, db.versions, async () => {
    await db.projects.delete(id)
    await db.photos.where('projectId').equals(id).delete()
    await db.versions.where('projectId').equals(id).delete()
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
