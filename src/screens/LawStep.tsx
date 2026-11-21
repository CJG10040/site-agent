// ⑪ 법규 검토 (2026-11-21 묶음 E3): 주용도·대략 규모를 넣으면 해당 법 항목만 추린 체크리스트.
// 항목마다 확인할 것 · 이 대지 값(수집 자료·조례 표) · 근거 조문 링크 · 내 확인 상태(확인함·해당 없음·확인 필요).
// 사용자 결정: 새 단계 ⑪ / 조례는 광주 + 전남·전북 모든 시·군 / 주용도 = 별표 1 큰 분류 + 자주 쓰는 세부 / 참고용(판정 아님).

import { area, booleanIntersects, feature, point, pointToPolygonDistance } from '@turf/turf'
import { ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { buildDiagramData } from '../diagrams/data'
import { siteZones } from '../diagrams/panelsLaw'
import { buildChecklist, checklistSummary, STATUS_LABEL, type Basis, type CheckStatus } from '../law/checklist'
import { LAW_SOURCE, loadOrdinances, regionIdOf, regionOf, siteAddress, type OrdinanceTable } from '../law/ordinances'
import { USE_CLASSES, USE_SOURCE, useLabel } from '../law/uses'
import { nowIso } from '../model/project'
import type { LawState, Project } from '../model/types'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  onGoData: () => void
  onGoDiagrams: () => void
}

const STATUS_ORDER: CheckStatus[] = ['todo', 'ok', 'na']
const fmt = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 0 })
const ymd = (s: string | undefined) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s ?? '')

/** 근거 링크 + 받아 둔 조문 글 펼치기 */
function BasisLink({ b, table }: { b: Basis; table: OrdinanceTable | null }) {
  const [open, setOpen] = useState(false)
  const lawRec = b.law ? table?.laws?.[b.law] : undefined
  const art = b.article ? lawRec?.articles?.[b.article] : undefined
  return (
    <span className="law-basis">
      <a href={b.url} target="_blank" rel="noreferrer">
        {b.label}
        <ExternalLink size={12} aria-hidden="true" />
      </a>
      {art && (
        <button type="button" className="link-btn small" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? '조문 접기' : '조문 보기'}
        </button>
      )}
      {open && art && (
        <span className="law-article small">
          <strong>
            {b.law} {b.article}({art.title})
          </strong>
          {lawRec?.effective && <span className="muted"> · 시행 {ymd(lawRec.effective)}</span>}
          <span className="law-article-text">{art.text}</span>
        </span>
      )}
    </span>
  )
}

export default function LawStep({ project, update, onGoData, onGoDiagrams }: Props) {
  const [table, setTable] = useState<OrdinanceTable | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    void loadOrdinances().then((t) => alive && setTable(t))
    return () => {
      alive = false
    }
  }, [])

  // 대지 자료 (용도지역·지구·구역·면적) — 수집 자료가 바뀔 때만
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => buildDiagramData(project), [project.collected, project.site, project.collectedAt])
  const zones = useMemo(() => (data ? siteZones(data) : []), [data])
  const siteArea = useMemo(() => {
    if (project.site.parcels.length && project.site.boundaryMode !== 'drawn') return project.site.parcels.reduce((s, p) => s + (p.areaM2 || 0), 0)
    try {
      return data ? area(feature(data.boundary)) : 0
    } catch {
      return 0
    }
  }, [data, project.site])
  const overlays = useMemo(() => {
    if (!data) return []
    const names = new Set<string>()
    for (const x of data.districts) {
      try {
        if (booleanIntersects(feature(x.geom), feature(data.boundary))) names.add(x.name)
      } catch {
        /* 계산 실패한 도형은 건너뜀 */
      }
    }
    return [...names]
  }, [data])

  // 학교(SC4)·어린이집·유치원(PS3)까지 대지 경계에서 거리 — 교육환경보호구역 (위치 점 기준 어림)
  const schools = useMemo(() => {
    if (!data) return []
    const out: { name: string; kind: string; dist: number }[] = []
    for (const p of data.pois) {
      if (p.kind !== 'SC4' && p.kind !== 'PS3') continue
      try {
        const b = data.boundary
        const polys = b.type === 'Polygon' ? [b] : b.coordinates.map((c) => ({ type: 'Polygon' as const, coordinates: c }))
        const d = Math.min(...polys.map((poly) => pointToPolygonDistance(point([p.lon, p.lat]), poly, { units: 'meters' })))
        if (d <= 300) out.push({ name: p.name, kind: p.kind, dist: Math.max(0, d) })
      } catch {
        /* 계산 실패는 건너뜀 */
      }
    }
    return out.sort((a, b) => a.dist - b.dist)
  }, [data])

  const law: LawState = project.law ?? {}
  const region = table ? regionOf(table, project) : null
  const regionId = regionIdOf(project)
  const items = useMemo(
    () =>
      buildChecklist({
        zones,
        siteArea,
        overlays,
        use: law.use ?? null,
        floors: law.floors ?? null,
        basement: law.basement ?? null,
        gfa: law.gfa ?? null,
        table: table ?? null,
        region,
        schools,
      }),
    [zones, siteArea, overlays, law.use, law.floors, law.basement, law.gfa, table, region, schools],
  )
  const status: Record<string, CheckStatus | undefined> = Object.fromEntries(Object.entries(law.checks ?? {}).map(([k, v]) => [k, v.status]))
  const sum = checklistSummary(items, status)
  const groups = [...new Set(items.map((i) => i.group))]

  const patchLaw = (fn: (l: LawState) => LawState) =>
    update((d) => {
      d.law = fn(d.law ?? {})
    })
  const setStatus = (id: string, s: CheckStatus) => patchLaw((l) => ({ ...l, checks: { ...(l.checks ?? {}), [id]: { ...(l.checks?.[id] ?? {}), status: s, at: nowIso() } } }))
  const setMemo = (id: string, memo: string) => patchLaw((l) => ({ ...l, checks: { ...(l.checks ?? {}), [id]: { status: l.checks?.[id]?.status ?? 'todo', at: nowIso(), memo } } }))
  const num = (v: string) => (v.trim() === '' ? undefined : Math.max(0, Number(v) || 0))

  const useClass = USE_CLASSES.find((u) => u.no === law.use?.no)
  const ordinanceAge = table ? Math.floor((Date.now() - new Date(table.checkedAt).getTime()) / 86400000) : null
  const integrated = region && /통합특별시/.test(region.province)

  return (
    <div className="form-page wide law-page">
      <header className="form-head">
        <p className="eyebrow">11 법규 검토</p>
        <h2>법규 검토 체크리스트</h2>
        <p className="muted">
          주용도와 대략 규모를 넣으면 해당하는 법 항목만 추립니다. 항목마다 <strong>확인할 것 · 이 대지 값 · 근거 조문</strong>을 보고 확인 상태를 표시하세요. 자료로 알 수 없는 것은 '확인 필요'로 둡니다.
          참고용이며 법적 판정이 아닙니다.
        </p>
      </header>

      {!project.collectedAt && (
        <p className="notice">
          아직 공간정보를 수집하지 않아 용도지역을 모릅니다.{' '}
          <button type="button" className="link-btn" onClick={onGoData}>
            공간정보 수집
          </button>
        </p>
      )}

      <section className="law-site">
        <div>
          <h3>대지와 조례</h3>
          <dl>
            <div>
              <dt>주소</dt>
              <dd>{siteAddress(project).split(' / ')[0] || '주소 없음'}</dd>
            </div>
            <div>
              <dt>용도지역</dt>
              <dd>{zones.length ? zones.map((z) => `${z.rule?.label ?? z.name}${zones.length > 1 ? ` ${Math.round(z.share * 100)}%` : ''}`).join(', ') : '자료 없음'}</dd>
            </div>
            <div>
              <dt>대지 면적</dt>
              <dd>{siteArea ? `${fmt(siteArea)}㎡` : '모름'}</dd>
            </div>
            <div>
              <dt>지구·구역</dt>
              <dd>{overlays.length ? overlays.join(', ') : '찾은 것 없음'}</dd>
            </div>
            <div>
              <dt>적용 조례</dt>
              <dd>
                {table === undefined ? (
                  '조례 표 읽는 중…'
                ) : !table ? (
                  <span className="law-warn">조례 표가 아직 없습니다 (사이트 배포 때 받아 옴) — 국가 법 상한만 보여 줍니다</span>
                ) : region ? (
                  <>
                    {region.org}
                    {region.urban && (
                      <>
                        {' · '}
                        <a href={region.urban.url} target="_blank" rel="noreferrer">
                          {region.urban.name}
                        </a>
                        <span className="muted small"> (시행 {ymd(region.urban.effective)})</span>
                      </>
                    )}
                    {region.building && (
                      <>
                        {' · '}
                        <a href={region.building.url} target="_blank" rel="noreferrer">
                          {region.building.name}
                        </a>
                        <span className="muted small"> (시행 {ymd(region.building.effective)})</span>
                      </>
                    )}
                    {region.stale && <span className="law-warn small"> 이번에 다시 받지 못해 지난 표를 씀</span>}
                  </>
                ) : (
                  <span className="law-warn">
                    {regionId ? '이 지역의 조례가 표에 없습니다' : '대지 주소로 지역을 찾지 못함 (조례 표는 광주·전남·전북)'} — 국가 법 상한만 보여 줍니다
                  </span>
                )}
              </dd>
            </div>
          </dl>
          {region?.issues.length ? (
            <details className="law-issues small">
              <summary>조례 표에서 읽지 못한 것 {region.issues.length}</summary>
              <ul>
                {region.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {integrated && table?.transition && (
            <details className="law-issues small">
              <summary>광주·전남 통합(2026-07-01) 뒤 종전 조례 적용 — {table.transition.law}</summary>
              {table.transition.excerpts
                .filter((e) => /조례/.test(e))
                .map((e) => (
                  <p key={e.slice(0, 40)}>{e}</p>
                ))}
              <a href={table.transition.url} target="_blank" rel="noreferrer">
                특별법 원문 <ExternalLink size={12} aria-hidden="true" />
              </a>
            </details>
          )}
          <p className="muted small law-source">
            {LAW_SOURCE}
            {table && ` · 조례 표 받은 날 ${table.checkedAt.slice(0, 10)}${ordinanceAge !== null && ordinanceAge > 14 ? ` (${ordinanceAge}일 전)` : ''}`}
          </p>
        </div>

        <div className="law-plan">
          <h3>계획</h3>
          <label className="field">
            <span className="label">주용도</span>
            <select
              value={law.use?.no ?? ''}
              onChange={(e) => patchLaw((l) => ({ ...l, use: e.target.value ? { no: e.target.value } : undefined }))}
            >
              <option value="">고르세요</option>
              {USE_CLASSES.map((u) => (
                <option key={u.no} value={u.no}>
                  {u.no}. {u.name}
                </option>
              ))}
            </select>
          </label>
          {useClass?.subs && (
            <label className="field">
              <span className="label">세부 용도</span>
              <select value={law.use?.sub ?? ''} onChange={(e) => patchLaw((l) => ({ ...l, use: { no: l.use!.no, sub: e.target.value || undefined } }))}>
                <option value="">{useClass.name} (세부 모름)</option>
                {useClass.subs.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="law-plan-nums">
            <label className="num-field">
              <span className="label">지상 층수</span>
              <input type="number" min={1} max={200} value={law.floors ?? ''} onChange={(e) => patchLaw((l) => ({ ...l, floors: num(e.target.value) }))} />
              <span className="muted small">층</span>
            </label>
            <label className="num-field">
              <span className="label">지하 층수</span>
              <input type="number" min={0} max={20} value={law.basement ?? ''} onChange={(e) => patchLaw((l) => ({ ...l, basement: num(e.target.value) }))} />
              <span className="muted small">층</span>
            </label>
            <label className="num-field">
              <span className="label">연면적</span>
              <input type="number" min={0} step={100} value={law.gfa ?? ''} onChange={(e) => patchLaw((l) => ({ ...l, gfa: num(e.target.value) }))} />
              <span className="muted small">㎡</span>
            </label>
          </div>
          <p className="muted small">
            용도 목록:{' '}
            <a href={USE_SOURCE.url} target="_blank" rel="noreferrer">
              {USE_SOURCE.label}
            </a>{' '}
            · 지금: {useLabel(law.use)}
          </p>
        </div>
      </section>

      <div className="law-summary" role="status">
        <span>
          항목 {items.length}개 · <strong>확인함 {sum.ok}</strong> · 해당 없음 {sum.na} · 확인 필요 {sum.todo}
        </span>
        <span className="spacer" />
        <button type="button" className="link-btn small" onClick={onGoDiagrams}>
          도판 7 법규 개요 보기
        </button>
      </div>

      {groups.map((g) => (
        <section key={g} className="law-group">
          <h3>{g}</h3>
          {items
            .filter((i) => i.group === g)
            .map((it) => {
              const st = status[it.id] ?? 'todo'
              return (
                <article key={it.id} className={`law-item status-${st}`}>
                  <div className="law-item-head">
                    <h4>{it.title}</h4>
                    <div className="segmented small" role="radiogroup" aria-label={`${it.title} 확인 상태`}>
                      {STATUS_ORDER.map((s) => (
                        <button key={s} type="button" role="radio" aria-checked={st === s} className={st === s ? 'on' : ''} onClick={() => setStatus(it.id, s)}>
                          {STATUS_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="law-what">{it.what}</p>
                  <ul className="law-values">
                    {it.values.map((v, i) => (
                      <li key={i}>{v}</li>
                    ))}
                  </ul>
                  <div className="law-bases small">
                    <span className="muted">근거</span>
                    {it.basis.map((b) => (
                      <BasisLink key={b.label} b={b} table={table ?? null} />
                    ))}
                  </div>
                  {it.ordinanceText && (
                    <details className="law-ordinance small">
                      <summary>{it.ordinanceText.label} 글 펼치기</summary>
                      <pre>{it.ordinanceText.text}</pre>
                      <a href={it.ordinanceText.url} target="_blank" rel="noreferrer">
                        조례 원문 <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    </details>
                  )}
                  <input
                    className="law-memo"
                    type="text"
                    aria-label={`${it.title} 메모`}
                    placeholder="메모 (확인한 곳·담당 부서 답 등)"
                    value={law.checks?.[it.id]?.memo ?? ''}
                    onChange={(e) => setMemo(it.id, e.target.value)}
                  />
                </article>
              )
            })}
        </section>
      ))}

      <p className="muted small law-foot">
        참고용 체크리스트입니다 — 법적 판정이 아니며, 허가 전에는 해당 지자체 담당 부서·전문가에게 확인하세요. 지구단위계획·가로구역 높이·문화유산·교육환경 등은 이 표에 없거나 일부만 있습니다. {LAW_SOURCE}
      </p>
    </div>
  )
}
