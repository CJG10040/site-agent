// 현장 사진 처리: 촬영 위치·시간(EXIF)을 먼저 읽고, 크기를 줄여 JPEG로 저장한다.
// 참고: 휴대폰 브라우저는 사진을 올릴 때 위치 정보를 지우는 경우가 많다(개인정보 보호).
//       위치가 없으면 '현재 위치' 또는 '지도에서 지정'을 쓰도록 안내한다.

import { parse } from 'exifr'

const MAX_SIDE = 2048
const THUMB_SIDE = 360

export interface ProcessedPhoto {
  blob: Blob
  thumb: Blob
  width: number
  height: number
  takenAt: string | null
  lon: number | null
  lat: number | null
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Date → "YYYY-MM-DDTHH:mm" (현지 시각) */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function readExif(file: File): Promise<{ takenAt: string | null; lon: number | null; lat: number | null }> {
  try {
    const meta = (await parse(file, { gps: true, pick: ['DateTimeOriginal', 'CreateDate', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef'] })) as
      | { DateTimeOriginal?: Date; CreateDate?: Date; latitude?: number; longitude?: number }
      | undefined
    const date = meta?.DateTimeOriginal ?? meta?.CreateDate
    const lat = typeof meta?.latitude === 'number' && Number.isFinite(meta.latitude) ? meta.latitude : null
    const lon = typeof meta?.longitude === 'number' && Number.isFinite(meta.longitude) ? meta.longitude : null
    return {
      takenAt: date instanceof Date && !Number.isNaN(date.getTime()) ? toLocalInput(date) : null,
      lat: lat !== null && lon !== null && !(lat === 0 && lon === 0) ? lat : null,
      lon: lat !== null && lon !== null && !(lat === 0 && lon === 0) ? lon : null,
    }
  } catch {
    return { takenAt: null, lon: null, lat: null }
  }
}

async function resize(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('이미지를 처리할 수 없습니다.')
  ctx.drawImage(bitmap, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality))
  if (!blob) throw new Error('이미지를 저장 형식으로 바꾸지 못했습니다.')
  return { blob, width, height }
}

export async function processPhoto(file: File): Promise<ProcessedPhoto> {
  const exif = await readExif(file)
  let bitmap: ImageBitmap
  try {
    // 사진의 회전 정보를 반영해 읽는다
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(`'${file.name}'을(를) 열 수 없습니다. 이 브라우저가 지원하지 않는 형식(예: HEIC)일 수 있습니다. JPEG로 바꿔 올려 주세요.`)
  }
  try {
    const main = await resize(bitmap, MAX_SIDE, 0.85)
    const thumb = await resize(bitmap, THUMB_SIDE, 0.75)
    return { blob: main.blob, thumb: thumb.blob, width: main.width, height: main.height, ...exif }
  } finally {
    bitmap.close()
  }
}

/** 시간대 구분 (요청서: 시간대별 점유·활동 차이) */
export function timeBand(observedAt: string | null): { band: string; weekend: boolean | null } {
  if (!observedAt) return { band: '시간 미상', weekend: null }
  const d = new Date(observedAt)
  if (Number.isNaN(d.getTime())) return { band: '시간 미상', weekend: null }
  const h = d.getHours()
  const band = h < 6 ? '새벽' : h < 12 ? '오전' : h < 18 ? '오후' : h < 21 ? '저녁' : '밤'
  const day = d.getDay()
  return { band, weekend: day === 0 || day === 6 }
}

export function formatObservedAt(observedAt: string | null): string {
  if (!observedAt) return '시간 미상'
  const d = new Date(observedAt)
  if (Number.isNaN(d.getTime())) return observedAt
  const days = ['일', '월', '화', '수', '목', '금', '토']
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}
