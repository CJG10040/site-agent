// ⑪ 건축 가능 영역 (2026-11-21 묶음 E5): 띄울 거리·최고 높이·계단을 넣으면 대지를 깎은 계단형 덩어리를 평면도로 보여 준다.
// 사용자 결정: 띄울 거리·최고 높이는 직접 넣기, 도로변은 앱이 찾고 평면도에서 눌러 고침, 계단은 층고/1m.
// 묶음 F1(2026-11-21): 띄울 거리 칸을 비우면 앱이 조례 별표에서 고른 값으로 (넣으면 그 값).
// 참고용 — 건폐율·용적률은 덩어리와 따로(덩어리 = 지을 수 있는 껍데기, 실제 바닥은 건폐율·용적률로 더 작음).

import { useEffect, useMemo, useState } from 'react'
import type { DiagramData } from '../diagrams/data'
import { siteRingsXY } from '../diagrams/move'
import { bcrOf, computeEnvelopeFor, planInputOf, type EnvelopeRun, type SiteZone } from '../law/envelopeData'
import { farOf } from '../law/envelopeData'
import type { OrdinanceTable, RegionTable } from '../law/ordinances'
import type { XY } from '../lib/network'
import { siteKey } from '../model/project'
import { panelNumber } from '../diagrams/panels'
import type { EnvelopeState, LawState, Project } from '../model/types'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  data: DiagramData
  zones: SiteZone[]
  siteArea: number
  overlays: string[]
  region: RegionTable | null
  /** 위(⑪ 화면)에서 한 번 계산한 가능 영역 — 검토서와 같은 계산 */
  run: EnvelopeRun & { edgesValid: boolean }
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

/** 숫자 칸: 치는 동안의 글은 따로 (빈칸 = 값 없음) */
function Num({ label, unit, value, onChange, step = 0.5, min = 0, max = 300, placeholder }: { label: string; unit: string; value: number | undefined; onChange: (v: number | undefined) => void; step?: number; min?: number; max?: number; placeholder?: string }) {
  const [txt, setTxt] = useState(value === undefined ? '' : String(value))
  useEffect(() => setTxt(value === undefined ? '' : String(value)), [value])
  return (
    <label className="num-field">
      <span className="label">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={txt}
        placeholder={placeholder}
        onChange={(e) => {
          setTxt(e.target.value)
          if (!e.target.value.trim()) return onChange(undefined)
          const v = Number(e.target.value)
          if (Number.isFinite(v) && v >= min && v <= max) onChange(v)
        }}
        onBlur={() => setTxt(value === undefined ? '' : String(value))}
      />
      <span className="muted small">{unit}</span>
    </label>
  )
}

const NO_AUTO: EnvelopeRun['auto'] = { road: 0, side: 0, roadPick: null, sidePick: null, source: 'none', assumed: [] }

export function useEnvelope(d: DiagramData | null, zones: SiteZone[], siteArea: number, region: RegionTable | null, table: OrdinanceTable | null, project: Project): EnvelopeRun & { edgesValid: boolean } {
  const env = project.law?.envelope ?? {}
  const sk = siteKey(project.site)
  const edgesValid = !env.siteKey || env.siteKey === sk
  const apartment = project.law?.use?.no === '2'
  const plan = planInputOf(project)
  return useMemo(() => {
    if (!d) return { result: null, cap: null, auto: NO_AUTO, used: { road: 0, side: 0, roadFrom: 'auto', sideFrom: 'auto' }, edgesValid }
    return { ...computeEnvelopeFor(d, zones, siteArea, region, table, { env, apartment, edgesValid, plan }), edgesValid }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, zones, siteArea, region, table, JSON.stringify(env), JSON.stringify(plan), apartment, sk])
}

export default function EnvelopePanel({ project, update, data, zones, siteArea, overlays, region, run }: Props) {
  const env: EnvelopeState = project.law?.envelope ?? {}
  const { result: r, cap, edgesValid, auto, used } = run
  const patch = (fn: (e: EnvelopeState) => EnvelopeState) =>
    update((dr) => {
      const law: LawState = dr.law ?? {}
      dr.law = { ...law, envelope: fn(law.envelope ?? {}) }
    })
  const toggleEdge = (key: string, auto: 'road' | 'side', cur: 'road' | 'side') =>
    patch((e) => {
      const next = { ...(edgesValid ? (e.edges ?? {}) : {}) }
      const want = cur === 'road' ? 'side' : 'road'
      if (want === auto) delete next[key]
      else next[key] = want
      return { ...e, edges: Object.keys(next).length ? next : undefined, siteKey: siteKey(project.site) }
    })

  // 평면도 (위 = 북)
  const view = useMemo(() => {
    if (!r) return null
    const pts = r.edges.flatMap((e) => [e.a, e.b])
    const xs = pts.map((q) => q[0])
    const ys = pts.map((q) => q[1])
    const x0 = Math.min(...xs)
    const y1 = Math.max(...ys)
    const w = Math.max(...xs) - x0
    const h = y1 - Math.min(...ys)
    const pad = Math.max(w, h) * 0.06 + 2
    return { x0: x0 - pad, y1: y1 + pad, w: w + pad * 2, h: h + pad * 2, sw: Math.max(w, h) / 220 }
  }, [r])
  const X = (q: XY) => +(q[0] - (view?.x0 ?? 0)).toFixed(2)
  const Y = (q: XY) => +((view?.y1 ?? 0) - q[1]).toFixed(2)
  const P = (q: XY) => `${X(q)},${Y(q)}`
  const siteRings = useMemo(() => siteRingsXY(data), [data])
  const path = (rings: XY[][]) => rings.map((ring) => `M${ring.map(P).join('L')}Z`).join('')

  const sunZone = zones.some((z) => z.rule?.sunlight)
  const bcr = bcrOf(region, zones)
  const far = farOf(region, zones)
  const roadEdges = r?.edges.filter((e) => e.kind === 'road').length ?? 0
  const overridden = Object.keys(edgesValid ? (env.edges ?? {}) : {}).length

  const applied: string[] = []
  const unknown: string[] = []
  if (r) {
    const from = (f: 'input' | 'auto') => (f === 'input' ? '넣은 값' : auto.source === 'ordinance' ? '조례 별표' : '가정')
    applied.push(`대지 안의 공지 (건축법 제58조): 건축선에서 ${used.road}m(${from(used.roadFrom)}) · 인접 대지경계선에서 ${used.side}m(${from(used.sideFrom)})`)
    if ((used.roadFrom === 'auto' || used.sideFrom === 'auto') && auto.source !== 'ordinance') unknown.push(...auto.assumed)
    applied.push(`도로에 접한 변 ${roadEdges}곳${overridden ? ` (손으로 고친 변 ${overridden}곳)` : ''} — 평면도에서 변을 눌러 고침`)
    if (r.narrowRoads) applied.push(`좁은 도로(4m 미만) 건축선 후퇴 ${r.narrowRoads}곳 (건축법 제46조 ①)`)
    if (r.unknownWidthRoads) unknown.push(`너비를 모르는 도로에 접한 변 ${r.unknownWidthRoads}곳 — 4m 미만이면 건축선이 물러남`)
    if (sunZone)
      applied.push(
        `정북 일조 (건축법 제61조 ①: 10m 이하 1.5m · 10~17m 5m · 17m 초과 높이의 1/2) — 북쪽 도로·공원·하천은 반대편 경계부터${project.law?.use?.no === '2' ? '(공동주택은 가운데 선)' : ''} (시행령 제86조 ⑥)${r.sunExemptCells ? ', 북쪽 대지가 주거지역이 아닌 곳은 빼 줌(시행령 제86조 ② 1호)' : ''}`,
      )
    else applied.push('정북 일조: 대지가 전용·일반주거지역이 아니라 적용 안 함')
    if (r.sunUnknownNeighbor) unknown.push('북쪽 대지의 용도지역을 자료로 알 수 없는 곳이 있음 — 주거지역으로 보고 깎음')
    if (env.maxHeight) applied.push(`최고 높이 ${env.maxHeight}m (넣은 값)`)
    else unknown.push(`높이 제한(고도·경관지구, 가로구역별 최고높이, 지구단위계획)을 넣지 않음${cap ? ` — 그림은 ${fmt(cap, 1)}m(검토서의 층수 × 층고 — 층수를 넣지 않았으면 가정한 층수)에서 자름` : ''}`)
    if (overlays.some((n) => /지구단위계획/.test(n))) unknown.push('지구단위계획구역 — 건축한계선·높이·배치가 따로 정해질 수 있음')
    unknown.push('도로 모퉁이 가각 건축선(건축법 시행령 제31조)은 넣지 않음', '공동주택 채광·동 사이 거리(시행령 제86조 ③)는 배치할 때 — 위 검토서', '건폐율·용적률은 덩어리와 따로 — 오른쪽 숫자')
  }

  return (
    <section className="law-envelope" id="law-envelope">
      <div className="law-envelope-head">
        <h3>건축 가능 영역</h3>
        <span className="muted small">참고용 — 띄울 거리·정북 일조·최고 높이로 깎은 덩어리 (건폐율·용적률은 따로) · ⑥ 도판 {panelNumber('envelope')}(3D)과 ⑩ .3dm '법규_가능영역' 레이어에도 같은 덩어리</span>
      </div>
      <div className="law-envelope-inputs">
        <Num label="건축선에서" unit="m" value={env.setbackRoad} onChange={(v) => patch((e) => ({ ...e, setbackRoad: v }))} placeholder={`조례 ${auto.road}`} />
        <Num label="인접 대지에서" unit="m" value={env.setbackSide} onChange={(v) => patch((e) => ({ ...e, setbackSide: v }))} placeholder={`조례 ${auto.side}`} />
        <Num label="최고 높이" unit="m" value={env.maxHeight} onChange={(v) => patch((e) => ({ ...e, maxHeight: v }))} step={1} max={1000} placeholder="모르면 비움" />
        <div className="seg-field">
          <span className="label">계단</span>
          <div className="segmented small" role="radiogroup" aria-label="계단">
            {(
              [
                ['floor', '층고 단위'],
                ['meter', '1m 단위'],
              ] as const
            ).map(([v, l]) => {
              const on = (env.step ?? 'floor') === v
              return (
                <button key={v} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => patch((e) => ({ ...e, step: v }))}>
                  {l}
                </button>
              )
            })}
          </div>
        </div>
        {(env.step ?? 'floor') === 'floor' && <Num label="층고" unit="m" value={env.floorH ?? 3.5} onChange={(v) => patch((e) => ({ ...e, floorH: v ?? 3.5 }))} step={0.1} min={2} max={10} />}
      </div>
      <p className="muted small law-envelope-auto">
        띄울 거리 칸을 비우면 조례 값: 건축선에서 <strong>{auto.road}m</strong> · 인접 대지에서 <strong>{auto.side}m</strong>
        {auto.source === 'ordinance' ? (auto.roadPick || auto.sidePick ? ` (${[auto.roadPick && `건축선 ${auto.roadPick.item}`, auto.sidePick && `인접 ${auto.sidePick.item}`].filter(Boolean).join(' · ')})` : ' (조례가 이 용도·규모에 정하지 않음)') : ` — 가정: ${auto.assumed.join(', ')}`}
        {(used.roadFrom === 'input' || used.sideFrom === 'input') && ' · 지금은 넣은 값으로 계산'}
      </p>
      {overlays.length > 0 && <p className="muted small">걸친 지구·구역: {overlays.join(', ')} — 높이 제한이 있으면 '최고 높이'에</p>}

      {r && view ? (
        <div className="law-envelope-body">
          <figure className="law-envelope-plan">
            <svg viewBox={`0 0 ${view.w.toFixed(2)} ${view.h.toFixed(2)}`} role="img" aria-label="건축 가능 영역 평면도 (위가 북쪽, 진할수록 높음)">
              <path d={path(siteRings)} className="env-site" strokeWidth={view.sw} fillRule="evenodd" />
              {r.slabs.map((s) => (
                <path key={s.top} d={path(s.rings)} className="env-slab" fillOpacity={Math.min(0.5, 0.75 / Math.max(1, r.slabs.length))} fillRule="evenodd" />
              ))}
              {r.slabs.length > 0 && <path d={path(r.slabs[0].rings)} className="env-foot" strokeWidth={view.sw} fillRule="evenodd" />}
              {r.edges.map((e) => (
                <g key={e.key} className={`env-edge ${e.kind}${e.kind !== e.auto ? ' changed' : ''}`} onClick={() => toggleEdge(e.key, e.auto, e.kind)}>
                  <title>{e.kind === 'road' ? `도로에 접한 변${e.roadWidth ? ` (도로 너비 약 ${fmt(e.roadWidth, 1)}m)` : ''} — 눌러서 인접 대지로` : '인접 대지경계선 — 눌러서 도로로'}</title>
                  <line x1={X(e.a)} y1={Y(e.a)} x2={X(e.b)} y2={Y(e.b)} className="hit" strokeWidth={view.sw * 8} />
                  <line x1={X(e.a)} y1={Y(e.a)} x2={X(e.b)} y2={Y(e.b)} className="vis" strokeWidth={e.kind === 'road' ? view.sw * 3 : view.sw * 1.5} />
                </g>
              ))}
              <text x={view.w - view.sw * 14} y={view.sw * 16} className="env-north" fontSize={view.sw * 9}>
                N ↑
              </text>
            </svg>
            <figcaption className="muted small">
              위가 북쪽 · 진할수록 높이 지을 수 있음 · <span className="env-key road" /> 도로에 접한 변(건축선) <span className="env-key side" /> 인접 대지경계선 — 변을 누르면 바뀜
            </figcaption>
          </figure>
          <div className="law-envelope-stats">
            <dl>
              <div>
                <dt>대지</dt>
                <dd>{fmt(siteArea || r.siteArea)}㎡</dd>
              </div>
              <div>
                <dt>1층으로 쓸 수 있는 넓이</dt>
                <dd>약 {fmt(r.buildableArea)}㎡ (띄울 거리·정북 1.5m를 뺀 곳)</dd>
              </div>
              <div>
                <dt>가장 높은 곳</dt>
                <dd>
                  {fmt(r.maxHeight, 1)}m{(env.step ?? 'floor') === 'floor' ? ` (${Math.round(r.maxHeight / (env.floorH ?? 3.5))}층)` : ''}
                  {r.unlimited && !env.maxHeight ? ' — 높이 제한을 넣지 않아 그림용으로 자름' : ''}
                </dd>
              </div>
              {r.fullGfa !== null && (
                <div>
                  <dt>덩어리를 층마다 꽉 채우면</dt>
                  <dd>연면적 약 {fmt(r.fullGfa)}㎡</dd>
                </div>
              )}
              {bcr !== undefined && (
                <div>
                  <dt>건폐율 상한</dt>
                  <dd>
                    {bcr}% → 건축면적 약 {fmt((siteArea * bcr) / 100)}㎡
                  </dd>
                </div>
              )}
              {far !== undefined && (
                <div>
                  <dt>용적률 상한</dt>
                  <dd>
                    {far}% → 지상 연면적 약 {fmt((siteArea * far) / 100)}㎡
                  </dd>
                </div>
              )}
            </dl>
            <h4>반영한 것</h4>
            <ul className="small">
              {applied.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <h4>가정 · 반영 안 한 것</h4>
            <ul className="small">
              {unknown.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <p className="muted small">대지 경계를 정하고 공간정보를 수집하면 계산합니다.</p>
      )}
    </section>
  )
}
