// 15-A 콘타 모형 작업대 (2026-11-12 사용자 결정): ⑩ 3D 모형 화면 안(또는 떠 있는 창). 결과물 두 가지 — 렌더링 모델(실제 크기 .3dm) · 콘타 모형(15-B, ContourBench).
// 범위를 고르면 모형을 만들어 돌려 볼 수 있는 3D로 보여 주고, 물체 수·예상 파일 크기·너무 크면 경고, 그다음 내려받기.
// 이 화면과 3D 미리보기는 열 때만 불러온다.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { DiagramData } from '../diagrams/data'
import type { AerialTex } from '../export/aerialTexture'
import { buildModelFor, modelStats } from '../export/modelBuild'
import { filterModel, itemCounts, itemsOfLevel, LEVELS, MODEL_ITEMS } from '../export/modelItems'
import { LAYER_MAT, MATERIAL_STYLES, materialSet, RENDER_HELP, texturesOf, type MaterialStyle, type MatId } from '../export/renderMaterials'
import type { SiteModel } from '../export/siteModel'
import { siteModelToDxf } from '../export/toDxf'
import { downloadBlob } from '../model/project'
import type { ContourSettings, RenderLevel, RenderModelSettings } from '../model/types'
import ContourBench from './ContourBench'
import ModelDimsPanel from './ModelDimsPanel'

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
  /** 렌더링 모델 단계·항목 (프로젝트에 저장) */
  render?: RenderModelSettings
  onRender?: (s: RenderModelSettings) => void
  /** 브이월드 키 (지형에 항공사진 입히기) */
  vworldKey?: string
  /** 어림 치수 (기본값과 다른 것만, 프로젝트에 저장) */
  modelDims?: Partial<Record<string, number>>
  onModelDims?: (d: Partial<Record<string, number>>) => void
}

type Tab = 'render' | 'contour'

const sideLabel = (h: number) => (h * 2 >= 1000 ? `${(h * 2) / 1000}km` : `${h * 2}m`)
const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

export default function ModelWorkbench({ data, baseName, meta, halfOptions, initialHalf, asPage = false, onClose, onExported, contour, onContour, render, onRender, vworldKey = '', modelDims, onModelDims }: Props) {
  const [tab, setTab] = useState<Tab>('render')
  const [half, setHalf] = useState(initialHalf)
  const [model, setModel] = useState<SiteModel | null>(null)
  const [building, setBuilding] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const [previewInfo, setPreviewInfo] = useState<{ triangles: number; ms: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // 진행도 (2026-11-16 사용자 요청: 내려받기 중 멈춘 건지 진행 중인지 모르겠음): 0~1, 모르면 null
  const [frac, setFrac] = useState<number | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [, setNow] = useState(0)
  useEffect(() => {
    if (!busy) return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [busy])
  const begin = (label: string) => {
    setBusy(label)
    setFrac(0)
    setStartedAt(Date.now())
  }
  const finish = () => {
    setBusy(null)
    setFrac(null)
    setStartedAt(null)
  }
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

  // 범위·어림 치수(하천 깊이 포함)가 바뀌면 모형을 다시 만듦
  const dimsKey = JSON.stringify(modelDims ?? {})
  useEffect(() => {
    let alive = true
    setBuilding(true)
    setModel(null)
    setPreviewInfo(null)
    void (async () => {
      await new Promise((r) => setTimeout(r, 30))
      try {
        const m = await buildModelFor(data, half, { dims: modelDims })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, half, dimsKey])

  // 15-C 단계·항목: 끈 항목을 비운 모형으로 물체 수·미리보기·내려받기
  const [rs, setRs] = useState<RenderModelSettings>(() => render ?? { level: 'detail', items: itemsOfLevel('detail') })
  useEffect(() => {
    if (render) setRs(render)
  }, [render])
  const setRender = (next: RenderModelSettings) => {
    setRs(next)
    onRender?.(next)
  }
  const itemsKey = [...rs.items].sort().join(',')
  const custom = itemsKey !== [...itemsOfLevel(rs.level)].sort().join(',')
  const counts = useMemo(() => (model ? itemCounts(model) : null), [model])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (model ? filterModel(model, rs.items) : null), [model, itemsKey])
  // 미리보기는 항목을 연달아 끄고 켤 때 매번 다시 그리지 않게 조금 기다렸다가
  const [previewModel, setPreviewModel] = useState<SiteModel | null>(null)
  useEffect(() => {
    if (!shown) {
      setPreviewModel(null)
      return
    }
    const t = window.setTimeout(() => setPreviewModel(shown), previewModel ? 400 : 0)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown])
  const stats = useMemo(() => (shown ? modelStats(shown) : null), [shown])
  const levelLabel = LEVELS.find((l) => l.id === rs.level)?.label ?? ''
  const name = `${baseName}_3D_${sideLabel(half)}_${levelLabel}${custom ? '_고침' : ''}`

  // 렌더 재질 (2026-11-16): 방식은 학생이 고름, 항공사진은 키가 있을 때만
  const material: MaterialStyle = rs.material ?? 'tex'
  const hasKey = !!vworldKey.trim()
  const aerialOn = !!rs.aerial && hasKey && material !== 'none'
  const withTextures = material === 'tex' || aerialOn
  // 같은 범위면 항공사진을 한 번만 받음 (.3dm과 ZIP이 같이 씀)
  const aerialRef = useRef<{ sig: string; tex: AerialTex | null } | null>(null)
  const getAerial = async (m: SiteModel): Promise<AerialTex | null> => {
    if (!aerialOn) return null
    const sig = `${m.origin.x5179.toFixed(1)},${m.origin.y5179.toFixed(1)},${m.half}`
    if (aerialRef.current?.sig === sig && aerialRef.current.tex) return aerialRef.current.tex
    setBusy('항공사진 타일 받는 중')
    const { aerialForModel } = await import('../export/aerialTexture')
    // 항공사진은 전체의 앞 20%
    const tex = await aerialForModel(m, vworldKey, (s) => {
      setBusy(s)
      const t = /(\d+)\/(\d+)/.exec(s)
      if (t) setFrac((0.2 * Number(t[1])) / Number(t[2]))
    })
    aerialRef.current = { sig, tex }
    return tex
  }

  const download3dm = async () => {
    if (!shown) return
    begin('라이노 모듈 불러오는 중')
    setMsg(null)
    try {
      const t0 = performance.now()
      const aerial = await getAerial(shown)
      // 2026-11-17: 일꾼(Web Worker)에서 만들어 파일 쓰는 동안에도 화면이 멈추지 않음
      const { siteModelTo3dmInWorker } = await import('../export/model3dmJob')
      const base = aerialOn ? 0.2 : 0
      const bytes = await siteModelTo3dmInWorker(
        shown,
        meta,
        (s, f) => {
          setBusy(s)
          if (f !== undefined) setFrac(base + (1 - base) * f)
        },
        { materials: material, aerial },
      )
      setFrac(1)
      downloadBlob(`${name}.3dm`, new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
      onExported?.()
      const miss = aerialOn && !aerial ? ' 항공사진은 받지 못해 땅 재질로 넣었습니다(키·연결 확인).' : ''
      setMsg({ kind: miss ? 'error' : 'ok', text: `라이노 파일을 내려받았습니다 — ${fmt(bytes.length / 1e6, 1)}MB, 만드는 데 ${fmt((performance.now() - t0) / 1000, 1)}초.${miss}` })
    } catch (e) {
      setMsg({ kind: 'error', text: `만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      finish()
    }
  }
  /** 무늬 이미지만 따로 (D5에서 .3dm을 바로 불러와 무늬가 안 보일 때 .3dm 옆에 풀기) */
  const downloadTextures = async () => {
    if (!shown) return
    begin('재질 무늬 그리는 중')
    setFrac(null)
    setMsg(null)
    try {
      const aerial = await getAerial(shown)
      const [{ textureJpeg, TEX_FILE }, { zipSync, strToU8 }] = await Promise.all([import('../export/textures'), import('fflate')])
      const set = materialSet(material)
      const files: Record<string, Uint8Array> = {}
      if (set) for (const t of texturesOf(set, Object.values(LAYER_MAT) as MatId[])) files[TEX_FILE[t]] = await textureJpeg(t)
      if (aerial) files[aerial.file] = aerial.bytes
      const readme = [
        '대지해석 에이전트 — 렌더 재질 무늬 이미지',
        '',
        '이 이미지들은 .3dm 파일 안에도 들어 있습니다. 라이노는 열 때 알아서 꺼내 씁니다.',
        '렌더러에서 무늬가 안 보이면 이 ZIP을 .3dm 파일과 같은 폴더에 푸세요 (라이노는 모형 폴더에서 같은 이름의 이미지를 찾습니다).',
        '',
        ...RENDER_HELP.map(([k, v]) => `[${k}] ${v}`),
        '',
        '무늬(SA_asphalt 등)는 앱이 그린 이미지입니다. SA_aerial.jpg는 브이월드 위성영상(국토교통부)입니다 — 쓸 때 출처를 밝히세요.',
      ].join('\r\n')
      files['읽어보기.txt'] = strToU8(readme)
      const zip = zipSync(files, { level: 0 })
      downloadBlob(`${name}_재질무늬.zip`, new Blob([zip as BlobPart], { type: 'application/zip' }))
      setMsg({ kind: 'ok', text: `무늬 이미지 ${Object.keys(files).length - 1}장을 ZIP으로 내려받았습니다 — .3dm과 같은 폴더에 푸세요.` })
    } catch (e) {
      setMsg({ kind: 'error', text: `무늬 이미지를 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      finish()
    }
  }
  const downloadDxf = () => {
    if (!shown) return
    downloadBlob(`${baseName}_평면_${sideLabel(half)}.dxf`, new Blob([siteModelToDxf(shown, meta)], { type: 'application/dxf' }))
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
              <h3>디테일 단계</h3>
              <div className="segmented small" role="radiogroup" aria-label="디테일 단계">
                {LEVELS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="radio"
                    aria-checked={rs.level === l.id}
                    className={rs.level === l.id ? 'on' : ''}
                    disabled={!!busy}
                    onClick={() => setRender({ ...rs, level: l.id as RenderLevel, items: itemsOfLevel(l.id) })}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <p className="muted small">
                {LEVELS.find((l) => l.id === rs.level)?.note}
                {custom ? ' — 항목을 고쳤습니다' : ''}
              </p>
              <details className="model-items">
                <summary className="small">항목 켜고 끄기{custom ? ' (고침)' : ''}</summary>
                {LEVELS.map((l) => (
                  <div key={l.id} className="model-item-group">
                    <span className="label small">{l.id === 'light' ? '가벼움' : `${l.label}에 더함`}</span>
                    {MODEL_ITEMS.filter((it) => it.level === l.id).map((it) => {
                      const n = counts?.[it.id] ?? 0
                      const on = rs.items.includes(it.id)
                      return (
                        <label key={it.id} className={`check-row small${n ? '' : ' muted'}`}>
                          <input
                            type="checkbox"
                            checked={on && n > 0}
                            disabled={!n || !!busy}
                            onChange={(e) => setRender({ ...rs, items: e.target.checked ? [...rs.items, it.id] : rs.items.filter((x) => x !== it.id) })}
                          />
                          {it.label}
                          <span className="muted">{n ? (it.unit ? ` ${fmt(n)}${it.unit}` : '') : ' 자료 없음'}</span>
                        </label>
                      )
                    })}
                  </div>
                ))}
                <p className="muted small">파라펫·지붕 모양(건축물대장 지붕 구조)은 다음 단계(15-D)에서 자세히에 더합니다.</p>
              </details>
            </section>

            {onModelDims && <ModelDimsPanel value={modelDims} onChange={onModelDims} disabled={!!busy} />}

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
                  {material === 'tex' ? ' + 무늬 이미지 약 1MB' : ''}
                  {aerialOn ? ' + 항공사진 약 1~4MB' : ''}
                  {previewInfo && (
                    <span className="muted">
                      {' '}
                      · 미리보기 삼각형 {fmt(previewInfo.triangles)}개 ({fmt(previewInfo.ms / 1000, 1)}초)
                    </span>
                  )}
                </p>
              )}
              {stats?.warn && <p className="notice error">{stats.warn}</p>}
              <p className="muted small">디테일(가로수·정류장·차선 등)은 1:1,000 수치지도·정밀도로지도를 올렸을 때 들어갑니다.</p>
            </section>

            <section>
              <h3>렌더 재질 (엔스케이프·D5)</h3>
              <div className="segmented small" role="radiogroup" aria-label="렌더 재질">
                {MATERIAL_STYLES.map((s) => (
                  <button key={s.id} type="button" role="radio" aria-checked={material === s.id} className={material === s.id ? 'on' : ''} disabled={!!busy} onClick={() => setRender({ ...rs, material: s.id })}>
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="muted small">{MATERIAL_STYLES.find((s) => s.id === material)?.note}</p>
              <label className={`check-row small${hasKey && material !== 'none' ? '' : ' muted'}`}>
                <input type="checkbox" checked={aerialOn} disabled={!hasKey || material === 'none' || !!busy} onChange={(e) => setRender({ ...rs, aerial: e.target.checked })} />
                지형 면에 항공사진 입히기 (브이월드 위성영상, 약 1~4MB 더함)
              </label>
              {!hasKey && <p className="muted small">브이월드 키를 설정에 넣으면 고를 수 있습니다.</p>}
              <details className="model-items">
                <summary className="small">엔스케이프·D5에서 쓰는 법</summary>
                <ul className="small render-help">
                  <li>
                    <strong>엔스케이프</strong>: 라이노에서 그대로 렌더. 레이어마다 <code>SA_</code>로 시작하는 재질이 붙어 있습니다. 잔디·물은 엔스케이프 재질 편집기에서 종류를 Grass·Water로 바꾸면 더 좋습니다.
                  </li>
                  <li>
                    <strong>D5</strong>: D5 LiveSync(또는 Sync)로 라이노에서 넘기거나 D5에서 .3dm을 바로 불러옵니다. 메시마다 실제 크기 UV를 적어 두어 무늬 크기가 맞습니다. 재질 이름(<code>SA_Asphalt</code> 등)으로 D5 재질 라이브러리와 바꿔 끼우세요.
                  </li>
                  <li>
                    무늬 이미지는 .3dm 안에 들어 있고 라이노가 열 때 꺼내 씁니다. 렌더러에서 무늬가 안 보이면 아래 <strong>무늬 이미지 따로 받기</strong> ZIP을 .3dm과 같은 폴더에 푸세요.
                  </li>
                  <li>건물 벽은 돌출 면이라 무늬 없이 색만 넣었습니다 (외벽 재질은 렌더러에서 고르는 것이 낫습니다).</li>
                </ul>
              </details>
            </section>

            <section className="workbench-actions">
              <button type="button" className="btn primary" disabled={!shown || !!busy} onClick={() => void download3dm()}>
                {busy ? `만드는 중…${frac !== null ? ` ${Math.round(frac * 100)}%` : ''}` : '라이노 .3dm 내려받기'}
              </button>
              {busy && (
                <div className="export-progress" role="status" aria-live="polite">
                  <div className={`export-bar${frac === null ? ' indeterminate' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={frac === null ? undefined : Math.round(frac * 100)}>
                    <span style={frac === null ? undefined : { width: `${Math.max(2, Math.round(frac * 100))}%` }} />
                  </div>
                  <p className="small">
                    {busy}
                    {frac !== null && <strong> · {Math.round(frac * 100)}%</strong>}
                    {startedAt !== null && <span className="muted"> · {Math.floor((Date.now() - startedAt) / 1000)}초 지남</span>}
                  </p>
                  <p className="muted small">범위가 넓거나 '자세히'면 1분 넘게 걸릴 수 있습니다. 막대 위 빛이 움직이고 지난 시간이 늘면 진행 중입니다 — 마지막 '파일 쓰는 중'은 퍼센트가 한동안 그대로입니다.</p>
                </div>
              )}
              {withTextures && (
                <button type="button" className="btn small" disabled={!shown || !!busy} onClick={() => void downloadTextures()}>
                  무늬 이미지 따로 받기 (ZIP)
                </button>
              )}
              <button type="button" className="btn small" disabled={!shown || !!busy} onClick={downloadDxf}>
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
            {showPreview && previewModel ? (
              <Suspense fallback={<p className="model-preview-note">3D 미리보기 불러오는 중…</p>}>
                <ModelPreview model={previewModel} onReady={setPreviewInfo} />
              </Suspense>
            ) : (
              <div className="model-preview-empty muted">{building ? '모형 만드는 중…' : '미리보기를 끈 상태'}</div>
            )}
          </main>
        </div>
      ) : (
        <ContourBench data={data} baseName={baseName} meta={meta} settings={contour} onSettings={onContour} onExported={onExported} modelDims={modelDims} />
      )}
    </div>
  )
}
