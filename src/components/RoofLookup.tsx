// 15-D 지붕 구조 조회 (⑩ 3D 모형 '모형에 쓰는 자료'): 학생이 고른 반경 안 건물이 놓인 필지의 건축물대장 표제부에서 지붕 구조를 받아 저장.
// 받은 필지는 다시 조회하지 않음 (한 번 받으면 다시 쓰기). 반경 밖·대장에 없는 건물은 규칙(1~2층 단독주택 박공, 그 밖 평지붕 + 파라펫).

import { useMemo, useRef, useState } from 'react'
import type { DiagramData } from '../diagrams/data'
import { roofKindOf, ROOF_LABEL, type RoofKind } from '../export/roofs'
import { applyRoofs, DEFAULT_ROOF_R, fetchRoofs, roofData, roofParcels, ROOF_RADII } from '../model/applyRoofs'
import type { Project } from '../model/types'
import type { ApiKeys } from '../sources/keys'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  keys: ApiKeys
  data: DiagramData
}

const fmt = (n: number) => n.toLocaleString('ko-KR')

export default function RoofLookup({ project, update, keys, data }: Props) {
  const R = project.roofRadiusM ?? DEFAULT_ROOF_R
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const stop = useRef(false)
  const parcels = useMemo(() => roofParcels(data, R), [data, R])
  const stored = useMemo(() => roofData(project), [project])
  const todo = parcels.filter((p) => !(p.pnu in stored))
  const inRange = parcels.filter((p) => p.pnu in stored)
  // 받은 필지의 지붕 구조 → 모양별 동 수 (주건축물)
  const kinds = useMemo(() => {
    const c: Record<RoofKind | 'unknown', number> = { flat: 0, gable: 0, metal: 0, unknown: 0 }
    for (const p of inRange) for (const t of stored[p.pnu] ?? []) if (t.main) c[roofKindOf(t.roof, t.strct) ?? 'unknown']++
    return c
  }, [inRange, stored])
  const noKey = !keys.dataGoKr.trim()

  const setR = (r: number) =>
    update((d) => {
      d.roofRadiusM = r
    })

  const run = async (all: boolean) => {
    const list = (all ? parcels : todo).map((p) => p.pnu)
    if (!list.length) return
    stop.current = false
    setMsg(null)
    setBusy({ done: 0, total: list.length })
    const res = await fetchRoofs(keys, list, (done, total) => setBusy({ done, total }), () => stop.current)
    update((d) => applyRoofs(d, res, R))
    setBusy(null)
    const err = res.filter((r) => r.error)
    const none = res.filter((r) => !r.error && !r.titles.length).length
    setMsg(
      err.length === res.length
        ? { kind: 'error', text: `받지 못했습니다: ${err[0]?.error ?? '오류'}` }
        : {
            kind: 'ok',
            text: `필지 ${fmt(res.length - err.length)}개의 지붕 구조를 받아 저장했습니다${none ? ` (대장이 없는 필지 ${fmt(none)}개 — 규칙으로)` : ''}${err.length ? `, ${fmt(err.length)}개는 오류라 다음에 다시` : ''}${stop.current ? ' — 멈춤' : ''}.`,
          },
    )
  }

  return (
    <div className="roof-lookup">
      <h4>지붕 모양 (건축물대장 지붕 구조)</h4>
      <p className="muted small">
        반경 안 건물은 건축물대장 표제부의 지붕 구조로 정하고(콘크리트 → 평지붕 + 파라펫, 기와·슬레이트 → 박공, 판넬·강판 → 낮은 경사), 그 밖은 규칙(1~2층 단독주택 박공, 나머지 평지붕 +
        파라펫). 받은 것은 저장해 다시 씁니다.
      </p>
      <div className="row">
        <span className="small">조회 반경</span>
        <div className="segmented small" role="radiogroup" aria-label="지붕 조회 반경">
          {ROOF_RADII.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={R === r} className={R === r ? 'on' : ''} disabled={!!busy} onClick={() => setR(r)}>
              {r}m
            </button>
          ))}
        </div>
      </div>
      {!data.parcels.length ? (
        <p className="notice small">필지(연속지적도) 자료가 없어 건물이 어느 필지에 있는지 알 수 없습니다 — ④ 공간정보를 수집하면 조회할 수 있습니다. 지금은 모두 규칙으로 그립니다.</p>
      ) : (
        <>
          <p className="small">
            반경 {R}m 안 건물이 놓인 필지 <strong>{fmt(parcels.length)}</strong>개 · 받아 둔 것 {fmt(inRange.length)}개
            {inRange.length > 0 && (
              <span className="muted">
                {' '}
                — {ROOF_LABEL.flat} {fmt(kinds.flat)}동 · 박공 {fmt(kinds.gable)}동 · 낮은 경사 {fmt(kinds.metal)}동{kinds.unknown ? ` · 구조 모름(규칙) ${fmt(kinds.unknown)}동` : ''}
              </span>
            )}
          </p>
          {noKey && <p className="notice small">설정에서 공공데이터포털 인증키(건축물대장)를 넣어야 조회할 수 있습니다.</p>}
          <div className="row">
            {busy ? (
              <>
                <span className="small">
                  받는 중 {fmt(busy.done)}/{fmt(busy.total)} 필지
                </span>
                <progress max={busy.total} value={busy.done} aria-label="지붕 구조 받는 진행도" />
                <button type="button" className="btn small ghost" onClick={() => (stop.current = true)}>
                  멈추기
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn small primary" disabled={noKey || !todo.length} onClick={() => void run(false)}>
                  {todo.length ? `지붕 구조 받기 (필지 ${fmt(todo.length)}개, 약 ${Math.max(1, Math.ceil(todo.length / 8))}초)` : '반경 안 필지를 모두 받음'}
                </button>
                {inRange.length > 0 && (
                  <button type="button" className="btn small ghost" disabled={noKey} onClick={() => void run(true)}>
                    새로 받기
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
      {msg && <p className={`notice small ${msg.kind === 'error' ? 'error' : 'ok'}`}>{msg.text}</p>}
    </div>
  )
}
