import { useState } from 'react'
import {
  errorHint,
  search,
  SEARCH_KIND_LABEL,
  VWorldError,
  type SearchHit,
  type SearchKind,
  type VWorldConfig,
} from '../sources/vworld'

interface Props {
  config: VWorldConfig
  onPick: (hit: SearchHit) => void
  hint?: string
}

const KINDS: SearchKind[] = ['road', 'parcel', 'place']

interface Group {
  kind: SearchKind
  hits: SearchHit[]
}

export default function SearchPanel({ config, onPick, hint }: Props) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [error, setError] = useState<{ message: string; hint: string } | null>(null)

  const run = async () => {
    const q = query.trim()
    if (!q) return
    setBusy(true)
    setError(null)
    const settled = await Promise.allSettled(KINDS.map((k) => search(config, q, k)))
    const next: Group[] = []
    let firstError: unknown = null
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') next.push({ kind: KINDS[i], hits: s.value })
      else if (!firstError) firstError = s.reason
    })
    // 세 가지 검색이 모두 실패했을 때만 오류로 보여 준다.
    if (next.length === 0 && firstError) {
      const code = firstError instanceof VWorldError ? firstError.code : ''
      const message = firstError instanceof Error ? firstError.message : String(firstError)
      setError({ message: code ? `${code} — ${message}` : message, hint: errorHint(code) })
      setGroups(null)
    } else {
      setGroups(next)
    }
    setBusy(false)
  }

  const total = groups?.reduce((n, g) => n + g.hits.length, 0) ?? 0

  return (
    <div className="search-block">
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="주소 또는 장소 (예: 광주 동구 충장로)"
          aria-label="주소 또는 장소 검색"
        />
        <button type="submit" className="btn primary" disabled={busy || !query.trim()}>
          {busy ? '검색 중…' : '검색'}
        </button>
      </form>

      {hint && <p className="help">{hint}</p>}

      {error && (
        <div className="notice error">
          <strong>검색하지 못했습니다.</strong>
          <p>{error.message}</p>
          {error.hint && <p className="hint">{error.hint}</p>}
        </div>
      )}

      {groups && total === 0 && <p className="empty">검색 결과가 없습니다. 표현을 바꿔 보세요.</p>}

      {groups && total > 0 && (
        <div className="search-results">
          {groups.map(
            (g) =>
              g.hits.length > 0 && (
                <section key={g.kind} className="result-group">
                  <h3>
                    {SEARCH_KIND_LABEL[g.kind]} <span className="count">{g.hits.length}</span>
                  </h3>
                  <ul>
                    {g.hits.map((h) => (
                      <li key={h.id}>
                        <button
                          type="button"
                          className="result"
                          onClick={() => {
                            onPick(h)
                            setGroups(null)
                          }}
                        >
                          <span className="result-title">{h.title}</span>
                          {h.subtitle && <span className="result-sub">{h.subtitle}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ),
          )}
        </div>
      )}
    </div>
  )
}
