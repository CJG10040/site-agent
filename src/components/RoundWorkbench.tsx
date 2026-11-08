import { useMemo, useState } from 'react'
import { buildContactSheets, type SheetItem } from '../lib/contactSheet'
import { importItems, parseAnswer, type ParseResult } from '../model/answerParser'
import { observationsOf } from '../model/observations'
import { downloadBlob } from '../model/project'
import { buildPrompt, roundReadiness, ROUNDS, splitPrompt, TYPE_LABEL } from '../model/prompts'
import type { Project, RoundId } from '../model/types'

interface Props {
  project: Project
  round: RoundId
  update: (fn: (draft: Project) => void) => void
  onImported: () => void
}

const SPLIT_OPTIONS = [
  { value: 0, label: '나누지 않음' },
  { value: 12000, label: '1만 2천 자씩' },
  { value: 6000, label: '6천 자씩' },
]

const TAG_LABEL: Record<string, string> = { ...TYPE_LABEL, RELATION: '관계', SUMMARY: '요약문' }

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export default function RoundWorkbench({ project, round, update, onImported }: Props) {
  const def = ROUNDS.find((r) => r.id === round)!
  const ready = roundReadiness(project, round)
  const [prompt, setPrompt] = useState<string | null>(null)
  const [splitAt, setSplitAt] = useState(0)
  const [copied, setCopied] = useState<number | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)
  const [answer, setAnswer] = useState('')
  const [chatbot, setChatbot] = useState('')
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [replace, setReplace] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [sheetBusy, setSheetBusy] = useState(false)

  const parts = useMemo(() => (prompt ? (splitAt ? splitPrompt(prompt, splitAt) : [prompt]) : []), [prompt, splitAt])
  const previous = project.cards.filter((c) => c.round === round && c.origin === 'chatbot')
  const photoItems: SheetItem[] = useMemo(
    () =>
      observationsOf(project).flatMap((o) =>
        o.observation!.photoIds.map((pid, i) => ({ photoId: pid, label: `${o.id}${o.observation!.photoIds.length > 1 ? ` (${i + 1})` : ''}` })),
      ),
    [project],
  )

  const make = () => {
    setPrompt(buildPrompt(project, round))
    setCopied(null)
    setMsg(null)
  }

  const copyPart = async (i: number) => {
    const ok = await copyText(parts[i])
    setCopyFailed(!ok)
    if (ok) setCopied(i)
  }

  const downloadSheets = async () => {
    setSheetBusy(true)
    try {
      const sheets = await buildContactSheets(photoItems)
      sheets.forEach((b, i) => downloadBlob(`관찰사진_${i + 1}.jpg`, b))
      setMsg(`관찰 사진 묶음 ${sheets.length}개를 내려받았습니다. 프롬프트와 함께 챗봇에 첨부하세요.`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setSheetBusy(false)
    }
  }

  const read = () => {
    const r = parseAnswer(answer, project)
    setParsed(r)
    setPicked(new Set(r.items.map((i) => i.key)))
    setMsg(null)
  }

  const doImport = () => {
    if (!parsed) return
    const items = parsed.items.filter((i) => picked.has(i.key))
    let result: ReturnType<typeof importItems> | null = null
    update((d) => {
      result = importItems(d, round, items, { prompt: prompt ?? '', answer, chatbot: chatbot.trim(), replacePrevious: replace && previous.length > 0 })
    })
    const r = result as ReturnType<typeof importItems> | null
    setParsed(null)
    setAnswer('')
    setMsg(r ? `카드 ${r.created.length}개를 가져왔습니다${r.removed ? ` (이전 카드 ${r.removed}개는 바꿈)` : ''}${r.summary ? ' · 패널 요약문 저장' : ''}.` : null)
    onImported()
  }

  return (
    <div className="workbench">
      <header>
        <h3>
          {def.short} {def.title}
        </h3>
        <p className="muted small">만들어질 카드: {def.produces}</p>
      </header>

      {ready.warnings.length > 0 && (
        <div className={`notice ${ready.ok ? '' : 'error'}`}>
          {ready.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      <section className="wb-step">
        <h4>1. 프롬프트 만들기</h4>
        <div className="row">
          <button type="button" className="btn primary" onClick={make} disabled={!ready.ok}>
            {prompt ? '다시 만들기' : '프롬프트 만들기'}
          </button>
          <label className="row small">
            길면 나누기
            <select value={splitAt} onChange={(e) => setSplitAt(Number(e.target.value))}>
              {SPLIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {prompt && (
          <>
            <p className="help">
              {prompt.length.toLocaleString('ko-KR')}자 · {parts.length}개로 복사. 챗봇 창에 붙여넣고 보내세요. 무료 챗봇에서 너무 길다고 하면 '6천 자씩'으로
              나누세요.
            </p>
            <div className="row">
              {parts.map((_, i) => (
                <button key={i} type="button" className={`btn small${copied === i ? ' primary' : ''}`} onClick={() => void copyPart(i)}>
                  {parts.length > 1 ? `${i + 1}/${parts.length} 복사` : '복사'}
                  {copied === i ? ' ✓' : ''}
                </button>
              ))}
            </div>
            {copyFailed && <p className="notice error">자동 복사가 막혔습니다. 아래 상자를 눌러 전체 선택(Ctrl+A) 후 복사하세요.</p>}
            <textarea className="prompt-box mono" readOnly rows={8} value={parts[copied ?? 0] ?? prompt} onFocus={(e) => e.currentTarget.select()} aria-label="프롬프트" />
            {photoItems.length > 0 && round !== 'R5' && (
              <p className="help">
                관찰 사진 {photoItems.length}장은 프롬프트에 글로 들어갈 수 없습니다.{' '}
                <button type="button" className="link-btn" onClick={() => void downloadSheets()} disabled={sheetBusy}>
                  {sheetBusy ? '만드는 중…' : '관찰 번호가 적힌 사진 묶음 내려받기'}
                </button>
                를 눌러 챗봇에 함께 첨부하세요.
              </p>
            )}
          </>
        )}
      </section>

      <section className="wb-step">
        <h4>2. 챗봇 답변 붙여넣기</h4>
        <textarea rows={8} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="챗봇의 답변 전체를 복사해 붙여넣으세요." aria-label="챗봇 답변" />
        <div className="row">
          <input type="text" value={chatbot} onChange={(e) => setChatbot(e.target.value)} placeholder="사용한 챗봇 (선택, 예: ChatGPT)" aria-label="사용한 챗봇" />
          <button type="button" className="btn primary" onClick={read} disabled={!answer.trim()}>
            답변 읽기
          </button>
        </div>
      </section>

      {parsed && (
        <section className="wb-step">
          <h4>3. 가져올 카드 고르기</h4>
          {parsed.warnings.map((w) => (
            <p key={w} className="notice error">
              {w}
            </p>
          ))}
          <ul className="parsed-list">
            {parsed.items.map((it) => (
              <li key={it.key} className={picked.has(it.key) ? 'on' : ''}>
                <label>
                  <input
                    type="checkbox"
                    checked={picked.has(it.key)}
                    onChange={() =>
                      setPicked((s) => {
                        const n = new Set(s)
                        if (n.has(it.key)) n.delete(it.key)
                        else n.add(it.key)
                        return n
                      })
                    }
                  />
                  <span className="parsed-body">
                    <span className="parsed-head">
                      <span className="type-badge">{TAG_LABEL[it.tag]}</span>
                      {it.label && <span className="card-id">{it.label}</span>}
                      {it.fields['관점'] && <span className="muted small">{it.fields['관점']}</span>}
                      {it.fields['제목'] && it.tag !== 'HYPOTHESIS' && <strong>{it.fields['제목']}</strong>}
                    </span>
                    <span>{it.text || <em className="muted">(내용 없음)</em>}</span>
                    {it.refs.length > 0 && (
                      <span className="small muted">
                        근거:{' '}
                        {it.refs.map((r) => (
                          <span key={r} className={it.invalidRefs.includes(r) ? 'bad-ref' : ''}>
                            {r}{' '}
                          </span>
                        ))}
                      </span>
                    )}
                    {it.invalidRefs.length > 0 && <span className="small bad-ref">없는 번호 {it.invalidRefs.join(', ')} — 가져오면 '확인 필요'로 표시됩니다</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {parsed.leftover && (
            <details className="leftover">
              <summary>형식 밖의 답변 ({parsed.leftover.length}자) — 카드로 만들지 않음</summary>
              <pre>{parsed.leftover}</pre>
            </details>
          )}
          {previous.length > 0 && (
            <label className="check-row">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              이 단계에서 이전에 가져온 카드 중 반응·수정·메모가 없는 것은 지우고 바꾸기
            </label>
          )}
          <div className="row">
            <button type="button" className="btn primary" onClick={doImport} disabled={picked.size === 0}>
              카드 {picked.size}개 가져오기
            </button>
            <button type="button" className="btn ghost" onClick={() => setParsed(null)}>
              취소
            </button>
          </div>
        </section>
      )}

      {msg && <p className="notice ok">{msg}</p>}
    </div>
  )
}
