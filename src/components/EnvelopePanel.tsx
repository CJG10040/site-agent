// ⑪ 건축 가능 영역 (2026-11-21 묶음 E5): 띄울 거리·최고 높이·계단을 넣으면 대지를 깎은 계단형 덩어리를 평면도로 보여 준다.
// 사용자 결정: 띄울 거리·최고 높이는 직접 넣기(조례 별표 줄을 옆에), 도로변은 앱이 찾고 평면도에서 눌러 고침, 계단은 층고/1m.
// 참고용 — 건폐율·용적률은 덩어리와 따로(덩어리 = 지을 수 있는 껍데기, 실제 바닥은 건폐율·용적률로 더 작음).

import { useEffect, useMemo, useState } from 'react'
import type { DiagramData } from '../diagrams/data'
import { siteRingsXY } from '../diagrams/move'
import type { EnvelopeResult } from '../law/envelope'
import { bcrOf, computeEnvelopeFor, farOf, type SiteZone } from '../law/envelopeData'
import type { RegionTable } from '../law/ordinances'
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
  /** 체크리스트 '대지 안의 공지' 항목의 값 줄 (조례 별표에서 고른 용도 줄) */
  setbackHint: string[]
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

export function useEnvelope(d: DiagramData | null, zones: SiteZone[], siteArea: number, region: RegionTable | null, project: Project): { result: EnvelopeResult | null; cap: number | null; edgesValid: boolean } {
  const env = project.law?.envelope ?? {}
  const sk = siteKey(project.site)
  const edgesValid = !env.siteKey || env.siteKey === sk
  const apartment = project.law?.use?.no === '2'
  return useMemo(() => {
    if (!d) return { result: null, cap: null, edgesValid }
    return { ...computeEnvelopeFor(d, zones, siteArea, region, { env, apartment, edgesValid }), edgesValid }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, zones, siteArea, region, JSON.stringify(env), apartment, sk])
}

export default function EnvelopePanel({ project, update, data, zones, siteArea, overlays, region, setbackHint }: Props) {
  const env: EnvelopeState = project.law?.envelope ?? {}
  const { result: r, cap, edgesValid } = useEnvelope(data, zones, siteArea, region, project)
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
    if ((env.setbackRoad ?? 0) > 0 || (env.setbackSide ?? 0) > 0) applied.push(`대지 안의 공지: 건축선에서 ${env.setbackRoad ?? 0}m, 인접 대지경계선에서 ${env.setbackSide ?? 0}m (넣은 값 — 조례 별표로 확인, 건축법 제58조)`)
    else unknown.push('대지 안의 공지 띄울 거리를 넣지 않음 (0m로 계산) — 조례 별표 확인')
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
    else unknown.push(`높이 제한(고도·경관지구, 가로구역별 최고높이, 지구단위계획)을 넣지 않음${cap ? ` — 그림은 ${fmt(cap)}m(용적률 상한 연면적을 가능 바닥에 쌓은 높이)에서 자름` : ''}`)
    if (overlays.some((n) => /지구단위계획/.test(n))) unknown.push('지구단위계획구역 — 건축한계선·높이·배치가 따로 정해질 수 있음')
    unknown.push('도로 모퉁이 건축선(건축법 시행령 제31조)', '공동주택 채광·동 사이 거리(시행령 제86조 ③)', '건폐율·용적률은 덩어리와 따로 — 아래 숫자 참고')
  }

  return (
    <section className="law-envelope">
      <div className="law-envelope-head">
        <h3>건축 가능 영역</h3>
        <span className="muted small">참고용 — 띄울 거리·정북 일조·최고 높이로 깎은 덩어리 (건폐율·용적률은 따로) · ⑥ 도판 {panelNumber('envelope')}(3D)과 ⑩ .3dm '법규_가능영역' 레이어에도 같은 덩어리</span>
      </div>
      <div className="law-envelope-inputs">
        <Num label="건축선에서" unit="m" value={env.setbackRoad} onChange={(v) => patch((e) => ({ ...e, setbackRoad: v }))} placeholder="0" />
        <Num label="인접 대지에서" unit="m" value={env.setbackSide} onChange={(v) => patch((e) => ({ ...e, setbackSide: v }))} placeholder="0" />
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
      {setbackHint.length > 0 && (
        <details className="law-envelope-hint small">
          <summary>조례 별표에서 고른 용도 줄 (띄울 거리 정하기)</summary>
          <ul>
            {setbackHint.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </details>
      )}
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
            <h4>확인 필요 (반영 못 함)</h4>
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
