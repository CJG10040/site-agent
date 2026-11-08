import { FLOOR_CLASSES, FLOOR_UNKNOWN } from './mapStyles'

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
