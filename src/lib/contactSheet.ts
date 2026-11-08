// 관찰 사진을 챗봇에 첨부하기 쉽도록, 여러 장을 관찰 번호와 함께 한 장의 이미지(밀착 인화지)로 묶는다.
// 한 장에 최대 9장(3×3). 사진이 많으면 여러 장이 만들어진다.

import { getPhotos } from '../model/db'

export interface SheetItem {
  photoId: string
  label: string // 예: "O-03 ①"
}

const COLS = 3
const CELL_W = 640
const CELL_H = 480
const LABEL_H = 44
const GAP = 12

export async function buildContactSheets(items: SheetItem[]): Promise<Blob[]> {
  const records = new Map((await getPhotos(items.map((i) => i.photoId))).map((r) => [r.id, r]))
  const usable = items.filter((i) => records.has(i.photoId))
  const sheets: Blob[] = []
  for (let start = 0; start < usable.length; start += 9) {
    const page = usable.slice(start, start + 9)
    const rows = Math.ceil(page.length / COLS)
    const canvas = document.createElement('canvas')
    canvas.width = COLS * CELL_W + (COLS + 1) * GAP
    canvas.height = rows * (CELL_H + LABEL_H) + (rows + 1) * GAP
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('이미지를 만들 수 없습니다.')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < page.length; i++) {
      const rec = records.get(page[i].photoId)!
      const bmp = await createImageBitmap(rec.blob)
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const x = GAP + col * (CELL_W + GAP)
      const y = GAP + row * (CELL_H + LABEL_H + GAP)
      const scale = Math.min(CELL_W / bmp.width, CELL_H / bmp.height)
      const w = bmp.width * scale
      const h = bmp.height * scale
      ctx.fillStyle = '#f1f0ec'
      ctx.fillRect(x, y, CELL_W, CELL_H)
      ctx.drawImage(bmp, x + (CELL_W - w) / 2, y + (CELL_H - h) / 2, w, h)
      bmp.close()
      ctx.fillStyle = '#1d1d1b'
      ctx.font = '700 28px Pretendard, "Malgun Gothic", sans-serif'
      ctx.textBaseline = 'middle'
      ctx.fillText(page[i].label, x + 6, y + CELL_H + LABEL_H / 2)
    }
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
    if (blob) sheets.push(blob)
  }
  return sheets
}
