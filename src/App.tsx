import { useCallback, useRef, useState } from 'react'
import MapView, { type MapFocus } from './components/MapView'
import SettingsDialog from './components/SettingsDialog'
import SearchPanel from './components/SearchPanel'
import SiteInfoPanel, { type SiteInspection, type ZoningHit } from './components/SiteInfoPanel'
import DiagnosticsPanel from './components/DiagnosticsPanel'
import {
  BASE_MAPS,
  errorHint,
  featuresAtPoint,
  loadConfig,
  PARCEL_LAYER,
  reverseGeocode,
  saveConfig,
  VWorldError,
  ZONING_LAYERS,
  type BaseMap,
  type SearchHit,
  type VWorldConfig,
} from './sources/vworld'

type Tab = 'search' | 'site' | 'diag'

const TABS: { id: Tab; label: string }[] = [
  { id: 'search', label: '검색' },
  { id: 'site', label: '대지 정보' },
  { id: 'diag', label: '연결 진단' },
]

function describe(what: string, e: unknown) {
  const code = e instanceof VWorldError ? e.code : ''
  const message = e instanceof Error ? e.message : String(e)
  return { what, message: code ? `${code} — ${message}` : message, hint: errorHint(code) }
}

export default function App() {
  const [config, setConfig] = useState<VWorldConfig>(() => loadConfig())
  const [settingsOpen, setSettingsOpen] = useState(() => !loadConfig().key)
  const [storageBlocked, setStorageBlocked] = useState(false)
  const [baseMap, setBaseMap] = useState<BaseMap>('Base')
  const [tab, setTab] = useState<Tab>('search')
  const [focus, setFocus] = useState<MapFocus | null>(null)
  const [site, setSite] = useState<SiteInspection | null>(null)

  const configRef = useRef(config)
  configRef.current = config
  const requestSeq = useRef(0)

  /** 한 지점의 주소·필지·용도지역을 동시에 조회 */
  const inspect = useCallback(async (lon: number, lat: number) => {
    const cfg = configRef.current
    const seq = ++requestSeq.current
    setTab('site')
    setSite({ lon, lat, loading: true, parcels: [], parcelFailed: false, zoning: [], zoningFailed: false, errors: [] })

    const addressP = reverseGeocode(cfg, lon, lat)
    const parcelP = featuresAtPoint(cfg, PARCEL_LAYER.id, lon, lat, true)
    const zoningP = ZONING_LAYERS.map((l) => featuresAtPoint(cfg, l.id, lon, lat, false))

    // 모든 요청에 한꺼번에 결과 처리기를 붙여야 먼저 실패한 요청이 '처리되지 않은 오류'로 남지 않는다.
    const [[addressR, parcelR], zoningR] = await Promise.all([
      Promise.allSettled([addressP, parcelP]),
      Promise.allSettled(zoningP),
    ])
    if (seq !== requestSeq.current) return // 더 최근 클릭이 있으면 버린다

    const errors: { what: string; message: string; hint: string }[] = []
    if (addressR.status === 'rejected') errors.push(describe('주소', addressR.reason))
    if (parcelR.status === 'rejected') errors.push(describe(PARCEL_LAYER.label, parcelR.reason))

    const zoning: ZoningHit[] = []
    zoningR.forEach((r, i) => {
      const layer = ZONING_LAYERS[i]
      if (r.status === 'fulfilled') zoning.push({ layerId: layer.id, layerLabel: layer.label, features: r.value })
      else errors.push(describe(layer.label, r.reason))
    })

    // 키가 없을 때처럼 같은 오류가 여러 항목에서 나면 항목 이름을 묶어 한 줄로 보여 준다.
    const grouped = new Map<string, { what: string[]; message: string; hint: string }>()
    for (const e of errors) {
      const g = grouped.get(e.message)
      if (g) g.what.push(e.what)
      else grouped.set(e.message, { what: [e.what], message: e.message, hint: e.hint })
    }

    setSite({
      lon,
      lat,
      loading: false,
      address: addressR.status === 'fulfilled' ? addressR.value : undefined,
      parcels: parcelR.status === 'fulfilled' ? parcelR.value : [],
      parcelFailed: parcelR.status === 'rejected',
      zoning,
      zoningFailed: zoningR.every((r) => r.status === 'rejected'),
      errors: [...grouped.values()].map((g) => ({ what: g.what.join(', '), message: g.message, hint: g.hint })),
      fetchedAt: new Date(),
    })
  }, [])

  const pickSearchHit = useCallback(
    (hit: SearchHit) => {
      setFocus({ lon: hit.lon, lat: hit.lat, zoom: 18, seq: Date.now() })
      void inspect(hit.lon, hit.lat)
    },
    [inspect],
  )

  const handleSave = (next: VWorldConfig) => {
    const ok = saveConfig(next)
    setStorageBlocked(!ok)
    setConfig({ key: next.key.trim(), domain: next.domain.trim() })
    setSettingsOpen(false)
  }

  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>대지해석 에이전트</h1>
          <span className="phase">Phase 0 · 연결 확인</span>
        </div>
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={() => setSettingsOpen(true)}>
          설정
        </button>
      </header>

      {storageBlocked && (
        <div className="banner">
          이 브라우저에서는 저장이 막혀 있어 새로고침하면 인증키가 사라집니다. (사생활 보호 모드 등)
        </div>
      )}

      <main className="main">
        <aside className="sidebar">
          <nav className="tabs" role="tablist" aria-label="패널">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? 'active' : ''}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {tab === 'search' && <SearchPanel config={config} onPick={pickSearchHit} />}
          {tab === 'site' && <SiteInfoPanel site={site} />}
          {tab === 'diag' && <DiagnosticsPanel config={config} />}
        </aside>

        <section className="map-area">
          <MapView
            vworldKey={config.key}
            baseMap={baseMap}
            focus={focus}
            marker={site ? { lon: site.lon, lat: site.lat } : null}
            parcels={site?.parcels ?? []}
            onMapClick={(lon, lat) => void inspect(lon, lat)}
          />
          <div className="basemap-switch" role="radiogroup" aria-label="배경지도">
            {BASE_MAPS.map((b) => (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={baseMap === b.id}
                className={baseMap === b.id ? 'active' : ''}
                onClick={() => setBaseMap(b.id)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </section>
      </main>

      {settingsOpen && <SettingsDialog initial={config} onSave={handleSave} onClose={closeSettings} />}
    </div>
  )
}
