// 지형 면에 입히는 항공사진 (2026-11-16): 브이월드 위성영상 타일(CORS 허용, 항공사진 도판과 같은 것)을
// 모형 범위만큼 한 장으로 합쳐 JPEG로. 지형 메시의 꼭짓점마다 이 사진의 UV를 적는다.
// 사진은 가로·세로 4096px 이하 (렌더러가 받는 크기), 줌 19까지.

import { utmkToWgs84 } from '../lib/proj'
import { tileUrl } from '../sources/vworld'
import type { SiteModel } from './siteModel'
import { imageToJpeg } from './textures'

export const AERIAL_FILE = 'SA_aerial.jpg'
const MAX_PX = 4096
const MARGIN = 10

export interface AerialTex {
  file: string
  bytes: Uint8Array
  /** 모형 좌표 (m) → 사진 UV (0~1, v는 북쪽이 1) */
  uv: (x: number, y: number) => [number, number]
  z: number
  width: number
  height: number
  tiles: number
  failed: number
}

const mercX = (lon: number) => (lon + 180) / 360
const mercY = (lat: number) => {
  const r = (lat * Math.PI) / 180
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2
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

type TileLoader = (z: number, x: number, y: number) => Promise<CanvasImageSource | null>

/** 브이월드 위성영상 타일 */
const vworldTiles = (key: string): TileLoader => {
  const template = tileUrl(key, 'Satellite')
  return (z, x, y) => loadImage(template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)))
}

/** 모형 범위 항공사진. 키가 없거나 타일을 하나도 못 받으면 null (loadTile은 시험할 때 바꿔 끼움) */
export async function aerialForModel(m: Pick<SiteModel, 'origin' | 'half'>, vworldKey: string, onStep?: (s: string) => void, loadTile: TileLoader = vworldTiles(vworldKey)): Promise<AerialTex | null> {
  if (!vworldKey.trim()) return null
  const h = m.half + MARGIN
  const X0 = m.origin.x5179
  const Y0 = m.origin.y5179
  const merc = (x: number, y: number): [number, number] => {
    const [lon, lat] = utmkToWgs84(x + X0, y + Y0)
    return [mercX(lon), mercY(lat)]
  }
  const corners = [merc(-h, -h), merc(h, -h), merc(h, h), merc(-h, h)]
  const mx0 = Math.min(...corners.map((c) => c[0]))
  const mx1 = Math.max(...corners.map((c) => c[0]))
  const my0 = Math.min(...corners.map((c) => c[1]))
  const my1 = Math.max(...corners.map((c) => c[1]))
  const span = Math.max(mx1 - mx0, my1 - my0)
  const z = Math.max(12, Math.min(19, Math.floor(Math.log2(MAX_PX / (256 * span)))))
  const scale = 256 * 2 ** z
  const width = Math.ceil((mx1 - mx0) * scale)
  const height = Math.ceil((my1 - my0) * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')
  if (!g) return null
  g.fillStyle = '#b8b4a8'
  g.fillRect(0, 0, width, height)
  const tx0 = Math.floor(mx0 * 2 ** z)
  const tx1 = Math.floor(mx1 * 2 ** z)
  const ty0 = Math.floor(my0 * 2 ** z)
  const ty1 = Math.floor(my1 * 2 ** z)
  const total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)
  let done = 0
  const jobs: Promise<boolean>[] = []
  for (let tx = tx0; tx <= tx1; tx++)
    for (let ty = ty0; ty <= ty1; ty++) {
      jobs.push(
        loadTile(z, tx, ty).then((img) => {
          done++
          if (done % 16 === 0) onStep?.(`항공사진 타일 ${done}/${total}`)
          if (!img) return false
          g.drawImage(img, Math.round(tx * 256 - mx0 * scale), Math.round(ty * 256 - my0 * scale), 256, 256)
          return true
        }),
      )
    }
  const ok = await Promise.all(jobs)
  const failed = ok.filter((x) => !x).length
  if (failed === ok.length) return null
  onStep?.('항공사진 담는 중')
  let bytes: Uint8Array
  try {
    bytes = await imageToJpeg(g.getImageData(0, 0, width, height), 0.85)
  } catch {
    return null
  }
  // UV: 모형 범위를 21×21 칸으로 나눠 정확히 구해 두고 그 사이는 겹선형 (꼭짓점 수십만 개를 좌표 변환하지 않게)
  const N = 20
  const step = (2 * h) / N
  const gu = new Float64Array((N + 1) * (N + 1))
  const gv = new Float64Array((N + 1) * (N + 1))
  for (let j = 0; j <= N; j++)
    for (let i = 0; i <= N; i++) {
      const [mx, my] = merc(-h + i * step, -h + j * step)
      gu[j * (N + 1) + i] = ((mx - mx0) * scale) / width
      gv[j * (N + 1) + i] = 1 - ((my - my0) * scale) / height
    }
  const uv = (x: number, y: number): [number, number] => {
    const fi = Math.min(N - 1e-9, Math.max(0, (x + h) / step))
    const fj = Math.min(N - 1e-9, Math.max(0, (y + h) / step))
    const i = Math.floor(fi)
    const j = Math.floor(fj)
    const a = fi - i
    const b = fj - j
    const k = j * (N + 1) + i
    const lerp = (arr: Float64Array) => arr[k] * (1 - a) * (1 - b) + arr[k + 1] * a * (1 - b) + arr[k + N + 1] * (1 - a) * b + arr[k + N + 2] * a * b
    return [lerp(gu), lerp(gv)]
  }
  return { file: AERIAL_FILE, bytes, uv, z, width, height, tiles: ok.length, failed }
}
