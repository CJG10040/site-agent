// 수목(초록 덮개): 브이월드 위성영상 타일(줌 17, 약 1m/픽셀)의 색으로 나무 그늘·풀밭 칸(2m)을 찾는다.
// 초록 지수 ExG = (2G − R − B)/(R+G+B). 그림자에 묻힌 나무, 계절(낙엽), 초록 지붕·인조잔디 오검출은 한계.

import type { XY } from '../network'
import { cellAt, rasterize, type GridSpec } from './grid'
import type { EnvBuilding } from './compute'

export const TREE_ZOOM = 17

export interface TreeInput {
  /** 위성영상 타일 주소 틀 ({z}/{y}/{x}) */
  tileUrl: string
  lon0: number
  lat0: number
  kx: number
  ky: number
  g: GridSpec
}

function tileX(lon: number, z: number) {
  return ((lon + 180) / 360) * 2 ** z
}
function tileY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}

export async function detectTrees(t: TreeInput, buildings: EnvBuilding[], onProgress?: (f: number) => void): Promise<{ mask: Uint8Array; tiles: number; failed: number }> {
  const { g } = t
  const z = TREE_ZOOM
  const lonOf = (x: number) => t.lon0 + x / t.kx
  const latOf = (y: number) => t.lat0 + y / t.ky
  const xMin = Math.floor(tileX(lonOf(g.x0), z))
  const xMax = Math.floor(tileX(lonOf(g.x0 + g.nx * g.cell), z))
  const yMin = Math.floor(tileY(latOf(g.y0), z))
  const yMax = Math.floor(tileY(latOf(g.y0 - g.ny * g.cell), z))
  const N = g.nx * g.ny
  const green = new Uint16Array(N)
  const total = new Uint16Array(N)
  const jobs: [number, number][] = []
  for (let ty = yMin; ty <= yMax; ty++) for (let tx = xMin; tx <= xMax; tx++) jobs.push([tx, ty])
  let done = 0
  let failed = 0
  const S = 256
  const n2 = 2 ** z
  const one = async ([tx, ty]: [number, number]) => {
    try {
      const res = await fetch(t.tileUrl.replace('{z}', String(z)).replace('{y}', String(ty)).replace('{x}', String(tx)))
      if (!res.ok) throw new Error(String(res.status))
      const bmp = await createImageBitmap(await res.blob())
      const cv = new OffscreenCanvas(S, S)
      const ctx = cv.getContext('2d')
      if (!ctx) throw new Error('canvas')
      ctx.drawImage(bmp, 0, 0, S, S)
      const px = ctx.getImageData(0, 0, S, S).data
      for (let py = 0; py < S; py++) {
        const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty * S + py + 0.5)) / (S * n2)))) * 180) / Math.PI
        const y = (lat - t.lat0) * t.ky
        for (let pxi = 0; pxi < S; pxi++) {
          const lon = ((tx * S + pxi + 0.5) / (S * n2)) * 360 - 180
          const k = cellAt(g, (lon - t.lon0) * t.kx, y)
          if (k < 0) continue
          const o = (py * S + pxi) * 4
          const r = px[o]
          const gg = px[o + 1]
          const b = px[o + 2]
          const sum = r + gg + b
          total[k]++
          if (sum < 45) continue
          const exg = (2 * gg - r - b) / sum
          if (exg > 0.06 && gg > r && gg >= b) green[k]++
        }
      }
    } catch {
      failed++
    }
    done++
    onProgress?.(done / jobs.length)
  }
  let next = 0
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < jobs.length) await one(jobs[next++])
    }),
  )
  const mask = new Uint8Array(N)
  for (let k = 0; k < N; k++) if (total[k] && green[k] * 2 >= total[k]) mask[k] = 1
  // 건물 발자국은 빼고, 이웃이 하나도 없는 외톨이 칸도 뺀다
  for (const b of buildings) rasterize(g, b.rings, (k) => (mask[k] = 0))
  const out = new Uint8Array(N)
  for (let r = 0; r < g.ny; r++)
    for (let c = 0; c < g.nx; c++) {
      const k = r * g.nx + c
      if (!mask[k]) continue
      let nb = 0
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue
          const rr = r + dr
          const cc = c + dc
          if (rr >= 0 && cc >= 0 && rr < g.ny && cc < g.nx && mask[rr * g.nx + cc]) nb++
        }
      if (nb >= 2) out[k] = 1
    }
  return { mask: out, tiles: jobs.length, failed }
}

export type { XY }
