// 15-B 콘타 모형 작업대 (⑩ 3D 모형 '콘타 모형' 탭): 축척·판 두께·모형 크기·재료 판·도로 처리 → 판 계산(작업자 스레드)
// → 3D 조립 모습·레이저 판 도면 미리보기 → 라이노 .3dm (mm). 설정은 프로젝트에 저장.

import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { DiagramData } from '../diagrams/data'
import type { ContourPlan } from '../export/contour'
import {
  contourInputOf,
  contourSettingsOf,
  effectiveSize,
  halfOfSize,
  ROAD_MODE_LABEL,
  ROAD_MODE_NOTE,
  runContour,
  SCALE_OPTIONS,
  sizeOptions,
  THICK_OPTIONS,
} from '../export/contourJob'
import { buildModelFor, siteFarOf } from '../export/modelBuild'
import type { SiteModel } from '../export/siteModel'
import { downloadBlob } from '../model/project'
import type { ContourSettings } from '../model/types'
import ContourSheets from './ContourSheets'

const ModelPreview = lazy(() => import('./ModelPreview'))

interface Props {
  data: DiagramData
  baseName: string
  meta: { title: string; address: string; collected: string }
  settings?: ContourSettings
  onSettings?: (s: ContourSettings) => void
  onExported?: () => void
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })
const realLabel = (m: number) => (m >= 1000 ? `${fmt(m / 1000, 2)}km` : `${fmt(m)}m`)

/** 숫자 칸: 입력하는 동안은 그대로 두고, 칸을 벗어나거나 Enter일 때 반영 */
function NumField({ value, min, max, step = 1, onCommit, label, suffix }: { value: number; min: number; max: number; step?: number; onCommit: (v: number) => void; label: string; suffix?: string }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const v = Number(draft)
    if (Number.isFinite(v) && v >= min && v <= max) {
      if (v !== value) onCommit(v)
    } else setDraft(String(value))
  }
  return (
    <label className="num-field small">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {suffix && <span>{suffix}</span>}
    </label>
  )
}

export default function ContourBench({ data, baseName, meta, settings, onSettings, onExported }: Props) {
  const [local, setLocal] = useState<ContourSettings>(() => contourSettingsOf(settings))
  // 저장된 설정이 바뀌면 (다른 탭·되돌리기) 따라감
  useEffect(() => {
    if (settings) setLocal(contourSettingsOf(settings))
  }, [settings])
  const s = local
  const set = (patch: Partial<ContourSettings>) => {
    const next = { ...s, ...patch }
    setLocal(next)
    onSettings?.(next)
  }

  const siteFar = useMemo(() => siteFarOf(data), [data])
  const opts = useMemo(() => sizeOptions(s.scale, siteFar, data.R), [s.scale, siteFar, data.R])
  const size = effectiveSize(s, opts, siteFar, data.R)
  const half = size ? halfOfSize(size, s.scale) : null
  const minSize = Math.ceil(((siteFar + 5) * 2 * 1000) / s.scale)
  const maxSize = Math.floor((data.R * 2 * 1000) / s.scale)

  const [model, setModel] = useState<SiteModel | null>(null)
  const [plan, setPlan] = useState<ContourPlan | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [view, setView] = useState<'3d' | 'sheets'>('3d')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  // 범위가 바뀌면 대지 모형(지형·도로·건물)을 다시
  useEffect(() => {
    if (half === null) return
    let alive = true
    setModel(null)
    setPlan(null)
    setErr(null)
    setProgress('지형·도로·건물 모으는 중')
    void (async () => {
      await new Promise((r) => setTimeout(r, 30))
      try {
        const m = await buildModelFor(data, half)
        if (alive) setModel(m)
      } catch (e) {
        if (alive) {
          setErr(`모형 자료를 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
          setProgress(null)
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [data, half])

  // 판 계산 (작업자 스레드, 설정을 바꾸면 앞 계산은 멈춤)
  useEffect(() => {
    if (!model) return
    setPlan(null)
    setErr(null)
    setProgress('판 계산 준비')
    let job: ReturnType<typeof runContour> | null = null
    const timer = setTimeout(() => {
      job = runContour(contourInputOf(model, s), setProgress)
      job.promise.then(
        (p) => {
          setPlan(p)
          setProgress(null)
        },
        (e: Error) => {
          if (e.message === 'cancelled') return
          setErr(`판을 계산하지 못했습니다: ${e.message}`)
          setProgress(null)
        },
      )
    }, 250)
    return () => {
      clearTimeout(timer)
      job?.cancel()
    }
    // 크기는 model(half)로 들어옴
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, s.scale, s.thickness, s.sheetW, s.sheetH, s.roads])

  const download = async () => {
    if (!plan) return
    setBusy('라이노 모듈 불러오는 중')
    setMsg(null)
    try {
      const { contourTo3dm } = await import('../export/contour3dm')
      const bytes = await contourTo3dm(plan, meta, model?.origin.elev ?? null, (x) => setBusy(x))
      downloadBlob(`${baseName}_콘타_1-${plan.scale}_${plan.thickness}mm.3dm`, new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
      onExported?.()
      setMsg({ kind: 'ok', text: `콘타 모형 라이노 파일을 내려받았습니다 — ${fmt(bytes.length / 1e6, 1)}MB (단위 mm).` })
    } catch (e) {
      setMsg({ kind: 'error', text: `만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  const platePieces = plan?.pieces.filter((p) => p.kind === 'plate') ?? []
  const roadPieces = plan?.pieces.filter((p) => p.kind === 'road') ?? []
  const plateGroup = plan?.groups.find((g) => g.material === 'plate')
  const roadGroup = plan?.groups.find((g) => g.material === 'road')
  const hidden = platePieces.filter((p) => p.label.hidden).length

  return (
    <div className="workbench-body">
      <aside className="workbench-side">
        <section>
          <h3>축척</h3>
          <div className="segmented small" role="radiogroup" aria-label="축척">
            {SCALE_OPTIONS.map((v) => (
              <button key={v} type="button" role="radio" aria-checked={s.scale === v} className={s.scale === v ? 'on' : ''} onClick={() => set({ scale: v })}>
                1:{fmt(v)}
              </button>
            ))}
          </div>
          <NumField label="직접 1:" value={s.scale} min={50} max={10000} onCommit={(v) => set({ scale: Math.round(v) })} />
        </section>

        <section>
          <h3>판 두께 (우드락·폼보드)</h3>
          <div className="segmented small" role="radiogroup" aria-label="판 두께">
            {THICK_OPTIONS.map((v) => (
              <button key={v} type="button" role="radio" aria-checked={s.thickness === v} className={s.thickness === v ? 'on' : ''} onClick={() => set({ thickness: v })}>
                {v}mm
              </button>
            ))}
          </div>
          <NumField label="직접" value={s.thickness} min={0.5} max={20} step={0.5} suffix="mm" onCommit={(v) => set({ thickness: v })} />
          <p className="muted small">
            등고 간격 = 두께 × 축척 = <strong>{fmt((s.thickness * s.scale) / 1000, 2)}m</strong>
          </p>
        </section>

        <section>
          <h3>모형 크기 (가로·세로)</h3>
          {opts.length ? (
            <div className="segmented small wrap" role="radiogroup" aria-label="모형 크기">
              {opts.map((v) => (
                <button key={v} type="button" role="radio" aria-checked={size === v} className={size === v ? 'on' : ''} onClick={() => set({ sizeMm: v })}>
                  {v}mm
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small">이 축척에서 대지가 들어가면서 수집 반경 안인 기본 크기가 없습니다 — 직접 넣거나 축척을 바꾸세요.</p>
          )}
          {minSize <= maxSize && <NumField label="직접" value={size ?? minSize} min={minSize} max={maxSize} suffix={`mm (${fmt(minSize)}~${fmt(maxSize)})`} onCommit={(v) => set({ sizeMm: Math.round(v) })} />}
          {half !== null && (
            <p className="muted small">
              실제 {realLabel(half * 2)} 정사각, 대지 중심이 가운데. {s.sizeMm === 0 ? '재료 판에 들어가는 가장 큰 크기로 골랐습니다.' : ''}
            </p>
          )}
        </section>

        <section>
          <h3>재료 판</h3>
          <div className="num-row">
            <NumField label="가로" value={s.sheetW} min={100} max={3000} suffix="mm" onCommit={(v) => set({ sheetW: Math.round(v) })} />
            <NumField label="세로" value={s.sheetH} min={100} max={3000} suffix="mm" onCommit={(v) => set({ sheetH: Math.round(v) })} />
          </div>
        </section>

        <section>
          <h3>도로</h3>
          <div className="segmented small" role="radiogroup" aria-label="도로 처리">
            {(['engrave', 'pieces', 'cutout'] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={s.roads === v} className={s.roads === v ? 'on' : ''} onClick={() => set({ roads: v })}>
                {ROAD_MODE_LABEL[v]}
              </button>
            ))}
          </div>
          <p className="muted small">{ROAD_MODE_NOTE[s.roads]}. 건물은 자리만 새김.</p>
        </section>

        <section>
          <h3>만들어지는 것</h3>
          {progress && <p className="muted small">{progress}…</p>}
          {err && <p className="notice error">{err}</p>}
          {plan && (
            <table className="workbench-stats">
              <tbody>
                <tr>
                  <td>판</td>
                  <td className="num">{fmt(plan.plates)}</td>
                  <td className="muted small">장 (땅 높이 차 {fmt(plan.hi - plan.lo, 1)}m)</td>
                </tr>
                <tr>
                  <td>판 조각</td>
                  <td className="num">{fmt(platePieces.length)}</td>
                  <td className="muted small">개{plan.removed ? ` (작은 섬·구멍 ${fmt(plan.removed)}곳 정리)` : ''}</td>
                </tr>
                {roadPieces.length > 0 && (
                  <tr>
                    <td>도로 조각</td>
                    <td className="num">{fmt(roadPieces.length)}</td>
                    <td className="muted small">개</td>
                  </tr>
                )}
                <tr>
                  <td>모형</td>
                  <td className="num">{fmt(plan.side)}</td>
                  <td className="muted small">
                    mm 정사각 × 높이 {fmt(plan.height, 1)}mm
                  </td>
                </tr>
                {plateGroup && (
                  <tr>
                    <td>판 재료</td>
                    <td className="num">{fmt(plateGroup.sheets.length)}</td>
                    <td className="muted small">
                      장 ({plan.sheetW}×{plan.sheetH}mm, 쓰는 비율 {Math.round(plateGroup.use * 100)}%)
                    </td>
                  </tr>
                )}
                {roadGroup && (
                  <tr>
                    <td>도로 재료</td>
                    <td className="num">{fmt(roadGroup.sheets.length)}</td>
                    <td className="muted small">장 ({roadGroup.thickness}mm)</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {plan && (
            <p className="muted small">
              판 번호는 아래에서부터 쌓는 순서({platePieces.length ? `${hidden}/${platePieces.length}개는 위 판에 가려지는 자리` : ''}). 계산 {fmt(plan.ms / 1000, 1)}초.
            </p>
          )}
          {plan?.warnings.map((w) => (
            <p key={w} className="notice error">
              {w}
            </p>
          ))}
        </section>

        <section className="workbench-actions">
          <button type="button" className="btn primary" disabled={!plan || !!busy} onClick={() => void download()}>
            {busy ? `만드는 중… ${busy}` : '라이노 .3dm 내려받기 (판 도면 + 조립 안내)'}
          </button>
          {msg && <p className={`notice ${msg.kind === 'error' ? 'error' : 'ok'}`}>{msg.text}</p>}
          <p className="muted small">
            선 색: <span className="laser-swatch outer" /> 외곽 자르기(분홍) · <span className="laser-swatch inner" /> 구멍 자르기(빨강) · <span className="laser-swatch engrave" /> 새김(파랑). 단위 mm, 판마다 레이어.
          </p>
        </section>
      </aside>

      <main className="workbench-view">
        <div className="workbench-view-head">
          <div className="segmented small" role="tablist" aria-label="보기">
            {(
              [
                ['3d', '3D 조립 모습'],
                ['sheets', '레이저 판 도면'],
              ] as const
            ).map(([v, l]) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {l}
              </button>
            ))}
          </div>
          {view === '3d' && <span className="muted small">끌어서 돌리기 · 휠로 확대 · 판 높이는 실제 등고 간격</span>}
        </div>
        {!plan ? (
          <div className="model-preview-empty muted">{err ? '계산하지 못했습니다' : `${progress ?? '준비 중'}…`}</div>
        ) : view === '3d' ? (
          <Suspense fallback={<p className="model-preview-note">3D 미리보기 불러오는 중…</p>}>
            <ModelPreview plan={plan} />
          </Suspense>
        ) : (
          <ContourSheets plan={plan} />
        )}
      </main>
    </div>
  )
}
