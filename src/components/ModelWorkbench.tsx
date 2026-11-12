// 15-A 콘타 모형 작업대 (2026-11-12 사용자 결정): ⑩ 3D 모형 화면 안(또는 떠 있는 창). 결과물 두 가지 — 렌더링 모델(실제 크기 .3dm) · 콘타 모형(15-B, ContourBench).
// 범위를 고르면 모형을 만들어 돌려 볼 수 있는 3D로 보여 주고, 물체 수·예상 파일 크기·너무 크면 경고, 그다음 내려받기.
// 이 화면과 3D 미리보기는 열 때만 불러온다.

import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { DiagramData } from '../diagrams/data'
import { buildModelFor, modelStats } from '../export/modelBuild'
import type { SiteModel } from '../export/siteModel'
import { siteModelToDxf } from '../export/toDxf'
import { downloadBlob } from '../model/project'
import type { ContourSettings } from '../model/types'
import ContourBench from './ContourBench'

const ModelPreview = lazy(() => import('./ModelPreview'))

interface Props {
  data: DiagramData
  /** 파일 이름 앞부분 */
  baseName: string
  meta: { title: string; address: string; collected: string }
  /** 범위 후보 (정사각 반쪽, m) */
  halfOptions: number[]
  initialHalf: number
  /** 떠 있는 창이 아니라 ⑩ 3D 모형 화면 안에 (닫기·Esc 없음) */
  asPage?: boolean
  onClose?: () => void
  /** 내려받았을 때 (단계 완료 표시) */
  onExported?: () => void
  /** 콘타 모형 설정 (프로젝트에 저장) */
  contour?: ContourSettings
  onContour?: (s: ContourSettings) => void
}

type Tab = 'render' | 'contour'

const sideLabel = (h: number) => (h * 2 >= 1000 ? `${(h * 2) / 1000}km` : `${h * 2}m`)
const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

export default function ModelWorkbench({ data, baseName, meta, halfOptions, initialHalf, asPage = false, onClose, onExported, contour, onContour }: Props) {
  const [tab, setTab] = useState<Tab>('render')
  const [half, setHalf] = useState(initialHalf)
  const [model, setModel] = useState<SiteModel | null>(null)
  const [building, setBuilding] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const [previewInfo, setPreviewInfo] = useState<{ triangles: number; ms: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  // Esc로 닫기, 열려 있는 동안 뒤 화면이 스크롤되지 않게 (떠 있는 창일 때만)
  useEffect(() => {
    if (asPage) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose?.()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [busy, onClose, asPage])

  // 범위가 바뀌면 모형을 다시 만듦
  useEffect(() => {
    let alive = true
    setBuilding(true)
    setModel(null)
    setPreviewInfo(null)
    void (async () => {
      await new Promise((r) => setTimeout(r, 30))
      try {
        const m = await buildModelFor(data, half)
        if (alive) setModel(m)
      } catch (e) {
        if (alive) setMsg({ kind: 'error', text: `모형을 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}` })
      } finally {
        if (alive) setBuilding(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [data, half])

  const stats = useMemo(() => (model ? modelStats(model) : null), [model])
  const name = `${baseName}_3D_${sideLabel(half)}`

  const download3dm = async () => {
    if (!model) return
    setBusy('라이노 모듈 불러오는 중')
    setMsg(null)
    try {
      const { siteModelTo3dm } = await import('../export/to3dm')
      const t0 = performance.now()
      const bytes = await siteModelTo3dm(model, meta, (s) => setBusy(s))
      downloadBlob(`${name}.3dm`, new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
      onExported?.()
      setMsg({ kind: 'ok', text: `라이노 파일을 내려받았습니다 — ${fmt(bytes.length / 1e6, 1)}MB, 만드는 데 ${fmt((performance.now() - t0) / 1000, 1)}초.` })
    } catch (e) {
      setMsg({ kind: 'error', text: `만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }
  const downloadDxf = () => {
    if (!model) return
    downloadBlob(`${baseName}_평면_${sideLabel(half)}.dxf`, new Blob([siteModelToDxf(model, meta)], { type: 'application/dxf' }))
    onExported?.()
    setMsg({ kind: 'ok', text: 'DXF(평면 밑그림)를 내려받았습니다.' })
  }

  return (
    <div className={`workbench${asPage ? ' as-page' : ''}`} {...(asPage ? { 'aria-label': '모형 작업대' } : { role: 'dialog', 'aria-modal': true, 'aria-label': '모형 작업대' })}>
      <header className="workbench-head">
        <h2>{asPage ? '작업대' : '모형 작업대'}</h2>
        <div className="segmented small" role="tablist" aria-label="결과물">
          {(
            [
              ['render', '렌더링 모델'],
              ['contour', '콘타 모형'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={tab === v} className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>
              {l}
            </button>
          ))}
        </div>
        {!asPage && (
          <button type="button" className="btn small" onClick={onClose} disabled={!!busy}>
            닫기 (Esc)
          </button>
        )}
      </header>

      {tab === 'render' ? (
        <div className="workbench-body">
          <aside className="workbench-side">
            <section>
              <h3>범위 (가로·세로)</h3>
              <div className="segmented small" role="radiogroup" aria-label="범위">
                {halfOptions.map((h) => (
                  <button key={h} type="button" role="radio" aria-checked={half === h} className={half === h ? 'on' : ''} disabled={!!busy} onClick={() => setHalf(h)}>
                    {sideLabel(h)}
                  </button>
                ))}
              </div>
              <p className="muted small">대지 중심 = 원점, 실제 크기(m), 높이 0 = 대지 중심 지면.</p>
            </section>

            <section>
              <h3>들어가는 것</h3>
              {building && <p className="muted small">모형 만드는 중…</p>}
              {stats && (
                <table className="workbench-stats">
                  <tbody>
                    {stats.rows.map((r) => (
                      <tr key={r.label}>
                        <td>{r.label}</td>
                        <td className="num">{fmt(r.n)}</td>
                        <td className="muted small">{r.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {stats && (
                <p className="small">
                  라이노 물체 약 <strong>{fmt(stats.objects)}</strong>개 · 예상 파일 약 <strong>{fmt(stats.mb, stats.mb < 10 ? 1 : 0)}MB</strong>
                  {previewInfo && (
                    <span className="muted">
                      {' '}
                      · 미리보기 삼각형 {fmt(previewInfo.triangles)}개 ({fmt(previewInfo.ms / 1000, 1)}초)
                    </span>
                  )}
                </p>
              )}
              {stats?.warn && <p className="notice error">{stats.warn}</p>}
              <p className="muted small">
                디테일(가로수·정류장·차선 등)은 ④에서 1:1,000 수치지도·정밀도로지도를 올렸을 때 들어갑니다. 가벼움·보통·자세히 단계와 항목 끄기는 다음 단계(15-C)에서 붙입니다.
              </p>
            </section>

            <section className="workbench-actions">
              <button type="button" className="btn primary" disabled={!model || !!busy} onClick={() => void download3dm()}>
                {busy ? `만드는 중… ${busy}` : '라이노 .3dm 내려받기'}
              </button>
              <button type="button" className="btn small" disabled={!model || !!busy} onClick={downloadDxf}>
                DXF (평면 밑그림)
              </button>
              {msg && <p className={`notice ${msg.kind === 'error' ? 'error' : 'ok'}`}>{msg.text}</p>}
            </section>
          </aside>

          <main className="workbench-view">
            <div className="workbench-view-head">
              <label className="check-row small">
                <input type="checkbox" checked={showPreview} onChange={(e) => setShowPreview(e.target.checked)} />
                3D 미리보기
              </label>
              <span className="muted small">끌어서 돌리기 · 휠로 확대 · 오른쪽 끌기로 옮기기</span>
            </div>
            {showPreview && model ? (
              <Suspense fallback={<p className="model-preview-note">3D 미리보기 불러오는 중…</p>}>
                <ModelPreview model={model} onReady={setPreviewInfo} />
              </Suspense>
            ) : (
              <div className="model-preview-empty muted">{building ? '모형 만드는 중…' : '미리보기를 끈 상태'}</div>
            )}
          </main>
        </div>
      ) : (
        <ContourBench data={data} baseName={baseName} meta={meta} settings={contour} onSettings={onContour} onExported={onExported} />
      )}
    </div>
  )
}
