// ④ 공간정보 › 항목별로 쓸 자료 (사용자 결정 2026-11-13: 항목별 표 + 바뀐 곳 자동, ④에 두어 도판·단면·환경 계산·3D에 모두 씀, 지형 기본은 새 1:5,000).
// 1:1,000(예: 2020년)과 1:5,000(예: 2025년)이 겹치는 곳에서 항목마다 어느 파일의 자료를 쓸지 고른다.
// 바꾼 것은 '적용'을 눌러야 들어간다(환경 계산을 했으면 다시).

import { useEffect, useMemo, useRef, useState } from 'react'
import { hdCrosswalk } from '../diagrams/data'
import { siteBoundary } from '../lib/geo'
import { CHANGE_DZ, type ChangeAreas } from '../lib/sourceChange'
import { applyEnv } from '../model/applyEnv'
import { refreshNgiiFacts } from '../model/applyNgii'
import { autoAvailable, defaultPick, NEW5000, PICK_GROUPS, PICK_KEYS, PICK_LABEL, pickState, repPoint, selectNgii, sourcesFor, type PickKey } from '../model/sourcePick'
import type { Project, SourceId } from '../model/types'
import { computeEnv } from '../sources/env'
import { ngiiLayer, type NgiiKey } from '../sources/ngiiMap'
import type { VWorldConfig } from '../sources/vworld'
import type { Position } from 'geojson'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  config: VWorldConfig
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
type Draft = Partial<Record<string, SourceId>>
const same = (a: Draft, b: Draft) => {
  const ka = Object.keys(a).filter((k) => a[k])
  const kb = Object.keys(b).filter((k) => b[k])
  return ka.length === kb.length && ka.every((k) => a[k] === b[k])
}

export default function SourcePicker({ project, update, config }: Props) {
  const saved = project.sourcePick ?? {}
  const savedAuto = project.sourceAuto !== false
  const [draft, setDraft] = useState<Draft>(saved)
  const [auto, setAuto] = useState(savedAuto)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [view, setView] = useState<'change' | 'diff'>('change')
  // 밖에서 바뀌면(다시 올리기 등) 초안을 맞춤
  useEffect(() => {
    setDraft(project.sourcePick ?? {})
    setAuto(project.sourceAuto !== false)
  }, [project.sourcePick, project.sourceAuto])

  const base = useMemo(() => pickState(project), [project])
  const { ctx } = base
  const show = ctx.cover1000.length > 0 && (ctx.cover5000.length > 0 || ctx.hasHd)

  // 자료마다 1:1,000 도엽 범위 안 개수 (올린 범위 안)
  const counts = useMemo(() => {
    const inCov = (p: Position | null) => !!p && ctx.cover1000.some((b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3])
    const out = {} as Record<PickKey, Partial<Record<SourceId, number>>>
    for (const k of PICK_KEYS) {
      let n1 = 0
      let n5 = 0
      for (const kk of (k === 'walk' ? ['walk', 'walkline'] : [k]) as NgiiKey[])
        for (const f of project.collected[ngiiLayer(kk)]?.features ?? []) {
          if ((ctx.scaleOf.get(String(f.properties.sheet)) ?? 5000) === 1000) n1++
          else if (inCov(repPoint(f.geometry))) n5++
        }
      out[k] = { '1000': n1, '5000': n5 }
    }
    out.crosswalk.hd = (project.collected['hd:mark']?.features ?? []).filter((f) => hdCrosswalk(f.properties) && inCov(repPoint(f.geometry))).length
    out.bldg.vworld = (project.collected['LT_C_BLDGINFO']?.features ?? []).filter((f) => inCov(repPoint(f.geometry))).length
    return out
  }, [project.collected, ctx])

  // 초안대로 고르면 1:1,000 범위 안에서 쓰게 되는 것
  const draftProject = useMemo(() => ({ ...project, sourcePick: draft, sourceAuto: auto }), [project, draft, auto])
  const st = useMemo(() => pickState(draftProject), [draftProject])
  const used = useMemo(() => {
    const inCov = (p: Position | null) => !!p && ctx.cover1000.some((b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3])
    const out = {} as Record<PickKey, { n1: number; n5: number }>
    for (const k of PICK_KEYS) {
      let n1 = 0
      let n5 = 0
      for (const kk of (k === 'walk' ? ['walk', 'walkline'] : [k]) as NgiiKey[])
        for (const f of selectNgii(draftProject, st, kk)) {
          if ((ctx.scaleOf.get(String(f.properties.sheet)) ?? 5000) === 1000) n1++
          else if (inCov(repPoint(f.geometry))) n5++
        }
      out[k] = { n1, n5 }
    }
    return out
  }, [draftProject, st, ctx])

  if (!show) return null
  const dirty = !same(draft, saved) || auto !== savedAuto
  const canAuto = autoAvailable(ctx)
  const ca = canAuto ? st.change ?? pickState({ ...project, sourceAuto: true }).change : null
  const y1 = ctx.year1000 ? `${ctx.year1000}` : '연도 미상'
  const y5 = ctx.year5000 ? `${ctx.year5000}` : '연도 미상'
  // 두 해가 다르면 해로, 같거나 모르면 축척으로 짧게
  const byYear = !!ctx.year1000 && !!ctx.year5000 && ctx.year1000 !== ctx.year5000
  const label = (s: SourceId) => ({ '1000': byYear ? y1 : '1:1,000', '5000': byYear ? y5 : '1:5,000', hd: '정밀도로지도', vworld: '브이월드', off: '안 씀' })[s]

  const setPick = (k: PickKey, s: SourceId) =>
    setDraft((d) => {
      const n = { ...d }
      if (s === defaultPick(k, ctx)) delete n[k]
      else n[k] = s
      return n
    })

  const apply = async () => {
    setMsg(null)
    let after: Project | null = null
    update((d) => {
      if (Object.keys(draft).length) d.sourcePick = { ...draft }
      else delete d.sourcePick
      if (auto) delete d.sourceAuto
      else d.sourceAuto = false
      refreshNgiiFacts(d)
      after = d
    })
    let envText = ''
    if (after && (after as Project).collected['env:result']) {
      setBusy('환경 계산 다시 하는 중')
      try {
        const r = await computeEnv(after, config, (t) => setBusy(`환경 계산 다시 하는 중 · ${t}`))
        update((d) => applyEnv(d, r, null))
        envText = ' 일조·하늘·가시권·바람·열쾌적도도 다시 계산했습니다.'
      } catch (e) {
        envText = ` 환경 계산은 다시 하지 못했습니다(${e instanceof Error ? e.message : String(e)}).`
      }
    }
    setBusy(null)
    setMsg({ kind: 'ok', text: `고른 자료로 바꿨습니다 — 도판·단면·3D 모형이 이 자료로 다시 그려집니다.${envText}` })
  }

  return (
    <section className="block source-pick">
      <h3>항목별로 쓸 자료</h3>
      <p className="help">
        1:1,000 도엽 안에서 항목마다 어느 자료를 쓸지 고릅니다. 1:1,000은 {y1}년, 1:5,000은 {y5}년 자료라 그사이 바뀐 곳이 있습니다. 고른 자료는 도판·단면·환경 계산·3D 모형에 모두 쓰입니다. 숫자는 올린 범위 안
        1:1,000 도엽과 겹치는 개수입니다. 지형을 '안 씀'으로 하면 그 범위는 10m 격자로 그립니다.
      </p>
      <p className="small pick-key">
        {byYear ? (
          <>
            <strong>{y1}</strong> = 1:1,000 수치지도 · <strong>{y5}</strong> = 1:5,000 수치지도
          </>
        ) : (
          '1:1,000 · 1:5,000 수치지도'
        )}
        {ctx.hasHd ? ' · 정밀도로지도' : ''} · 숫자 = 개수 · <span className="pick-def">기본</span> = 처음 정해진 것
      </p>
      {ctx.old5000 && !ctx.v5000 && (
        <p className="notice small">예전에 올린 1:5,000은 도로중심선·교통섬·담장·하천을 읽지 않았습니다. 같은 1:5,000 ZIP을 위 칸에 다시 올리면 이 항목도 {y5}년 자료로 고를 수 있습니다.</p>
      )}
      <div className="pick-table" role="table" aria-label="항목별 자료">
        {PICK_GROUPS.map((g) => (
          <div key={g.title} className="pick-group" role="rowgroup">
            <p className="pick-group-title">{g.title}</p>
            {g.keys.map((k) => {
              const opts = sourcesFor(k, ctx)
              const cur = st.picks[k]
              const def = defaultPick(k, ctx)
              const c = counts[k]
              const u = used[k]
              const dropped = (cur === '1000' || cur === 'hd') && st.change ? (c['1000'] ?? 0) - u.n1 : 0
              return (
                <div key={k} className="pick-row" role="row">
                  <span className="pick-label" role="rowheader">
                    {PICK_LABEL[k]}
                  </span>
                  <div className="pick-opts" role="cell">
                    <div className="pick-chips" role="radiogroup" aria-label={`${PICK_LABEL[k]} 자료`}>
                      {opts.map((s) => (
                        <button
                          key={s}
                          type="button"
                          role="radio"
                          aria-checked={cur === s}
                          className={`chip small${cur === s ? ' on' : ''}`}
                          disabled={!!busy}
                          onClick={() => setPick(k, s)}
                          title={s === '1000' ? `1:1,000 수치지도 (${y1})` : s === '5000' ? `1:5,000 수치지도 (${y5})` : undefined}
                        >
                          {label(s)}
                          {c[s] !== undefined && <span className="pick-n"> · {fmt(c[s] ?? 0)}</span>}
                          {s === def && <span className="pick-def">기본</span>}
                        </button>
                      ))}
                    </div>
                    {(dropped > 0 || ((cur === '1000' || cur === 'hd') && u.n5 > 0)) && (
                      <span className="small muted">
                        바뀐 곳{dropped > 0 ? `에서 1:1,000 ${fmt(dropped)}개 뺌` : ''}
                        {u.n5 > 0 ? `${dropped > 0 ? ', ' : '에 '}1:5,000 ${fmt(u.n5)}개 넣음` : ''}
                      </span>
                    )}
                    {NEW5000.includes(k) && ctx.cover5000.length > 0 && !opts.includes('5000') && <span className="small muted">1:5,000을 다시 올리면 고를 수 있음</span>}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {canAuto && (
        <label className="check-row source-auto">
          <input type="checkbox" checked={auto} disabled={!!busy} onChange={(e) => setAuto(e.target.checked)} />
          <span>
            <strong>{y5}년에 바뀐 곳은 바꿔 넣기</strong> — 1:1,000을 고른 항목도 바뀐 곳 안은 1:1,000을 빼고 1:5,000으로(1:5,000에 없는 항목은 빼기만)
          </span>
        </label>
      )}
      {ca && <ChangeMap ca={ca} project={project} view={view} setView={setView} y1={y1} y5={y5} />}

      <div className="row source-actions">
        <button type="button" className="btn small primary" disabled={!dirty || !!busy} onClick={() => void apply()}>
          {busy ? `${busy}…` : '적용하고 다시 그리기'}
        </button>
        <button
          type="button"
          className="btn small ghost"
          disabled={!dirty || !!busy}
          onClick={() => {
            setDraft(saved)
            setAuto(savedAuto)
          }}
        >
          되돌리기
        </button>
        <button
          type="button"
          className="link-btn small"
          disabled={!!busy || (!Object.keys(draft).length && auto)}
          onClick={() => {
            setDraft({})
            setAuto(true)
          }}
        >
          모두 기본으로
        </button>
        {dirty && !busy && <span className="small muted">바꾼 것은 '적용'을 눌러야 들어갑니다</span>}
      </div>
      {msg && <p className={`notice small ${msg.kind === 'error' ? 'error' : 'ok'}`}>{msg.text}</p>}
    </section>
  )
}

// ───────────────────────── 바뀐 곳 지도 ─────────────────────────

const PX = 2

function ramp(v: number): string {
  if (!Number.isFinite(v)) return '#dcdcdc'
  if (Math.abs(v) < 0.5) return '#f7f7f7'
  const t = Math.max(-1, Math.min(1, v / 6))
  return t > 0 ? `rgb(255,${Math.round(247 - 205 * t)},${Math.round(247 - 225 * t)})` : `rgb(${Math.round(247 + 225 * t)},${Math.round(247 + 150 * t)},255)`
}

function ChangeMap({ ca, project, view, setView, y1, y5 }: { ca: ChangeAreas; project: Project; view: 'change' | 'diff'; setView: (v: 'change' | 'diff') => void; y1: string; y5: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const W = ca.nx * PX
  const H = ca.ny * PX
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = W * dpr
    cv.height = H * dpr
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, W, H)
    for (let j = 0; j < ca.ny; j++)
      for (let i = 0; i < ca.nx; i++) {
        const k = j * ca.nx + i
        const d = ca.diff[k]
        const m = ca.mask[k]
        let col: string
        if (view === 'diff') col = ramp(d)
        else col = m & 2 ? '#cdb6f5' : m & 1 ? '#ffc98f' : Number.isFinite(d) ? '#f7f7f7' : '#e4e4e4'
        g.fillStyle = col
        g.fillRect(i * PX, (ca.ny - 1 - j) * PX, PX, PX)
      }
    const X = (lon: number) => (((lon - ca.lon0) * ca.kx - ca.x0) / ca.cell) * PX
    const Y = (lat: number) => (ca.ny - ((lat - ca.lat0) * ca.ky - ca.y0) / ca.cell) * PX
    const ring = (r: Position[]) => {
      g.beginPath()
      r.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))))
      g.closePath()
    }
    // 건물 (두 해 모두 옅게), 바뀐 건물
    g.lineWidth = 0.5
    g.strokeStyle = 'rgba(90,90,90,0.45)'
    const sheetScale = new Map((project.collected['ngii:sheets']?.features ?? []).map((f) => [String(f.properties.code), Number(f.properties.scale) || 5000]))
    for (const f of project.collected['ngii:bldg']?.features ?? []) {
      if ((sheetScale.get(String(f.properties.sheet)) ?? 5000) === 1000) continue
      const geom = f.geometry
      const o = geom?.type === 'Polygon' ? geom.coordinates[0] : geom?.type === 'MultiPolygon' ? geom.coordinates[0]?.[0] : null
      if (!o) continue
      ring(o)
      g.stroke()
    }
    g.lineWidth = 1.6
    g.strokeStyle = '#6a2fb8'
    for (const r of ca.gone) {
      ring(r)
      g.stroke()
    }
    g.strokeStyle = '#111111'
    for (const r of ca.added) {
      ring(r)
      g.stroke()
    }
    // 1:1,000 도엽
    g.setLineDash([4, 3])
    g.lineWidth = 1
    g.strokeStyle = '#8a8a8a'
    for (const f of project.collected['ngii:sheets']?.features ?? []) {
      if (Number(f.properties.scale) !== 1000) continue
      const b = f.properties.bounds as [number, number, number, number] | undefined
      if (b) g.strokeRect(X(b[0]), Y(b[3]), X(b[2]) - X(b[0]), Y(b[1]) - Y(b[3]))
    }
    g.setLineDash([])
    // 대지
    const site = siteBoundary(project.site)
    if (site) {
      g.lineWidth = 2.5
      g.strokeStyle = '#d9480f'
      for (const poly of site.type === 'Polygon' ? [site.coordinates] : site.coordinates) {
        ring(poly[0])
        g.stroke()
      }
    }
  }, [ca, project.collected, project.site, view, W, H])

  const s = ca.stats
  const pct = s.bothCells ? Math.round((s.maskCells / s.bothCells) * 100) : 0
  return (
    <div className="change-map">
      <div className="row">
        <div className="segmented small" role="radiogroup" aria-label="지도 보기">
          <button type="button" role="radio" aria-checked={view === 'change'} className={view === 'change' ? 'on' : ''} onClick={() => setView('change')}>
            바뀐 곳
          </button>
          <button type="button" role="radio" aria-checked={view === 'diff'} className={view === 'diff' ? 'on' : ''} onClick={() => setView('diff')}>
            땅 높이 차이 ({y5} − {y1})
          </button>
        </div>
      </div>
      <p className="small">
        바뀐 곳은 두 축척이 겹치는 범위의 약 {pct}%입니다: {y1}에만 있는 건물 {fmt(s.gone)}동과 {y5}에만 있는 건물 {fmt(s.added)}동(30m² 이상, 지붕만 있는 구조물·가건물 뺌)의 둘레 5m, 그리고 두 해 모두
        높이 자료가 가까이 있는데 땅이 {CHANGE_DZ}m 넘게 다른 곳.
      </p>
      <div className="change-canvas">
        <canvas ref={ref} style={{ width: W, maxWidth: '100%', aspectRatio: `${W} / ${H}` }} aria-label="1:1,000 도엽 범위의 바뀐 곳 지도" />
      </div>
      <ul className="change-legend small">
        {view === 'change' ? (
          <>
            <li>
              <i style={{ background: '#cdb6f5' }} />
              건물이 바뀐 곳(둘레 5m)
            </li>
            <li>
              <i style={{ background: '#ffc98f' }} />땅 높이가 {CHANGE_DZ}m 넘게 바뀐 곳
            </li>
          </>
        ) : (
          <>
            <li>
              <i style={{ background: ramp(4) }} />
              {y5}이 높음
            </li>
            <li>
              <i style={{ background: ramp(-4) }} />
              {y5}이 낮음
            </li>
            <li>
              <i style={{ background: '#f7f7f7', border: '1px solid #ccc' }} />
              ±0.5m 안
            </li>
          </>
        )}
        <li>
          <i className="line" style={{ background: '#6a2fb8' }} />
          {y1}에만 있는 건물
        </li>
        <li>
          <i className="line" style={{ background: '#111' }} />
          {y5}에만 있는 건물
        </li>
        <li>
          <i className="line" style={{ background: '#d9480f' }} />
          대지
        </li>
        <li>
          <i style={{ background: '#e4e4e4' }} />
          비교 못 함
        </li>
      </ul>
    </div>
  )
}
