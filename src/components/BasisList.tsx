// ⑥ 도판 카드 아래 '근거 자료' (2026-11-21 사용자 결정): 이 도판을 만든 점 자료를 이름·분류·주소·거리·지도 링크로 보여 주고,
// 틀린 것은 그 자리에서 '빼기'(이유 적기) → 자료 빼기 기록으로 모든 도판에서 빠짐. 도판 그림·내보내는 파일·리포트에는 넣지 않는다.

import { useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { mapLinkOf } from '../diagrams/basis'
import type { BasisGroup, BasisItem } from '../diagrams/compose'

const FIRST = 10
const STEP = 40

const distText = (m: number) => (m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`)
// 같은 가게가 업종마다 따로 올라 있기도 해서 분류까지 넣음
const keyOf = (x: BasisItem) => `${x.layer}:${x.lon.toFixed(6)},${x.lat.toFixed(6)}:${x.name}:${x.kind}`

interface Props {
  basis: BasisGroup[]
  onHide: (item: BasisItem, reason: string) => void
}

export default function BasisList({ basis, onHide }: Props) {
  const [query, setQuery] = useState('')
  // 뺀 줄: 도판을 다시 그려 목록에서 사라질 때까지 '뺐음'으로
  const [pending, setPending] = useState<Set<string>>(() => new Set())
  const hide = (x: BasisItem, reason: string) => {
    setPending((cur) => new Set(cur).add(keyOf(x)))
    onHide(x, reason)
  }
  const total = basis.reduce((n, g) => n + g.items.length, 0)
  const q = query.trim().toLowerCase()
  const groups = useMemo(
    () => (q ? basis.map((g) => ({ ...g, items: g.items.filter((x) => `${x.name} ${x.kind} ${x.addr ?? ''} ${x.note ?? ''}`.toLowerCase().includes(q)) })).filter((g) => g.items.length) : basis),
    [basis, q],
  )
  if (!total) return null
  const noAddr = basis.every((g) => g.items.every((x) => !x.addr)) && basis.some((g) => g.items.some((x) => x.layer !== 'stop'))
  return (
    <details className="basis">
      <summary>
        근거 자료 <span className="count">{total.toLocaleString('ko-KR')}</span>
        <span className="muted small"> 이 도판을 만든 시설 · 틀린 것은 빼기</span>
      </summary>
      <p className="muted small basis-help">도판에 쓴 자료입니다. 이름을 누르면 카카오맵에서 열립니다. 이 목록은 도판 그림·내려받는 파일·리포트에는 들어가지 않습니다.</p>
      {noAddr && <p className="small basis-help">주소와 장소 링크는 2026-11-21 뒤에 수집한 자료에만 있습니다. ④ 공간정보에서 다시 수집하면 생깁니다. 지금은 이름과 좌표로 지도를 엽니다.</p>}
      {total > 30 && <input className="basis-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름·분류·주소로 찾기" aria-label="근거 자료 찾기" />}
      {groups.map((g) => (
        <BasisGroupView key={g.title} group={g} pending={pending} onHide={hide} />
      ))}
      {q && !groups.length && <p className="muted small">찾는 자료가 없습니다.</p>}
    </details>
  )
}

function BasisGroupView({ group, pending, onHide }: { group: BasisGroup; pending: Set<string>; onHide: Props['onHide'] }) {
  const [shown, setShown] = useState(FIRST)
  const [asking, setAsking] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const rest = group.items.length - shown
  // 묶음 이름과 같은 분류는 줄마다 되풀이하지 않음 (예: '주차장' 묶음의 '주차장')
  const kindOf = (x: BasisItem) => (x.kind && !group.title.startsWith(x.kind) ? x.kind : '')
  return (
    <div className="basis-group">
      <h5>
        {group.title} <span className="count">{group.items.length.toLocaleString('ko-KR')}</span>
      </h5>
      <ul>
        {group.items.slice(0, shown).map((x, i) => {
          const k = keyOf(x)
          const gone = pending.has(k)
          return (
            <li key={`${k}#${i}`} className={`basis-row${gone ? ' gone' : ''}`}>
              <div className="basis-text">
                <a href={mapLinkOf(x)} target="_blank" rel="noopener noreferrer">
                  {x.name || '이름 없음'}
                  <ExternalLink className="icon" aria-hidden="true" />
                </a>
                {kindOf(x) && <span className="muted small"> {kindOf(x)}</span>}
                <div className="muted small">{[x.addr, `대지 중심에서 ${distText(x.distM)}`, x.note].filter(Boolean).join(' · ')}</div>
                {asking === k && (
                  <div className="basis-ask">
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="이유 (예: 폐업, 현장에 없음)" aria-label="빼는 이유" autoFocus />
                    <button
                      type="button"
                      className="btn small danger"
                      onClick={() => {
                        onHide(x, reason)
                        setAsking(null)
                        setReason('')
                      }}
                    >
                      빼기
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => setAsking(null)}>
                      취소
                    </button>
                  </div>
                )}
              </div>
              {gone && <span className="muted small basis-gone">뺐음 · 도판 다시 그리는 중</span>}
              {asking !== k && !gone && (
                <button
                  type="button"
                  className="btn small ghost danger"
                  onClick={() => {
                    setAsking(k)
                    setReason('')
                  }}
                  aria-label={`${x.name || '이름 없음'} 빼기`}
                >
                  빼기
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {rest > 0 && (
        <button type="button" className="link-btn small" onClick={() => setShown((n) => n + STEP)}>
          {Math.min(STEP, rest)}곳 더 보기 (남은 {rest.toLocaleString('ko-KR')}곳)
        </button>
      )}
    </div>
  )
}
