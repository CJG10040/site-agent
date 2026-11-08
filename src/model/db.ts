// 브라우저 저장소 (IndexedDB).
// 사생활 보호 모드 등에서 IndexedDB를 쓸 수 없으면 모든 함수가 실패를 알리고, 앱은 메모리에서만 동작한다.

import Dexie, { type EntityTable } from 'dexie'
import type { Project } from './types'

const db = new Dexie('site-agent') as Dexie & {
  projects: EntityTable<Project, 'id'>
}

db.version(1).stores({
  projects: 'id, updatedAt',
})

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
  lastExportedAt: string | null
  address: string
  factCount: number
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
  }))
}

export async function getProject(id: string): Promise<Project | undefined> {
  return db.projects.get(id)
}

export async function putProject(project: Project): Promise<void> {
  await db.projects.put(project)
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id)
}
