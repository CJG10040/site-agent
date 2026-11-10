// 항공사진 도판: 브이월드 위성영상 타일(CORS 허용)을 도판 좌표에 맞춰 한 장으로 합친다.

import { tileUrl } from '../sources/vworld'
import { MAP_CX, MAP_CY, MAP_R, type Frame } from './frame'

const SCALE = 2 // 도판 1배 픽셀당 2픽셀로 받아 선명하게

function tile2lon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}

function tile2lat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}

function lat2tile(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

export interface AerialImage {
  href: string
  x: number
  y: number
  size: number
  tiles: number
  failed: number
}

export async function aerialImage(frame: Frame, vworldKey: string): Promise<AerialImage | null> {
  if (!vworldKey.trim()) return null
  const size = MAP_R * 2 * SCALE
  const mpp = (frame.R * 2) / size
  const lat0 = frame.lat0
  const z = Math.min(19, Math.max(12, Math.ceil(Math.log2((156543.03 * Math.cos((lat0 * Math.PI) / 180)) / mpp))))
  const [w, s, e, n] = frame.bbox
  const x0 = lon2tile(w, z)
  const x1 = lon2tile(e, z)
  const y0 = lat2tile(n, z)
  const y1 = lat2tile(s, z)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  if (!g) return null
  g.fillStyle = '#d8d6d0'
  g.fillRect(0, 0, size, size)
  const template = tileUrl(vworldKey, 'Satellite')
  const jobs: Promise<boolean>[] = []
  const left = MAP_CX - MAP_R
  const top = MAP_CY - MAP_R
  for (let tx = x0; tx <= x1; tx++)
    for (let ty = y0; ty <= y1; ty++) {
      const url = template.replace('{z}', String(z)).replace('{x}', String(tx)).replace('{y}', String(ty))
      jobs.push(
        loadImage(url).then((img) => {
          if (!img) return false
          const [ax, ay] = frame.pt(tile2lon(tx, z), tile2lat(ty, z))
          const [bx, by] = frame.pt(tile2lon(tx + 1, z), tile2lat(ty + 1, z))
          g.drawImage(img, (ax - left) * SCALE, (ay - top) * SCALE, (bx - ax) * SCALE, (by - ay) * SCALE)
          return true
        }),
      )
    }
  const results = await Promise.all(jobs)
  try {
    return {
      href: canvas.toDataURL('image/jpeg', 0.86),
      x: left,
      y: top,
      size: MAP_R * 2,
      tiles: results.length,
      failed: results.filter((r) => !r).length,
    }
  } catch {
    // 타일이 CORS를 막으면 캔버스를 꺼낼 수 없다
    return null
  }
}
