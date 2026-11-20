import { useEffect, useRef, useState } from 'react'
import { Check, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { STEPS, stepStatus } from '../model/project'
import type { Project, StepId } from '../model/types'
import { readSetting, writeSetting } from '../lib/storage'

interface Props {
  project: Project
  current: StepId
  onSelect: (step: StepId) => void
}

/** 개발이 끝난 단계까지 (이후 단계는 '준비 중'으로 표시) */
const CURRENT_PHASE = 7

/** 목차를 접어 두었는지 (이 브라우저에 기억) */
const COLLAPSE_KEY = 'site-agent:stepper-collapsed'

const pad2 = (n: number) => String(n).padStart(2, '0')

export default function Stepper({ project, current, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState(() => readSetting(COLLAPSE_KEY) === '1')
  const toggle = () => {
    setCollapsed((c) => {
      writeSetting(COLLAPSE_KEY, c ? '' : '1')
      return !c
    })
  }

  // 휴대폰에서는 목차가 가로 띠라서, 지금 단계가 화면 밖이면 보이도록 옆으로 밀어 줌
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const nav = navRef.current
    const cur = nav?.querySelector<HTMLElement>('.step.current')
    if (!nav || !cur || nav.scrollWidth <= nav.clientWidth) return
    nav.scrollLeft = cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2
  }, [current])

  return (
    <nav ref={navRef} className={`stepper${collapsed ? ' collapsed' : ''}`} aria-label="단계">
      <div className="stepper-head">
        <span className="stepper-title">단계</span>
        <button
          type="button"
          className="btn ghost small icon-only"
          onClick={toggle}
          aria-expanded={!collapsed}
          title={collapsed ? '목차 펼치기' : '목차 접기 (작업 공간 넓히기)'}
          aria-label={collapsed ? '목차 펼치기' : '목차 접기'}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>
      </div>
      <ol>
        {STEPS.map((s, i) => {
          const st = stepStatus(project, s.id)
          const later = s.phase > CURRENT_PHASE
          // 목차 나누기: 앞 단계와 group이 다르면 제목 줄
          const groupHead = s.group && s.group !== STEPS[i - 1]?.group ? s.group : null
          const note = later ? '준비 중' : st.note
          return (
            <li key={s.id} className={groupHead ? 'step-group-start' : undefined}>
              {groupHead && <span className="step-group">{groupHead}</span>}
              <button
                type="button"
                className={`step${current === s.id ? ' current' : ''}${st.done ? ' done' : ''}${later ? ' later' : ''}`}
                aria-current={current === s.id ? 'step' : undefined}
                title={collapsed ? `${s.label}${note ? ` · ${note}` : ''}${st.done ? ' · 완료' : ''}` : undefined}
                onClick={() => onSelect(s.id)}
              >
                <span className="step-num" aria-hidden="true">
                  {pad2(i + 1)}
                </span>
                <span className="step-text">
                  <span className="step-label">{s.label}</span>
                  {note && <span className="step-note">{note}</span>}
                </span>
                {st.done && (
                  <span className="step-done" aria-label="완료">
                    <Check aria-hidden="true" />
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
