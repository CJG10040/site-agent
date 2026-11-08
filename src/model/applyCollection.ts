// 수집 결과를 프로젝트에 반영한다.
//  1) 출처 기록(SourceRecord) 생성 — 요청서 8.4, F-06
//  2) 원자료 보관 (collected)
//  3) 사실(FACT)·미확인(UNKNOWN) 카드 초안 생성 — 사용자가 확인해야 확정됨
// 원칙: 데이터가 없으면 지어내지 않고 UNKNOWN으로 남긴다. 계산값은 계산값이라고 밝힌다.

import { lineToAreaDistanceM, areaToAreaDistanceM, areaM2, isAreal, isLinear, type Areal } from '../lib/geo'
import { sunSummaries } from '../lib/sun'
import type { CollectOutcome, LayerOutcome } from '../sources/collect'
import { SOURCE_NAME } from '../sources/vworld'
import { jimokName, useName } from './codes'
import { makeCard, nextNumber, nowIso } from './project'
import type { Card, CardType, Project, SourceRecord } from './types'

interface DraftFact {
  auto_key: string
  type: CardType
  topic: string
  text: string
  sources: string[]
  confidence: Card['confidence']
  human_validation_required: boolean
}

const VWORLD_LICENSE = '브이월드 오픈API 이용약관에 따름 (출처 표기 필요)'

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function listText(items: string[], max = 6): string {
  const shown = items.slice(0, max).join(', ')
  return items.length > max ? `${shown} 외 ${items.length - max}곳` : shown
}

export function applyCollection(project: Project, outcome: CollectOutcome, boundary: Areal): void {
  const site = project.site
  const radiusM = outcome.radiusM

  // ── 0. 기존 출처 정리: 사용자가 손댄 카드가 가리키는 출처와 사용자 입력 출처만 남긴다
  const keepIds = new Set(
    project.cards
      .filter((c) => !(c.origin === 'data' && c.status === 'draft' && !c.edited))
      .flatMap((c) => c.related_source_ids),
  )
  project.sources = project.sources.filter((s) => s.reliability === 'user' || keepIds.has(s.source_id))

  const newSource = (s: Omit<SourceRecord, 'source_id'>): string => {
    const id = nextNumber(project, 'S')
    project.sources.push({ ...s, source_id: id })
    return id
  }

  // ── 1. 레이어별 출처 기록과 원자료
  project.collected = {}
  const layerSource: Record<string, string> = {}
  for (const o of outcome.layers) {
    layerSource[o.layer.id] = newSource({
      source_name: SOURCE_NAME,
      dataset_name: o.layer.label,
      dataset_id: o.layer.id,
      retrieved_at: o.retrievedAt,
      update_date: null,
      geometry: o.scopeLabel,
      coordinate_system: 'EPSG:4326 (WGS84 경위도)',
      spatial_scale: o.scopeLabel,
      time_range: null,
      raw_ref: o.state === 'ok' ? o.layer.id : null,
      normalized_value: null,
      unit: null,
      license: VWORLD_LICENSE,
      limitations: o.layer.limitations + (o.truncated ? ` 이번 조회는 전체 ${o.total}건 중 ${o.features.length}건만 받음.` : ''),
      original_url: o.url,
      reliability: 'official',
      feature_count: o.state === 'error' ? null : o.features.length,
      status: o.state,
      error: o.error,
    })
    if (o.state === 'ok') {
      project.collected[o.layer.id] = { dataset_id: o.layer.id, retrieved_at: o.retrievedAt, features: o.features }
    }
  }

  const addressSource = newSource({
    source_name: SOURCE_NAME,
    dataset_name: '주소 API (좌표 → 주소)',
    dataset_id: 'req/address:getAddress',
    retrieved_at: outcome.addressAt,
    update_date: null,
    geometry: '대지 중심점',
    coordinate_system: 'EPSG:4326 (WGS84 경위도)',
    spatial_scale: '지점',
    time_range: null,
    raw_ref: null,
    normalized_value: outcome.address,
    unit: null,
    license: VWORLD_LICENSE,
    limitations: '대지 중심점에 가장 가까운 주소이며, 여러 필지로 된 대지의 대표 주소와 다를 수 있음.',
    original_url: 'https://api.vworld.kr/req/address?service=address&request=getAddress&type=both',
    reliability: 'official',
    feature_count: null,
    status: outcome.address ? 'ok' : outcome.addressError ? 'error' : 'empty',
    error: outcome.addressError,
  })
  if (outcome.address) site.address = outcome.address

  const parcelSource =
    site.parcels.length > 0
      ? newSource({
          source_name: SOURCE_NAME,
          dataset_name: '연속지적도 (대지 필지)',
          dataset_id: 'LP_PA_CBND_BUBUN',
          retrieved_at: nowIso(),
          update_date: null,
          geometry: '대지 필지',
          coordinate_system: 'EPSG:4326 (WGS84 경위도)',
          spatial_scale: '필지',
          time_range: null,
          raw_ref: null,
          normalized_value: site.parcels.map((p) => ({ pnu: p.pnu, addr: p.addr, jibun: p.jibun, jiga: p.jiga, gosiYM: p.gosiYM })),
          unit: null,
          license: VWORLD_LICENSE,
          limitations: '연속지적도는 지적도를 이어 붙인 참고 도면으로, 실제 측량 경계·면적과 다를 수 있음.',
          original_url: 'https://api.vworld.kr/req/data?service=data&request=GetFeature&data=LP_PA_CBND_BUBUN',
          reliability: 'official',
          feature_count: site.parcels.length,
          status: 'ok',
          error: null,
        })
      : null

  const areaValue = areaM2(boundary)
  const areaSource = newSource({
    source_name: '대지해석 에이전트 계산',
    dataset_name: '대지 면적 계산 (Turf.js 측지 면적)',
    dataset_id: 'computed:area',
    retrieved_at: nowIso(),
    update_date: null,
    geometry: '대지 경계',
    coordinate_system: 'EPSG:4326 (WGS84 경위도)',
    spatial_scale: '대지',
    time_range: null,
    raw_ref: null,
    normalized_value: Math.round(areaValue),
    unit: '㎡',
    license: '—',
    limitations: '지적도 도형(또는 직접 그린 경계)으로 계산한 값으로, 토지대장 면적과 다를 수 있음.',
    original_url: '',
    reliability: 'computed',
    feature_count: null,
    status: 'ok',
    error: null,
  })

  const [lon, lat] = outcome.center
  const sun = sunSummaries(lon, lat)
  const sunSource = newSource({
    source_name: '대지해석 에이전트 계산',
    dataset_name: '태양 위치 계산 (SunCalc)',
    dataset_id: 'computed:sun',
    retrieved_at: nowIso(),
    update_date: null,
    geometry: '대지 중심점',
    coordinate_system: 'EPSG:4326 (WGS84 경위도)',
    spatial_scale: '지점',
    time_range: `${new Date().getFullYear()}년 하지·춘분·동지`,
    raw_ref: null,
    normalized_value: sun,
    unit: '°, 한국 표준시',
    license: '—',
    limitations: '천문 계산값이며 지형·주변 건물에 의한 그림자는 반영하지 않음.',
    original_url: '',
    reliability: 'computed',
    feature_count: null,
    status: 'ok',
    error: null,
  })

  project.collectedAt = outcome.finishedAt
  project.collectedRadiusM = radiusM

  // ── 2. 사실 카드 초안
  const layer = (id: string): LayerOutcome | undefined => outcome.layers.find((o) => o.layer.id === id)
  const drafts: DraftFact[] = []
  const fact = (d: Omit<DraftFact, 'type' | 'confidence' | 'human_validation_required'> & Partial<DraftFact>) =>
    drafts.push({ type: 'FACT', confidence: 'high', human_validation_required: false, ...d })

  // 위치
  const emd = str(layer('LT_C_ADEMD_INFO')?.features[0]?.properties.full_nm)
  if (emd || outcome.address) {
    const road = outcome.address?.road
    const parcel = outcome.address?.parcel
    let text = emd ? `대지는 ${emd}에 있다.` : '대지 위치를 주소로 확인했다.'
    if (road) text += ` 대지 중심점의 도로명주소는 ${road}이다.`
    else if (parcel) text += ` 대지 중심점의 지번주소는 ${parcel}이다.`
    fact({
      auto_key: 'location',
      topic: '위치',
      text,
      sources: [layerSource.LT_C_ADEMD_INFO, addressSource].filter(Boolean),
    })
  }

  // 필지 구성
  if (site.parcels.length > 0 && parcelSource) {
    const counts = new Map<string, number>()
    for (const p of site.parcels) counts.set(jimokName(p.jimok), (counts.get(jimokName(p.jimok)) ?? 0) + 1)
    const jimokText = [...counts.entries()].map(([k, n]) => `${k} ${n}필지`).join(', ')
    fact({
      auto_key: 'parcels',
      topic: '대지 규모',
      text:
        site.boundaryMode === 'drawn'
          ? `직접 그린 대지 범위에 ${site.parcels.length}개 필지가 걸쳐 있다 (지목: ${jimokText}).`
          : `대지는 ${site.parcels.length}개 필지로 이루어져 있다 (지목: ${jimokText}).`,
      sources: [parcelSource],
    })
  }

  // 면적
  fact({
    auto_key: 'area',
    topic: '대지 규모',
    text: `${site.boundaryMode === 'drawn' ? '직접 그린 대지 범위의' : '대지'} 면적은 도형으로 계산하면 약 ${fmt(Math.round(areaValue))}㎡(약 ${fmt(areaValue / 3.3058)}평)이다.`,
    sources: [parcelSource, areaSource].filter((x): x is string => !!x),
    confidence: 'medium',
  })

  // 용도지역
  const zoningLayers = outcome.layers.filter((o) => o.layer.kind === 'zoning')
  const zoningNames = uniq(zoningLayers.flatMap((o) => o.features.map((f) => str(f.properties.uname)).filter(Boolean)))
  if (zoningNames.length === 1) {
    fact({
      auto_key: 'zoning',
      topic: '용도지역',
      text: `대지는 ${zoningNames[0]}에 속한다.`,
      sources: zoningLayers.filter((o) => o.state === 'ok').map((o) => layerSource[o.layer.id]),
    })
  } else if (zoningNames.length > 1) {
    fact({
      auto_key: 'zoning',
      topic: '용도지역',
      text: `대지에 ${zoningNames.join('·')}이 함께 걸쳐 있다. 어느 부분이 어떤 지역인지 경계를 확인해야 한다.`,
      sources: zoningLayers.filter((o) => o.state === 'ok').map((o) => layerSource[o.layer.id]),
      human_validation_required: true,
    })
  } else if (zoningLayers.every((o) => o.state === 'empty')) {
    drafts.push({
      auto_key: 'zoning-missing',
      type: 'UNKNOWN',
      topic: '용도지역',
      text: '브이월드 도시계획 자료에서 대지의 용도지역이 조회되지 않았다. 토지이음에서 확인해야 한다.',
      sources: zoningLayers.map((o) => layerSource[o.layer.id]),
      confidence: 'low',
      human_validation_required: true,
    })
  }

  // 용도지구·구역
  for (const o of outcome.layers.filter((x) => x.layer.kind === 'district' && x.state === 'ok')) {
    const byName = new Map<string, string[]>()
    for (const f of o.features) {
      const name = str(f.properties[o.layer.nameField])
      if (!name) continue
      const year = str(f.properties.dyear)
      const list = byName.get(name) ?? []
      if (/^\d{4}$/.test(year) && year !== '0000') list.push(year)
      byName.set(name, list)
    }
    for (const [name, years] of byName) {
      const latest = years.sort().at(-1)
      fact({
        auto_key: `district:${o.layer.id}:${name}`,
        topic: '용도지구·구역',
        text: `대지는 ${name}에 포함된다${latest ? ` (자료상 고시 연도 ${latest})` : ''}.`,
        sources: [layerSource[o.layer.id]],
      })
    }
  }

  // 보호구역
  for (const o of outcome.layers.filter((x) => x.layer.kind === 'protect' && x.state === 'ok')) {
    const byName = new Map<string, string[]>()
    for (const f of o.features) {
      const name = str(f.properties[o.layer.nameField])
      if (!name) continue
      const remark = o.layer.remarkField ? str(f.properties[o.layer.remarkField]) : ''
      const list = byName.get(name) ?? []
      if (remark) list.push(remark)
      byName.set(name, list)
    }
    for (const [name, remarks] of byName) {
      const related = uniq(remarks)
      fact({
        auto_key: `protect:${o.layer.id}:${name}`,
        topic: '보호구역',
        text: `대지는 ${o.layer.namePrefix ?? ''}${name}에 포함된다${related.length ? ` (관련: ${listText(related, 3)})` : ''}.`,
        sources: [layerSource[o.layer.id]],
      })
    }
  }

  // 공시지가
  const priced = site.parcels.filter((p) => p.jiga && p.jiga > 0)
  if (priced.length > 0 && parcelSource) {
    const prices = priced.map((p) => p.jiga as number)
    const ym = uniq(priced.map((p) => p.gosiYM).filter(Boolean)).join(', ')
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    fact({
      auto_key: 'landprice',
      topic: '공시지가',
      text:
        priced.length === 1 || min === max
          ? `대지의 개별공시지가는 ㎡당 ${fmt(min)}원이다${ym ? ` (${ym} 기준)` : ''}.`
          : `대지 필지들의 개별공시지가는 ㎡당 ${fmt(min)}~${fmt(max)}원이다${ym ? ` (${ym} 기준)` : ''}.`,
      sources: [parcelSource],
    })
  }

  // 주변 건물
  const bOut = layer('LT_C_BLDGINFO')
  if (bOut?.state === 'ok') {
    const src = [layerSource.LT_C_BLDGINFO]
    const props = bOut.features.map((f) => f.properties)
    const n = props.length
    const note = bOut.truncated ? ` (전체 ${fmt(bOut.total)}동 중 ${fmt(n)}동 기준)` : ''
    fact({ auto_key: 'bldg-count', topic: '주변 건물', text: `반경 ${radiusM}m 안에 건물 ${fmt(n)}동이 있다${note}.`, sources: src })

    const floors = props.map((p) => Number(p.grnd_flr)).filter((v) => Number.isFinite(v) && v > 0)
    if (floors.length > 0) {
      const low = floors.filter((f) => f <= 3).length
      const mid = floors.filter((f) => f >= 4 && f <= 7).length
      const high = floors.filter((f) => f >= 8).length
      fact({
        auto_key: 'bldg-floors',
        topic: '주변 건물',
        text: `반경 안 건물의 지상층수는 1~3층 ${pct(low, floors.length)}%, 4~7층 ${pct(mid, floors.length)}%, 8층 이상 ${pct(high, floors.length)}%이며, 가장 높은 건물은 지상 ${Math.max(...floors)}층이다 (층수 확인 ${fmt(floors.length)}동 기준, 중앙값 ${fmt(median(floors), 1)}층).`,
        sources: src,
      })
    }

    const useCounts = new Map<string, number>()
    for (const p of props) {
      const u = useName(p.usability)
      useCounts.set(u, (useCounts.get(u) ?? 0) + 1)
    }
    const topUses = [...useCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    if (topUses.length > 0) {
      fact({
        auto_key: 'bldg-use',
        topic: '주변 건물',
        text: `반경 안 건물의 주용도는 ${topUses.map(([u, c]) => `${u} ${pct(c, n)}%`).join(', ')} 순으로 많다.`,
        sources: src,
      })
    }

    const thisYear = new Date().getFullYear()
    const years = props
      .map((p) => Number(str(p.useapr_day).slice(0, 4)))
      .filter((y) => Number.isInteger(y) && y >= 1900 && y <= thisYear)
    if (years.length > 0) {
      const cutoff = thisYear - 30
      const old = years.filter((y) => y < cutoff).length
      fact({
        auto_key: 'bldg-age',
        topic: '주변 건물',
        text: `사용승인 연도가 확인되는 ${fmt(years.length)}동 중 ${pct(old, years.length)}%가 ${cutoff}년 이전에 지어진(30년 이상) 건물이며, 사용승인 연도 중앙값은 ${Math.round(median(years))}년이다.`,
        sources: src,
      })
    }

    const heightKnown = props.filter((p) => Number(p.height) > 0).length
    if (pct(heightKnown, n) < 50) {
      drafts.push({
        auto_key: 'bldg-height-unknown',
        type: 'UNKNOWN',
        topic: '주변 건물',
        text: `반경 안 건물 중 높이(m)가 기록된 건물은 ${pct(heightKnown, n)}%뿐이다. 실제 높이와 스카이라인은 현장이나 다른 자료로 확인해야 한다.`,
        sources: src,
        confidence: 'low',
        human_validation_required: true,
      })
    }
  }

  // 도로
  const rOut = layer('LT_L_MOCTLINK')
  if (rOut?.state === 'ok' || rOut?.state === 'empty') {
    const src = [layerSource.LT_L_MOCTLINK]
    const near: { name: string; speed: string }[] = []
    for (const f of rOut.features) {
      if (!isLinear(f.geometry)) continue
      if (lineToAreaDistanceM(f.geometry, boundary) <= 20) {
        near.push({ name: str(f.properties.road_name) || '이름 없는 도로', speed: str(f.properties.max_spd) })
      }
    }
    const nearNames = uniq(near.map((r) => (r.speed && r.speed !== '0' ? `${r.name}(제한속도 ${r.speed}km/h)` : r.name)))
    fact({
      auto_key: 'road-adjacent',
      topic: '도로',
      text: nearNames.length
        ? `대지 경계에서 20m 안을 지나는 차도는 ${listText(nearNames)}이다 (도로 중심선 기준).`
        : '대지 경계에서 20m 안을 지나는 차도(표준노드링크)가 없다.',
      sources: src,
      confidence: 'medium',
    })
    const allNames = uniq(rOut.features.map((f) => str(f.properties.road_name)).filter(Boolean))
    if (allNames.length > 0) {
      fact({
        auto_key: 'road-network',
        topic: '도로',
        text: `반경 ${radiusM}m 안의 이름 있는 차도는 ${listText(allNames, 8)}이다.`,
        sources: src,
      })
    }
  }

  const pOut = layer('LT_C_UPISUQ151')
  if (pOut?.state === 'ok') {
    const touching = uniq(
      pOut.features
        .filter((f) => isAreal(f.geometry) && areaToAreaDistanceM(f.geometry, boundary) <= 2)
        .map((f) => str(f.properties.dgm_nm))
        .filter(Boolean),
    )
    if (touching.length > 0) {
      fact({
        auto_key: 'road-plan',
        topic: '도로',
        text: `대지는 도시계획도로(${touching.join(', ')})에 접해 있다 (도시계획 정보 기준, 오차 2m 이내).`,
        sources: [layerSource.LT_C_UPISUQ151],
        confidence: 'medium',
      })
    }
  }

  // 도시계획시설
  for (const id of ['LT_C_UQ162', 'LT_C_UPISUQ152']) {
    const o = layer(id)
    if (o?.state !== 'ok') continue
    const names = uniq(o.features.map((f) => str(f.properties[o.layer.nameField])).filter(Boolean))
    if (names.length === 0) continue
    fact({
      auto_key: `facility:${id}`,
      topic: '도시계획시설',
      text: `반경 ${radiusM}m 안에 있는 ${o.layer.label}: ${listText(names)}.`,
      sources: [layerSource[id]],
    })
  }

  // 일조
  const s = sun.find((x) => x.key === 'summer')!
  const e = sun.find((x) => x.key === 'equinox')!
  const w = sun.find((x) => x.key === 'winter')!
  fact({
    auto_key: 'sun-altitude',
    topic: '일조',
    text: `대지(위도 ${lat.toFixed(3)}°)에서 태양의 남중고도는 하지 약 ${fmt(s.noonAltitude, 1)}°, 춘·추분 약 ${fmt(e.noonAltitude, 1)}°, 동지 약 ${fmt(w.noonAltitude, 1)}°이다.`,
    sources: [sunSource],
  })
  fact({
    auto_key: 'sun-daylength',
    topic: '일조',
    text: `낮 길이는 하지 약 ${s.dayLength}, 동지 약 ${w.dayLength}이다 (동지 일출 ${w.sunrise}·일몰 ${w.sunset}, 한국 표준시).`,
    sources: [sunSource],
  })

  // 법규 확인 안내 (요청서 2.2: 실무적 법규 검토와 창의적 해석을 분리)
  drafts.push({
    auto_key: 'legal-check',
    type: 'UNKNOWN',
    topic: '용도지역',
    text: '용도지역·지구·구역 정보는 참고용이다. 건폐율·용적률·높이 제한 등 실제 규제는 토지이음 토지이용계획확인원과 조례로 확인해야 한다.',
    sources: [],
    confidence: 'low',
    human_validation_required: true,
  })

  // 실패한 수집
  for (const o of outcome.layers.filter((x) => x.state === 'error')) {
    drafts.push({
      auto_key: `error:${o.layer.id}`,
      type: 'UNKNOWN',
      topic: '수집 오류',
      text: `${o.layer.label} 정보를 가져오지 못했다 (${o.error}). 다시 수집하거나 다른 자료로 확인해야 한다.`,
      sources: [layerSource[o.layer.id]],
      confidence: 'low',
      human_validation_required: true,
    })
  }

  mergeDrafts(project, drafts)
}

/** 같은 auto_key의 카드는 사용자가 손대지 않았을 때만 새 내용으로 바꾼다. */
function mergeDrafts(project: Project, drafts: DraftFact[]): void {
  const keys = new Set(drafts.map((d) => d.auto_key))
  // 이번에 만들어지지 않은, 손대지 않은 자동 초안은 지운다
  project.cards = project.cards.filter(
    (c) => !(c.origin === 'data' && c.auto_key && !keys.has(c.auto_key) && c.status === 'draft' && !c.edited),
  )
  const t = nowIso()
  for (const d of drafts) {
    const existing = project.cards.find((c) => c.auto_key === d.auto_key)
    if (!existing) {
      project.cards.push(
        makeCard(project, {
          type: d.type,
          topic: d.topic,
          text: d.text,
          related_source_ids: d.sources,
          related_card_ids: [],
          origin: 'data',
          confidence: d.confidence,
          human_validation_required: d.human_validation_required,
          status: 'draft',
          user_note: '',
          auto_key: d.auto_key,
        }),
      )
    } else if (existing.status === 'draft' && !existing.edited) {
      existing.text = d.text
      existing.topic = d.topic
      existing.related_source_ids = d.sources
      existing.confidence = d.confidence
      existing.human_validation_required = d.human_validation_required
      existing.updated_at = t
    }
  }
}
