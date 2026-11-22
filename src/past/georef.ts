// 과거와 현재 (2026-11-22 사용자 결정: 옛 항공사진을 올리고 세 점으로 위치를 맞춤).
// 세 점(사진 픽셀 ↔ 지금 경위도)으로 '사진 → 대지 중심 평면(m)' 아핀 변환을 풀고,
// 도판 좌표(frame)로 옮겨 SVG <image transform="matrix(…)">로 그린다. 세 점이면 돌림·비율·기울기까지 맞음.

import { MAP_CX, MAP_CY, MAP_R, type Frame } from '../diagrams/frame'
import type { PastImage } from '../model/types'

/** x = a·u + b·v + c, y = d·u + e·v + f (x 동쪽 m, y 북쪽 m, 대지 중심 원점) */
export interface Affine {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/** 경위도 → 대지 중심 평면(m) — 도판 틀(makeFrame)과 같은 비율 */
export function toLocal(lon: number, lat: number, lon0: number, lat0: number): [number, number] {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180)
  return [(lon - lon0) * kx, (lat - lat0) * 110574]
}

function solve3(m: number[][], r: number[]): [number, number, number] | null {
  const det = (q: number[][]) => q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1]) - q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0]) + q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0])
  const D = det(m)
  if (Math.abs(D) < 1e-9) return null
  const col = (i: number) => m.map((row, k) => row.map((v, j) => (j === i ? r[k] : v)))
  return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D]
}

/** 세 점에서 아핀 변환 (세 점이 한 줄이면 null) */
export function affineOf(img: PastImage, lon0: number, lat0: number): Affine | null {
  if (img.gcps.length < 3) return null
  const g = img.gcps.slice(0, 3)
  const m = g.map((p) => [p.img[0], p.img[1], 1])
  const loc = g.map((p) => toLocal(p.ll[0], p.ll[1], lon0, lat0))
  const xs = solve3(m, loc.map((q) => q[0]))
  const ys = solve3(m, loc.map((q) => q[1]))
  if (!xs || !ys) return null
  return { a: xs[0], b: xs[1], c: xs[2], d: ys[0], e: ys[1], f: ys[2] }
}

/** 사진 1픽셀이 땅에서 몇 m인지 (대략) */
export function metersPerPixel(t: Affine): number {
  return Math.sqrt(Math.abs(t.a * t.e - t.b * t.d))
}

export interface PastLayer {
  /** 도판 틀 안에 들어오는 부분만 잘라 낸 그림 (data URL — SVG로 받아도 그림이 들어가게) */
  href: string
  width: number
  height: number
  /** 잘라 낸 그림 픽셀 → 도판 좌표 SVG matrix */
  matrix: string
}

/** 저장한 옛 사진을 도판 틀 범위로 잘라 SVG에 넣을 그림으로 (긴 변 2000px 안) */
export async function pastLayerFor(blob: Blob, img: PastImage, t: Affine, f: Frame): Promise<PastLayer | null> {
  // 도판 픽셀 → 사진 픽셀 (역변환)
  const s = f.s
  const m11 = s * t.a
  const m21 = s * t.b
  const tx = s * t.c + MAP_CX
  const m12 = -s * t.d
  const m22 = -s * t.e
  const ty = -s * t.f + MAP_CY
  const det = m11 * m22 - m21 * m12
  if (Math.abs(det) < 1e-12) return null
  const inv = (X: number, Y: number): [number, number] => {
    const x = X - tx
    const y = Y - ty
    return [(m22 * x - m21 * y) / det, (-m12 * x + m11 * y) / det]
  }
  const pad = 20
  const corners = [
    [MAP_CX - MAP_R - pad, MAP_CY - MAP_R - pad],
    [MAP_CX + MAP_R + pad, MAP_CY - MAP_R - pad],
    [MAP_CX + MAP_R + pad, MAP_CY + MAP_R + pad],
    [MAP_CX - MAP_R - pad, MAP_CY + MAP_R + pad],
  ].map(([X, Y]) => inv(X, Y))
  const u0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))))
  const v0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))))
  const u1 = Math.min(img.width, Math.ceil(Math.max(...corners.map((c) => c[0]))))
  const v1 = Math.min(img.height, Math.ceil(Math.max(...corners.map((c) => c[1]))))
  if (u1 - u0 < 2 || v1 - v0 < 2) return null
  const bmp = await createImageBitmap(blob)
  try {
    const k = Math.min(1, 2000 / Math.max(u1 - u0, v1 - v0))
    const w = Math.max(1, Math.round((u1 - u0) * k))
    const h = Math.max(1, Math.round((v1 - v0) * k))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const g = canvas.getContext('2d')
    if (!g) return null
    // 저장한 그림과 기록한 크기가 다르면(옛 기록) 비율로 맞춤
    const sx = bmp.width / img.width
    const sy = bmp.height / img.height
    g.drawImage(bmp, u0 * sx, v0 * sy, (u1 - u0) * sx, (v1 - v0) * sy, 0, 0, w, h)
    const href = canvas.toDataURL('image/jpeg', 0.82)
    // 잘라 낸 그림 픽셀 (p, q) → 사진 픽셀 (u0 + p/k, v0 + q/k) → 도판
    const n = (x: number) => x.toFixed(5)
    const matrix = `matrix(${n(m11 / k)} ${n(m12 / k)} ${n(m21 / k)} ${n(m22 / k)} ${n(m11 * u0 + m21 * v0 + tx)} ${n(m12 * u0 + m22 * v0 + ty)})`
    return { href, width: w, height: h, matrix }
  } finally {
    bmp.close()
  }
}

/** 옛 사진을 저장용으로 줄임 (긴 변 4096px JPEG — 옛 항공사진은 한 장이 넓은 땅이라 현장 사진보다 크게) */
export async function processPastImage(file: File): Promise<{ blob: Blob; thumb: Blob; width: number; height: number }> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    throw new Error(`'${file.name}'을(를) 열 수 없습니다. JPEG·PNG로 바꿔 올려 주세요 (TIFF·HEIC는 브라우저가 못 엶).`)
  }
  try {
    const shrink = async (max: number, q: number) => {
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
      const w = Math.max(1, Math.round(bmp.width * k))
      const h = Math.max(1, Math.round(bmp.height * k))
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      c.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
      const b = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', q))
      if (!b) throw new Error('그림을 저장 형식으로 바꾸지 못했습니다.')
      return { blob: b, width: w, height: h }
    }
    const main = await shrink(4096, 0.85)
    const thumb = await shrink(360, 0.75)
    return { blob: main.blob, thumb: thumb.blob, width: main.width, height: main.height }
  } finally {
    bmp.close()
  }
}
