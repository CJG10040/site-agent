import { STEPS, stepStatus } from '../model/project'
import type { Project, StepId } from '../model/types'

interface Props {
  project: Project
  current: StepId
  onSelect: (step: StepId) => void
}

/** 개발이 끝난 단계까지 (이후 단계는 '준비 중'으로 표시) */
const CURRENT_PHASE = 6

export default function Stepper({ project, current, onSelect }: Props) {
  return (
    <nav className="stepper" aria-label="단계">
      <ol>
        {STEPS.map((s, i) => {
          const st = stepStatus(project, s.id)
          const later = s.phase > CURRENT_PHASE
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`step${current === s.id ? ' current' : ''}${st.done ? ' done' : ''}${later ? ' later' : ''}`}
                aria-current={current === s.id ? 'step' : undefined}
                onClick={() => onSelect(s.id)}
              >
                <span className="step-num" aria-hidden="true">
                  {st.done ? '✓' : i + 1}
                </span>
                <span className="step-text">
                  <span className="step-label">{s.label}</span>
                  {later ? <span className="step-note">준비 중</span> : st.note && <span className="step-note">{st.note}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
