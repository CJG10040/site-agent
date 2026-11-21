// '보는 안' 고르기 (2026-11-21 묶음 C, 사용자 결정: ⑥ 도판·⑩ 3D 모형 위쪽에): 현황(빈 대지) · A안 · B안 …
// 고르면 도판·3D 모형이 그 안으로 바뀐다. 설계안이 없으면 보이지 않는다.

import { useState } from 'react'
import { applyEnv } from '../model/applyEnv'
import { activeDesign, ENV_KEY, envKeyOf, storeDesignEnv } from '../model/designs'
import { lastEditAt } from '../model/edits'
import type { Project } from '../model/types'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  /** ⑩으로 가는 안내 (⑥에서) */
  onGoModel?: () => void
}

export default function ScenarioPicker({ project, update, onGoModel }: Props) {
  const designs = project.designs ?? []
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!designs.length) return null
  // 현황 환경 계산을 했는데 이 안의 결과가 없으면 계산 단추
  const design = activeDesign(project)
  const needEnv = !!design && !!project.collected[ENV_KEY] && !project.collected[envKeyOf(project)]
  // 보는 안의 환경 계산이 학생이 더하거나 뺀 건물보다 먼저면 다시
  const envAt = project.collected[envKeyOf(project)]?.retrieved_at ?? ''
  const edited = lastEditAt(project)
  const stale = !needEnv && !!envAt && !!edited && envAt < edited
  const runEnv = async () => {
    setError(null)
    setBusy('계산 준비')
    try {
      const { computeEnv } = await import('../sources/env')
      if (design) {
        const r = await computeEnv(project, null, (t) => setBusy(t), { design: true })
        update((d) => storeDesignEnv(d, r))
      } else {
        // 현황은 사실 카드도 함께 (④ 수집 때와 같음)
        const r = await computeEnv(project, null, (t) => setBusy(t))
        update((d) => applyEnv(d, r, null))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(null)
  }
  const cur = designs.some((d) => d.id === project.scenario) ? project.scenario! : ''
  const opts: [string, string][] = [['', '현황 (빈 대지)'], ...designs.map((d) => [d.id, d.name] as [string, string])]
  return (
    <div className="scenario-picker">
      <span className="label">보는 안</span>
      <div className="segmented small" role="radiogroup" aria-label="보는 안">
        {opts.map(([id, label]) => (
          <button
            key={id || 'now'}
            type="button"
            role="radio"
            aria-checked={cur === id}
            className={cur === id ? 'on' : ''}
            onClick={() =>
              update((d) => {
                if (id) d.scenario = id
                else delete d.scenario
              })
            }
          >
            {label}
          </button>
        ))}
      </div>
      <span className="muted small">
        {cur ? '이 안의 매스가 도판·3D 모형에 들어갑니다. 대지 안 기존 건물은 늘 뺍니다.' : '대지 안 기존 건물을 뺀 빈 대지입니다.'}
        {onGoModel && (
          <>
            {' '}
            <button type="button" className="link-btn small" onClick={onGoModel}>
              ⑩에서 안 올리기·관리
            </button>
          </>
        )}
      </span>
      {(needEnv || stale || busy || error) && (
        <p className={`notice small scenario-env${error ? ' error' : ''}`}>
          {busy ? (
            `${design?.name ?? '현황'} 환경 계산 중 · ${busy} (몇 초~1분)`
          ) : error ? (
            `환경 계산을 하지 못했습니다: ${error}`
          ) : stale ? (
            <>
              {design?.name ?? '현황'}의 환경 계산이 더하거나 뺀 건물보다 먼저입니다 — 일조·하늘 등에 아직 반영되지 않았습니다.{' '}
              <button type="button" className="btn small" onClick={() => void runEnv()}>
                다시 계산
              </button>
            </>
          ) : (
            <>
              {design?.name}의 일조·하늘·가시권·바람·열쾌적 계산이 아직 없습니다 — 환경 도판이 비어 보입니다.{' '}
              <button type="button" className="btn small" onClick={() => void runEnv()}>
                {design?.name} 계산하기
              </button>
            </>
          )}
        </p>
      )}
    </div>
  )
}
