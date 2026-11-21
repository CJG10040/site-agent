// 올린 글꼴 목록 훅 (2026-11-21 묶음 D3): 목록을 읽고, 화면에 바로 그리는 곳을 위해 FontFace로 등록.

import { useEffect, useState } from 'react'
import { listFonts, onFontsChange, registerFonts, type FontRecord } from './fonts'

export function useFonts(): FontRecord[] {
  const [list, setList] = useState<FontRecord[]>([])
  useEffect(() => {
    let alive = true
    const load = () => {
      void listFonts().then((l) => alive && setList(l))
      void registerFonts()
    }
    load()
    const off = onFontsChange(load)
    return () => {
      alive = false
      off()
    }
  }, [])
  return list
}
