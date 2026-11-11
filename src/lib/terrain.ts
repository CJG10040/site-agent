// 지형: 국토지리정보원 연속수치지형도 등고선·표고점으로 미리 만든 10m 격자 타일(site-agent-terrain 저장소)을 읽는다.
// 타일: EPSG:5179 2,560m(256칸), PNG RGB — v = R×256 + G, 높이 = v/10 − 1000 (m), B=0이면 자료 없음.
// 세 지역(전남광주·전북) 밖이거나 타일이 없으면 AWS Terrarium 타일로 대신한다 (도심에서 건물 높이가 섞여 오차가 큼).
// 사용자 결정(2026-11-10): 높이는 '대지 중심 = 0m' 상대 높이로만 보여 준다.

import { utmkToWgs84, wgs84ToUtmk } from './proj'

/** 개발 중에만: localStorage 'site-agent:terrain-base'로 다른 주소(예: 내 PC에서 띄운 타일)를 시험할 수 있다 */
const DEV_BASE = import.meta.env.DEV
  ? (() => {
      try {
        return localStorage.getItem('site-agent:terrain-base')
      } catch {
        return null
      }
    })()
  : null

export const TERRAIN_BASE = DEV_BASE || 'https://cjg10040.github.io/site-agent-terrain/'
const TILE = 2560
const N = 256

export interface TerrainManifest {
  version: string
  builtAt: string
  source: { name: string; license: string; updated: string }
  cell: number
  tiles: string[]
}

export interface TerrainGrid {
  /** 격자 왼쪽 위 모서리 (EPSG:5179) */
  x0: number
  y0: number
  cell: number
  nx: number
  ny: number
  /** 해발 높이(m), 0행 = 북쪽, 자료 없음 = NaN */
  z: Float32Array
  /** ngii 10m 지형 타일, terrarium 대체 자료, map 사용자가 올린 수치지도로 만든 세밀 지형(+10m) */
  source: 'ngii' | 'terrarium' | 'map'
  version: string | null
}

/** 도판·파일 출처 글 */
export function terrainSourceLabel(source: TerrainGrid['source'] | null | undefined, version?: string | null): string {
  if (source === 'map') return `국토지리정보원 수치지도${version ? `(${version}년)` : ''} 등고선·표고점·옹벽 → 대지 주변 2m + 그 밖 10m 격자`
  if (source === 'ngii') return '국토지리정보원 10m 격자'
  if (source === 'terrarium') return '대체 자료(AWS Terrain Tiles)'
  return '자료 없음'
}

let manifestP: Promise<TerrainManifest | null> | null = null

export function loadManifest(): Promise<TerrainManifest | null> {
  manifestP ??= fetch(`${TERRAIN_BASE}dem/manifest.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<TerrainManifest>) : null))
    .catch(() => null)
  return manifestP
}

async function decode(url: string): Promise<ImageData | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const g = canvas.getContext('2d', { willReadFrequently: true })
    if (!g) return null
    g.drawImage(bmp, 0, 0)
    return g.getImageData(0, 0, bmp.width, bmp.height)
  } catch {
    return null
  }
}

const tileCache = new Map<string, Promise<ImageData | null>>()

function ngiiTile(c: number, r: number): Promise<ImageData | null> {
  const k = `${c}_${r}`
  let p = tileCache.get(k)
  if (!p) {
    p = decode(`${TERRAIN_BASE}dem/${k}.png`)
    tileCache.set(k, p)
  }
  return p
}

function emptyGrid(cx: number, cy: number, radiusM: number, margin: number) {
  const x0 = Math.floor((cx - radiusM - margin) / 10) * 10
  const y0 = Math.ceil((cy + radiusM + margin) / 10) * 10
  const nx = Math.ceil((cx + radiusM + margin - x0) / 10)
  const ny = Math.ceil((y0 - (cy - radiusM - margin)) / 10)
  const z = new Float32Array(nx * ny).fill(NaN)
  return { x0, y0, nx, ny, z, cell: 10 }
}

async function fromNgii(cx: number, cy: number, radiusM: number, manifest: TerrainManifest) {
  const g = emptyGrid(cx, cy, radiusM, 150)
  const have = new Set(manifest.tiles)
  const c0 = Math.floor(g.x0 / TILE)
  const c1 = Math.floor((g.x0 + g.nx * 10 - 1) / TILE)
  const r0 = Math.floor((g.y0 - g.ny * 10) / TILE)
  const r1 = Math.floor((g.y0 - 1) / TILE)
  const jobs: Promise<void>[] = []
  for (let c = c0; c <= c1; c++)
    for (let r = r0; r <= r1; r++) {
      if (!have.has(`${c}_${r}`)) continue
      jobs.push(
        ngiiTile(c, r).then((img) => {
          if (!img) return
          const d = img.data
          for (let j = 0; j < N; j++) {
            const y = r * TILE + TILE - (j + 0.5) * 10
            const row = Math.round((g.y0 - y) / 10 - 0.5)
            if (row < 0 || row >= g.ny) continue
            for (let i = 0; i < N; i++) {
              const x = c * TILE + (i + 0.5) * 10
              const col = Math.round((x - g.x0) / 10 - 0.5)
              if (col < 0 || col >= g.nx) continue
              const k = (j * N + i) * 4
              if (d[k + 2] === 0) continue
              g.z[row * g.nx + col] = ((d[k] << 8) | d[k + 1]) / 10 - 1000
            }
          }
        }),
      )
    }
  await Promise.all(jobs)
  return g
}

// ───────── Terrarium 대체 (전 세계 30m 안팎, 도심에서 건물 높이가 섞임) ─────────

const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'

async function fromTerrarium(cx: number, cy: number, radiusM: number) {
  const g = emptyGrid(cx, cy, radiusM, 150)
  const z = 15
  const n = 2 ** z
  const tiles = new Map<string, Promise<ImageData | null>>()
  const lonLatAt = (col: number, row: number) => utmkToWgs84(g.x0 + (col + 0.5) * 10, g.y0 - (row + 0.5) * 10)
  for (let row = 0; row < g.ny; row++)
    for (let col = 0; col < g.nx; col++) {
      const [lon, lat] = lonLatAt(col, row)
      const fx = ((lon + 180) / 360) * n
      const fy = ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n
      const tx = Math.floor(fx)
      const ty = Math.floor(fy)
      const k = `${tx}/${ty}`
      if (!tiles.has(k)) tiles.set(k, decode(`${TERRARIUM}/${z}/${tx}/${ty}.png`))
      const img = await tiles.get(k)!
      if (!img) continue
      const px = Math.min(255, Math.floor((fx - tx) * 256))
      const py = Math.min(255, Math.floor((fy - ty) * 256))
      const q = (py * 256 + px) * 4
      g.z[row * g.nx + col] = img.data[q] * 256 + img.data[q + 1] + img.data[q + 2] / 256 - 32768
    }
  return g
}

const gridCache = new Map<string, Promise<TerrainGrid | null>>()

/** 대지 중심 반경(+150m) 범위의 10m 격자 */
export function terrainAround(lon: number, lat: number, radiusM: number): Promise<TerrainGrid | null> {
  const key = `${lon.toFixed(6)},${lat.toFixed(6)},${radiusM}`
  let p = gridCache.get(key)
  if (!p) {
    p = (async () => {
      const [cx, cy] = wgs84ToUtmk(lon, lat)
      const manifest = await loadManifest()
      if (manifest) {
        const g = await fromNgii(cx, cy, radiusM, manifest)
        let valid = 0
        for (const v of g.z) if (!Number.isNaN(v)) valid++
        if (valid / g.z.length >= 0.3) return { ...g, source: 'ngii' as const, version: manifest.version }
      }
      try {
        const g = await fromTerrarium(cx, cy, radiusM)
        return { ...g, source: 'terrarium' as const, version: null }
      } catch {
        return null
      }
    })()
    gridCache.set(key, p)
  }
  return p
}

// ───────────────────────── 분석 ─────────────────────────

/** 가우시안 평활 (자료 없음은 빼고 가중 평균) */
export function smooth(g: TerrainGrid, sigmaM: number): Float32Array {
  const s = sigmaM / g.cell
  const rad = Math.ceil(s * 2.5)
  const w = Array.from({ length: rad * 2 + 1 }, (_, i) => Math.exp(-((i - rad) ** 2) / (2 * s * s)))
  const pass = (src: Float32Array, horiz: boolean) => {
    const out = new Float32Array(src.length).fill(NaN)
    for (let r = 0; r < g.ny; r++)
      for (let c = 0; c < g.nx; c++) {
        let sum = 0
        let ws = 0
        for (let k = -rad; k <= rad; k++) {
          const cc = horiz ? c + k : c
          const rr = horiz ? r : r + k
          if (cc < 0 || cc >= g.nx || rr < 0 || rr >= g.ny) continue
          const v = src[rr * g.nx + cc]
          if (Number.isNaN(v)) continue
          sum += v * w[k + rad]
          ws += w[k + rad]
        }
        if (ws > 0 && !Number.isNaN(src[r * g.nx + c])) out[r * g.nx + c] = sum / ws
      }
    return out
  }
  return pass(pass(g.z, true), false)
}

/** Horn 방식 경사도(°)와 경사 방향(비탈이 향하는 나침반 방위, °) */
export function slopeAspect(g: TerrainGrid, zz: Float32Array): { slope: Float32Array; aspect: Float32Array } {
  const slope = new Float32Array(zz.length).fill(NaN)
  const aspect = new Float32Array(zz.length).fill(NaN)
  const at = (c: number, r: number) => zz[Math.min(g.ny - 1, Math.max(0, r)) * g.nx + Math.min(g.nx - 1, Math.max(0, c))]
  for (let r = 0; r < g.ny; r++)
    for (let c = 0; c < g.nx; c++) {
      const a = at(c - 1, r - 1), b = at(c, r - 1), d = at(c + 1, r - 1)
      const e = at(c - 1, r), f = at(c + 1, r)
      const h = at(c - 1, r + 1), i = at(c, r + 1), j = at(c + 1, r + 1)
      if ([a, b, d, e, f, h, i, j].some(Number.isNaN)) continue
      const dzdx = ((d + 2 * f + j) - (a + 2 * e + h)) / (8 * g.cell) // 동쪽으로 올라가는 기울기
      const dzdy = ((a + 2 * b + d) - (h + 2 * i + j)) / (8 * g.cell) // 북쪽으로 올라가는 기울기 (0행이 북쪽)
      const k = r * g.nx + c
      slope[k] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI
      aspect[k] = ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360
    }
  return { slope, aspect }
}

export function sampleAt(g: TerrainGrid, zz: Float32Array, x: number, y: number): number {
  const fc = (x - g.x0) / g.cell - 0.5
  const fr = (g.y0 - y) / g.cell - 0.5
  const c = Math.floor(fc)
  const r = Math.floor(fr)
  if (c < 0 || r < 0 || c + 1 >= g.nx || r + 1 >= g.ny) return NaN
  const tx = fc - c
  const ty = fr - r
  const v00 = zz[r * g.nx + c], v10 = zz[r * g.nx + c + 1], v01 = zz[(r + 1) * g.nx + c], v11 = zz[(r + 1) * g.nx + c + 1]
  if ([v00, v10, v01, v11].some(Number.isNaN)) return zz[Math.round(fr) * g.nx + Math.round(fc)]
  return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty
}

/** 격자 칸 (열, 행) → 경위도 */
export function cellLonLat(g: TerrainGrid, col: number, row: number): [number, number] {
  return utmkToWgs84(g.x0 + (col + 0.5) * g.cell, g.y0 - (row + 0.5) * g.cell)
}
