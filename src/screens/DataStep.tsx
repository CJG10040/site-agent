import { useEffect, useMemo, useRef, useState } from 'react'
import MapView, { type MapFit } from '../components/MapView'
import MapToolbar from '../components/MapToolbar'
import { DensityLegend, FloorLegend, OverlayLegend, SunLegend } from '../components/Legends'
import { buildOverlays, type OverlayId } from '../components/overlays'
import SiteLinks from '../components/SiteLinks'
import { areaM2, centerOf, radiusCircle, siteBoundary } from '../lib/geo'
import { sunPathFeatures } from '../lib/sun'
import { applyCollection } from '../model/applyCollection'
import { siteKey } from '../model/project'
import type { Project } from '../model/types'
import { ALL_CATEGORIES, DATA_CATEGORIES, type DataCategory, type KeyNeed } from '../sources/categories'
import { collectSiteData, type CollectProgress } from '../sources/collect'
import type { ApiKeys } from '../sources/keys'
import { effectiveDomain, type BaseMap, type GeoFeature, type VWorldConfig } from '../sources/vworld'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  config: VWorldConfig
  keys: ApiKeys
  baseMap: BaseMap
  onBaseMap: (b: BaseMap) => void
  onGoSite: () => void
  onGoQuestion: () => void
  onOpenSettings: () => void
  onNext: () => void
}

const STATE_LABEL: Record<CollectProgress['state'], string> = {
  pending: '대기',
  running: '수집 중',
  ok: '완료',
  empty: '해당 없음',
  error: '오류',
}

const GROUP_ORDER = ['행정', '규제', '토지', '건물', '교통', '시설', '인구·사업체', '재해·하천', '공공·교육', '상권', '대중교통·기후', '주변 시설']

const KEY_LABEL: Record<KeyNeed, string> = { vworld: '브이월드', sgis: 'SGIS', dataGoKr: '공공데이터포털', kakao: '카카오' }

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

export default function DataStep(props: Props) {
  const { project, update, config, keys, baseMap, onBaseMap, onGoSite, onGoQuestion, onOpenSettings, onNext } = props
  const site = project.site
  const [wms, setWms] = useState<string[]>([])
  const [showBuildings, setShowBuildings] = useState(true)
  const [showRoads, setShowRoads] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showSun, setShowSun] = useState(false)
  const [progress, setProgress] = useState<CollectProgress[] | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fit, setFit] = useState<MapFit | null>(null)
  const [shown, setShown] = useState<OverlayId[]>([])
  const [info, setInfo] = useState<{ name: string; sub: string } | null>(null)

  const boundary = useMemo(() => siteBoundary(site), [site])
  const center = useMemo(() => (boundary ? centerOf(boundary) : null), [boundary])
  const radius = useMemo(() => (center ? radiusCircle(center, site.radiusM) : null), [center, site.radiusM])
  const sun = useMemo<GeoFeature[]>(
    () => (showSun && center ? (sunPathFeatures(center[0], center[1], Math.min(site.radiusM * 0.6, 220)) as GeoFeature[]) : []),
    [showSun, center, site.radiusM],
  )
  const buildings = (project.collected.LT_C_BLDGINFO?.features ?? []) as GeoFeature[]
  const roads = (project.collected.LT_L_MOCTLINK?.features ?? []) as GeoFeature[]
  const statsAreas = (project.collected['sgis:statsarea']?.features ?? []) as GeoFeature[]
  const statsYear = statsAreas[0]?.properties?.year as number | undefined
  // collected는 프로젝트를 고쳐도 같은 객체로 유지되므로(useProject) 다시 수집할 때만 새로 만든다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const overlays = useMemo(() => buildOverlays(project), [project.collected])
  const visible = useMemo(() => overlays.filter((o) => shown.includes(o.id) && o.count > 0), [overlays, shown])
  const overlayAreas = useMemo(() => visible.flatMap((o) => o.areas), [visible])
  const overlayPoints = useMemo(() => visible.flatMap((o) => o.points), [visible])
  const toggleOverlay = (id: OverlayId) => setShown((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || !radius) return
    fitted.current = true
    setFit({ geometry: radius, seq: Date.now() })
  }, [radius])

  const selection = (project.dataSelection as DataCategory[] | undefined) ?? ALL_CATEGORIES
  const hasKey: Record<KeyNeed, boolean> = {
    vworld: !!config.key.trim(),
    sgis: !!(keys.sgisKey.trim() && keys.sgisSecret.trim()),
    dataGoKr: !!keys.dataGoKr.trim(),
    kakao: !!keys.kakaoRest.trim(),
  }
  const runnable = selection.filter((c) => hasKey[DATA_CATEGORIES.find((d) => d.id === c)!.needs])
  const skippedForKey = selection.filter((c) => !runnable.includes(c))

  const setAll = (on: boolean) =>
    update((d) => {
      d.dataSelection = on ? [...ALL_CATEGORIES] : []
    })

  const toggleCategory = (c: DataCategory) =>
    update((d) => {
      const cur = (d.dataSelection as DataCategory[] | undefined) ?? ALL_CATEGORIES
      d.dataSelection = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]
    })

  const questionEmpty = !project.question.curiosity.trim() && project.question.lenses.length === 0
  const radiusChanged = project.collectedAt && project.collectedRadiusM !== site.radiusM
  const siteChanged = !!project.collectedAt && !!project.collectedSiteKey && project.collectedSiteKey !== siteKey(site)

  const run = async () => {
    if (!boundary) return
    setRunning(true)
    setError(null)
    let last: CollectProgress[] = []
    try {
      const outcome = await collectSiteData(
        { config, keys, boundary, parcels: site.parcels, radiusM: site.radiusM, selection: runnable },
        (p) => {
          last = p
          setProgress(p)
        },
      )
      update((d) => applyCollection(d, outcome, boundary, last))
      setShowBuildings(true)
      if (outcome.sgis?.statsAreas.length) setShowStats(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const rows: CollectProgress[] = progress ?? project.collectLog ?? []
  const grouped = GROUP_ORDER.map((g) => ({ group: g, rows: rows.filter((r) => r.group === g) })).filter((g) => g.rows.length)
  const drafts = project.cards.filter((c) => c.status === 'draft').length

  return (
    <div className="split">
      <aside className="split-panel">
        <header className="panel-head">
          <p className="eyebrow">④ 공간정보</p>
          <h2>대지와 주변의 공공데이터 모으기</h2>
        </header>

        {!boundary ? (
          <div className="notice">
            <p>먼저 대지를 정해야 합니다.</p>
            <button type="button" className="btn small" onClick={onGoSite}>
              대지 정하러 가기
            </button>
          </div>
        ) : (
          <>
            <p className="stat-line">
              대지 약 <strong>{fmt(areaM2(boundary))}㎡</strong> · 조사 반경 <strong>{site.radiusM}m</strong>
              <button type="button" className="link-btn" onClick={onGoSite}>
                바꾸기
              </button>
            </p>
            {questionEmpty && (
              <p className="notice">
                아직 첫 질문을 적지 않았습니다. 질문을 먼저 적어 두면 자료에 끌려가지 않고 자료를 고를 수 있습니다.{' '}
                <button type="button" className="link-btn" onClick={onGoQuestion}>
                  첫 질문 적기
                </button>
              </p>
            )}

            <section className="block">
              <div className="block-head">
                <h3>수집할 자료</h3>
                <span className="spacer" />
                <button type="button" className="link-btn" onClick={() => setAll(true)}>
                  전체 선택
                </button>
                <button type="button" className="link-btn" onClick={() => setAll(false)}>
                  전체 해제
                </button>
              </div>
              <ul className="category-list">
                {DATA_CATEGORIES.map((c) => {
                  const on = selection.includes(c.id)
                  const keyOk = hasKey[c.needs]
                  return (
                    <li key={c.id} className={on ? 'on' : ''}>
                      <label>
                        <input type="checkbox" checked={on} onChange={() => toggleCategory(c.id)} />
                        <span className="category-text">
                          <span className="category-label">
                            {c.label}
                            {!keyOk && <span className="badge warn">{KEY_LABEL[c.needs]} 키 필요</span>}
                          </span>
                          <span className="category-detail">{c.detail}</span>
                          <span className="category-meta">
                            {c.source} · {c.scope}
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
              {skippedForKey.length > 0 && (
                <p className="help">
                  키가 없는 자료는 건너뜁니다.{' '}
                  <button type="button" className="link-btn" onClick={onOpenSettings}>
                    설정에서 키 입력
                  </button>
                </p>
              )}
            </section>

            {site.radiusM >= 1000 && <p className="help">반경 1km는 건물이 수천 동일 수 있어 1분 정도 걸릴 수 있습니다.</p>}
            <button type="button" className="btn primary block" onClick={() => void run()} disabled={running || runnable.length === 0}>
              {running ? '수집 중…' : project.collectedAt ? '다시 수집' : '공간정보 수집'}
            </button>
            {project.collectedAt && !running && (
              <p className="help">
                마지막 수집 {new Date(project.collectedAt).toLocaleString('ko-KR')}
                {radiusChanged && ` · 반경이 ${project.collectedRadiusM}m에서 바뀌었습니다. 다시 수집하세요.`}
              </p>
            )}
            {siteChanged && !running && (
              <p className="notice error">수집한 뒤 대지 경계가 바뀌었습니다. 지금 보이는 자료와 사실 카드는 이전 대지 기준입니다. 다시 수집하세요.</p>
            )}
            {error && <p className="notice error">{error}</p>}
          </>
        )}

        {rows.length > 0 && (
          <section className="block">
            <h3>수집 결과</h3>
            {grouped.map((g) => (
              <div key={g.group} className="collect-group">
                <p className="collect-group-title">{g.group}</p>
                <ul className="collect-list">
                  {g.rows.map((r) => (
                    <li key={r.id} className={`state-${r.state}`}>
                      <span className="dot" aria-hidden="true" />
                      <span className="collect-label">{r.label}</span>
                      <span className="collect-state">{r.state === 'ok' && r.count !== undefined ? `${fmt(r.count)}건` : STATE_LABEL[r.state]}</span>
                      {r.message && <span className="collect-msg">{r.message}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="help">'해당 없음'은 오류가 아니라 대지·반경 안에 그 자료가 없다는 뜻입니다. 기준 연도가 자료마다 다르니 사실 카드의 출처를 확인하세요.</p>
          </section>
        )}

        {boundary && <SiteLinks site={site} />}

        {project.collectedAt && !running && (
          <div className="panel-foot">
            <p className="muted small">사실 카드 초안 {drafts}개가 확인을 기다립니다.</p>
            <span className="spacer" />
            <button type="button" className="btn primary" onClick={onNext}>
              사실 카드 확인
            </button>
          </div>
        )}
      </aside>

      <section className="split-map">
        <MapView
          vworldKey={config.key}
          vworldDomain={effectiveDomain(config)}
          baseMap={baseMap}
          wms={wms}
          data={{
            boundary,
            radius,
            buildings: showBuildings ? buildings : [],
            roads: showRoads ? roads : [],
            statsAreas: showStats ? statsAreas : [],
            sun,
            overlayAreas,
            overlayPoints,
          }}
          fit={fit}
          mode="click"
          onOverlayClick={setInfo}
        >
          <MapToolbar
            baseMap={baseMap}
            onBaseMap={onBaseMap}
            wms={wms}
            onWms={setWms}
            extra={[
              {
                id: 'bldg',
                label: `수집한 건물 (층수별 색) ${buildings.length ? `${fmt(buildings.length)}동` : ''}`,
                on: showBuildings,
                onToggle: () => setShowBuildings((v) => !v),
                disabled: buildings.length === 0,
              },
              { id: 'roads', label: '수집한 도로망', on: showRoads, onToggle: () => setShowRoads((v) => !v), disabled: roads.length === 0 },
              {
                id: 'stats',
                label: `집계구 인구밀도 ${statsAreas.length ? `${statsAreas.length}곳` : ''}`,
                on: showStats,
                onToggle: () => setShowStats((v) => !v),
                disabled: statsAreas.length === 0,
              },
              { id: 'sun', label: '태양 궤적', on: showSun, onToggle: () => setShowSun((v) => !v), disabled: !center },
              ...overlays.map((o) => ({
                id: `ov:${o.id}`,
                label: `${o.label} ${o.count ? `${fmt(o.count)}` : ''}`,
                on: shown.includes(o.id),
                onToggle: () => toggleOverlay(o.id),
                disabled: o.count === 0,
              })),
            ]}
          />
          {info && (
            <div className="map-info" role="status">
              <strong>{info.name || '이름 없음'}</strong>
              {info.sub && <span className="muted small">{info.sub}</span>}
              <button type="button" className="link-btn" onClick={() => setInfo(null)} aria-label="닫기">
                ×
              </button>
            </div>
          )}
          {((showBuildings && buildings.length > 0) || (showStats && statsAreas.length > 0) || (showSun && center) || visible.length > 0) && (
            <div className="map-legend">
              {showBuildings && buildings.length > 0 && <FloorLegend />}
              {showStats && statsAreas.length > 0 && <DensityLegend year={statsYear} />}
              {showSun && center && <SunLegend />}
              {visible.map((o) => (
                <OverlayLegend key={o.id} title={o.label} entries={o.legend} />
              ))}
            </div>
          )}
        </MapView>
      </section>
    </div>
  )
}
