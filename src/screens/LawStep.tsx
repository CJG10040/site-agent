// ⑪ 법규 검토 (2026-11-21 묶음 E3 → F1 다시): 앱이 항목마다 판정한 법규 검토서 한 표. 학생은 가볍게 재확인한다.
// 줄마다 항목 · 기준(한 줄) · 이 계획(앱이 낸 값) · 판정 · 가정(넣지 않은 값은 앱이 가정하고 밝힘) · 직접 확인(정말 모를 때만, 어디서 무엇을).
// 사용자 결정(2026-11-21, ⑪을 써 본 뒤): 법규 검토서 한 표 / 가정하고 판정 + 가정 표시 / 법 기준은 앱 규칙 + 법 바뀌면 경고 / 설계안 점검은 안 함.
// 그전 결정: 새 단계 ⑪ / 조례는 광주 + 전남·전북 모든 시·군 / 주용도 = 별표 1 큰 분류 + 자주 쓰는 세부 / 참고용(판정 아님).

import { booleanIntersects, feature, point, pointToPolygonDistance } from '@turf/turf'
import { ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { buildDiagramData } from '../diagrams/data'
import { siteZones } from '../diagrams/panelsLaw'
import { buildReview, planAssumed, reviewSummary, type Basis, type PlanKey, type ReviewRow } from '../law/checklist'
import { LAW_SOURCE, loadOrdinances, regionIdOf, regionOf, siteAddress, type OrdinanceTable } from '../law/ordinances'
import { USE_CLASSES, USE_SOURCE, useLabel } from '../law/uses'
import EnvelopePanel, { useEnvelope } from '../components/EnvelopePanel'
import { boundaryArea, parcelAreaOf, planInputOf } from '../law/envelopeData'
import { hasUnits, planOf, type Plan } from '../law/plan'
import { nowIso } from '../model/project'
import { panelNumber } from '../diagrams/panels'
import type { LawState, Project } from '../model/types'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  onGoData: () => void
  onGoDiagrams: () => void
}

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

/** 가정 글 → 고칠 칸 (넣으면 가정이 사라짐) */
function fieldFor(text: string): { id: string; label: string } | null {
  if (/연면적을 넣지/.test(text)) return { id: 'law-in-gfa', label: '연면적 넣기' }
  if (/층수를 넣지/.test(text)) return { id: 'law-in-floors', label: '층수 넣기' }
  if (/지하층을 넣지/.test(text)) return { id: 'law-in-basement', label: '지하 층수 넣기' }
  if (/세대수를 넣지/.test(text)) return { id: 'law-in-units', label: '세대수 넣기' }
  if (/세부 용도를 몰라/.test(text)) return { id: 'law-in-sub', label: '세부 용도 고르기' }
  if (/도로에 접한 변은 앱이/.test(text)) return { id: 'law-envelope', label: '평면도로' }
  return null
}

const PLAN_LABEL: Record<PlanKey, { name: string; id: string; text: (p: Plan) => string }> = {
  gfa: { name: '연면적', id: 'law-in-gfa', text: (p) => `${fmt(p.gfa?.v ?? 0)}㎡` },
  floors: { name: '지상 층수', id: 'law-in-floors', text: (p) => `${p.floors?.v ?? 0}층` },
  basement: { name: '지하 층수', id: 'law-in-basement', text: (p) => `${p.basement.v}층` },
  units: { name: '세대수', id: 'law-in-units', text: (p) => `${fmt(p.units?.v ?? 0)}세대` },
}

function focusField(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.focus({ preventScroll: true })
}

function ReviewLine({ r, plan, mine, memo, onMine, onMemo, table }: { r: ReviewRow; plan: Plan; mine: boolean; memo: string; onMine: (v: boolean) => void; onMemo: (v: string) => void; table: OrdinanceTable | null }) {
  const usedAssumed = (r.uses ?? []).filter((k) => planAssumed(plan, k))
  return (
    <article className={`law-row tone-${r.verdict.tone}${mine ? ' mine' : ''}`}>
      <div className="law-row-main">
        <div className="c-item">
          <label className="law-mine" title="다시 확인했으면 표시">
            <input type="checkbox" checked={mine} onChange={(e) => onMine(e.target.checked)} />
            <span>{r.item}</span>
          </label>
        </div>
        <div className="c-rule">
          <span className="law-cell-label">기준</span>
          {r.rule}
        </div>
        <div className="c-result">
          <span className="law-cell-label">이 계획</span>
          {r.result}
          {r.cite && <span className="law-cite">근거 줄: {r.cite}</span>}
        </div>
        <div className="c-verdict">
          <span className={`law-verdict tone-${r.verdict.tone}`}>{r.verdict.label}</span>
        </div>
      </div>
      {(r.check || (r.assumed?.length ?? 0) > 0 || usedAssumed.length > 0 || (r.changed?.length ?? 0) > 0) && (
        <div className="law-row-notes">
          {r.changed?.map((c) => (
            <p key={c} className="law-changed">
              <span className="law-chip warn">법 바뀜</span> 이 줄의 규칙을 만든 뒤(2026-11-21) 글이 바뀜: {c} — 판정이 맞는지 아래 근거 조문에서 확인하세요
            </p>
          ))}
          {r.check && (
            <p className="law-check">
              <span className="law-chip check">직접 확인</span> {r.check}
            </p>
          )}
          {usedAssumed.length > 0 && (
            <p className="law-assume">
              <span className="law-chip">가정</span> 가정한 계획 값으로 판정: {usedAssumed.map((k) => `${PLAN_LABEL[k].name} ${PLAN_LABEL[k].text(plan)}`).join(' · ')}
              <button type="button" className="link-btn small" onClick={() => focusField(PLAN_LABEL[usedAssumed[0]].id)}>
                넣기
              </button>
            </p>
          )}
          {r.assumed?.map((a) => {
            const f = fieldFor(a)
            return (
              <p key={a} className="law-assume">
                <span className="law-chip">가정</span> {a}
                {f && (
                  <button type="button" className="link-btn small" onClick={() => focusField(f.id)}>
                    {f.label}
                  </button>
                )}
              </p>
            )
          })}
        </div>
      )}
      <details className="law-row-more small">
        <summary>근거 조문{r.source ? ' · 원문' : ''} · 메모</summary>
        <div className="law-bases">
          {r.basis.map((b) => (
            <BasisLink key={b.label} b={b} table={table} />
          ))}
        </div>
        {r.source && (
          <details className="law-ordinance">
            <summary>{r.source.label} 원문 펼치기</summary>
            <pre>{r.source.text}</pre>
            <a href={r.source.url} target="_blank" rel="noreferrer">
              원문 <ExternalLink size={12} aria-hidden="true" />
            </a>
          </details>
        )}
        <input className="law-memo" type="text" aria-label={`${r.item} 메모`} placeholder="메모 (확인한 곳·담당 부서 답 등)" value={memo} onChange={(e) => onMemo(e.target.value)} />
      </details>
    </article>
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
  // 도판·모형과 같은 면적 (필지 대지면 토지대장 합, 그린 경계면 도형 넓이)
  const siteArea = useMemo(() => parcelAreaOf(project) ?? boundaryArea(data), [data, project.site])
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
  // 계획 값 — 넣지 않은 것은 앱이 가정 (도판·모형도 같은 가정)
  const planInput = planInputOf(project)
  const planKey = JSON.stringify(planInput)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => planOf(planInput, siteArea, zones, region), [planKey, siteArea, zones, region])
  const env = useEnvelope(data, zones, siteArea, region, table ?? null, project)
  const rows = useMemo(
    () =>
      buildReview({
        zones,
        siteArea,
        overlays,
        plan,
        table: table ?? null,
        region,
        env: env.result ? env : null,
        floorH: law.envelope?.floorH ?? 3.5,
        maxHeight: law.envelope?.maxHeight,
        schools,
      }),
    [zones, siteArea, overlays, plan, table, region, env, law.envelope?.floorH, law.envelope?.maxHeight, schools],
  )
  const mine: Record<string, boolean> = Object.fromEntries(Object.entries(law.checks ?? {}).map(([k, v]) => [k, v.status === 'ok']))
  const sum = reviewSummary(rows, mine, plan)
  const planAssumptions = (['gfa', 'floors', 'basement', 'units'] as PlanKey[]).filter((k) => planAssumed(plan, k))
  const groups = [...new Set(rows.map((r) => r.group))]

  const patchLaw = (fn: (l: LawState) => LawState) =>
    update((d) => {
      d.law = fn(d.law ?? {})
    })
  const setMine = (id: string, v: boolean) => patchLaw((l) => ({ ...l, checks: { ...(l.checks ?? {}), [id]: { ...(l.checks?.[id] ?? {}), status: v ? 'ok' : 'todo', at: nowIso() } } }))
  const setMemo = (id: string, memo: string) => patchLaw((l) => ({ ...l, checks: { ...(l.checks ?? {}), [id]: { status: l.checks?.[id]?.status ?? 'todo', at: nowIso(), memo } } }))
  const num = (v: string) => (v.trim() === '' ? undefined : Math.max(0, Number(v) || 0))

  const useClass = USE_CLASSES.find((u) => u.no === law.use?.no)
  const ordinanceAge = table ? Math.floor((Date.now() - new Date(table.checkedAt).getTime()) / 86400000) : null
  const integrated = region && /통합특별시/.test(region.province)

  return (
    <div className="form-page wide law-page">
      <header className="form-head">
        <p className="eyebrow">11 법규 검토</p>
        <h2>법규 검토서</h2>
        <p className="muted">
          주용도와 대략 규모를 넣으면 앱이 항목마다 <strong>기준 · 이 계획 값 · 판정</strong>을 냅니다. 넣지 않은 값은 앱이 가정하고 <strong>가정</strong>으로 밝히니, 가정을 보고
          맞으면 표시만 하세요. 정말 알 수 없는 것만 <strong>직접 확인</strong>으로 어디서 무엇을 볼지 적었습니다. 참고용이며 법적 판정이 아닙니다.
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

        <div className="law-plan" id="law-plan">
          <h3>계획</h3>
          <label className="field">
            <span className="label">주용도</span>
            <select value={law.use?.no ?? ''} onChange={(e) => patchLaw((l) => ({ ...l, use: e.target.value ? { no: e.target.value } : undefined }))}>
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
              <select id="law-in-sub" value={law.use?.sub ?? ''} onChange={(e) => patchLaw((l) => ({ ...l, use: { no: l.use!.no, sub: e.target.value || undefined } }))}>
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
              <span className="label">연면적</span>
              <input id="law-in-gfa" type="number" min={0} step={100} value={law.gfa ?? ''} placeholder={plan.gfa?.assumed ? `가정 ${fmt(plan.gfa.v)}` : ''} onChange={(e) => patchLaw((l) => ({ ...l, gfa: num(e.target.value) }))} />
              <span className="muted small">㎡</span>
            </label>
            <label className="num-field">
              <span className="label">지상 층수</span>
              <input id="law-in-floors" type="number" min={1} max={200} value={law.floors ?? ''} placeholder={plan.floors?.assumed ? `가정 ${plan.floors.v}` : ''} onChange={(e) => patchLaw((l) => ({ ...l, floors: num(e.target.value) }))} />
              <span className="muted small">층</span>
            </label>
            <label className="num-field">
              <span className="label">지하 층수</span>
              <input id="law-in-basement" type="number" min={0} max={20} value={law.basement ?? ''} placeholder={plan.basement.assumed ? '가정 0' : ''} onChange={(e) => patchLaw((l) => ({ ...l, basement: num(e.target.value) }))} />
              <span className="muted small">층</span>
            </label>
            {hasUnits(law.use) && (
              <label className="num-field">
                <span className="label">세대수</span>
                <input id="law-in-units" type="number" min={1} step={10} value={law.units ?? ''} placeholder={plan.units?.assumed ? `가정 ${fmt(plan.units.v)}` : ''} onChange={(e) => patchLaw((l) => ({ ...l, units: num(e.target.value) }))} />
                <span className="muted small">세대</span>
              </label>
            )}
          </div>
          <p className="muted small">
            비운 칸은 앱이 가정한 값(흐린 글)으로 판정합니다. 용도 목록:{' '}
            <a href={USE_SOURCE.url} target="_blank" rel="noreferrer">
              {USE_SOURCE.label}
            </a>{' '}
            · 지금: {useLabel(law.use)}
          </p>
        </div>
      </section>

      <div className="law-summary" role="status">
        <span>
          {rows.length}줄 · <strong>앱 판정 {sum.decided}</strong> (가정 들어간 줄 {sum.assumed}) · 직접 확인 {sum.check} · 내가 다시 확인 {sum.mine}/{rows.length}
          {sum.changed > 0 && <span className="law-warn"> · 법 바뀜 {sum.changed}줄</span>}
        </span>
        <span className="spacer" />
        <button type="button" className="link-btn small" onClick={onGoDiagrams}>
          도판 {panelNumber('law')}·{panelNumber('envelope')} 법규 개요·가능 영역 보기
        </button>
      </div>

      {planAssumptions.length > 0 && (
        <section className="law-assumed-plan" aria-label="가정한 계획 값">
          <h3>가정한 계획 값</h3>
          <p className="muted small">넣지 않은 값은 아래처럼 가정해 판정했습니다. 다르면 위 '계획' 칸에 넣으세요 — 모든 줄이 바로 다시 판정됩니다.</p>
          <ul>
            {planAssumptions.map((k) => (
              <li key={k}>
                <strong>
                  {PLAN_LABEL[k].name} {PLAN_LABEL[k].text(plan)}
                </strong>{' '}
                <span className="muted">— {planAssumed(plan, k)}</span>{' '}
                <button type="button" className="link-btn small" onClick={() => focusField(PLAN_LABEL[k].id)}>
                  넣기
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="law-review" aria-label="법규 검토서">
        <div className="law-review-head" aria-hidden="true">
          <span>항목</span>
          <span>기준</span>
          <span>이 계획</span>
          <span>판정</span>
        </div>
        {groups.map((g) => (
          <div key={g} className="law-review-group">
            <h3>{g}</h3>
            {rows
              .filter((r) => r.group === g)
              .map((r) => (
                <ReviewLine key={r.id} r={r} plan={plan} mine={!!mine[r.id]} memo={law.checks?.[r.id]?.memo ?? ''} onMine={(v) => setMine(r.id, v)} onMemo={(v) => setMemo(r.id, v)} table={table ?? null} />
              ))}
          </div>
        ))}
      </section>

      {data && <EnvelopePanel project={project} update={update} data={data} zones={zones} siteArea={siteArea} overlays={overlays} region={region} run={env} />}

      <p className="muted small law-foot">
        참고용 검토서입니다 — 법적 판정이 아니며, 허가 전에는 해당 지자체 담당 부서·전문가에게 확인하세요. 판정은 넣은 값과 '가정'에 따라 달라집니다. {LAW_SOURCE}
      </p>
    </div>
  )
}
