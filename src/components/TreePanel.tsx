// 15-E 나무 (⑩ 3D 모형 '모형에 쓰는 자료'): 규칙(넓은 길 가로수·공원·녹지 격자)·수종 비율 보기, 항공사진 지도에서 심기·지우기·줄로 심기.
// 사용자 결정(2026-11-13): 공개 자료는 수종 비율에만 / 규칙 가로수는 1:1,000 가로수가 없는 길만 / 수종별 모양 + 라이노 블록 / ⑩에 항공사진 지도.
// 찍은 것은 바로 프로젝트에 저장(되돌리기 가능)되고 렌더링 모델·.3dm·DXF가 따라 바뀐다.

import { useEffect, useMemo, useRef, useState } from 'react'
import OlMap from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
import XYZ from 'ol/source/XYZ'
import VectorSource from 'ol/source/Vector'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import LineString from 'ol/geom/LineString'
import PolygonGeom from 'ol/geom/Polygon'
import Draw from 'ol/interaction/Draw'
import { fromLonLat, toLonLat } from 'ol/proj'
import { defaults as defaultControls, ScaleLine } from 'ol/control'
import { defaults as defaultInteractions } from 'ol/interaction/defaults'
import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style } from 'ol/style'
import 'ol/ol.css'
import type { DiagramData } from '../diagrams/data'
import { buildTrees, crownRadius, MIX_SOURCE, SPECIES, SPECIES_ORDER, SRC_LABEL, treeSettingsOf, type ModelTree, type TreeSrc } from '../export/trees'
import { utmkToWgs84, wgs84ToUtmk } from '../lib/proj'
import type { Project, TreeEdits, TreeSettings } from '../model/types'
import { tileUrl, type VWorldConfig } from '../sources/vworld'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  data: DiagramData
  config: VWorldConfig
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
const EMPTY: TreeEdits = { add: [], remove: [], rows: [] }
const SRC_COLOR: Record<TreeSrc, string> = { map: '#2e7d32', street: '#9ccc65', park: '#4db6ac', user: '#ffb300' }
type Tool = 'view' | 'add' | 'erase' | 'row'

export default function TreePanel({ project, update, data, config }: Props) {
  const st = treeSettingsOf(project.trees)
  const edits = project.treeEdits ?? EMPTY
  const [open, setOpen] = useState(false)
  const [tool, setTool] = useState<Tool>('view')
  const [sp, setSp] = useState('')
  const [history, setHistory] = useState<TreeEdits[]>([])
  const R = data.R

  // 조사 반경 안 나무 (3D 모형과 같은 계산, UTM-K 기준)
  const res = useMemo(() => {
    const [X0, Y0] = wgs84ToUtmk(data.center[0], data.center[1])
    return buildTrees(
      data,
      ([lo, la]) => {
        const [x, y] = wgs84ToUtmk(lo, la)
        return [x - X0, y - Y0]
      },
      ([x, y]) => utmkToWgs84(x + X0, y + Y0),
      R,
    )
  }, [data, R])

  const setSettings = (patch: Partial<TreeSettings>) =>
    update((d) => {
      d.trees = { ...treeSettingsOf(d.trees), ...patch }
    })
  const setEdits = (fn: (e: TreeEdits) => TreeEdits) => {
    setHistory((h) => [...h.slice(-30), edits])
    update((d) => {
      d.treeEdits = fn(d.treeEdits ?? EMPTY)
    })
  }
  const undo = () => {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory((h) => h.slice(0, -1))
    update((d) => {
      d.treeEdits = prev
    })
  }
  const nEdits = edits.add.length + edits.remove.length + edits.rows.length
  const top = res.mix.list
    .slice()
    .sort((a, b) => b.w - a.w)
    .map((x) => `${x.species} ${Math.round(x.w * 100)}%`)
    .join(' · ')

  return (
    <div className="roof-lookup tree-panel">
      <h4>나무</h4>
      <p className="small">
        조사 반경 {fmt(R)}m 안 <strong>{fmt(res.trees.length)}</strong>그루 —{' '}
        {(['map', 'street', 'park', 'user'] as TreeSrc[])
          .filter((k) => res.counts[k])
          .map((k) => `${SRC_LABEL[k]} ${fmt(res.counts[k])}`)
          .join(' · ') || '없음'}
        {res.capped ? ` (너무 많아 ${fmt(res.capped)}그루 뺌)` : ''}
      </p>
      <div className="tree-rules">
        <label className="check-row small">
          <input type="checkbox" checked={st.street} onChange={(e) => setSettings({ street: e.target.checked })} />
          <span>넓은 길 가로수 (1:1,000 가로수가 없는 길) — 도로 폭</span>
          <NumIn value={st.minWidth} min={6} max={60} onCommit={(v) => setSettings({ minWidth: v })} disabled={!st.street} />
          <span>m 이상, 간격</span>
          <NumIn value={st.spacing} min={4} max={30} onCommit={(v) => setSettings({ spacing: v })} disabled={!st.street} />
          <span>m</span>
        </label>
        <label className="check-row small">
          <input type="checkbox" checked={st.park} onChange={(e) => setSettings({ park: e.target.checked })} />
          <span>공원·녹지 안 격자 — 간격</span>
          <NumIn value={st.parkSpacing} min={4} max={40} onCommit={(v) => setSettings({ parkSpacing: v })} disabled={!st.park} />
          <span>m (광장·유원지 빼고)</span>
        </label>
      </div>
      <p className="small muted">
        수종: {res.mix.local ? `광주 ${res.mix.name}` : '광주 전체(대지가 광주 자치구 밖이거나 필지를 몰라서)'} 가로수 비율 — {top}. 길마다 한 수종, 모양은 원뿔형(은행·메타세쿼이아)·넓은형(느티·왕벚·플라타너스)·둥근형(그 밖) 3가지
        블록. 그 지역 실제 평균 간격은 길 한쪽 약 {res.mix.spacing.toFixed(1)}m. 출처: {MIX_SOURCE}
      </p>
      <div className="row">
        <button type="button" className={`btn small ${open ? 'primary' : 'ghost'}`} onClick={() => setOpen((o) => !o)}>
          {open ? '지도 닫기' : '항공사진 지도에서 심기·지우기'}
        </button>
        {nEdits > 0 && (
          <span className="small muted">
            직접 심은 나무 {fmt(edits.add.length)} · 줄 {fmt(edits.rows.length)} · 지운 자리 {fmt(edits.remove.length)}
          </span>
        )}
      </div>
      {open && (
        <div className="tree-editor">
          <div className="row">
            <div className="segmented small" role="radiogroup" aria-label="나무 도구">
              {(
                [
                  ['view', '보기'],
                  ['add', '심기'],
                  ['erase', '지우기'],
                  ['row', '줄로 심기'],
                ] as [Tool, string][]
              ).map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={tool === k} className={tool === k ? 'on' : ''} onClick={() => setTool(k)}>
                  {l}
                </button>
              ))}
            </div>
            {(tool === 'add' || tool === 'row') && (
              <select className="small" value={sp} onChange={(e) => setSp(e.target.value)} aria-label="심을 수종">
                <option value="">수종: 자치구 비율로</option>
                {SPECIES_ORDER.filter((s) => s !== '기타').map((s) => (
                  <option key={s} value={s}>
                    {s} ({SPECIES[s].h}m)
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="btn small ghost" disabled={!history.length} onClick={undo}>
              되돌리기
            </button>
            <button
              type="button"
              className="link-btn small"
              disabled={!nEdits}
              onClick={() => {
                if (window.confirm('직접 심은 나무·줄·지운 자리를 모두 없앨까요? (규칙·1:1,000 나무는 그대로)')) setEdits(() => EMPTY)
              }}
            >
              찍은 것 모두 없애기
            </button>
          </div>
          <p className="small muted">
            {tool === 'view' && '지도를 끌어 옮기고 휠로 확대합니다. 도구를 고르면 찍을 수 있습니다.'}
            {tool === 'add' && '누른 자리에 나무 한 그루를 심습니다.'}
            {tool === 'erase' && '누른 자리 가까운 나무를 지웁니다 (규칙·1:1,000 나무도 — 지운 자리로 기억해 규칙을 바꿔도 같은 자리면 빠짐).'}
            {tool === 'row' && `선을 그리면(누르며 꺾고, 두 번 눌러 끝) ${st.spacing}m 간격으로 심습니다 (간격은 넓은 길 가로수 간격).`}
          </p>
          <TreeMap
            data={data}
            trees={res.trees}
            edits={edits}
            tool={tool}
            vworldKey={config.key}
            onAdd={(lon, lat) => setEdits((e) => ({ ...e, add: [...e.add, { lon, lat, ...(sp ? { sp } : {}) }] }))}
            onErase={(t) =>
              setEdits((e) => {
                // 직접 심은 나무면 그 기록을 빼고, 아니면 지운 자리로
                const i = e.add.findIndex((a) => Math.abs(a.lon - t.lon) < 1e-7 && Math.abs(a.lat - t.lat) < 1e-7)
                if (i >= 0) return { ...e, add: e.add.filter((_, k) => k !== i) }
                return { ...e, remove: [...e.remove, { lon: t.lon, lat: t.lat }] }
              })
            }
            onRow={(line) => setEdits((e) => ({ ...e, rows: [...e.rows, { line, spacing: st.spacing, ...(sp ? { sp } : {}) }] }))}
          />
          <ul className="change-legend small">
            {(['map', 'street', 'park', 'user'] as TreeSrc[]).map((k) => (
              <li key={k}>
                <i style={{ background: SRC_COLOR[k], borderRadius: '50%' }} />
                {SRC_LABEL[k]}
              </li>
            ))}
            <li>
              <i style={{ background: '#e53935', height: 3 }} />
              지운 자리
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}

function NumIn({ value, min, max, onCommit, disabled }: { value: number; min: number; max: number; onCommit: (v: number) => void; disabled?: boolean }) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  const commit = () => {
    const n = Number(v)
    if (Number.isFinite(n) && n >= min && n <= max && n !== value) onCommit(n)
    else setV(String(value))
  }
  return (
    <input
      type="number"
      className="num-in"
      value={v}
      min={min}
      max={max}
      step={1}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

// ───────────────────────── 항공사진 지도 ─────────────────────────

interface MapProps {
  data: DiagramData
  trees: ModelTree[]
  edits: TreeEdits
  tool: Tool
  vworldKey: string
  onAdd: (lon: number, lat: number) => void
  onErase: (t: ModelTree) => void
  onRow: (line: [number, number][]) => void
}

function TreeMap({ data, trees, edits, tool, vworldKey, onAdd, onErase, onRow }: MapProps) {
  const target = useRef<HTMLDivElement>(null)
  const mapRef = useRef<OlMap | null>(null)
  const treeSrc = useRef(new VectorSource())
  const markSrc = useRef(new VectorSource())
  const baseRef = useRef<TileLayer<XYZ> | null>(null)
  const drawRef = useRef<Draw | null>(null)
  const cb = useRef({ tool, onAdd, onErase, onRow, trees })
  cb.current = { tool, onAdd, onErase, onRow, trees }

  // 지도 만들기 (한 번)
  useEffect(() => {
    if (!target.current) return
    const base = new TileLayer<XYZ>({ zIndex: 0 })
    baseRef.current = base
    const label = new TileLayer<XYZ>({ zIndex: 1 })
    const site = new VectorSource()
    for (const poly of data.boundary.type === 'Polygon' ? [data.boundary.coordinates] : data.boundary.coordinates)
      site.addFeature(new Feature(new PolygonGeom(poly.map((r) => r.map((p) => fromLonLat(p))))))
    const treeLayer = new VectorLayer({
      source: treeSrc.current,
      zIndex: 3,
      style: (f, resolution) => {
        const r = Math.max(3, Number(f.get('r')) / resolution)
        return new Style({
          image: new CircleStyle({ radius: r, fill: new Fill({ color: `${SRC_COLOR[f.get('src') as TreeSrc]}cc` }), stroke: new Stroke({ color: '#ffffff', width: 1 }) }),
        })
      },
    })
    const markLayer = new VectorLayer({
      source: markSrc.current,
      zIndex: 4,
      style: (f) =>
        f.getGeometry()?.getType() === 'LineString'
          ? new Style({ stroke: new Stroke({ color: '#ffb300', width: 2, lineDash: [6, 4] }) })
          : new Style({ image: new RegularShape({ points: 4, radius: 6, radius2: 0, angle: Math.PI / 4, stroke: new Stroke({ color: '#e53935', width: 2.5 }) }) }),
    })
    const siteLayer = new VectorLayer({ source: site, zIndex: 2, style: new Style({ stroke: new Stroke({ color: '#d9480f', width: 2.5 }) }) })
    const map = new OlMap({
      target: target.current,
      layers: [base, label, siteLayer, treeLayer, markLayer],
      view: new View({ center: fromLonLat(data.center), zoom: 18, minZoom: 13, maxZoom: 21 }),
      controls: defaultControls({ attributionOptions: { collapsible: true } }).extend([new ScaleLine()]),
      // 두 번 누르기 확대를 끔: 심기·지우기를 빨리 눌러도 한 번씩 (줄 그리기는 두 번 눌러 끝냄)
      interactions: defaultInteractions({ doubleClickZoom: false }),
    })
    mapRef.current = map
    if (vworldKey.trim()) {
      base.setSource(new XYZ({ url: tileUrl(vworldKey, 'Satellite'), maxZoom: 19, attributions: '© 브이월드 (국토교통부)' }))
      label.setSource(new XYZ({ url: tileUrl(vworldKey, 'Hybrid'), maxZoom: 19 }))
    }
    map.on('click', (evt) => {
      const { tool: t, onAdd: add, onErase: erase, trees: ts } = cb.current
      const [lon, lat] = toLonLat(evt.coordinate)
      if (t === 'add') {
        // 같은 자리(1m 안) 직접 심은 나무가 있으면 또 심지 않음
        const res = map.getView().getResolution() ?? 1
        const dup = ts.some((tr) => {
          if (tr.src !== 'user') return false
          const q = fromLonLat([tr.lon, tr.lat])
          return Math.hypot(q[0] - evt.coordinate[0], q[1] - evt.coordinate[1]) < Math.max(1, res * 3)
        })
        if (!dup) add(lon, lat)
      }
      else if (t === 'erase') {
        // 누른 자리에서 수관 반지름 + 화면 8px 안 가장 가까운 나무
        const res = map.getView().getResolution() ?? 1
        let best: ModelTree | null = null
        let bd = Infinity
        for (const tr of ts) {
          const p = fromLonLat([tr.lon, tr.lat])
          const d = Math.hypot(p[0] - evt.coordinate[0], p[1] - evt.coordinate[1])
          if (d < bd && d <= crownRadius(tr) * 1.2 + 8 * res) {
            bd = d
            best = tr
          }
        }
        if (best) erase(best)
      }
    })
    return () => {
      map.setTarget(undefined)
      mapRef.current = null
    }
    // 대지가 바뀌면 지도를 새로
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.center[0], data.center[1]])

  // 줄로 심기: 그리기 도구
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (drawRef.current) {
      map.removeInteraction(drawRef.current)
      drawRef.current = null
    }
    if (tool !== 'row') return
    const draw = new Draw({ type: 'LineString', style: new Style({ stroke: new Stroke({ color: '#ffb300', width: 2 }) }) })
    draw.on('drawend', (e) => {
      const g = e.feature.getGeometry() as LineString
      const line = g.getCoordinates().map((c) => toLonLat(c) as [number, number])
      if (line.length >= 2) cb.current.onRow(line)
    })
    map.addInteraction(draw)
    drawRef.current = draw
  }, [tool])

  // 나무·지운 자리·줄
  useEffect(() => {
    const s = treeSrc.current
    s.clear()
    s.addFeatures(
      trees.map((t) => {
        const f = new Feature(new Point(fromLonLat([t.lon, t.lat])))
        f.set('src', t.src)
        // 화면 지도(EPSG:3857)는 위도만큼 늘어남
        f.set('r', crownRadius(t) / Math.cos((t.lat * Math.PI) / 180))
        return f
      }),
    )
    const m = markSrc.current
    m.clear()
    m.addFeatures([
      ...edits.remove.map((p) => new Feature(new Point(fromLonLat([p.lon, p.lat])))),
      ...edits.rows.map((r) => new Feature(new LineString(r.line.map((p) => fromLonLat(p))))),
    ])
  }, [trees, edits])

  return (
    <div className="tree-map-wrap">
      <div ref={target} className={`tree-map tool-${tool}`} />
      {!vworldKey.trim() && <p className="small muted">설정에서 브이월드 인증키를 넣으면 항공사진이 배경으로 나옵니다.</p>}
    </div>
  )
}
