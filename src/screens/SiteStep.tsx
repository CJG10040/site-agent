import { useEffect, useMemo, useRef, useState } from 'react'
import type { Polygon } from 'geojson'
import MapView, { type MapFit, type MapFocus, type MapMode } from '../components/MapView'
import MapToolbar from '../components/MapToolbar'
import { SunLegend } from '../components/Legends'
import SearchPanel from '../components/SearchPanel'
import { areaM2, centerOf, radiusCircle, siteBoundary } from '../lib/geo'
import { sunPathFeatures } from '../lib/sun'
import { jimokName } from '../model/codes'
import type { Project } from '../model/types'
import { parcelAt, parcelsIn } from '../sources/parcels'
import { effectiveDomain, errorHint, VWorldError, type BaseMap, type GeoFeature, type VWorldConfig } from '../sources/vworld'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  config: VWorldConfig
  baseMap: BaseMap
  onBaseMap: (b: BaseMap) => void
  onNext: () => void
}

type Tool = 'select' | 'draw' | 'modify'

const RADII = [250, 500, 1000]

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

function errMessage(e: unknown): string {
  if (e instanceof VWorldError) return `${e.code} — ${e.message} ${errorHint(e.code)}`
  return e instanceof Error ? e.message : String(e)
}

export default function SiteStep({ project, update, config, baseMap, onBaseMap, onNext }: Props) {
  const site = project.site
  const [tool, setTool] = useState<Tool>('select')
  const [wms, setWms] = useState<string[]>(['lp_pa_cbnd_bubun'])
  const [showSun, setShowSun] = useState(false)
  const [focus, setFocus] = useState<MapFocus | null>(null)
  const [fit, setFit] = useState<MapFit | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)

  const boundary = useMemo(() => siteBoundary(site), [site])
  const center = useMemo(() => (boundary ? centerOf(boundary) : null), [boundary])
  const radius = useMemo(() => (center ? radiusCircle(center, site.radiusM) : null), [center, site.radiusM])
  const sun = useMemo<GeoFeature[]>(
    () => (showSun && center ? (sunPathFeatures(center[0], center[1], Math.min(site.radiusM * 0.6, 220)) as GeoFeature[]) : []),
    [showSun, center, site.radiusM],
  )
  const parcelFeatures = useMemo<GeoFeature[]>(
    () => site.parcels.map((p) => ({ type: 'Feature', geometry: p.geometry, properties: { pnu: p.pnu } })),
    [site.parcels],
  )
  const boundaryArea = boundary ? areaM2(boundary) : 0

  // 처음 열 때 대지가 있으면 대지에 맞춰 보여 준다
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || !boundary) return
    fitted.current = true
    setFit({ geometry: boundary, seq: Date.now() })
  }, [boundary])

  const toggleParcelAt = async (lon: number, lat: number, addOnly = false) => {
    if (site.boundaryMode === 'drawn' && site.drawn) {
      const ok = window.confirm('직접 그린 경계를 지우고 필지 선택으로 바꿀까요?')
      if (!ok) return
    }
    setBusy('필지를 찾는 중…')
    setMsg(null)
    try {
      const p = await parcelAt(config, lon, lat)
      if (!p) {
        setMsg({ kind: 'info', text: '이 지점에서 필지를 찾지 못했습니다. (도로·하천일 수 있습니다)' })
        return
      }
      const exists = site.boundaryMode === 'parcels' && site.parcels.some((x) => x.pnu === p.pnu)
      update((d) => {
        if (d.site.boundaryMode === 'drawn') {
          d.site.boundaryMode = 'parcels'
          d.site.drawn = null
          d.site.parcels = []
        }
        const i = d.site.parcels.findIndex((x) => x.pnu === p.pnu)
        if (i >= 0) {
          if (!addOnly) d.site.parcels.splice(i, 1)
        } else d.site.parcels.push(p)
      })
      setMsg({ kind: 'info', text: exists && !addOnly ? `${p.addr}을(를) 대지에서 뺐습니다.` : `${p.addr}을(를) 대지에 넣었습니다.` })
    } catch (e) {
      setMsg({ kind: 'error', text: errMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const findParcelsIn = async (poly: Polygon) => {
    setBusy('경계에 걸친 필지를 찾는 중…')
    try {
      const r = await parcelsIn(config, poly)
      update((d) => {
        d.site.parcels = r.parcels
      })
      setMsg({
        kind: 'info',
        text: `경계에 걸친 필지 ${r.parcels.length}개를 찾았습니다.${r.truncated ? ` (전체 ${r.total}개 중 일부)` : ''}`,
      })
    } catch (e) {
      setMsg({ kind: 'error', text: errMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const onDrawEnd = (poly: Polygon) => {
    update((d) => {
      d.site.drawn = poly
      d.site.boundaryMode = 'drawn'
    })
    setTool('modify')
    void findParcelsIn(poly)
  }

  const startModify = () => {
    if (site.boundaryMode === 'parcels') {
      if (!boundary) return
      if (boundary.type !== 'Polygon') {
        setMsg({ kind: 'error', text: '떨어져 있는 필지가 있어 하나의 경계로 바꿀 수 없습니다. [직접 그리기]를 쓰세요.' })
        return
      }
      update((d) => {
        d.site.drawn = boundary
        d.site.boundaryMode = 'drawn'
      })
    }
    setTool('modify')
  }

  const clearSite = () => {
    if (!window.confirm('지정한 대지를 모두 지울까요?')) return
    update((d) => {
      d.site.parcels = []
      d.site.drawn = null
      d.site.boundaryMode = 'parcels'
    })
    setTool('select')
    setMsg(null)
  }

  const mapMode: MapMode = tool === 'select' ? 'click' : tool === 'draw' ? 'draw' : 'modify'
  const editable = tool === 'modify' && site.boundaryMode === 'drawn' ? site.drawn : null

  return (
    <div className="split">
      <aside className="split-panel">
        <header className="panel-head">
          <p className="eyebrow">③ 대지</p>
          <h2>대지 경계 정하기</h2>
        </header>

        <SearchPanel
          config={config}
          hint={tool === 'select' ? '결과를 누르면 그 위치로 이동하고 해당 필지를 대지에 넣습니다.' : '결과를 누르면 그 위치로 이동합니다.'}
          onPick={(hit) => {
            setFocus({ lon: hit.lon, lat: hit.lat, zoom: 18, seq: Date.now() })
            if (tool === 'select') void toggleParcelAt(hit.lon, hit.lat, true)
          }}
        />

        <section className="block">
          <h3>경계 지정 방법</h3>
          <div className="segmented" role="radiogroup" aria-label="경계 지정 방법">
            <button type="button" role="radio" aria-checked={tool === 'select'} className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')}>
              필지 선택
            </button>
            <button type="button" role="radio" aria-checked={tool === 'draw'} className={tool === 'draw' ? 'on' : ''} onClick={() => setTool('draw')}>
              직접 그리기
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={tool === 'modify'}
              className={tool === 'modify' ? 'on' : ''}
              onClick={startModify}
              disabled={!boundary}
            >
              경계 수정
            </button>
          </div>
          <p className="help">
            {tool === 'select' && '지도에서 필지를 누르면 대지에 넣고, 다시 누르면 뺍니다. 여러 필지를 이어서 고를 수 있습니다.'}
            {tool === 'draw' && '지도를 눌러 꼭짓점을 찍고, 마지막 점을 두 번 눌러 마칩니다. 경계에 걸친 필지는 자동으로 찾습니다.'}
            {tool === 'modify' && '경계선의 꼭짓점을 끌어 옮기거나, 선 위를 끌어 새 꼭짓점을 만듭니다.'}
          </p>
          {tool === 'modify' && site.drawn && (
            <button type="button" className="btn small" onClick={() => site.drawn && void findParcelsIn(site.drawn)}>
              경계에 걸친 필지 다시 찾기
            </button>
          )}
        </section>

        {busy && <p className="loading">{busy}</p>}
        {msg && <p className={`notice ${msg.kind === 'error' ? 'error' : ''}`}>{msg.text}</p>}

        <section className="block">
          <h3>
            {site.boundaryMode === 'drawn' ? '경계에 걸친 필지' : '선택한 필지'}{' '}
            <span className="count">{site.parcels.length}</span>
          </h3>
          {boundary && (
            <p className="stat-line">
              대지 면적 약 <strong>{fmt(boundaryArea)}㎡</strong> ({fmt(boundaryArea / 3.3058)}평)
              <span className="muted"> · {site.boundaryMode === 'drawn' ? '직접 그린 경계' : '필지 합계'} 기준 계산값</span>
            </p>
          )}
          {site.parcels.length === 0 ? (
            <p className="muted">아직 없습니다.</p>
          ) : (
            <ul className="parcel-list">
              {site.parcels.map((p) => (
                <li key={p.pnu}>
                  <div>
                    <p className="parcel-addr">{p.addr}</p>
                    <p className="muted small">
                      {jimokName(p.jimok)} · {fmt(p.areaM2)}㎡{p.jiga ? ` · 공시지가 ${p.jiga.toLocaleString('ko-KR')}원/㎡` : ''}
                    </p>
                  </div>
                  {site.boundaryMode === 'parcels' && (
                    <button
                      type="button"
                      className="btn ghost small"
                      aria-label={`${p.addr} 빼기`}
                      onClick={() =>
                        update((d) => {
                          d.site.parcels = d.site.parcels.filter((x) => x.pnu !== p.pnu)
                        })
                      }
                    >
                      빼기
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="block">
          <h3>주변 조사 반경</h3>
          <div className="chips">
            {RADII.map((r) => (
              <button
                key={r}
                type="button"
                className={`chip${site.radiusM === r ? ' on' : ''}`}
                aria-pressed={site.radiusM === r}
                onClick={() =>
                  update((d) => {
                    d.site.radiusM = r
                  })
                }
              >
                {r >= 1000 ? `${r / 1000}km` : `${r}m`}
              </button>
            ))}
          </div>
          <p className="help">대지 중심에서 이 거리 안의 건물·도로·시설을 모읍니다. 걸어서 약 {Math.round(site.radiusM / 67)}분 거리입니다.</p>
        </section>

        <div className="panel-foot">
          <button type="button" className="btn ghost danger" onClick={clearSite} disabled={!boundary}>
            대지 지우기
          </button>
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={onNext} disabled={!boundary}>
            다음: 공간정보
          </button>
        </div>
      </aside>

      <section className="split-map">
        <MapView
          vworldKey={config.key}
          vworldDomain={effectiveDomain(config)}
          baseMap={baseMap}
          wms={wms}
          data={{
            boundary: tool === 'modify' ? null : boundary,
            radius,
            parcels: parcelFeatures,
            sun,
          }}
          focus={focus}
          fit={fit}
          mode={mapMode}
          editable={editable}
          onMapClick={(lon, lat) => void toggleParcelAt(lon, lat)}
          onDrawEnd={onDrawEnd}
          onModifyEnd={(poly) =>
            update((d) => {
              d.site.drawn = poly
            })
          }
        >
          <MapToolbar
            baseMap={baseMap}
            onBaseMap={onBaseMap}
            wms={wms}
            onWms={setWms}
            extra={[{ id: 'sun', label: '태양 궤적 (하지·춘추분·동지)', on: showSun, onToggle: () => setShowSun((v) => !v), disabled: !center }]}
          />
          {showSun && center && (
            <div className="map-legend">
              <SunLegend />
            </div>
          )}
        </MapView>
      </section>
    </div>
  )
}
