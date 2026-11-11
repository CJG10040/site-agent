// '버전 저장' 버튼: 누르면 이름 칸이 열리고, 저장하면 지금 해석을 버전으로 남긴다 (조사 버전, Phase 12).

import { useState } from 'react'
import { saveVersion } from '../model/db'
import type { Project } from '../model/types'

interface Props {
  project: Project
  /** 저장한 뒤 (목록 새로고침 등) */
  onSaved?: () => void
  className?: string
}

export default function VersionSave({ project, onSaved, className = 'btn ghost' }: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const v = await saveVersion(project, name.trim() || `${new Date().toLocaleDateString('ko-KR')} 버전`, 'manual')
      setMsg(v ? `'${v.name}' 저장됨` : '저장하지 못했습니다')
      setOpen(false)
      setName('')
      onSaved?.()
    } catch (e) {
      setMsg(`저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
      window.setTimeout(() => setMsg(null), 3000)
    }
  }

  return (
    <span className="version-save">
      {open ? (
        <form
          className="version-save-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <input autoFocus type="text" value={name} placeholder="버전 이름 (예: 중간 크리틱 전)" onChange={(e) => setName(e.target.value)} aria-label="버전 이름" />
          <button type="submit" className="btn small primary" disabled={busy}>
            저장
          </button>
          <button type="button" className="btn small ghost" onClick={() => setOpen(false)}>
            취소
          </button>
        </form>
      ) : (
        <button type="button" className={className} onClick={() => setOpen(true)} title="지금의 카드·도판 결론·종합 다이어그램을 버전으로 남겨 나중에 비교">
          버전 저장
        </button>
      )}
      {msg && <span className="version-save-msg">{msg}</span>}
    </span>
  )
}
