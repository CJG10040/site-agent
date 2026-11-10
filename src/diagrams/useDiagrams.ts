// 도판 화면과 리포트가 함께 쓰는 그리기 훅.
// 같은 자료·설정으로 그린 도판은 모듈 안에 잠시 보관해 단계를 오갈 때 다시 그리지 않는다.

import { useEffect, useMemo, useState } from 'react'
import { observationsOf } from '../model/observations'
import { siteKey } from '../model/project'
import type { DiagramSettings, Project } from '../model/types'
import { buildDiagramData, type DiagramData } from './data'
import { svgBlob } from './export'
import { ORDERED_PANELS } from './panels'
import { collectedDate, renderPanel, settingsOf, type RenderedPanel } from './render'

export interface CachedPanel extends RenderedPanel {
  url: string
  key: string
}

const cache = new Map<string, CachedPanel>()
const MAX_CACHE = 80

function cachePut(p: CachedPanel) {
  cache.set(p.key, p)
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value as string
    const old = cache.get(oldest)
    if (old) URL.revokeObjectURL(old.url)
    cache.delete(oldest)
  }
}

/** 도판마다 영향을 주는 설정만 골라 열쇠로 */
function settingsKey(id: string, s: DiagramSettings): string {
  const common = `${s.frame}|${s.palette}|${s.background}|${s.siteMark}`
  if (id === 'high') return `${common}|${s.highFloors}`
  if (id === 'low') return `${common}|${s.lowFloors}`
  if (id === 'sun') return `${common}|${s.sunDay}|${s.sunHour}`
  return common
}

export function useDiagrams(project: Project, vworldKey: string, only?: string[]) {
  const settings = settingsOf(project)
  const obsSig = observationsOf(project)
    .map((o) => {
      const d = o.observation!
      return `${o.id}:${d.location ? `${d.location.lon.toFixed(6)},${d.location.lat.toFixed(6)}` : ''}:${d.discovery ? 1 : 0}:${d.links.some((l) => l.relation === 'differ') ? 1 : 0}`
    })
    .join('|')
  const dataSig = `${project.collectedAt ?? ''}|${siteKey(project.site)}|${project.collectedRadiusM ?? project.site.radiusM}|${obsSig}`
  // 결론을 고칠 때마다 프로젝트 객체가 바뀌므로, 자료가 실제로 바뀐 때만 다시 만든다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data: DiagramData | null = useMemo(() => buildDiagramData(project), [dataSig, project.collected])
  const date = collectedDate(project)
  const ids = (only ?? ORDERED_PANELS.map((p) => p.id)).join(',')
  const allKey = ORDERED_PANELS.map((p) => settingsKey(p.id, settings)).join(';')
  const [panels, setPanels] = useState<Record<string, CachedPanel>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!data) {
      setPanels({})
      return
    }
    let alive = true
    const wanted = ORDERED_PANELS.filter((p) => ids.split(',').includes(p.id))
    void (async () => {
      setBusy(true)
      for (const def of wanted) {
        const key = `${dataSig}|${def.id}|${settingsKey(def.id, settings)}|${vworldKey ? 'k' : '-'}`
        let hit = cache.get(key)
        if (!hit) {
          const r = await renderPanel(def, data, settings, vworldKey, date)
          hit = { ...r, url: URL.createObjectURL(svgBlob(r.svg)), key }
          cachePut(hit)
        }
        if (!alive) return
        const done = hit
        setPanels((cur) => (cur[def.id]?.key === done.key ? cur : { ...cur, [def.id]: done }))
        await new Promise((r) => setTimeout(r, 0))
      }
      if (alive) setBusy(false)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, allKey, vworldKey, ids, date])

  return { data, settings, panels, busy }
}
