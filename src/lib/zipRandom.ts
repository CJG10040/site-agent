// 큰 ZIP(시군구 묶음 등)을 통째로 메모리에 올리지 않고 필요한 파일만 꺼내기 (2026-11-22 묶음 H2).
// 끝의 중앙 디렉터리만 읽어 목록을 만들고, 꺼낼 때는 그 파일 자리만 잘라 읽어 푼다. ZIP64(4GB 넘음)는 아직 못 읽음.

import { inflateSync } from 'fflate'

export interface ZipEntry {
  name: string
  method: number
  compSize: number
  size: number
  /** 로컬 헤더 위치 */
  offset: number
}

const cp949 = (() => {
  try {
    return new TextDecoder('euc-kr')
  } catch {
    return new TextDecoder()
  }
})()
const utf8 = new TextDecoder()

async function bytesOf(file: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, end).arrayBuffer())
}

/** ZIP 안 파일 목록 */
export async function listZip(file: Blob): Promise<ZipEntry[]> {
  const tailLen = Math.min(file.size, 65557)
  const tail = await bytesOf(file, file.size - tailLen, file.size)
  const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  if (eocd < 0) throw new Error('ZIP 끝(중앙 디렉터리)을 찾지 못했습니다')
  const count = dv.getUint16(eocd + 10, true)
  const cdSize = dv.getUint32(eocd + 12, true)
  const cdOff = dv.getUint32(eocd + 16, true)
  if (cdOff === 0xffffffff || count === 0xffff) throw new Error('4GB가 넘는 ZIP(ZIP64)은 아직 못 읽습니다 — 풀어서 폴더에 두세요')
  const cd = await bytesOf(file, cdOff, cdOff + cdSize)
  const v = new DataView(cd.buffer, cd.byteOffset, cd.byteLength)
  const out: ZipEntry[] = []
  let p = 0
  for (let k = 0; k < count && p + 46 <= cd.length; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const flags = v.getUint16(p + 8, true)
    const method = v.getUint16(p + 10, true)
    const compSize = v.getUint32(p + 20, true)
    const size = v.getUint32(p + 24, true)
    const nLen = v.getUint16(p + 28, true)
    const xLen = v.getUint16(p + 30, true)
    const cLen = v.getUint16(p + 32, true)
    const offset = v.getUint32(p + 42, true)
    const raw = cd.subarray(p + 46, p + 46 + nLen)
    const name = (flags & 0x800 ? utf8 : cp949).decode(raw)
    out.push({ name, method, compSize, size, offset })
    p += 46 + nLen + xLen + cLen
  }
  return out
}

/** 한 파일 꺼내기 (저장·deflate만) */
export async function readZipEntry(file: Blob, e: ZipEntry): Promise<Uint8Array> {
  const head = await bytesOf(file, e.offset, e.offset + 30)
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength)
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error(`${e.name}: ZIP 안 파일 머리가 맞지 않습니다`)
  const start = e.offset + 30 + dv.getUint16(26, true) + dv.getUint16(28, true)
  const data = await bytesOf(file, start, start + e.compSize)
  if (e.method === 0) return data
  if (e.method === 8) return inflateSync(data, { out: new Uint8Array(e.size) })
  throw new Error(`${e.name}: 이 압축 방식(${e.method})은 못 풉니다`)
}
