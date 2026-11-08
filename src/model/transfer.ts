// 프로젝트 파일 내보내기·가져오기, 다른 기기의 관찰 합치기.
// 사진은 base64로 같은 JSON 파일 안에 넣는다 (파일 하나로 옮기기 쉽도록).

import { base64ToBlob, blobToBase64 } from '../lib/photos'
import { getPhotos, getProject, putPhoto, putProject, type PhotoRecord } from './db'
import { newId, nextCardId, nowIso } from './project'
import { SCHEMA_VERSION, type Card, type Project } from './types'

interface ExportedPhoto {
  id: string
  width: number
  height: number
  takenAt: string | null
  lon: number | null
  lat: number | null
  originalName: string
  createdAt: string
  data: string // base64 JPEG
  thumb: string // base64 JPEG
}

interface ExportFile {
  app: 'site-agent'
  schema: number
  exportedAt: string
  project: Project
  photos?: ExportedPhoto[]
}

function photoIdsOf(project: Project): string[] {
  return project.cards.flatMap((c) => c.observation?.photoIds ?? [])
}

export async function exportProjectFile(project: Project): Promise<{ filename: string; blob: Blob; photoCount: number }> {
  const records = await getPhotos(photoIdsOf(project))
  const photos: ExportedPhoto[] = []
  for (const r of records) {
    photos.push({
      id: r.id,
      width: r.width,
      height: r.height,
      takenAt: r.takenAt,
      lon: r.lon,
      lat: r.lat,
      originalName: r.originalName,
      createdAt: r.createdAt,
      data: await blobToBase64(r.blob),
      thumb: await blobToBase64(r.thumb),
    })
  }
  const data: ExportFile = { app: 'site-agent', schema: SCHEMA_VERSION, exportedAt: nowIso(), project, photos }
  const safeName = (project.brief.projectName || '대지해석').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40)
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  return {
    filename: `${safeName}_${stamp}.siteagent.json`,
    blob: new Blob([JSON.stringify(data)], { type: 'application/json' }),
    photoCount: photos.length,
  }
}

export async function readProjectFile(file: File): Promise<{ project: Project; photos: ExportedPhoto[] }> {
  const text = await file.text()
  let data: Partial<ExportFile>
  try {
    data = JSON.parse(text) as Partial<ExportFile>
  } catch {
    throw new Error('JSON 파일이 아닙니다.')
  }
  if (data.app !== 'site-agent' || !data.project) throw new Error('이 프로그램에서 내보낸 프로젝트 파일이 아닙니다.')
  if ((data.schema ?? 0) > SCHEMA_VERSION) throw new Error('더 새로운 버전에서 만든 파일입니다. 사이트를 새로고침한 뒤 다시 시도하세요.')
  return { project: data.project, photos: data.photos ?? [] }
}

function toRecord(p: ExportedPhoto, projectId: string, id = p.id): PhotoRecord {
  return {
    id,
    projectId,
    blob: base64ToBlob(p.data, 'image/jpeg'),
    thumb: base64ToBlob(p.thumb, 'image/jpeg'),
    width: p.width,
    height: p.height,
    takenAt: p.takenAt,
    lon: p.lon,
    lat: p.lat,
    originalName: p.originalName,
    createdAt: p.createdAt,
  }
}

/**
 * 프로젝트 파일을 이 브라우저에 가져온다.
 * 같은 프로젝트가 있으면 asCopy에 따라 덮어쓰거나 사본으로 넣는다 (사본은 사진 id도 새로 만든다).
 */
export async function importProjectFile(
  file: File,
  decide: (existingName: string) => 'overwrite' | 'copy',
): Promise<{ name: string; photoCount: number }> {
  const { project, photos } = await readProjectFile(file)
  const exists = await getProject(project.id)
  let target = project
  let photoMap = new Map(photos.map((p) => [p.id, p.id]))
  if (exists && decide(exists.brief.projectName || '이름 없는 프로젝트') === 'copy') {
    photoMap = new Map(photos.map((p) => [p.id, newId()]))
    target = {
      ...project,
      id: newId(),
      brief: { ...project.brief, projectName: `${project.brief.projectName || '이름 없는 프로젝트'} (사본)` },
      cards: project.cards.map((c) =>
        c.observation ? { ...c, observation: { ...c.observation, photoIds: c.observation.photoIds.map((id) => photoMap.get(id) ?? id) } } : c,
      ),
    }
  }
  for (const p of photos) await putPhoto(toRecord(p, target.id, photoMap.get(p.id)))
  await putProject(target)
  return { name: target.brief.projectName || '이름 없는 프로젝트', photoCount: photos.length }
}

export interface MergeResult {
  added: number
  updated: number
  unchanged: number
  photos: number
  droppedLinks: number
  sameProject: boolean
}

/**
 * 다른 기기에서 기록한 관찰을 현재 프로젝트에 합친다.
 *  - 같은 관찰(uid)이 있으면 더 최근에 고친 쪽으로 바꾼다 (번호는 현재 프로젝트 것을 유지)
 *  - 새 관찰은 현재 프로젝트에서 새 번호를 받는다
 *  - 다른 프로젝트에서 온 관찰의 '관련 사실' 연결은 번호가 맞지 않을 수 있어 지운다
 * 사진 저장은 호출한 쪽에서 먼저 끝낸 뒤 이 함수로 프로젝트를 고친다.
 */
export function mergeObservations(current: Project, incoming: Project): MergeResult {
  const sameProject = incoming.id === current.id
  const result: MergeResult = { added: 0, updated: 0, unchanged: 0, photos: 0, droppedLinks: 0, sameProject }
  const incomingObs = incoming.cards.filter((c) => c.type === 'OBSERVATION' && c.observation && c.uid)
  for (const inc of incomingObs) {
    const copy: Card = structuredClone(inc)
    if (!sameProject && copy.observation!.links.length) {
      result.droppedLinks += copy.observation!.links.length
      copy.observation!.links = []
    }
    result.photos += copy.observation!.photoIds.length
    const existing = current.cards.find((c) => c.uid === inc.uid)
    if (existing) {
      if (inc.updated_at > existing.updated_at) {
        const id = existing.id
        Object.assign(existing, copy, { id })
        result.updated++
      } else result.unchanged++
    } else {
      copy.id = nextCardId(current, 'OBSERVATION')
      current.cards.push(copy)
      result.added++
    }
  }
  return result
}

/** 합치기 전에 들어온 사진을 현재 프로젝트 소속으로 저장 */
export async function storeIncomingPhotos(photos: ExportedPhoto[], projectId: string): Promise<void> {
  for (const p of photos) await putPhoto(toRecord(p, projectId))
}
