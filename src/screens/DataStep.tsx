import { useEffect, useMemo, useRef, useState } from 'react'
import MapView, { type MapFit } from '../components/MapView'
import MapToolbar from '../components/MapToolbar'
import { FloorLegend, SunLegend } from '../components/Legends'
import { areaM2, centerOf, radiusCircle, siteBoundary } from '../lib/geo'
import { sunPathFeatures } from '../lib/sun'
import { applyCollection } from '../model/applyCollection'
import { siteKey } from '../model/project'
import type { Project } from '../model/types'
import { collectSiteData, type CollectProgress } from '../sources/collect'
import { COLLECT_LAYERS, LAYER_GROUP_ORDER } from '../sources/vworldLayers'
import { effectiveDomain, type BaseMap, type GeoFeature, type VWorldConfig } from '../sources/vworld'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  config: VWorldConfig
  baseMap: BaseMap
  onBaseMap: (b: BaseMap) => void
  onGoSite: () => void
  onGoQuestion: () => void
  onNext: () => void
}

const STATE_LABEL: Record<CollectProgress['state'], string> = {
  pending: '대기',
  running: '수집 중',
  ok: '완료',
  empty: '해당 없음',
  error: '오류',
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

export default function DataStep({ project, update, config, baseMap, onBaseMap, onGoSite, onGoQuestion, onNext }: Props) {
  const site = project.site
  const [wms, setWms] = useState<string[]>([])
  const [showBuildings, setShowBuildings] = useState(true)
  const [showRoads, setShowRoads] = useState(false)
  const [showSun, setShowSun] = useState(false)
  const [progress, setProgress] = useState<CollectProgress[] | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fit, setFit] = useState<MapFit | null>(null)

  const boundary = useMemo(() => siteBoundary(site), [site])
  const center = useMemo(() => (boundary ? centerOf(boundary) : null), [boundary])
  const radius = useMemo(() => (center ? radiusCircle(center, site.radiusM) : null), [center, site.radiusM])
  const sun = useMemo<GeoFeature[]>(
    () => (showSun && center ? (sunPathFeatures(center[0], center[1], Math.min(site.radiusM * 0.6, 220)) as GeoFeature[]) : []),
    [showSun, center, site.radiusM],
  )
  const buildings = (project.collected.LT_C_BLDGINFO?.features ?? []) as GeoFeature[]
  const roads = (project.collected.LT_L_MOCTLINK?.features ?? []) as GeoFeature[]

  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || !radius) return
    fitted.current = true
    setFit({ geometry: radius, seq: Date.now() })
  }, [radius])

  const questionEmpty = !project.question.curiosity.trim() && project.question.lenses.length === 0
  const radiusChanged = project.collectedAt && project.collectedRadiusM !== site.radiusM
  const siteChanged = !!project.collectedAt && !!project.collectedSiteKey && project.collectedSiteKey !== siteKey(site)

  const run = async () => {
    if (!boundary) return
    setRunning(true)
    setError(null)
    try {
      const outcome = await collectSiteData(config, boundary, site.radiusM, setProgress)
      update((d) => applyCollection(d, outcome, boundary))
      setShowBuildings(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  // 지난 수집 결과를 진행 목록 형태로 보여 준다
  const rows: CollectProgress[] =
    progress ??
    COLLECT_LAYERS.flatMap((l) => {
      // 같은 레이어의 출처가 여럿이면 (확인한 카드가 옛 출처를 가리키는 경우) 가장 최근 것
      const s = project.sources.filter((x) => x.dataset_id === l.id && x.reliability === 'official').at(-1)
      return s
        ? [
            {
              id: l.id,
              label: l.label,
              group: l.group,
              state: s.status,
              count: s.feature_count ?? undefined,
              message: s.error ?? undefined,
            } satisfies CollectProgress,
          ]
        : []
    })
  const grouped = LAYER_GROUP_ORDER.map((g) => ({ group: g, rows: rows.filter((r) => r.group === g) })).filter((g) => g.rows.length)

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
          <section className="block">
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
            {!config.key.trim() && <p className="notice error">설정에서 브이월드 인증키를 먼저 입력하세요.</p>}
            {site.radiusM >= 1000 && <p className="help">반경 1km는 건물이 수천 동일 수 있어 1분 정도 걸릴 수 있습니다.</p>}
            <button type="button" className="btn primary block" onClick={() => void run()} disabled={running || !config.key.trim()}>
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
          </section>
        )}

        {rows.length > 0 && (
          <section className="block">
            <h3>수집 항목</h3>
            {grouped.map((g) => (
              <div key={g.group} className="collect-group">
                <p className="collect-group-title">{g.group}</p>
                <ul className="collect-list">
                  {g.rows.map((r) => (
                    <li key={r.id} className={`state-${r.state}`}>
                      <span className="dot" aria-hidden="true" />
                      <span className="collect-label">{r.label}</span>
                      <span className="collect-state">
                        {r.state === 'ok' && r.count !== undefined ? `${fmt(r.count)}건` : STATE_LABEL[r.state]}
                      </span>
                      {r.message && <span className="collect-msg">{r.message}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="help">'해당 없음'은 오류가 아니라 대지·반경 안에 그 자료가 없다는 뜻입니다.</p>
          </section>
        )}

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
            sun,
          }}
          fit={fit}
          mode="click"
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
              {
                id: 'roads',
                label: '수집한 도로망',
                on: showRoads,
                onToggle: () => setShowRoads((v) => !v),
                disabled: roads.length === 0,
              },
              { id: 'sun', label: '태양 궤적', on: showSun, onToggle: () => setShowSun((v) => !v), disabled: !center },
            ]}
          />
          {((showBuildings && buildings.length > 0) || (showSun && center)) && (
            <div className="map-legend">
              {showBuildings && buildings.length > 0 && <FloorLegend />}
              {showSun && center && <SunLegend />}
            </div>
          )}
        </MapView>
      </section>
    </div>
  )
}
