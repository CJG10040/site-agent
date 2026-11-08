import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteProject, listProjects, putProject, type ProjectSummary } from '../model/db'
import { createProject } from '../model/project'
import { importProjectFile } from '../model/transfer'

interface Props {
  onOpen: (id: string) => void
}

function when(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function Home({ onOpen }: Props) {
  const [items, setItems] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      setItems(await listProjects())
      setError(null)
    } catch {
      setItems([])
      setError('브라우저 저장소를 열 수 없습니다. 사생활 보호(시크릿) 모드에서는 프로젝트를 저장할 수 없습니다.')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = async () => {
    const p = createProject()
    try {
      await putProject(p)
      onOpen(p.id)
    } catch {
      setError('새 프로젝트를 저장하지 못했습니다.')
    }
  }

  const importFile = async (file: File) => {
    setMessage(null)
    try {
      const r = await importProjectFile(file, (name) =>
        window.confirm(`"${name}"이(가) 이미 있습니다.\n\n[확인] 파일 내용으로 덮어쓰기\n[취소] 사본으로 가져오기`) ? 'overwrite' : 'copy',
      )
      setMessage(`"${r.name}"을(를) 가져왔습니다${r.photoCount ? ` (사진 ${r.photoCount}장)` : ''}.`)
      await refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '가져오지 못했습니다.')
    }
  }

  const remove = async (item: ProjectSummary) => {
    const ok = window.confirm(
      `"${item.name}"을(를) 이 브라우저에서 삭제할까요? (현장 사진 포함)\n삭제하면 되돌릴 수 없습니다. 필요하면 먼저 프로젝트를 열어 파일로 내보내세요.`,
    )
    if (!ok) return
    await deleteProject(item.id)
    await refresh()
  }

  return (
    <div className="home">
      <section className="home-intro">
        <h2>대지를 더 잘 보고, 더 깊이 질문하기</h2>
        <p>
          공공데이터와 현장 관찰을 <strong>사실 · 관찰 · 해석 · 긴장 · 설계 질문 · 설계 가설</strong>로 정리합니다.
          프로젝트는 이 브라우저에 저장되며, 다른 기기로 옮길 때는 파일로 내보내 가져오면 됩니다.
        </p>
        <div className="home-actions">
          <button type="button" className="btn primary" onClick={() => void create()}>
            새 프로젝트
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            프로젝트 파일 가져오기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void importFile(f)
            }}
          />
        </div>
        {message && <p className="notice">{message}</p>}
        {error && <p className="notice error">{error}</p>}
      </section>

      <section className="home-list">
        <h3>내 프로젝트</h3>
        {items === null && <p className="muted">불러오는 중…</p>}
        {items?.length === 0 && !error && <p className="muted">아직 프로젝트가 없습니다. [새 프로젝트]로 시작하세요.</p>}
        <ul>
          {items?.map((it) => (
            <li key={it.id} className="project-row">
              <button type="button" className="project-open" onClick={() => onOpen(it.id)}>
                <span className="project-name">{it.name}</span>
                <span className="project-meta">
                  {it.address || '대지 미지정'} · 확인된 사실 {it.factCount}개 · 관찰 {it.observationCount}개 · 수정 {when(it.updatedAt)}
                </span>
                {!it.lastExportedAt && <span className="badge warn">파일로 내보낸 적 없음</span>}
              </button>
              <button type="button" className="btn ghost danger small" onClick={() => void remove(it)}>
                삭제
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
