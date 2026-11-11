// 도판 화면과 리포트가 함께 쓰는 그리기 훅.
// 같은 자료·설정으로 그린 도판은 모듈 안에 잠시 보관해 단계를 오갈 때 다시 그리지 않는다.

import { useEffect, useMemo, useState } from 'react'
import { fineHalfFor, fineTerrainCached } from '../lib/terrainFine'
import { analyzeTerrain, type TerrainAnalysis } from '../lib/terrainSite'
import { observationsOf } from '../model/observations'
import { siteKey } from '../model/project'
import type { DiagramSettings, Project } from '../model/types'
import { buildDiagramData, type DiagramData } from './data'
import { synthCtxOf } from './synth'
import { svgBlob } from './export'
import { ORDERED_PANELS } from './panels'
import { collectedDate, renderPanel, settingsOf, type RenderedPanel } from './render'

export interface CachedPanel extends RenderedPanel {
  url: string
  key: string
}

const cache = new Map<string, CachedPanel>()

/** 짧은 열쇠 (문자열 해시) */
function hashOf(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36) + s.length.toString(36)
}
const TERRAIN_IDS = new Set(['terrain', 'sectionA', 'sectionB'])
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
  if (id === 'wind') return `${common}|${s.windSeason}`
  if (id === 'speed' || id === 'speedLocal') return `${common}|${s.speedSnap}`
  if (id === 'sunSite' || id === 'sunWide') return `${common}|${s.sunDay}`
  if (id === 'viewshed') return `${common}|${s.planFloors}`
  if (id === 'sectionA' || id === 'sectionB') return `${common}|${s.sectionAngle}|${s.sectionVex}`
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
  // 환경 계산은 수집 뒤에 따로 끝나므로 그 시각도 넣는다
  const envSig = project.collected['env:result']?.retrieved_at ?? ''
  // 수치지도는 수집과 따로 올리므로 그 시각도
  const ngiiSig = project.collected['ngii:sheets']?.retrieved_at ?? ''
  const dataSig = `${project.collectedAt ?? ''}|${envSig}|${ngiiSig}|${siteKey(project.site)}|${project.collectedRadiusM ?? project.site.radiusM}|${obsSig}`
  // 결론을 고칠 때마다 프로젝트 객체가 바뀌므로, 자료가 실제로 바뀐 때만 다시 만든다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data: DiagramData | null = useMemo(() => buildDiagramData(project), [dataSig, project.collected])
  const date = collectedDate(project)
  const ids = (only ?? ORDERED_PANELS.map((p) => p.id)).join(',')
  const allKey = ORDERED_PANELS.map((p) => settingsKey(p.id, settings)).join(';')
  // 종합 다이어그램: 그림·카드가 바뀌면 그 도판만 다시
  const synthSig = JSON.stringify([project.synth ?? null, project.cards.filter((c) => ['TENSION', 'OPPORTUNITY', 'HYPOTHESIS'].includes(c.type)).map((c) => [c.id, c.status, c.text, c.fields?.['제목'], c.fields?.['방향'], c.fields?.['근거'], c.related_card_ids])])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const synth = useMemo(() => synthCtxOf(project), [synthSig])
  const [panels, setPanels] = useState<Record<string, CachedPanel>>({})
  const [busy, setBusy] = useState(false)
  const [terrain, setTerrain] = useState<TerrainAnalysis | null>(null)

  useEffect(() => {
    if (!data) {
      setPanels({})
      return
    }
    let alive = true
    const wanted = ORDERED_PANELS.filter((p) => ids.split(',').includes(p.id))
    void (async () => {
      setBusy(true)
      const needsTerrain = wanted.some((p) => TERRAIN_IDS.has(p.id) || (p.id === 'synth' && TERRAIN_IDS.has(synth.state.base)))
      const fine = needsTerrain ? fineTerrainCached(data.ngii, data.center, fineHalfFor(data.R)) : null
      const t = needsTerrain ? await analyzeTerrain(data.center, data.boundary, data.R, fine).catch(() => null) : null
      if (!alive) return
      setTerrain(t)
      for (const def of wanted) {
        const tKey = TERRAIN_IDS.has(def.id) || def.id === 'synth' ? `|${t ? `${t.grid.source}${t.grid.version ?? ''}` : 'no-terrain'}` : ''
        // 속도 장면은 수집 뒤에도 늘어나므로 장면 수를 열쇠에 넣는다
        const sKey = def.id === 'speed' || def.id === 'speedLocal' ? `|snaps:${data.speedSnaps.length}` : ''
        const yKey = def.id === 'synth' ? `|synth:${hashOf(synthSig)}` : ''
        const key = `${dataSig}|${def.id}|${settingsKey(def.id, settings)}|${vworldKey ? 'k' : '-'}${tKey}${sKey}${yKey}`
        let hit = cache.get(key)
        if (!hit) {
          const r = await renderPanel(def, data, settings, vworldKey, date, t, def.id === 'synth' ? { synth } : {})
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
  }, [data, allKey, vworldKey, ids, date, synthSig])

  return { data, settings, panels, busy, terrain }
}
