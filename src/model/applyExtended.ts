// Phase 2 확장 수집 → 출처 기록 + 사실·미확인 카드 초안
//  - 토지: 브이월드 부동산 개방데이터 (토지대장 면적, 토지이용계획, 토지특성, 공시지가·토지이동 이력)
//  - 건축물대장: 공공데이터포털 건축HUB (대지 + 맞닿은 필지)
//  - 인구·가구·사업체: 통계청 SGIS (행정동 추이 + 집계구)

import { point } from '@turf/turf'
import { centerOf, intersects } from '../lib/geo'
import type { LandOutcome, LandParcelResult, RegisterOutcome, SgisOutcome } from '../sources/collect'
import { publicHubUrl, pnuToParams } from '../sources/buildingRegister'
import { SGIS_PUBLIC_BASE } from '../sources/sgis'
import { SOURCE_NAME } from '../sources/vworld'
import { LAND_DATASETS } from '../sources/vworldLand'
import { VWORLD_LICENSE, type FactContext } from './applyCollection'
import { changePct, cleanNames, countBy, fmt, listText, median, pct, str, uniq, won } from './textUtil'

const SGIS_NAME = '통계청 SGIS 오픈API'
const SGIS_LICENSE = '통계청 SGIS 오픈API 이용약관에 따름 (출처 표기 필요)'
const HUB_NAME = '공공데이터포털 — 국토교통부 건축HUB 건축물대장정보'
const HUB_LICENSE = '공공데이터포털 이용허락범위에 따름 (출처 표기 필요)'

function n(v: unknown): number | null {
  const x = Number(str(v).replace(/,/g, ''))
  return Number.isFinite(x) && str(v) !== '' ? x : null
}

function jibunOf(addr: string): string {
  return addr.split(/\s+/).at(-1) ?? addr
}

// ───────────────────────── 토지 ─────────────────────────

/** 도로 접면 구분의 뜻 (토지특성 조사 기준) */
function roadSideGloss(v: string): string {
  if (v.startsWith('광대')) return '폭 25m 이상 도로'
  if (v.startsWith('중로')) return '폭 12~25m 도로'
  if (v.startsWith('소로')) return '폭 8~12m 도로'
  if (v.startsWith('세로') && v.includes('(가)')) return '폭 8m 미만·차량 통행 가능 도로'
  if (v.startsWith('세로') && v.includes('(불)')) return '차량 통행이 어려운 좁은 도로'
  if (v.startsWith('맹지')) return '도로에 접하지 않음'
  return ''
}

function latestBy(items: Record<string, unknown>[], yearField: string): Record<string, unknown> | null {
  let best: Record<string, unknown> | null = null
  for (const it of items) if (!best || str(it[yearField]) > str(best[yearField])) best = it
  return best
}

export function addLandFacts(ctx: FactContext, land: LandOutcome): void {
  const { project, push } = ctx
  const site = project.site
  const isParcels = site.boundaryMode === 'parcels'
  const src: Record<string, string> = {}

  for (const d of LAND_DATASETS) {
    const ds = land.datasets[d.id]
    if (!ds) continue
    const withData = ds.parcels.filter((p) => p.items.length > 0)
    const failed = ds.parcels.filter((p) => p.error)
    const years = withData.flatMap((p) => p.items.map((it) => str(it.stdrYear))).filter(Boolean).sort()
    const usedOld = withData.some((p) => p.usedPnu !== p.pnu)
    project.collected[d.id] = {
      dataset_id: d.id,
      retrieved_at: land.retrievedAt,
      features: withData.flatMap((p) => p.items.map((it) => ({ type: 'Feature' as const, geometry: null, properties: { ...it, _pnu: p.pnu } }))),
    }
    src[d.id] = ctx.newSource({
      source_name: SOURCE_NAME,
      dataset_name: d.label,
      dataset_id: d.id,
      retrieved_at: land.retrievedAt,
      update_date: null,
      geometry: '대지 필지',
      coordinate_system: '—',
      spatial_scale: '필지',
      time_range: years.length ? `${years[0]}~${years.at(-1)}년` : null,
      raw_ref: withData.length ? d.id : null,
      normalized_value: null,
      unit: null,
      license: VWORLD_LICENSE,
      limitations: d.limitations + (usedOld ? ' 일부 필지는 행정통합 이전 필지번호로 조회됨.' : ''),
      original_url: ds.url,
      reliability: 'official',
      feature_count: withData.length,
      status: failed.length === ds.parcels.length && ds.parcels.length > 0 ? 'error' : withData.length ? 'ok' : 'empty',
      error: failed[0]?.error ?? null,
    })
  }

  const parcelsOf = (id: string): LandParcelResult[] => land.datasets[id]?.parcels.filter((p) => p.items.length > 0) ?? []

  // 1) 토지대장 면적과 지적도 계산 면적 비교
  const ladfrl = parcelsOf('ned:ladfrl')
  if (ladfrl.length > 0) {
    const sum = ladfrl.reduce((s, p) => s + (n(p.items[0].lndpclAr) ?? 0), 0)
    push({
      auto_key: 'land-official-area',
      topic: '대지 규모',
      text: isParcels
        ? `토지대장상 대지 면적은 ${fmt(sum, 1)}㎡(약 ${fmt(sum / 3.3058)}평, ${ladfrl.length}필지 합계)이다.`
        : `직접 그린 경계에 걸친 ${ladfrl.length}필지의 토지대장 면적 합계는 ${fmt(sum, 1)}㎡이다 (필지 전체 면적이며 경계 안 면적과 다르다).`,
      sources: [src['ned:ladfrl']],
    })
    if (isParcels && sum > 0 && ladfrl.length === site.parcels.length) {
      const diff = Math.abs(sum - ctx.areaValue) / sum
      if (diff > 0.03) {
        push({
          auto_key: 'conflict-area',
          topic: '데이터 충돌',
          text: `지적도 도형으로 계산한 면적(약 ${fmt(ctx.areaValue)}㎡)과 토지대장 면적(${fmt(sum, 1)}㎡)이 ${fmt(diff * 100, 1)}% 차이 난다. 설계의 대지 면적은 토지대장을 기준으로 확인해야 한다.`,
          sources: [src['ned:ladfrl']],
          confidence: 'medium',
          human_validation_required: true,
        })
      }
    }
  }

  // 2) 토지이용계획
  const landUse = parcelsOf('ned:landUse')
  if (landUse.length > 0) {
    const byName = new Map<string, Set<string>>()
    for (const p of landUse) {
      for (const it of p.items) {
        const name = str(it.prposAreaDstrcCodeNm)
        if (!name) continue
        const set = byName.get(name) ?? new Set<string>()
        set.add(str(it.cnflcAtNm) || '포함')
        byName.set(name, set)
      }
    }
    const entries = [...byName.entries()].map(([name, kinds]) => {
      const k = [...kinds].filter((x) => x !== '포함')
      return k.length ? `${name}(${k.join('·')})` : name
    })
    push({
      auto_key: 'land-use-plan',
      topic: '용도지역',
      text: `토지이용계획(필지 기준)상 대지에 지정된 지역·지구 등은 ${cleanNames(entries).join(', ')}이다.`,
      sources: [src['ned:landUse']],
    })
    for (const name of byName.keys()) {
      if (!/높이/.test(name)) continue
      push({
        auto_key: `land-height:${name}`,
        topic: '용도지역',
        text: `대지는 '${name}'에 포함되어 건물 높이가 제한될 수 있다. 구체적인 최고 높이는 해당 고시로 확인해야 한다.`,
        sources: [src['ned:landUse']],
        human_validation_required: true,
      })
    }
  }

  // 3) 토지특성 (가장 최근 조사)
  const landChar = parcelsOf('ned:landChar')
  if (landChar.length > 0) {
    const latest = landChar.map((p) => ({ p, it: latestBy(p.items, 'stdrYear') })).filter((x) => x.it) as {
      p: LandParcelResult
      it: Record<string, unknown>
    }[]
    const year = latest.map((x) => str(x.it.stdrYear)).sort().at(-1)
    const describe = (field: string) =>
      countBy(latest.map((x) => str(x.it[field])).filter(Boolean))
        .map(([v, c]) => (latest.length > 1 ? `${v} ${c}필지` : v))
        .join(', ')
    const road = describe('roadSideCodeNm')
    const roadGloss = uniq(latest.map((x) => roadSideGloss(str(x.it.roadSideCodeNm))).filter(Boolean))
    push({
      auto_key: 'land-char',
      topic: '토지 특성',
      text: `토지특성 조사(${year}년)상 대지의 지형 높이는 ${describe('tpgrphHgCodeNm')}, 형상은 ${describe('tpgrphFrmCodeNm')}, 도로 접면은 ${road}${
        roadGloss.length ? `(${roadGloss.join(' / ')})` : ''
      }, 토지이용상황은 ${describe('ladUseSittnNm')}이다.`,
      sources: [src['ned:landChar']],
    })
    const changes: string[] = []
    for (const p of landChar) {
      const sorted = [...p.items].sort((a, b) => str(a.stdrYear).localeCompare(str(b.stdrYear)))
      const first = sorted[0]
      const last = sorted.at(-1)
      if (first && last && str(first.ladUseSittnNm) && str(first.ladUseSittnNm) !== str(last.ladUseSittnNm)) {
        changes.push(`${p.jibun || jibunOf(p.addr)}: ${str(first.stdrYear)}년 ${str(first.ladUseSittnNm)} → ${str(last.stdrYear)}년 ${str(last.ladUseSittnNm)}`)
      }
    }
    if (changes.length > 0) {
      push({
        auto_key: 'land-use-change',
        topic: '변화',
        text: `토지이용상황이 바뀐 필지가 있다 — ${listText(changes, 4)}.`,
        sources: [src['ned:landChar']],
      })
    }
  }

  // 4) 공시지가 이력 (가장 넓은 필지)
  const price = parcelsOf('ned:price')
  if (price.length > 0) {
    const areaOf = (pnu: string) => site.parcels.find((x) => x.pnu === pnu)?.areaM2 ?? 0
    const rep = [...price].sort((a, b) => areaOf(b.pnu) - areaOf(a.pnu))[0]
    const byYear = new Map<number, number>()
    for (const it of rep.items) {
      const y = n(it.stdrYear)
      const v = n(it.pblntfPclnd)
      if (y && v) byYear.set(y, v)
    }
    const series = [...byYear.entries()].sort((a, b) => a[0] - b[0])
    if (series.length >= 2) {
      const [y0, p0] = series[0]
      const [y1, p1] = series.at(-1)!
      const peak = series.reduce((m, x) => (x[1] > m[1] ? x : m))
      const tenAgo = series.find(([y]) => y === y1 - 10)
      let text = `대표 필지(${rep.jibun || jibunOf(rep.addr)})의 개별공시지가는 ${y0}년 ㎡당 ${won(p0)}에서 ${y1}년 ${won(p1)}으로 ${changePct(p0, p1)} 변했다.`
      if (peak[0] < y1 && peak[1] > p1 * 1.05) {
        text += ` 가장 높았던 해는 ${peak[0]}년(㎡당 ${won(peak[1])})이며 그 뒤 ${changePct(peak[1], p1)} 변했다.`
      } else if (tenAgo) {
        text += ` 최근 10년(${tenAgo[0]}→${y1}년) 변화는 ${changePct(tenAgo[1], p1)}이다.`
      }
      push({ auto_key: 'land-price-trend', topic: '공시지가', text: `${text} (물가 변동은 반영하지 않은 명목 금액)`, sources: [src['ned:price']] })
    }
  }

  // 5) 토지이동 이력
  const moves = parcelsOf('ned:landMove')
  if (moves.length > 0) {
    const events = moves
      .flatMap((p) =>
        p.items.map((it) => ({ date: str(it.ladMvmnDe), reason: str(it.ladMvmnPrvonshCodeNm), jibun: p.jibun || jibunOf(p.addr) })),
      )
      .filter((e) => e.date && e.reason && !/행정구역|관할구역/.test(e.reason))
      .sort((a, b) => a.date.localeCompare(b.date))
    const dedup = events.filter((e, i) => events.findIndex((x) => x.date === e.date && x.reason === e.reason) === i)
    if (dedup.length > 0) {
      const kinds = countBy(dedup.map((e) => (/분할/.test(e.reason) ? '분할' : /합병/.test(e.reason) ? '합병' : /지목/.test(e.reason) ? '지목변경' : '기타')))
      push({
        auto_key: 'land-history',
        topic: '시간·기억',
        text: `대지 필지의 토지이동 기록은 ${dedup[0].date}부터 있다 (${kinds.map(([k, c]) => `${k} ${c}건`).join(', ')}). ${listText(
          dedup.map((e) => `${e.date} ${e.jibun} ${e.reason}`),
          5,
        )}.`,
        sources: [src['ned:landMove']],
      })
    }
  }

  // 실패
  for (const d of LAND_DATASETS) {
    const ds = land.datasets[d.id]
    if (!ds || ds.parcels.length === 0) continue
    if (ds.parcels.every((p) => p.error)) {
      push({
        auto_key: `error:${d.id}`,
        type: 'UNKNOWN',
        topic: '수집 오류',
        text: `${d.label} 정보를 가져오지 못했다 (${ds.parcels[0].error}). 다시 수집하거나 다른 자료로 확인해야 한다.`,
        sources: [src[d.id]],
        confidence: 'low',
        human_validation_required: true,
      })
    }
  }
}

// ───────────────────────── 건축물대장 ─────────────────────────

const HOUSING = /주택|아파트|다세대|다가구|연립|기숙사|원룸|오피스텔/

function purposeOf(f: Record<string, unknown>): string {
  return str(f.etcPurps) || str(f.mainPurpsCdNm) || '용도 미상'
}

function isMain(t: Record<string, unknown>): boolean {
  return str(t.mainAtchGbCdNm) !== '부속건축물'
}

export function addRegisterFacts(ctx: FactContext, reg: RegisterOutcome): void {
  const { project, push } = ctx
  const site = reg.parcels.filter((p) => p.role === 'site')
  const adj = reg.parcels.filter((p) => p.role === 'adjacent')
  const ok = reg.parcels.filter((p) => !p.error)
  const firstErr = reg.parcels.find((p) => p.error)?.error ?? null

  project.collected['hub:register'] = {
    dataset_id: 'hub:register',
    retrieved_at: reg.retrievedAt,
    features: reg.parcels.flatMap((p) =>
      p.titles.map((t) => ({ type: 'Feature' as const, geometry: null, properties: { ...t, _pnu: p.pnu, _role: p.role } })),
    ),
  }
  const sample = reg.parcels[0]
  const sid = ctx.newSource({
    source_name: HUB_NAME,
    dataset_name: '건축물대장 표제부·층별개요 (대지 + 맞닿은 필지)',
    dataset_id: 'hub:register',
    retrieved_at: reg.retrievedAt,
    update_date: null,
    geometry: `대지 ${site.length}필지 + 맞닿은 ${adj.length}필지`,
    coordinate_system: '—',
    spatial_scale: '건물',
    time_range: null,
    raw_ref: 'hub:register',
    normalized_value: null,
    unit: null,
    license: HUB_LICENSE,
    limitations: '건축물대장 기준이라 무허가·미등재 건물은 없고, 대장 내용이 현장과 다를 수 있음. 맞닿은 필지는 지적도상 경계 1.5m 이내로 판단.',
    original_url: sample ? publicHubUrl('getBrTitleInfo', pnuToParams(sample.pnu)) : '',
    reliability: 'official',
    feature_count: reg.parcels.reduce((s, p) => s + p.titles.length, 0),
    status: ok.length === 0 && reg.parcels.length > 0 ? 'error' : 'ok',
    error: firstErr,
  })

  if (ok.length === 0 && reg.parcels.length > 0) {
    push({
      auto_key: 'error:hub',
      type: 'UNKNOWN',
      topic: '수집 오류',
      text: `건축물대장 정보를 가져오지 못했다 (${firstErr}). 인증키와 활용신청 상태를 확인해야 한다.`,
      sources: [sid],
      confidence: 'low',
      human_validation_required: true,
    })
    return
  }

  // 대지 안 건물
  const siteTitles = site.flatMap((p) => p.titles).filter(isMain)
  if (site.every((p) => !p.error)) {
    if (siteTitles.length === 0) {
      push({
        auto_key: 'reg-site',
        topic: '대지 안 건물',
        text: '대지 필지에서 건축물대장상 건물을 찾지 못했다 (빈 땅이거나 대장에 오르지 않은 건물일 수 있다).',
        sources: [sid],
        confidence: 'medium',
      })
    } else {
      const desc = siteTitles.slice(0, 4).map((t) => {
        const g = n(t.grndFlrCnt) ?? 0
        const u = n(t.ugrndFlrCnt) ?? 0
        const tot = n(t.totArea)
        const year = str(t.useAprDay).slice(0, 4)
        return [
          str(t.bldNm) || str(t.dongNm) || null,
          str(t.mainPurpsCdNm),
          str(t.strctCdNm),
          `지상 ${g}층${u > 0 ? `·지하 ${u}층` : ''}`,
          tot ? `연면적 ${fmt(tot)}㎡` : null,
          /^\d{4}$/.test(year) ? `${year}년 사용승인` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      })
      push({
        auto_key: 'reg-site',
        topic: '대지 안 건물',
        text: `대지 안에 건축물대장상 건물 ${siteTitles.length}동이 있다 — ${desc.join(' / ')}${siteTitles.length > 4 ? ' 외' : ''}.`,
        sources: [sid],
      })
      const floors = site.flatMap((p) => p.floors).filter((f) => str(f.flrGbCdNm) === '지상')
      const byFloor = new Map<number, string[]>()
      for (const f of floors) {
        const no = n(f.flrNo)
        if (!no) continue
        byFloor.set(no, [...(byFloor.get(no) ?? []), purposeOf(f)])
      }
      const floorText = [...byFloor.entries()]
        .sort((a, b) => a[0] - b[0])
        .slice(0, 6)
        .map(([no, uses]) => `${no}층 ${uniq(uses).join('·')}`)
      if (floorText.length > 0) {
        push({ auto_key: 'reg-site-floors', topic: '대지 안 건물', text: `대지 건물의 층별 용도는 ${floorText.join(', ')}이다.`, sources: [sid] })
      }
    }
  }

  // 맞닿은 필지 건물
  if (adj.length > 0) {
    const titles = adj.flatMap((p) => p.titles).filter(isMain)
    if (titles.length === 0) {
      push({
        auto_key: 'reg-adj-none',
        topic: '맞닿은 건물',
        text: `맞닿은 ${adj.length}필지에서 건축물대장상 건물을 찾지 못했다.`,
        sources: [sid],
        confidence: 'medium',
      })
    } else {
      const ground = adj.flatMap((p) => p.floors).filter((f) => str(f.flrGbCdNm) === '지상' && n(f.flrNo) === 1)
      if (ground.length > 0) {
        const top = countBy(ground.map(purposeOf)).slice(0, 4)
        push({
          auto_key: 'reg-adj-ground',
          topic: '맞닿은 건물',
          text: `대지와 맞닿은 필지 건물의 1층 용도는 ${top.map(([u, c]) => `${u} ${c}곳`).join(', ')} 순으로 많다.`,
          sources: [sid],
        })
      }
      const fl = titles.map((t) => n(t.grndFlrCnt)).filter((x): x is number => !!x && x > 0)
      const hs = titles.map((t) => n(t.heit)).filter((x): x is number => !!x && x > 0)
      if (fl.length > 0) {
        push({
          auto_key: 'reg-adj-height',
          topic: '맞닿은 건물',
          text: `맞닿은 건물 ${titles.length}동은 지상 ${Math.min(...fl)}~${Math.max(...fl)}층이며${
            hs.length ? `, 높이가 기록된 ${hs.length}동은 ${fmt(Math.min(...hs), 1)}~${fmt(Math.max(...hs), 1)}m이다` : ''
          }.`,
          sources: [sid],
        })
      }
      const years = titles.map((t) => Number(str(t.useAprDay).slice(0, 4))).filter((y) => y >= 1900 && y <= new Date().getFullYear())
      if (years.length > 0) {
        push({
          auto_key: 'reg-adj-age',
          topic: '맞닿은 건물',
          text: `맞닿은 건물의 사용승인 연도는 ${Math.min(...years)}~${Math.max(...years)}년이며 중앙값은 ${Math.round(median(years))}년이다.`,
          sources: [sid],
        })
      }
      const upperHousing = new Set(
        adj
          .flatMap((p) => p.floors.map((f) => ({ f, pnu: p.pnu })))
          .filter(({ f }) => str(f.flrGbCdNm) === '지상' && (n(f.flrNo) ?? 0) >= 2 && HOUSING.test(purposeOf(f) + str(f.mainPurpsCdNm)))
          .map(({ f, pnu }) => `${pnu}:${str(f.mgmBldrgstPk)}`),
      )
      push({
        auto_key: 'reg-adj-housing',
        topic: '맞닿은 건물',
        text: upperHousing.size
          ? `맞닿은 건물 중 ${upperHousing.size}동은 2층 이상에 주거 용도가 있다.`
          : '맞닿은 건물의 2층 이상에서 주거 용도는 확인되지 않았다 (건축물대장 층별개요 기준).',
        sources: [sid],
        confidence: 'medium',
      })
    }
  }
}

// ───────────────────────── SGIS ─────────────────────────

export function addSgisFacts(ctx: FactContext, sg: SgisOutcome): void {
  const { project, push } = ctx
  const region = sg.region
  const dong = region ? `${region.dongName}(행정동)` : '행정동'
  const series = sg.series
  const y0 = series[0]
  const y1 = series.at(-1)
  const range = y0 && y1 ? `${y0.year}~${y1.year}년` : null
  const base = (dataset: string, id: string, scale: string, extra: Partial<Parameters<FactContext['newSource']>[0]> = {}) =>
    ctx.newSource({
      source_name: SGIS_NAME,
      dataset_name: dataset,
      dataset_id: id,
      retrieved_at: sg.retrievedAt,
      update_date: null,
      geometry: region?.name ?? '—',
      coordinate_system: 'UTM-K(EPSG:5179) → WGS84 변환',
      spatial_scale: scale,
      time_range: range,
      raw_ref: null,
      normalized_value: null,
      unit: null,
      license: SGIS_LICENSE,
      limitations: '등록센서스 기반 거주 인구 통계로 시간대별 활동인구가 아님. 소지역 값은 개인정보 보호를 위해 N/A로 가려질 수 있음. 행정통합 이전 행정구역 기준.',
      original_url: `${SGIS_PUBLIC_BASE}/stats/population.json?adm_cd=${region?.admCd ?? ''}&low_search=0`,
      reliability: 'official',
      feature_count: null,
      status: 'ok',
      error: null,
      ...extra,
    })

  const wantPop = sg.wants.population
  const wantBiz = sg.wants.business

  // 인구 추이 (총조사 주요지표에는 사업체 수도 들어 있어 사업체만 골라도 쓴다)
  if (series.length > 0 && y0 && y1) {
    const sPop = base('총조사 주요지표 (인구·가구·사업체)', 'sgis:population', `행정동 (${region?.name ?? ''})`, {
      normalized_value: series,
      feature_count: series.length,
    })
    project.collected['sgis:population'] = {
      dataset_id: 'sgis:population',
      retrieved_at: sg.retrievedAt,
      features: series.map((s) => ({ type: 'Feature' as const, geometry: null, properties: { ...s } })),
    }
    if (wantPop && y0.tot_ppltn !== null && y1.tot_ppltn !== null) {
      push({
        auto_key: 'pop-trend',
        topic: '인구·가구',
        text: `${dong}의 인구는 ${y0.year}년 ${fmt(y0.tot_ppltn)}명에서 ${y1.year}년 ${fmt(y1.tot_ppltn)}명으로 ${changePct(y0.tot_ppltn, y1.tot_ppltn)} 변했다.`,
        sources: [sPop],
      })
    }
    if (wantPop && y1.avg_age !== null && y1.aged_child_idx !== null) {
      push({
        auto_key: 'pop-age',
        topic: '인구·가구',
        text: `${y1.year}년 ${dong}의 평균 나이는 ${fmt(y1.avg_age, 1)}세, 노령화지수(유소년 100명당 65세 이상 인구)는 ${fmt(y1.aged_child_idx, 1)}이다${
          y0.aged_child_idx !== null ? ` (${y0.year}년 ${fmt(y0.aged_child_idx, 1)})` : ''
        }.`,
        sources: [sPop],
      })
    }
    if (wantPop && y1.tot_family !== null && y1.avg_fmember_cnt !== null) {
      push({
        auto_key: 'pop-household',
        topic: '인구·가구',
        text: `${y1.year}년 ${dong}의 가구는 ${fmt(y1.tot_family)}가구, 평균 가구원 수는 ${fmt(y1.avg_fmember_cnt, 1)}명이다${
          y0.tot_family !== null && y0.avg_fmember_cnt !== null ? ` (${y0.year}년 ${fmt(y0.tot_family)}가구·${fmt(y0.avg_fmember_cnt, 1)}명)` : ''
        }.`,
        sources: [sPop],
      })
    }
    if (wantPop && y1.ppltn_dnsty !== null) {
      push({ auto_key: 'pop-density', topic: '인구·가구', text: `${y1.year}년 ${dong}의 인구밀도는 ㎢당 ${fmt(y1.ppltn_dnsty)}명이다.`, sources: [sPop] })
    }
    if (wantBiz && y0.corp_cnt !== null && y1.corp_cnt !== null) {
      push({
        auto_key: 'biz-trend',
        topic: '사업체·산업',
        text: `${dong}의 사업체는 ${y0.year}년 ${fmt(y0.corp_cnt)}개에서 ${y1.year}년 ${fmt(y1.corp_cnt)}개(${changePct(y0.corp_cnt, y1.corp_cnt)}), 종사자는 ${fmt(y0.employee_cnt ?? 0)}명에서 ${fmt(
          y1.employee_cnt ?? 0,
        )}명(${changePct(y0.employee_cnt ?? 0, y1.employee_cnt ?? 0)})으로 변했다 (총조사 주요지표 기준).`,
        sources: [sPop],
      })
    }
  }

  // 1인 가구
  const hl = sg.householdsLatest
  if (hl?.total && hl.onePerson !== null) {
    const sHh = base('가구통계 (1인 가구)', 'sgis:household', `행정동 (${region?.name ?? ''})`)
    const hf = sg.householdsFirst
    push({
      auto_key: 'pop-one-person',
      topic: '인구·가구',
      text: `${hl.year}년 ${dong} 가구의 ${pct(hl.onePerson, hl.total)}%(${fmt(hl.onePerson)}/${fmt(hl.total)}가구)가 1인 가구이다${
        hf?.total && hf.onePerson !== null ? ` (${hf.year}년 ${pct(hf.onePerson, hf.total)}%)` : ''
      }.`,
      sources: [sHh],
    })
  }

  // 산업 구조
  if (sg.industriesLatest.length > 0 && sg.latestYear) {
    const sBiz = base('사업체통계 (산업 대분류별)', 'sgis:company', `행정동 (${region?.name ?? ''})`, {
      time_range: `${sg.baseYear}·${sg.latestYear}년`,
      normalized_value: { latest: sg.industriesLatest, base: sg.industriesBase },
      limitations:
        '전국사업체조사 기반. 산업별 합계는 총조사 주요지표의 사업체 수와 기준이 달라 값이 다를 수 있음. 행정통합 이전 행정구역 기준.',
      original_url: `${SGIS_PUBLIC_BASE}/stats/company.json?adm_cd=${region?.admCd ?? ''}&low_search=0`,
    })
    const total = sg.industriesLatest.reduce((s, r) => s + r.corp, 0)
    const top = [...sg.industriesLatest].sort((a, b) => b.corp - a.corp).slice(0, 3)
    push({
      auto_key: 'biz-industry',
      topic: '사업체·산업',
      text: `${sg.latestYear}년 ${dong}의 사업체(산업 대분류 합계 ${fmt(total)}개)는 ${top.map((r) => `${r.name} ${pct(r.corp, total)}%`).join(', ')} 순으로 많다.`,
      sources: [sBiz],
    })
    if (sg.industriesBase.length > 0) {
      const changes = sg.industriesLatest
        .map((r) => ({ r, b: sg.industriesBase.find((x) => x.code === r.code)?.corp ?? 0 }))
        .filter((x) => x.b >= 30)
        .map((x) => ({ name: x.r.name, from: x.b, to: x.r.corp, rate: (x.r.corp - x.b) / x.b }))
        .sort((a, b) => a.rate - b.rate)
      if (changes.length >= 2) {
        const down = changes[0]
        const up = changes.at(-1)!
        push({
          auto_key: 'biz-industry-change',
          topic: '사업체·산업',
          text: `${sg.baseYear}→${sg.latestYear}년 ${dong}에서 사업체가 가장 많이 줄어든 업종은 ${down.name}(${fmt(down.from)}→${fmt(down.to)}개, ${changePct(down.from, down.to)}), 가장 많이 늘어난 업종은 ${up.name}(${fmt(up.from)}→${fmt(up.to)}개, ${changePct(up.from, up.to)})이다 (사업체 30개 이상 업종 기준).`,
          sources: [sBiz],
        })
      }
    }
  }

  // 반경 안 집계구
  if (sg.statsAreas.length > 0 && sg.latestYear) {
    const sArea = base('집계구 경계·주요지표', 'sgis:statsarea', `집계구 (반경 ${ctx.radiusM}m에 걸친 ${sg.statsAreas.length}곳)`, {
      time_range: `${sg.latestYear}년`,
      raw_ref: 'sgis:statsarea',
      feature_count: sg.statsAreas.length,
      original_url: `${SGIS_PUBLIC_BASE}/boundary/userarea.geojson?cd=4`,
    })
    project.collected['sgis:statsarea'] = { dataset_id: 'sgis:statsarea', retrieved_at: sg.retrievedAt, features: sg.statsAreas }
    const props = sg.statsAreas.map((f) => f.properties)
    const pops = props.map((p) => p.tot_ppltn as number | null).filter((x): x is number => x !== null)
    const masked = props.length - pops.length
    push({
      auto_key: 'area-pop-sum',
      topic: '인구·가구',
      text: `반경 ${ctx.radiusM}m에 걸친 집계구 ${props.length}곳의 인구 합계는 ${fmt(pops.reduce((s, x) => s + x, 0))}명이다 (${sg.latestYear}년, 반경에 일부만 걸친 집계구도 전체를 셈${
        masked ? `, 값이 가려진 ${masked}곳 제외` : ''
      }).`,
      sources: [sArea],
      confidence: 'medium',
    })
    const center = point(centerOf(ctx.boundary))
    const home = sg.statsAreas.find((f) => f.geometry && intersects(f.geometry, center.geometry))
    if (home) {
      const p = home.properties
      push({
        auto_key: 'area-home',
        topic: '인구·가구',
        text: `대지가 속한 집계구(${str(p.adm_cd)})의 인구는 ${p.tot_ppltn !== null ? `${fmt(p.tot_ppltn as number)}명` : '가려짐(N/A)'}, 평균 나이 ${
          p.avg_age !== null ? `${fmt(p.avg_age as number, 1)}세` : '가려짐'
        }, 가구 ${p.tot_family !== null ? `${fmt(p.tot_family as number)}가구` : '가려짐'}이다 (${sg.latestYear}년).`,
        sources: [sArea],
      })
    }
    const ages = props.map((p) => p.avg_age as number | null).filter((x): x is number => x !== null)
    if (ages.length >= 3) {
      push({
        auto_key: 'area-age-range',
        topic: '인구·가구',
        text: `반경 안 집계구의 평균 나이는 ${fmt(Math.min(...ages), 1)}~${fmt(Math.max(...ages), 1)}세로 집계구마다 차이가 있다.`,
        sources: [sArea],
      })
    }
  }

  // 활동인구는 알 수 없음 (요청서: 거주인구와 활동인구의 차이)
  if (series.length > 0 || sg.statsAreas.length > 0) {
    push({
      auto_key: 'unknown-living-pop',
      type: 'UNKNOWN',
      topic: '인구·가구',
      text: '통계청 자료는 거주 인구 통계라서, 시간대별로 실제 이곳에 머무는 사람(생활인구·유동인구)은 알 수 없다. 현장 관찰로 확인해야 한다.',
      sources: [],
      confidence: 'low',
      human_validation_required: true,
    })
  }

  for (const e of sg.errors) {
    push({
      auto_key: `error:sgis:${e.part}`,
      type: 'UNKNOWN',
      topic: '수집 오류',
      text: `통계청 SGIS ${e.part === 'population' ? '인구·가구' : e.part === 'statsArea' ? '집계구' : '사업체'} 정보를 가져오지 못했다 (${e.message}).`,
      sources: [],
      confidence: 'low',
      human_validation_required: true,
    })
  }
}
