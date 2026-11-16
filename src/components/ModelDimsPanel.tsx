// ⑩ 3D 모형 '어림 치수' 칸 (2026-11-17 사용자 요청: 어림으로 넣는 모든 치수를 고칠 수 있게, 기본값은 그대로).
// 인터뷰: 묶음별로 접어 두고, 고친 값은 색으로, 칸마다·묶음마다 '기본값'. 프로젝트마다 저장 + '내 기본값'(이 브라우저, 새 프로젝트가 이 값으로 시작).

import { useEffect, useState } from 'react'
import { changedDims, DIM_DEFS, DIM_GROUPS, dimsOf, loadUserDims, saveUserDims, type DimDef, type DimGroup, type ModelDims } from '../export/modelDims'

interface Props {
  /** 프로젝트에 저장된 고친 값 (기본값과 다른 것만) */
  value: Partial<ModelDims> | undefined
  onChange: (next: Partial<ModelDims>) => void
  disabled?: boolean
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000)

/** 숫자 칸: 입력하는 동안은 그대로, 칸을 벗어나거나 Enter일 때 반영 (범위 밖이면 되돌림) */
function DimField({ def, value, onCommit, disabled }: { def: DimDef; value: number; onCommit: (v: number) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(fmt(value))
  useEffect(() => setDraft(fmt(value)), [value])
  const commit = () => {
    const v = Number(draft.replace(',', '.'))
    if (draft.trim() !== '' && Number.isFinite(v) && v >= def.min && v <= def.max) {
      if (Math.abs(v - value) > 1e-9) onCommit(v)
    } else setDraft(fmt(value))
  }
  return (
    <input
      type="number"
      inputMode="decimal"
      min={def.min}
      max={def.max}
      step={def.step}
      value={draft}
      disabled={disabled}
      aria-label={`${def.label} (${def.unit})`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  )
}

export default function ModelDimsPanel({ value, onChange, disabled }: Props) {
  const d = dimsOf(value)
  const changed = changedDims(d)
  const nChanged = Object.keys(changed).length
  const [user, setUser] = useState(() => loadUserDims())
  const [note, setNote] = useState<string | null>(null)
  const setOne = (k: DimDef['key'], v: number) => onChange(changedDims({ ...d, [k]: v }))
  const resetGroup = (g: DimGroup) => {
    const next = { ...d }
    for (const def of DIM_DEFS) if (def.group === g) next[def.key] = def.def
    onChange(changedDims(next))
  }
  const sameAsUser = JSON.stringify(changedDims(dimsOf(user))) === JSON.stringify(changed)

  return (
    <section className="model-dims">
      <h3>어림 치수</h3>
      <p className="muted small">
        자료에 없어 어림으로 넣는 치수입니다. 고치면 이 프로젝트의 렌더링 모델·미리보기·라이노 파일에 들어갑니다(하천·다리 묶음의 땅 모양은 콘타 모형에도).{' '}
        {nChanged ? <strong>고친 것 {nChanged}개</strong> : '지금은 모두 기본값'}
      </p>
      <div className="model-dims-actions">
        {nChanged > 0 && (
          <button type="button" className="btn small" disabled={disabled} onClick={() => onChange({})}>
            모두 기본값
          </button>
        )}
        <button
          type="button"
          className="btn small"
          disabled={disabled || sameAsUser}
          title="이 브라우저에서 새로 만드는 프로젝트가 이 값으로 시작합니다"
          onClick={() => {
            const ok = saveUserDims(changed)
            setUser(loadUserDims())
            setNote(ok ? (nChanged ? `내 기본값으로 저장했습니다 — 새 프로젝트가 고친 ${nChanged}개로 시작합니다.` : '내 기본값을 지웠습니다 — 새 프로젝트는 앱 기본값으로 시작합니다.') : '브라우저 저장소를 쓸 수 없어 저장하지 못했습니다.')
          }}
        >
          내 기본값으로 저장
        </button>
        {user && Object.keys(user).length > 0 && !sameAsUser && (
          <button
            type="button"
            className="btn small"
            disabled={disabled}
            onClick={() => {
              onChange(changedDims(dimsOf(user)))
              setNote(`내 기본값(고친 ${Object.keys(user).length}개)을 불러왔습니다.`)
            }}
          >
            내 기본값 불러오기
          </button>
        )}
      </div>
      {note && <p className="muted small">{note}</p>}
      {DIM_GROUPS.map((g) => {
        const defs = DIM_DEFS.filter((x) => x.group === g.id)
        const n = defs.filter((x) => x.key in changed).length
        return (
          <details key={g.id} className="model-dims-group">
            <summary>
              {g.label}
              {n > 0 && <span className="model-dims-badge"> 고친 것 {n}</span>}
            </summary>
            {g.note && <p className="muted small">{g.note}</p>}
            <table className="model-dims-table">
              <tbody>
                {defs.map((def) => {
                  const ch = def.key in changed
                  return (
                    <tr key={def.key} className={ch ? 'changed' : undefined}>
                      <td>{def.label}</td>
                      <td className="num">
                        <DimField def={def} value={d[def.key]} disabled={disabled} onCommit={(v) => setOne(def.key, v)} />
                      </td>
                      <td className="muted small">{def.unit}</td>
                      <td className="muted small">
                        {ch ? (
                          <button type="button" className="btn small ghost" disabled={disabled} title={`기본값 ${def.def}${def.unit}로`} onClick={() => setOne(def.key, def.def)}>
                            ↺ {def.def}
                          </button>
                        ) : (
                          `기본 ${def.def}`
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {n > 0 && (
              <button type="button" className="btn small ghost" disabled={disabled} onClick={() => resetGroup(g.id)}>
                {g.label} 모두 기본값
              </button>
            )}
          </details>
        )
      })}
    </section>
  )
}
