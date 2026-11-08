import { useCallback, useEffect, useRef, useState } from 'react'
import { getProject, putProject } from './db'
import { nowIso } from './project'
import type { Project } from './types'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * 프로젝트 하나를 불러오고, 바뀔 때마다 잠시 뒤 브라우저 저장소에 저장한다.
 * update(fn)에 넘기는 fn은 복사본(draft)을 직접 고치면 된다.
 */
export function useProject(id: string | null) {
  const [project, setProject] = useState<Project | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const timer = useRef<number | null>(null)
  const latest = useRef<Project | null>(null)

  useEffect(() => {
    let cancelled = false
    setProject(null)
    setLoadError(null)
    latest.current = null
    if (!id) return
    getProject(id)
      .then((p) => {
        if (cancelled) return
        if (!p) setLoadError('프로젝트를 찾을 수 없습니다.')
        else {
          latest.current = p
          setProject(p)
        }
      })
      .catch(() => !cancelled && setLoadError('브라우저 저장소를 열 수 없습니다. (사생활 보호 모드 등)'))
    return () => {
      cancelled = true
    }
  }, [id])

  const flush = useCallback(async () => {
    if (timer.current) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    const p = latest.current
    if (!p) return
    setSaveState('saving')
    try {
      await putProject(p)
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }, [])

  const update = useCallback(
    (fn: (draft: Project) => void) => {
      const current = latest.current
      if (!current) return
      // 수집 원자료(collected)는 크고 통째로 교체만 하므로 복사하지 않고 공유한다 (입력할 때마다 느려지지 않도록)
      const { collected, ...rest } = current
      const draft = { ...structuredClone(rest), collected } as Project
      fn(draft)
      draft.updatedAt = nowIso()
      latest.current = draft
      setProject(draft)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush(), 400)
    },
    [flush],
  )

  // 페이지를 떠나기 전 남은 저장을 처리
  useEffect(() => {
    const onHide = () => void flush()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      void flush()
    }
  }, [flush])

  return { project, loadError, saveState, update, flush }
}
