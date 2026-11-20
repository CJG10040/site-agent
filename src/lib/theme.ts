import { useCallback, useState } from 'react'
import { readSetting, writeSetting } from './storage'

// 밝은·어두운 테마: '자동'이면 컴퓨터 설정을 따르고, 고르면 이 브라우저에 기억한다.
// 첫 화면이 깜빡이지 않도록 index.html의 짧은 스크립트가 같은 값을 미리 <html data-theme>에 넣는다.

export type ThemePref = 'auto' | 'light' | 'dark'

const KEY = 'site-agent:theme'
const ORDER: ThemePref[] = ['auto', 'light', 'dark']

export const THEME_LABEL: Record<ThemePref, string> = { auto: '자동 (컴퓨터 설정)', light: '밝게', dark: '어둡게' }

function readPref(): ThemePref {
  const v = readSetting(KEY)
  return v === 'light' || v === 'dark' ? v : 'auto'
}

function apply(pref: ThemePref) {
  const root = document.documentElement
  if (pref === 'auto') delete root.dataset.theme
  else root.dataset.theme = pref
}

export function useTheme(): [ThemePref, () => void] {
  const [pref, setPref] = useState<ThemePref>(readPref)
  const cycle = useCallback(() => {
    setPref((cur) => {
      const next = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length]
      apply(next)
      writeSetting(KEY, next === 'auto' ? '' : next)
      return next
    })
  }, [])
  return [pref, cycle]
}
