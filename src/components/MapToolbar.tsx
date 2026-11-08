import type { ReactNode } from 'react'
import { BASE_MAPS, WMS_LAYERS, type BaseMap } from '../sources/vworld'

interface Props {
  baseMap: BaseMap
  onBaseMap: (b: BaseMap) => void
  wms: string[]
  onWms: (ids: string[]) => void
  /** 단계별 추가 레이어 토글 (태양 궤적, 수집한 건물 등) */
  extra?: { id: string; label: string; on: boolean; onToggle: () => void; disabled?: boolean }[]
  children?: ReactNode
}

export default function MapToolbar({ baseMap, onBaseMap, wms, onWms, extra = [], children }: Props) {
  const toggleWms = (id: string) => onWms(wms.includes(id) ? wms.filter((x) => x !== id) : [...wms, id])

  return (
    <div className="map-toolbar">
      <div className="basemap-switch" role="radiogroup" aria-label="배경지도">
        {BASE_MAPS.map((b) => (
          <button
            key={b.id}
            type="button"
            role="radio"
            aria-checked={baseMap === b.id}
            className={baseMap === b.id ? 'active' : ''}
            onClick={() => onBaseMap(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>
      <details className="layer-menu">
        <summary>레이어</summary>
        <div className="layer-menu-body">
          {extra.length > 0 && (
            <>
              <p className="layer-menu-title">분석</p>
              {extra.map((x) => (
                <label key={x.id} className={x.disabled ? 'disabled' : ''}>
                  <input type="checkbox" checked={x.on} disabled={x.disabled} onChange={x.onToggle} />
                  {x.label}
                </label>
              ))}
            </>
          )}
          <p className="layer-menu-title">브이월드 주제도 (확대 시 표시)</p>
          {WMS_LAYERS.map((l) => (
            <label key={l.id}>
              <input type="checkbox" checked={wms.includes(l.id)} onChange={() => toggleWms(l.id)} />
              {l.label}
            </label>
          ))}
        </div>
      </details>
      {children}
    </div>
  )
}
