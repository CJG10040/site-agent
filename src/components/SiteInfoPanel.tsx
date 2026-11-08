import { PARCEL_LAYER, SOURCE_NAME, type GeoFeature } from '../sources/vworld'

export interface ZoningHit {
  layerId: string
  layerLabel: string
  features: GeoFeature[]
}

export interface SiteInspection {
  lon: number
  lat: number
  loading: boolean
  address?: { road?: string; parcel?: string }
  parcels: GeoFeature[]
  /** 조회 자체가 실패한 경우 ('없음'과 구분) */
  parcelFailed: boolean
  zoning: ZoningHit[]
  zoningFailed: boolean
  errors: { what: string; message: string; hint: string }[]
  fetchedAt?: Date
}

interface Props {
  site: SiteInspection | null
}

function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

/** 용도지역 레이어의 이름 필드는 구현 시점에 실제 응답으로 확정해야 하므로 후보를 순서대로 찾는다. */
function zoningName(p: Record<string, unknown>): string {
  for (const k of ['uname', 'UNAME', 'dgm_nm', 'prpos_area_dstrc_nm', 'name']) {
    if (p[k]) return str(p[k])
  }
  return ''
}

function formatWon(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return ''
  return `${n.toLocaleString('ko-KR')} 원/㎡`
}

function RawProps({ props }: { props: Record<string, unknown> }) {
  return (
    <details className="raw">
      <summary>원본 속성 보기</summary>
      <table>
        <tbody>
          {Object.entries(props).map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{str(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

export default function SiteInfoPanel({ site }: Props) {
  if (!site) {
    return (
      <div className="panel-body">
        <p className="empty">지도에서 대지를 누르거나 주소를 검색하세요.</p>
      </div>
    )
  }

  const parcel = site.parcels[0]?.properties
  const zoningFound = site.zoning.filter((z) => z.features.length > 0)
  const time = site.fetchedAt?.toLocaleString('ko-KR')

  return (
    <div className="panel-body">
      <p className="coord">
        {site.lat.toFixed(6)}, {site.lon.toFixed(6)} <span className="muted">(WGS84 위도, 경도)</span>
      </p>

      {site.loading && <p className="loading">조회 중…</p>}

      {!site.loading && (
        <>
          <section className="info-block">
            <h3>주소</h3>
            {site.address?.road || site.address?.parcel ? (
              <dl>
                {site.address.road && (
                  <>
                    <dt>도로명</dt>
                    <dd>{site.address.road}</dd>
                  </>
                )}
                {site.address.parcel && (
                  <>
                    <dt>지번</dt>
                    <dd>{site.address.parcel}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="muted">주소 정보 없음</p>
            )}
          </section>

          <section className="info-block">
            <h3>필지</h3>
            {parcel ? (
              <>
                <dl>
                  {str(parcel.addr) && (
                    <>
                      <dt>소재지</dt>
                      <dd>{str(parcel.addr)}</dd>
                    </>
                  )}
                  {str(parcel.jibun) && (
                    <>
                      <dt>지번·지목</dt>
                      <dd>{str(parcel.jibun)}</dd>
                    </>
                  )}
                  {str(parcel.pnu) && (
                    <>
                      <dt>PNU</dt>
                      <dd className="mono">{str(parcel.pnu)}</dd>
                    </>
                  )}
                  {formatWon(parcel.jiga) && (
                    <>
                      <dt>공시지가</dt>
                      <dd>
                        {formatWon(parcel.jiga)}
                        {str(parcel.gosi_year) && (
                          <span className="muted">
                            {' '}
                            ({str(parcel.gosi_year)}년 {str(parcel.gosi_month)}월 기준)
                          </span>
                        )}
                      </dd>
                    </>
                  )}
                </dl>
                <RawProps props={parcel} />
              </>
            ) : site.parcelFailed ? (
              <p className="muted">조회하지 못했습니다. 아래 오류를 확인하세요.</p>
            ) : (
              <p className="muted">이 지점에서 필지를 찾지 못했습니다. (도로·하천 등일 수 있음)</p>
            )}
          </section>

          <section className="info-block">
            <h3>용도지역</h3>
            {zoningFound.length > 0 ? (
              zoningFound.map((z) => (
                <div key={z.layerId} className="zoning">
                  {z.features.map((f, i) => (
                    <div key={i}>
                      <p>
                        <strong>{zoningName(f.properties) || '(이름 필드 확인 필요)'}</strong>{' '}
                        <span className="muted">· {z.layerLabel}</span>
                      </p>
                      <RawProps props={f.properties} />
                    </div>
                  ))}
                </div>
              ))
            ) : site.zoningFailed ? (
              <p className="muted">조회하지 못했습니다. 아래 오류를 확인하세요.</p>
            ) : (
              <p className="muted">조회된 용도지역이 없습니다.</p>
            )}
          </section>

          {site.errors.length > 0 && (
            <div className="notice error">
              <strong>일부 정보를 가져오지 못했습니다.</strong>
              <ul>
                {site.errors.map((e, i) => (
                  <li key={i}>
                    {e.what}: {e.message}
                    {e.hint && <span className="hint"> — {e.hint}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="source">
            출처: {SOURCE_NAME} · 주소 API, 2D 데이터 API({PARCEL_LAYER.id} 외) · 조회 {time}
            <br />
            지적·용도지역은 참고용이며 법적 효력이 없습니다. 정확한 규제는 토지이음에서 확인하세요.
          </p>
        </>
      )}
    </div>
  )
}
