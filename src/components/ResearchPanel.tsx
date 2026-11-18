// ⑤ 사실 카드 맨 위 '정성 조사' (2026-11-18 사용자 요청·인터뷰): 챗봇에게 보낼 조사 명령어 만들기 → 답 붙여 넣기 → 출처가 붙은 '확인 전' 사실 카드.

import { useState } from 'react'
import { buildResearchPrompt, importResearch, isResearchCard, ISSUE_YEARS, parseResearch, RESEARCH_SCALES, RESEARCH_THEMES, type ResearchItem } from '../model/research'
import type { Project } from '../model/types'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  /** 카드로 넣은 뒤 (목록을 '확인 전'으로) */
  onImported?: () => void
}

export default function ResearchPanel({ project, update, onImported }: Props) {
  const [prompt, setPrompt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [answer, setAnswer] = useState('')
  const [parsed, setParsed] = useState<{ items: ResearchItem[]; warnings: string[]; noSearch: boolean } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const mine = project.cards.filter(isResearchCard)
  const nOk = mine.filter((c) => c.status === 'confirmed').length
  const nWait = mine.filter((c) => c.status === 'draft').length

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
      setMsg('복사하지 못했습니다 — 아래 글을 직접 선택해 복사하세요.')
    }
  }

  return (
    <section className="block research-panel">
      <h3>정성 조사 (챗봇)</h3>
      <p className="help">
        통계에 없는 것 — 최근 {ISSUE_YEARS}년의 <strong>이슈·갈등·개발 계획</strong>, <strong>역사·장소의 기억</strong>, <strong>지역 문화·생활</strong> — 을 웹 검색이 되는 챗봇에게 조사시킵니다.
        대한민국 → 광역 → 시·군·구 → 동 → 대지 주변 다섯 스케일마다 주요 이슈를 출처와 함께 받습니다. 답을 붙여 넣으면 <strong>확인 전</strong> 카드로 들어오고, 출처를 열어 확인한 것만 해석·가설의 근거와 ⑥ 도판 '스케일별 주요 이슈'에 쓰입니다.
      </p>
      {mine.length > 0 && (
        <p className="small">
          정성 조사 카드 {mine.length}개 — 확인 {nOk}개{nWait ? ` · 확인 전 ${nWait}개` : ''}
        </p>
      )}

      <div className="row wrap">
        <button
          type="button"
          className="btn small"
          onClick={() => {
            const p = buildResearchPrompt(project)
            setPrompt(p)
            setMsg(null)
            void copy(p)
          }}
        >
          조사 명령어 만들기·복사
        </button>
        {prompt && (
          <button type="button" className="btn small ghost" onClick={() => void copy(prompt)}>
            {copied ? '복사했습니다' : '다시 복사'}
          </button>
        )}
      </div>
      {prompt && (
        <details className="research-prompt">
          <summary className="small">
            명령어 보기 ({prompt.length.toLocaleString('ko-KR')}자){copied ? ' — 복사했습니다. 챗봇(웹 검색 켜기)에 붙여 넣으세요' : ''}
          </summary>
          <textarea readOnly rows={10} value={prompt} onFocus={(e) => e.currentTarget.select()} aria-label="정성 조사 명령어" />
        </details>
      )}

      <label className="field">
        <span className="label">챗봇 답 붙여 넣기</span>
        <textarea
          rows={5}
          value={answer}
          placeholder="### [조사] N1 … 형식의 답을 통째로 붙여 넣으세요"
          onChange={(e) => {
            setAnswer(e.target.value)
            setParsed(null)
          }}
        />
      </label>
      <div className="row wrap">
        <button type="button" className="btn small" disabled={!answer.trim()} onClick={() => setParsed(parseResearch(answer))}>
          읽기
        </button>
        {parsed && parsed.items.length > 0 && (
          <button
            type="button"
            className="btn small primary"
            onClick={() => {
              let r = { added: 0, skipped: 0 }
              update((d) => {
                r = importResearch(d, parsed.items)
              })
              setMsg(`${r.added}개를 '확인 전' 카드로 넣었습니다${r.skipped ? ` (이미 있는 ${r.skipped}개는 건너뜀)` : ''}. 아래에서 출처를 열어 보고 '확인' 또는 '제외'하세요.`)
              setAnswer('')
              setParsed(null)
              onImported?.()
            }}
          >
            카드로 넣기 ({parsed.items.length}개)
          </button>
        )}
      </div>

      {parsed && (
        <div className="research-preview">
          {parsed.noSearch && <p className="notice error">챗봇이 '검색 불가'라고 답했습니다 — 출처가 없거나 틀릴 수 있으니 웹 검색을 켜고 다시 받는 것이 좋습니다.</p>}
          {parsed.items.length === 0 ? (
            <p className="notice error">읽은 항목이 없습니다.</p>
          ) : (
            <>
              <p className="small">
                읽은 항목 {parsed.items.length}개 —{' '}
                {RESEARCH_SCALES.map((s) => `${s} ${parsed.items.filter((i) => i.scale === s).length}`).join(' · ')} / {RESEARCH_THEMES.map((t) => `${t} ${parsed.items.filter((i) => i.theme === t).length}`).join(' · ')}
                {parsed.items.filter((i) => !i.url).length ? ` · 주소(URL) 없음 ${parsed.items.filter((i) => !i.url).length}` : ''}
              </p>
              <ul className="research-list small">
                {parsed.items.slice(0, 40).map((i, k) => (
                  <li key={k}>
                    <span className="muted">
                      [{i.scale}
                      {i.place ? ` ${i.place}` : ''} · {i.theme}]
                    </span>{' '}
                    {i.title || i.content.slice(0, 50)}
                    {i.source ? <span className="muted"> — {i.source}</span> : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
          {parsed.warnings.length > 0 && (
            <ul className="small muted">
              {parsed.warnings.map((w, k) => (
                <li key={k}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {msg && <p className="notice ok">{msg}</p>}
    </section>
  )
}
