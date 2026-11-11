// ⑨ 리포트 › 보드: '리포트에 넣기' 도판을 용지 한 장(넘치면 여러 장)에 조판한다.

import { useEffect, useMemo, useState } from 'react'
import { boardOrder, boardPngWidth, boardSettingsOf, buildBoard, paperSize, PAPER_MM } from '../diagrams/board'
import type { DiagramData } from '../diagrams/data'
import { svgBlob, svgToPng, zipBlob } from '../diagrams/export'
import { siteOverview } from '../diagrams/overview'
import { panelNumber, type PanelDef } from '../diagrams/panels'
import { DEFAULT_SETTINGS } from '../diagrams/render'
import type { CachedPanel } from '../diagrams/useDiagrams'
import type { TerrainAnalysis } from '../lib/terrainSite'
import { downloadBlob } from '../model/project'
import type { BoardPaper, BoardSettings, Project } from '../model/types'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  /** 넣을 도판 (기본 순서) */
  defs: PanelDef[]
  panels: Record<string, CachedPanel>
  busy: boolean
  data: DiagramData | null
  terrain: TerrainAnalysis | null
}

const PAPERS = Object.keys(PAPER_MM) as BoardPaper[]

export default function BoardView({ project, update, defs, panels, busy, data, terrain }: Props) {
  const s = boardSettingsOf(project.diagrams?.board)
  const [working, setWorking] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const setBoard = (patch: Partial<BoardSettings>) =>
    update((d) => {
      const cur = d.diagrams ?? { settings: { ...DEFAULT_SETTINGS }, panels: {} }
      cur.board = { ...boardSettingsOf(cur.board), ...patch }
      d.diagrams = cur
    })

  const defById = new Map(defs.map((d) => [d.id, d]))
  const order = boardOrder(s.order, defs.map((d) => d.id))
  const title = s.title.trim() || project.brief.projectName || '대지해석'
  const addr = project.site.address?.road || project.site.address?.parcel || project.site.parcels[0]?.addr || ''

  const overview = useMemo(() => (data ? siteOverview(project, data, terrain).site.map((o) => ({ label: o.label, value: o.value })) : []), [data, project, terrain])
  const conclusionOf = (id: string) => project.diagrams?.panels[id]?.conclusion ?? ''
  const sig = JSON.stringify([s, title, addr, overview, order.map((id) => [id, panels[id]?.key, conclusionOf(id)])])

  const pages = useMemo(() => {
    const head = {
      title,
      subtitle: [addr, data ? `조사 반경 ${data.R.toLocaleString('ko-KR')}m` : '', project.collectedAt ? `${project.collectedAt.slice(0, 10)} 수집` : ''].filter(Boolean).join(' · '),
      overview,
      footer: `대지해석 에이전트 · 도판마다 아래에 출처·한계 표기 · ${new Date().toLocaleDateString('ko-KR')} 작성`,
    }
    return buildBoard(
      order.filter((id) => panels[id]).map((id) => ({ id, svg: panels[id].svg, conclusion: conclusionOf(id) })),
      s,
      head,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    const u = pages.map((p) => URL.createObjectURL(svgBlob(p)))
    setUrls(u)
    return () => u.forEach((x) => URL.revokeObjectURL(x))
  }, [pages])

  const move = (id: string, dir: -1 | 1) => {
    const i = order.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    setBoard({ order: next })
  }

  const baseName = `${(project.brief.projectName || '대지').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30)}_보드_${s.paper}${s.landscape ? '가로' : '세로'}`
  const download = async (kind: 'png' | 'svg') => {
    setWorking(kind)
    setMsg(null)
    try {
      const files: { name: string; data: Blob | string }[] = []
      for (let i = 0; i < pages.length; i++) {
        const name = `${baseName}${pages.length > 1 ? `_${i + 1}` : ''}.${kind}`
        files.push({ name, data: kind === 'svg' ? svgBlob(pages[i]) : await svgToPng(pages[i], boardPngWidth(s), '#ffffff') })
      }
      if (files.length === 1) downloadBlob(files[0].name, files[0].data as Blob)
      else downloadBlob(`${baseName}_${kind.toUpperCase()}.zip`, await zipBlob(files))
      setMsg({ kind: 'ok', text: kind === 'png' ? `PNG ${pages.length}장 (가로 ${boardPngWidth(s).toLocaleString('ko-KR')}px, 300dpi)을 내려받았습니다.` : `SVG ${pages.length}장을 내려받았습니다.` })
    } catch (e) {
      setMsg({ kind: 'error', text: `만들지 못했습니다: ${e instanceof Error ? e.message : String(e)} (용지가 크면 PNG가 실패할 수 있습니다 — A2 이하나 SVG를 써 보세요)` })
    } finally {
      setWorking(null)
    }
  }

  const { w, h } = paperSize(s)

  return (
    <div className="board-view">
      <div className="report-toolbar no-print board-toolbar">
        <div className="row">
          <span className="label">용지</span>
          <div className="segmented small">
            {PAPERS.map((p) => (
              <button key={p} type="button" className={s.paper === p ? 'on' : ''} onClick={() => setBoard({ paper: p })}>
                {p}
              </button>
            ))}
          </div>
          <div className="segmented small">
            <button type="button" className={s.landscape ? 'on' : ''} onClick={() => setBoard({ landscape: true })}>
              가로
            </button>
            <button type="button" className={!s.landscape ? 'on' : ''} onClick={() => setBoard({ landscape: false })}>
              세로
            </button>
          </div>
          <span className="label">열</span>
          <div className="segmented small">
            {[2, 3, 4, 5, 6].map((c) => (
              <button key={c} type="button" className={s.cols === c ? 'on' : ''} onClick={() => setBoard({ cols: c })}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <label className="board-title-field">
            <span className="label">제목</span>
            <input type="text" value={s.title} placeholder={project.brief.projectName || '대지해석'} onChange={(e) => setBoard({ title: e.target.value })} />
          </label>
          <label className="check-row small">
            <input type="checkbox" checked={s.overview} onChange={(e) => setBoard({ overview: e.target.checked })} />
            대지 개요
          </label>
          <label className="check-row small">
            <input type="checkbox" checked={s.conclusions} onChange={(e) => setBoard({ conclusions: e.target.checked })} />
            도판별 결론
          </label>
        </div>
        <div className="row">
          <button type="button" className="btn primary" onClick={() => window.print()} disabled={busy || !defs.length}>
            인쇄 / PDF로 저장
          </button>
          <button type="button" className="btn" onClick={() => void download('png')} disabled={busy || !!working || !defs.length}>
            {working === 'png' ? '만드는 중…' : 'PNG (300dpi)'}
          </button>
          <button type="button" className="btn" onClick={() => void download('svg')} disabled={busy || !!working || !defs.length}>
            {working === 'svg' ? '만드는 중…' : 'SVG'}
          </button>
          <span className="muted small">
            {s.paper} {s.landscape ? '가로' : '세로'} ({w}×{h}mm) · 도판 {order.length}장 · {pages.length}쪽
          </span>
        </div>
        <p className="help">
          인쇄 창에서 대상을 <strong>'PDF로 저장'</strong>, 여백 <strong>'없음'</strong>, <strong>'배경 그래픽'</strong>을 켜세요. 도판은 ⑥ 도판 단계에서 '리포트에
          넣기'로 고르고, 결론 문장도 거기서 씁니다. 한 쪽에 다 들어가지 않으면 다음 쪽으로 넘어갑니다.
        </p>
        {msg && <p className={`notice ${msg.kind === 'error' ? 'error' : 'ok'}`}>{msg.text}</p>}
        <details className="board-order-box">
          <summary>도판 순서 바꾸기 ({order.length})</summary>
          <ol className="board-order">
            {order.map((id, i) => {
              const def = defById.get(id)
              if (!def) return null
              return (
                <li key={id}>
                  <span className="num">{String(panelNumber(id)).padStart(2, '0')}</span>
                  <span className="t" title={def.title}>
                    {def.title}
                  </span>
                  <button type="button" className="btn small ghost" disabled={i === 0} onClick={() => move(id, -1)} aria-label={`${def.title} 앞으로`}>
                    ↑
                  </button>
                  <button type="button" className="btn small ghost" disabled={i === order.length - 1} onClick={() => move(id, 1)} aria-label={`${def.title} 뒤로`}>
                    ↓
                  </button>
                </li>
              )
            })}
          </ol>
          {s.order.length > 0 && (
            <button type="button" className="link-btn small" onClick={() => setBoard({ order: [] })}>
              기본 순서로
            </button>
          )}
        </details>
      </div>

      {busy && <p className="muted no-print">도판을 그리는 중…</p>}
      {!busy && !defs.length && <p className="muted">넣을 도판이 없습니다 (⑥ 도판 단계에서 '리포트에 넣기'를 고르세요).</p>}
      <div className="board-pages" style={{ ['--board-w' as string]: `${w}mm`, ['--board-h' as string]: `${h}mm`, ['--board-ratio' as string]: String(w / h) }}>
        {urls.map((u, i) => (
          <img key={u} className="board-page" src={u} alt={`보드 ${i + 1}쪽`} />
        ))}
      </div>
    </div>
  )
}
