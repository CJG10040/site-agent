// 도판 내보내기: SVG 그대로, PNG(캔버스), 여러 장을 ZIP 하나로.

import { zipSync, strToU8 } from 'fflate'

export function svgBlob(svg: string): Blob {
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`], { type: 'image/svg+xml;charset=utf-8' })
}

function svgSize(svg: string): { w: number; h: number } {
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 1000, h: 1300 }
}

/** SVG → PNG (가로 width 픽셀) */
export async function svgToPng(svg: string, width: number, background: string | null = null): Promise<Blob> {
  const { w, h } = svgSize(svg)
  const scale = width / w
  const url = URL.createObjectURL(svgBlob(svg))
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('도판 그림을 읽지 못했습니다'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const g = canvas.getContext('2d')
    if (!g) throw new Error('캔버스를 만들 수 없습니다')
    if (background) {
      g.fillStyle = background
      g.fillRect(0, 0, canvas.width, canvas.height)
    }
    g.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG로 바꾸지 못했습니다'))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function zipBlob(files: { name: string; data: Blob | string }[]): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {}
  for (const f of files) {
    entries[f.name] = typeof f.data === 'string' ? strToU8(f.data) : new Uint8Array(await f.data.arrayBuffer())
  }
  // PNG는 이미 압축되어 있어 다시 압축하지 않음
  const zipped = zipSync(entries, { level: 6 })
  return new Blob([zipped as BlobPart], { type: 'application/zip' })
}
