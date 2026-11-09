import { DENSITY_CLASSES, DENSITY_UNKNOWN, FLOOR_CLASSES, FLOOR_UNKNOWN } from './mapStyles'

export function DensityLegend({ year }: { year?: number | string }) {
  return (
    <div className="legend-item">
      <p className="legend-title">집계구 인구밀도 (명/㎢{year ? `, ${year}년` : ''})</p>
      <ul className="legend-list">
        {[...DENSITY_CLASSES, DENSITY_UNKNOWN].map((c) => (
          <li key={c.id}>
            <i style={{ background: c.color }} /> {c.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SunLegend() {
  return (
    <div className="legend-item">
      <p className="legend-title">태양 궤적 (한국 표준시)</p>
      <p className="legend-row">
        <i style={{ background: '#e8590c' }} /> 하지 <i style={{ background: '#e0a100' }} /> 춘·추분{' '}
        <i style={{ background: '#1c7ed6' }} /> 동지
      </p>
      <p className="muted small">바깥 원이 지평선, 중심에 가까울수록 높은 태양</p>
    </div>
  )
}

export function FloorLegend() {
  return (
    <div className="legend-item">
      <p className="legend-title">건물 지상층수</p>
      <ul className="legend-list">
        {[...FLOOR_CLASSES, FLOOR_UNKNOWN].map((c) => (
          <li key={c.id}>
            <i style={{ background: c.color }} /> {c.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 덧그린 수집 자료의 범례 (색 + 모양) */
export function OverlayLegend({ title, entries }: { title: string; entries: { color: string; label: string; shape?: 'square' | 'circle' | 'area' }[] }) {
  if (entries.length === 0) return null
  return (
    <div className="legend-item">
      <p className="legend-title">{title}</p>
      <ul className="legend-list">
        {entries.map((e) => (
          <li key={e.label}>
            <i
              className={`legend-shape ${e.shape ?? 'area'}`}
              style={e.shape === 'area' || !e.shape ? { background: `${e.color}33`, borderColor: e.color } : { background: e.color }}
            />{' '}
            {e.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
