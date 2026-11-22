// 과거와 현재 (2026-11-22 사용자 결정: 새 단계 — 옛 항공사진을 올려 세 점으로 위치를 맞추고 나란히(과거 | 현재),
// 앱 자료로 옛 물길·시기별 시가지, 옛 사진 위 지금 도로 = 길의 변화). 옛 사진을 자동으로 받을 공개 API는 없어(국토정보플랫폼·브이월드 모두 지금 영상만)
// 학생이 국토정보플랫폼에서 내려받아 올림. 알아서 그리지 않음 — '그리기'를 눌러야 그림(크게 확인하는 맞춤 미리보기 한 장만 바로).

import { useEffect, useMemo, useState } from 'react'
import PanZoom from '../components/PanZoom'
import { buildDiagramData } from '../diagrams/data'
import { svgBlob, svgToPng } from '../diagrams/export'
import { makeFrame } from '../diagrams/frame'
import { pastPhotoDef } from '../diagrams/panelsPast'
import { collectedDate, renderPanel, settingsOf } from '../diagrams/render'
import { deletePhotos, getPhoto, putPhoto } from '../model/db'
import { downloadBlob, newId, nowIso } from '../model/project'
import type { PastImage, PastState, Project } from '../model/types'
import { affineOf, metersPerPixel, pastLayerFor, processPastImage } from '../past/georef'
import { drawPast, keyFor, loadPastOutputs, pastOutputIds, pastTitle, type PastOutput } from '../past/outputs'
import type { VWorldConfig } from '../sources/vworld'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  config: VWorldConfig
  onGoData: () => void
}

const COLORS = ['#e03131', '#1971c2', '#2f9e44']
type Draft = { img?: [number, number]; ll?: [number, number] }

function usePhotoUrl(id: string | null, which: 'blob' | 'thumb'): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let u: string | null = null
    let alive = true
    setUrl(null)
    if (id)
      void getPhoto(id).then((r) => {
        if (!alive || !r) return
        u = URL.createObjectURL(r[which])
        setUrl(u)
      })
    return () => {
      alive = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [id, which])
  return url
}

function Thumb({ id }: { id: string }) {
  const url = usePhotoUrl(id, 'thumb')
  return url ? <img src={url} alt="" /> : <span className="muted small">…</span>
}

export default function PastStep({ project, update, config, onGoData }: Props) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => buildDiagramData(project), [project.collected, project.collectedAt, project.edits, project.site, project.collectedRadiusM])
  const past: PastState = project.past ?? { images: [] }
  const imgs = past.images
  const [sel, setSel] = useState<string | null>(imgs[0]?.id ?? null)
  const cur = imgs.find((i) => i.id === sel) ?? null
  const fullUrl = usePhotoUrl(cur?.id ?? null, 'blob')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [outputs, setOutputs] = useState<PastOutput[]>([])
  const [preview, setPreview] = useState<string | null>(null)

  const setPast = (fn: (p: PastState) => PastState) =>
    update((d) => {
      d.past = fn(d.past ?? { images: [] })
    })
  const setImg = (id: string, patch: Partial<PastImage>) => setPast((p) => ({ ...p, images: p.images.map((i) => (i.id === id ? { ...i, ...patch } : i)) }))

  useEffect(() => {
    setDrafts(cur ? cur.gcps.map((g) => ({ img: g.img, ll: g.ll })) : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id])
  useEffect(() => {
    void loadPastOutputs(project.id).then(setOutputs)
  }, [project.id])

  // 지금 지도 (점 찍기용): 대지 중심 정사각 틀
  const frame = useMemo(() => (data ? makeFrame(data.center[0], data.center[1], data.R, 'square') : null), [data])
  const mapSvg = useMemo(() => {
    if (!data || !frame) return null
    const roads = data.roads.map((r) => frame.path(r.geom)).join('')
    const bld = data.buildings.filter((b) => b.src !== 'design').map((b) => frame.path(b.geom, false)).join('')
    const water = [...(data.ngii?.water ?? []).filter((w) => w.kind !== 'bank').map((w) => w.geom), ...data.parks.filter((p) => p.extra.kind === 'river').map((p) => p.geom)].map((g) => frame.path(g)).join('')
    return (
      <g>
        <rect x={0} y={0} width={1000} height={1000} fill="#f7f6f2" />
        {water && <path d={water} fill="#a9c8e8" />}
        {roads && <path d={roads} fill="none" stroke="#9a968c" strokeWidth={1.4} strokeLinecap="round" />}
        {bld && <path d={bld} fill="#c9c5bb" />}
        <path d={frame.path(data.boundary, false)} fill="none" stroke="#d6336c" strokeWidth={2} />
      </g>
    )
  }, [data, frame])

  const done = drafts.filter((d) => d.img && d.ll).length
  const active = drafts.length < 3 ? drafts.findIndex((d) => !(d.img && d.ll)) : drafts.findIndex((d) => !(d.img && d.ll))
  const slot = active >= 0 ? active : drafts.length < 3 ? drafts.length : -1
  const saveDrafts = (next: Draft[]) => {
    setDrafts(next)
    if (cur) setImg(cur.id, { gcps: next.filter((d) => d.img && d.ll).map((d) => ({ img: d.img!, ll: d.ll! })) })
  }
  const pick = (side: 'img' | 'll', v: [number, number]) => {
    if (slot < 0) return
    const next = [...drafts]
    while (next.length <= slot) next.push({})
    next[slot] = { ...next[slot], [side]: v }
    saveDrafts(next)
  }

  // 세 점을 다 찍으면 맞춤 확인 그림 한 장만 바로 (지금 도로 선을 겹쳐)
  const gcpSig = JSON.stringify(cur?.gcps ?? [])
  useEffect(() => {
    setPreview(null)
    if (!cur || !data || cur.gcps.length < 3) return
    let alive = true
    let url = ''
    void (async () => {
      const t = affineOf(cur, data.center[0], data.center[1])
      const rec = await getPhoto(cur.id)
      if (!t || !rec) return
      const s = settingsOf(project)
      const f = makeFrame(data.center[0], data.center[1], data.R, s.frame)
      const layer = await pastLayerFor(rec.blob, cur, t, f)
      const r = await renderPanel(pastPhotoDef('맞춤 확인'), data, s, '', collectedDate(project), null, { past: { layer, year: cur.year, name: cur.name, roadsOver: true } })
      if (!alive) return
      url = URL.createObjectURL(svgBlob(r.svg))
      setPreview(url)
    })()
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id, gcpSig, data])

  const upload = async (files: File[]) => {
    setMsg(null)
    const added: PastImage[] = []
    for (const file of files) {
      try {
        setBusy(`읽는 중: ${file.name}`)
        const p = await processPastImage(file)
        const id = newId()
        await putPhoto({ id, projectId: project.id, blob: p.blob, thumb: p.thumb, width: p.width, height: p.height, takenAt: null, lon: null, lat: null, originalName: file.name, createdAt: nowIso() })
        const y = file.name.match(/(19[4-9]\d|20[0-2]\d)/)
        added.push({ id, year: y ? Number(y[1]) : null, name: file.name.replace(/\.[^.]+$/, '').slice(0, 40), width: p.width, height: p.height, gcps: [], addedAt: nowIso() })
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e))
      }
    }
    setBusy(null)
    if (added.length) {
      setPast((p) => ({ ...p, images: [...p.images, ...added] }))
      setSel(added[0].id)
    }
  }
  const remove = async (id: string) => {
    await deletePhotos([id]).catch(() => undefined)
    setPast((p) => ({ ...p, images: p.images.filter((i) => i.id !== id) }))
    if (sel === id) setSel(imgs.find((i) => i.id !== id)?.id ?? null)
  }

  // ── 그리기
  const ids = pastOutputIds(project, data)
  const status = (id: string) => {
    const o = outputs.find((x) => x.id === id)
    return !o ? 'missing' : o.key !== keyFor(id, project, config.key) ? 'stale' : 'fresh'
  }
  const toDraw = ids.filter((id) => status(id) !== 'fresh')
  const draw = async (which: string[]) => {
    if (!data || !which.length) return
    setBusy('그리는 중')
    try {
      const made = await drawPast(project, data, config.key, which, (id, i, n) => setBusy(`그리는 중 ${i + 1}/${n} — ${id.startsWith('past:pair') ? '옛 사진 | 지금' : id === 'past:oldRiver' ? '옛 물길' : '시기별 시가지'}`))
      setOutputs((cur) => [...cur.filter((o) => !made.some((m) => m.id === o.id)), ...made])
    } catch (e) {
      setMsg(`그리지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }
  const fileBase = `${(project.brief.projectName || '대지').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30)}_과거와현재`
  const outUrls = useMemo(() => Object.fromEntries(outputs.map((o) => [o.id, URL.createObjectURL(svgBlob(o.svg))])), [outputs])
  useEffect(() => () => Object.values(outUrls).forEach((u) => URL.revokeObjectURL(u)), [outUrls])

  if (!data) {
    return (
      <div className="form-page wide">
        <header className="form-head">
          <p className="eyebrow">과거와 현재</p>
          <h2>옛 모습과 지금 비교하기</h2>
        </header>
        <div className="notice">
          <p>먼저 대지를 정하고 공간정보를 수집해야 합니다.</p>
          <button type="button" className="btn small" onClick={onGoData}>
            공간정보 수집하러 가기
          </button>
        </div>
      </div>
    )
  }

  const t = cur && cur.gcps.length >= 3 ? affineOf(cur, data.center[0], data.center[1]) : null
  const shown = ids.filter((id) => outputs.some((o) => o.id === id))
  const excluded = new Set(past.exclude ?? [])

  return (
    <div className="form-page wide past-page">
      <header className="form-head">
        <p className="eyebrow">과거와 현재</p>
        <h2>옛 모습과 지금 비교하기</h2>
        <p className="muted">
          옛 항공사진을 올려 세 점으로 지금 지도에 맞추면 <strong>옛 사진 | 지금</strong>을 같은 틀로 나란히 그립니다. 사진 없이도 앱 자료로 <strong>옛 물길</strong>과{' '}
          <strong>시기별 시가지</strong>를 그립니다. 다 그린 그림은 SVG·PNG로 받고 리포트·보드에 넣을 수 있습니다.
        </p>
      </header>

      <section className="block">
        <h3>1. 옛 항공사진 올리기</h3>
        <p className="small">
          옛 사진을 자동으로 받을 공개 API는 없습니다(국토정보플랫폼·브이월드 모두 지금 영상만). <strong>국토정보플랫폼</strong>(map.ngii.go.kr)에서 지역·연도로 찾아 옛 항공사진을 무료로 내려받으세요(1947년부터). JPEG·PNG로 올리면
          되고(TIFF는 JPEG로 바꿔서), 파일 이름에 연도가 있으면 연도를 채웁니다.
        </p>
        <label className="btn small">
          옛 사진 올리기
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => void upload([...(e.target.files ?? [])]).then(() => (e.target.value = ''))} />
        </label>
        {busy && <span className="muted small"> {busy}</span>}
        {msg && <p className="notice error small">{msg}</p>}
        {imgs.length > 0 && (
          <ul className="past-list">
            {imgs.map((i) => (
              <li key={i.id} className={i.id === sel ? 'on' : ''}>
                <button type="button" className="past-thumb" onClick={() => setSel(i.id)} aria-label={`${i.name} 고르기`}>
                  <Thumb id={i.id} />
                </button>
                <div className="past-meta">
                  <input type="text" value={i.name} aria-label="이름" onChange={(e) => setImg(i.id, { name: e.target.value })} />
                  <label className="small">
                    연도{' '}
                    <input type="number" min={1900} max={2100} value={i.year ?? ''} onChange={(e) => setImg(i.id, { year: e.target.value ? Number(e.target.value) : null })} />
                  </label>
                  <span className={`small ${i.gcps.length >= 3 ? 'ok-text' : 'warn-text'}`}>{i.gcps.length >= 3 ? '위치 맞춤 끝' : `위치 점 ${i.gcps.length}/3`}</span>
                  <button type="button" className="link-btn small" onClick={() => void remove(i.id)}>
                    지우기
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {cur && (
        <section className="block">
          <h3>2. 세 점으로 위치 맞추기 — {pastTitle(cur)}</h3>
          <p className="small">
            오래 변하지 않은 곳(옛 길이 만나는 곳, 다리, 철길, 큰 건물 모서리) 세 곳을 <strong>서로 멀리</strong> 골라, 왼쪽 옛 사진에서 한 번 · 오른쪽 지금 지도에서 같은 곳을 한 번
            누르세요. 점 {slot >= 0 ? <strong style={{ color: COLORS[slot] }}>{slot + 1}번</strong> : '셋을 다'} {slot >= 0 ? '을 찍을 차례' : '찍었습니다'} ({done}/3)
          </p>
          <div className="past-pick">
            <div>
              <span className="label">옛 사진</span>
              {fullUrl ? (
                <PanZoom
                  label="옛 사진 (눌러서 점 찍기)"
                  box={[0, 0, cur.width, cur.height]}
                  points={drafts.flatMap((d, k) => (d.img ? [{ x: d.img[0], y: d.img[1], label: String(k + 1), color: COLORS[k] }] : []))}
                  onPick={(x, y) => pick('img', [Math.round(x), Math.round(y)])}
                >
                  <image href={fullUrl} x={0} y={0} width={cur.width} height={cur.height} />
                </PanZoom>
              ) : (
                <p className="muted small">불러오는 중…</p>
              )}
            </div>
            <div>
              <span className="label">지금 지도 (분홍 = 대지)</span>
              {frame && mapSvg && (
                <PanZoom
                  label="지금 지도 (눌러서 점 찍기)"
                  box={[0, 0, 1000, 1000]}
                  points={drafts.flatMap((d, k) => (d.ll ? [{ x: frame.x(d.ll[0]), y: frame.y(d.ll[1]), label: String(k + 1), color: COLORS[k] }] : []))}
                  onPick={(x, y) => pick('ll', frame.inv(x, y))}
                >
                  {mapSvg}
                </PanZoom>
              )}
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn small ghost" disabled={!drafts.length} onClick={() => saveDrafts(drafts.slice(0, -1))}>
              마지막 점 지우기
            </button>
            <button type="button" className="btn small ghost" disabled={!drafts.length} onClick={() => saveDrafts([])}>
              점 모두 다시 찍기
            </button>
            {t && <span className="muted small">사진 1칸 ≈ 땅 {metersPerPixel(t).toFixed(2)}m</span>}
          </div>
          {cur.gcps.length >= 3 && (
            <div className="past-preview">
              <span className="label">맞춤 확인 — 강조색 선(지금 도로)이 사진의 옛 길과 대체로 겹치면 잘 맞은 것</span>
              {preview ? <img src={preview} alt="맞춤 확인" /> : <p className="muted small">그리는 중…</p>}
            </div>
          )}
        </section>
      )}

      <section className="block">
        <h3>3. 비교 그림</h3>
        <div className="row past-settings">
          <div className="seg-field">
            <span className="label">나란히 보기의 지금 쪽</span>
            <div className="segmented small" role="radiogroup" aria-label="지금 쪽">
              {(
                [
                  ['map', '지금 지도 그림'],
                  ['aerial', '지금 항공사진'],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={(past.present ?? 'map') === v}
                  className={(past.present ?? 'map') === v ? 'on' : ''}
                  disabled={v === 'aerial' && !config.key.trim()}
                  title={v === 'aerial' && !config.key.trim() ? '설정에서 브이월드 키를 넣으세요' : ''}
                  onClick={() => setPast((p) => ({ ...p, present: v }))}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <label className="check-row small">
            <input type="checkbox" checked={!!past.roadsOver} onChange={(e) => setPast((p) => ({ ...p, roadsOver: e.target.checked }))} />
            옛 사진 위에 지금 도로 선 (길의 변화)
          </label>
        </div>
        <div className={`gen-bar${toDraw.length ? ' dirty' : ''}${busy ? ' busy' : ''}`} role="status" aria-live="polite">
          <span>
            {busy
              ? busy
              : toDraw.length
                ? `그림 ${toDraw.length}장을 그려야 합니다 (아직 안 그림 ${toDraw.filter((id) => status(id) === 'missing').length} · 바뀜 ${toDraw.filter((id) => status(id) === 'stale').length}) — '그리기'를 누르세요`
                : `그림 ${ids.length}장 · 지금 자료·설정으로 그렸습니다`}
          </span>
          <span className="spacer" />
          <button type="button" className="btn small primary" disabled={!!busy || !toDraw.length} onClick={() => void draw(toDraw)}>
            그리기
          </button>
        </div>
        {!imgs.some((i) => i.gcps.length >= 3) && <p className="muted small">옛 사진을 올려 위치를 맞추면 '옛 사진 | 지금' 그림이 더해집니다. 옛 물길·시기별 시가지는 사진 없이도 그립니다.</p>}
        <div className="past-outputs">
          {shown.map((id) => {
            const o = outputs.find((x) => x.id === id)!
            const st = status(id)
            const name = `${fileBase}_${id.replace(/^past:/, '').replace(/[:]/g, '_')}`
            return (
              <article key={id} className={`past-out${st !== 'fresh' ? ' changed' : ''}`}>
                <h4>
                  {o.title} {st === 'stale' && <span className="changed-badge-inline small">바뀜 · 그리기 전</span>}
                </h4>
                <img src={outUrls[id]} alt={o.title} loading="lazy" />
                <ul className="diagram-summary">
                  {o.summary.map((s, k) => (
                    <li key={k}>{s}</li>
                  ))}
                </ul>
                <div className="row">
                  <label className="check-row small">
                    <input
                      type="checkbox"
                      checked={!excluded.has(id)}
                      onChange={(e) => setPast((p) => ({ ...p, exclude: e.target.checked ? (p.exclude ?? []).filter((x) => x !== id) : [...(p.exclude ?? []), id] }))}
                    />
                    리포트·보드에 넣기
                  </label>
                  <span className="spacer" />
                  <button type="button" className="btn small ghost" onClick={() => downloadBlob(`${name}.svg`, svgBlob(o.svg))}>
                    SVG
                  </button>
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => {
                      const w = Number(o.svg.match(/viewBox="0 0 ([\d.]+)/)?.[1] ?? 2000)
                      void svgToPng(o.svg, Math.round(w * 2), settingsOf(project).background === 'white' ? '#ffffff' : null).then((b) => downloadBlob(`${name}.png`, b))
                    }}
                  >
                    PNG
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
