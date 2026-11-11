// Phase 9 사실 카드: 바람장미(ASOS 시간자료), 실시간 도로 속도, 길의 연결(선택도·가구), 가로 위요감.
// 수집 결과를 project.collected에 먼저 담고(storeMove), 도판과 같은 계산(diagrams/move)으로 문장을 만든다(addMoveFacts).

import { buildDiagramData, type DiagramData } from '../diagrams/data'
import { blockView, encView, linkSpeeds, netView, projOf, topShare } from '../diagrams/move'
import { ENC_CLASSES } from '../lib/enclosure'
import { midpoint } from '../lib/network'
import { bearingOf, ringArea, ringCentroid, toXY } from '../lib/xy'
import type { ApiOutcome } from '../sources/collect'
import { ITS_PUBLIC_URL, snapshotLabel, timeBand, type SpeedSnapshot } from '../sources/its'
import { WALK_R, type NetworkResult } from '../sources/network'
import { DIR16, prevailing, SEASONS, WIND_PUBLIC_URL, WIND_SERVICE, type WindResult } from '../sources/wind'
import type { DraftFact, FactContext } from './applyCollection'
import { apiSource, distText } from './applyNearby'
import { nextNumber } from './project'
import { cleanNames, fmt, listText } from './textUtil'
import type { Project, SourceRecord } from './types'

const VWORLD_LICENSE = '브이월드 오픈API 이용약관에 따름 (출처 표기 필요)'
const ITS_LICENSE = '국가교통정보센터 오픈데이터 이용 조건에 따름 (출처 표기 필요)'
const DIR8 = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
const dir8 = (b: number) => DIR8[Math.round(b / 45) % 8]
const pctText = (x: number) => `${Math.round(x * 100)}%`

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface MoveOutcome {
  wind?: ApiOutcome<WindResult>
  speed?: ApiOutcome<SpeedSnapshot>
  network?: ApiOutcome<NetworkResult>
}

// ───────────────────────── 원자료 저장 ─────────────────────────

/** 같은 대지에서 받아 둔 속도 장면은 다시 수집해도 남긴다 */
export function storeMove(project: Project, o: MoveOutcome, prevSnaps: SpeedSnapshot[]): void {
  if (o.wind?.result) {
    project.collected['kma:wind'] = {
      dataset_id: 'kma:wind',
      retrieved_at: o.wind.retrievedAt,
      features: [{ type: 'Feature', geometry: null, properties: o.wind.result as unknown as Record<string, unknown> }],
    }
  }
  if (o.speed) {
    const snaps = [...prevSnaps, ...(o.speed.result ? [o.speed.result] : [])].slice(-12)
    if (snaps.length) {
      project.collected['its:speed'] = {
        dataset_id: 'its:speed',
        retrieved_at: o.speed.retrievedAt,
        features: snaps.map((s) => ({ type: 'Feature' as const, geometry: null, properties: s as unknown as Record<string, unknown> })),
      }
    }
  }
  if (o.network?.result) {
    project.collected['network:graph'] = {
      dataset_id: 'network:graph',
      retrieved_at: o.network.retrievedAt,
      features: [{ type: 'Feature', geometry: null, properties: o.network.result as unknown as Record<string, unknown> }],
    }
  }
}

// ───────────────────────── 출처 ─────────────────────────

function windSource(o: ApiOutcome<WindResult>) {
  const r = o.result
  return apiSource({
    source_name: `공공데이터포털 — ${WIND_SERVICE}`,
    dataset_name: r ? `${r.station.name} 관측소(지점 ${r.station.id}) 시간자료 → 바람장미` : 'ASOS 시간자료',
    dataset_id: r ? `kma:asos-hr:${r.station.id}` : 'kma:asos-hr',
    retrieved_at: o.retrievedAt,
    geometry: r ? `${r.station.name} 관측소 (대지에서 약 ${r.distanceKm.toFixed(1)}km)` : '가까운 관측소',
    spatial_scale: '관측소 지점',
    time_range: r ? `${r.years[0]}~${r.years.at(-1)}년 매시` : null,
    raw_ref: r ? 'kma:wind' : null,
    unit: 'm/s, 16방위',
    limitations:
      '관측소(트인 곳, 지상 약 10m)의 바람이다. 대지 주변 건물·지형에 따라 실제 풍향·풍속은 크게 달라진다. 0.5m/s 미만은 바람 거의 없음(정온)으로 셈.' +
      (r?.note ? ` ${r.note}` : ''),
    original_url: WIND_PUBLIC_URL,
    feature_count: r ? r.tables[0].hours : null,
    status: o.error ? 'error' : 'ok',
    error: o.error,
  })
}

function speedSource(retrievedAt: string, snaps: SpeedSnapshot[], error: string | null, radiusM: number): Omit<SourceRecord, 'source_id'> {
  return apiSource({
    source_name: '국가교통정보센터 (its.go.kr) — 교통소통정보 Open API',
    dataset_name: '표준노드링크 링크별 실시간 통행 속도',
    dataset_id: 'its:trafficInfo',
    retrieved_at: retrievedAt,
    geometry: `대지 중심 반경 ${radiusM}m를 감싸는 사각형`,
    spatial_scale: '도로 링크',
    time_range: snaps.length ? snaps.map((s) => snapshotLabel(s)).join(', ') : null,
    raw_ref: snaps.length ? 'its:speed' : null,
    unit: 'km/h',
    license: ITS_LICENSE,
    limitations:
      '민간 내비게이션·공공기관 자료를 합쳐 추정한 구간 속도이며, 차나 사람의 수(교통량)가 아니다. 받은 순간의 한 장면이라 요일·날씨·행사에 따라 달라진다. 자료가 없는 골목은 비어 있다.',
    original_url: ITS_PUBLIC_URL,
    feature_count: snaps.length ? Object.keys(snaps[snaps.length - 1].speeds).length : null,
    status: error ? 'error' : 'ok',
    error,
  })
}

// ───────────────────────── 문장 ─────────────────────────

function windDraft(r: WindResult, src: string): DraftFact {
  const all = r.tables[0]
  const pv = prevailing(all)
  const where = `${r.station.name} 관측소(대지에서 약 ${r.distanceKm.toFixed(1)}km)의 ${r.years[0]}~${r.years.at(-1)}년 매시 자료(${fmt(all.hours)}시간)`
  const seasons = SEASONS.slice(1)
    .map((name, i) => {
      const t = r.tables[i + 1]
      if (!t?.hours) return ''
      const p = prevailing(t)
      return `${name} ${DIR16[p.dir]}풍(${pctText(p.share)}, 평균 ${fmt(t.meanSpeed, 1)}m/s)`
    })
    .filter(Boolean)
  return {
    auto_key: 'wind-rose',
    type: 'FACT',
    topic: '기후·바람',
    text: `${where}로 보면 가장 잦은 바람은 ${DIR16[pv.dir]}풍(${pctText(pv.share)}), 그다음은 ${DIR16[pv.second]}풍(${pctText(pv.secondShare)})이다. 바람이 거의 없는 시간(0.5m/s 미만)은 ${pctText(all.hours ? all.calm / all.hours : 0)}, 평균 풍속은 ${fmt(all.meanSpeed, 1)}m/s이다. 계절별로 가장 잦은 바람은 ${seasons.join(', ')}이다.`,
    sources: [src],
    confidence: 'medium',
    human_validation_required: false,
  }
}

/** 장면마다: 대지에 붙은 차도 속도, 반경 안 막힘 비율 */
export function speedText(d: DiagramData, snaps: SpeedSnapshot[]): string | null {
  if (!snaps.length) return null
  const parts = snaps.slice(-6).map((s) => {
    const head = `${snapshotLabel(s)}(${timeBand(s)})`
    if (!d.links.length) {
      const vs = Object.values(s.speeds)
      const slow = vs.filter((v) => v < 15).length
      return `${head} 반경을 감싼 범위의 도로 구간 ${fmt(vs.length)}개 중 시속 15km 미만이 ${pctText(vs.length ? slow / vs.length : 0)} (제한속도 자료가 없어 절대 속도로 봄)`
    }
    const v = linkSpeeds(d, s)
    const byName = new Map<string, number[]>()
    for (const a of v.adjacent) {
      if (a.v === null) continue
      const name = d.links[a.i].name || '이름 없는 도로'
      const list = byName.get(name)
      if (list) list.push(a.v)
      else byName.set(name, [a.v])
    }
    const adj = [...byName.entries()].map(([n, vs]) => { const m = vs.reduce((x, y) => x + y, 0) / vs.length; return `${n} 시속 ${fmt(m)}km(보행 체감 ${m < 20 ? "아주 느림" : m < 30 ? "이면도로 수준" : m < 40 ? "보통" : m < 50 ? "빠름" : "아주 빠름"})` })
    const known = v.inRadius.filter((x) => x.v !== null)
    const withLimit = known.filter((x) => d.links[x.i].maxSpd)
    const lenLim = withLimit.reduce((x, y) => x + y.len, 0)
    const lenJam = withLimit.filter((x) => (x.v as number) / (d.links[x.i].maxSpd as number) < 0.3).reduce((x, y) => x + y.len, 0)
    const radius = withLimit.length ? `반경 안 차도 중 제한속도의 30%도 못 내는 구간(정체)이 길이로 ${pctText(lenLim ? lenJam / lenLim : 0)}` : '반경 안 차도에 속도·제한속도 자료가 없음'
    return `${head} ${adj.length ? `대지에 붙은 차도는 ${listText(adj, 4)}, ` : '대지에 붙은 차도는 속도 자료 없음, '}${radius}`
  })
  return `국가교통정보센터 실시간 통행 속도(구간별 추정값)로 본 대지 주변 차도: ${parts.join(' / ')}. 받은 순간의 장면이라 시간대·요일에 따라 달라진다.`
}

function networkDrafts(d: DiagramData, r: NetworkResult, src: string): DraftFact[] {
  const out: DraftFact[] = []
  const v = netView(d)
  if (!v) return out
  const best = (arr: (number | null)[]) => {
    const vals = v.adjacent.map((i) => arr[i]).filter((x): x is number => x !== null)
    return vals.length ? Math.max(...vals) : null
  }
  const bw = best(v.nachWalk)
  const bwide = best(v.nachWide)
  // 넓은 규모에서 가장 높은 길(반경 안 상위 5%)의 위치·이름
  const ranked = v.net.edges
    .map((e, i) => ({ i, n: v.nachWide[i], m: midpoint(e) }))
    .filter((x) => v.inDisplay[x.i] && x.n !== null)
    .sort((a, b) => (b.n as number) - (a.n as number))
  const top = ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.05)))
  // 같은 자리 표준노드링크 도로 이름 (꼭짓점이 25m 안)
  const p = projOf(d)
  const linkPts = d.links.map((l) => (l.geom.type === 'LineString' ? l.geom.coordinates : l.geom.coordinates.flat()).map((c) => toXY(p, c)))
  const names = cleanNames(
    top.map((t) => {
      const k = linkPts.findIndex((pts) => pts.some(([x, y]) => Math.hypot(x - t.m[0], y - t.m[1]) < 25))
      return k >= 0 ? d.links[k].name : ''
    }),
  )
  // 방향별로 가장 가까운 거리 하나씩
  const byDir = new Map<string, number>()
  for (const t of top) {
    const k = dir8(bearingOf(t.m))
    const dd = Math.hypot(t.m[0], t.m[1])
    if (!byDir.has(k) || dd < (byDir.get(k) as number)) byDir.set(k, dd)
  }
  const dirs = [...byDir.entries()].sort((a, b) => a[1] - b[1]).map(([k, dd]) => `${k}쪽 ${distText(dd)}`)
  if (bw !== null || bwide !== null) {
    const walkTxt = bw !== null ? `걷는 규모(반경 ${WALK_R}m 안 이동)로는 반경 안 길의 상위 ${pctText(topShare(v.nachWalk, v.inDisplay, bw))}` : ''
    const wideTxt = bwide !== null ? `넓은 규모(반경 ${r.displayR}m 전체 이동)로는 상위 ${pctText(topShare(v.nachWide, v.inDisplay, bwide))}` : ''
    out.push({
      auto_key: 'network-choice',
      type: 'FACT',
      topic: '길의 연결',
      text: `길의 배치만으로 계산한 선택도(공간구문론: 여러 곳을 오갈 때 지나가기 쉬운 길)에서 대지에 붙은 길 중 가장 높은 길은 ${[walkTxt, wideTxt].filter(Boolean).join(', ')}이다. 넓은 규모에서 선택도가 가장 높은 길(상위 5%)은 ${names.length ? `${listText(names, 4)} 등으로, ` : ''}대지 ${dirs.slice(0, 3).join(', ')} 등에 있다.`,
      sources: [src],
      confidence: 'medium',
      human_validation_required: false,
    })
  } else {
    out.push({
      auto_key: 'network-choice',
      type: 'UNKNOWN',
      topic: '길의 연결',
      text: '대지 경계 가까이(길 가장자리에서 8m 안) 지나는 도로중심선이 없어 대지에 붙은 길의 선택도를 셀 수 없다. 대지로 드나드는 길(골목·사유 통로)을 현장에서 확인해야 한다.',
      sources: [src],
      confidence: 'low',
      human_validation_required: true,
    })
  }
  const b = blockView(d)
  if (b?.site) {
    const inR = b.faces.filter((f) => Math.hypot(...ringCentroid(f.ring)) <= d.R)
    out.push({
      auto_key: 'network-block',
      type: 'FACT',
      topic: '길의 연결',
      text: `도로중심선으로 둘러싸인 가구(街區)로 보면 대지가 속한 가구는 약 ${fmt(Math.round(ringArea(b.site.ring) / 10) * 10)}㎡이고, 반경 안 가구 ${fmt(inR.length)}개의 면적 중앙값은 약 ${fmt(Math.round(median(inR.map((f) => f.area)) / 10) * 10)}㎡이다 (도로 중심선까지 넣은 면적).`,
      sources: [src],
      confidence: 'medium',
      human_validation_required: false,
    })
  }
  return out
}

function enclosureDraft(d: DiagramData, src: string): DraftFact | null {
  const e = encView(d)
  if (!e || !e.samples.length) return null
  const shares = ENC_CLASSES.map((_, i) => e.samples.filter((s) => s.cls === i).length / e.samples.length)
  const unknown = e.samples.filter((s) => s.cls < 0).length / e.samples.length
  const whole = ENC_CLASSES.map((c, i) => `${c.label.replace(/ \(.*\)$/, '')} ${pctText(shares[i])}`).join(', ')
  const both = e.front.filter((s) => s.ratio !== null && Number.isFinite(s.ratio))
  let frontTxt: string
  if (!e.front.length) frontTxt = '대지 앞을 지나는 도로중심선을 찾지 못해 대지 앞 길의 D/H는 셀 수 없다.'
  else if (both.length < e.front.length / 2) frontTxt = `대지 앞 길은 잰 자리의 ${pctText(1 - both.length / e.front.length)}에서 한쪽 또는 양쪽에 건물이 없어 트여 있다.`
  else {
    const D = median(both.map((s) => s.D as number))
    const H = median(both.map((s) => s.H as number))
    const R = median(both.map((s) => s.ratio as number))
    const cls = ENC_CLASSES.findIndex((c) => R < c.max)
    frontTxt = `대지 앞 길에서 건물 사이 거리(D)는 약 ${fmt(D)}m, 양옆 건물 높이(H, 층수×3m)는 약 ${fmt(H)}m로 D/H는 약 ${fmt(R, 1)}(${ENC_CLASSES[cls >= 0 ? cls : ENC_CLASSES.length - 1].label.replace(/^.*\((.*)\)$/, '$1')})이다.`
  }
  return {
    auto_key: 'enclosure',
    type: 'FACT',
    topic: '길의 연결',
    text: `${frontTxt} 반경 안 길을 10m 간격으로 재면 ${whole}${unknown > 0.005 ? `, 높이 미상 ${pctText(unknown)}` : ''}이다.`,
    sources: [src],
    confidence: 'medium',
    human_validation_required: false,
  }
}

// ───────────────────────── 진입점 ─────────────────────────

export function addMoveFacts(ctx: FactContext, o: MoveOutcome, enclosure: boolean): void {
  const { project, push, radiusM } = ctx
  const d = buildDiagramData(project)

  if (o.wind) {
    const src = ctx.newSource(windSource(o.wind))
    if (o.wind.result) push(windDraft(o.wind.result, src))
    else
      push({
        auto_key: 'wind-error',
        type: 'UNKNOWN',
        topic: '기후·바람',
        text: `바람장미용 시간자료를 가져오지 못했다 (${o.wind.error}). 공공데이터포털에서 '${WIND_SERVICE}' 활용신청을 확인해야 한다.`,
        sources: [src],
        confidence: 'low',
        human_validation_required: true,
      })
  }

  if (o.speed) {
    const snaps = d?.speedSnaps ?? []
    const src = ctx.newSource(speedSource(o.speed.retrievedAt, snaps, o.speed.error, radiusM))
    const text = d ? speedText(d, snaps) : null
    if (text) push({ auto_key: 'its-speed', topic: '교통', text, sources: [src], confidence: 'medium' })
    if (!o.speed.result)
      push({
        auto_key: 'its-error',
        type: 'UNKNOWN',
        topic: '교통',
        text: `실시간 도로 속도를 가져오지 못했다 (${o.speed.error}). 설정의 국가교통정보센터 인증키를 확인해야 한다.`,
        sources: [src],
        confidence: 'low',
        human_validation_required: true,
      })
  }

  if (o.network) {
    const r = o.network.result
    const src = ctx.newSource(
      apiSource({
        source_name: '브이월드 — 국토지리정보원 도로중심선 (대지해석 에이전트가 계산)',
        dataset_name: '길의 연결: 각도 선택도(공간구문론)·도보권·가구',
        dataset_id: 'network:graph',
        retrieved_at: o.network.retrievedAt,
        geometry: r ? `대지 중심 반경 ${fmt(r.fetchR)}m 도로중심선 ${fmt(r.features)}개` : '도로중심선',
        spatial_scale: '도로 구간 (교차점 사이)',
        raw_ref: r ? 'network:graph' : null,
        unit: '정규화 선택도(NACH), m',
        license: VWORLD_LICENSE,
        reliability: 'computed',
        limitations:
          '골목까지 들어 있는 차도 중심선으로 만든 길 그래프다. 보행 전용 길·건물 사이 통로·건널 수 있는지는 빠져 있고, 고가·지하차도가 교차로로 이어질 수 있다. 선택도는 길의 배치만으로 계산한 값으로 실제 사람·차의 수가 아니다.' +
          (r?.truncated ? ` 도로중심선이 많아 ${fmt(r.features)}/${fmt(r.total)}개만 받았다.` : '') +
          (r && r.originsWalk < r.edges.length ? ` 계산량을 줄이려 출발 길 ${fmt(r.originsWalk)}개를 고르게 뽑아 환산했다.` : ''),
        original_url: r?.url ?? '',
        feature_count: r ? r.edges.length : null,
        status: o.network.error ? 'error' : 'ok',
        error: o.network.error,
      }),
    )
    if (r && d) for (const f of networkDrafts(d, r, src)) push(f)
    else
      push({
        auto_key: 'network-error',
        type: 'UNKNOWN',
        topic: '길의 연결',
        text: `길의 연결을 계산하지 못했다 (${o.network.error}). 다시 수집하거나 지도에서 길의 이어짐을 직접 살펴야 한다.`,
        sources: [src],
        confidence: 'low',
        human_validation_required: true,
      })
  }

  if (enclosure && d) {
    const src = ctx.newSource(
      apiSource({
        source_name: '브이월드 — 도로중심선·GIS건물통합정보 (대지해석 에이전트가 계산)',
        dataset_name: '가로 위요감 (D/H)',
        dataset_id: 'enclosure',
        retrieved_at: project.collectedAt ?? new Date().toISOString(),
        geometry: `대지 중심 반경 ${radiusM}m`,
        spatial_scale: '길 10m 간격',
        unit: 'm, D/H',
        license: VWORLD_LICENSE,
        reliability: 'computed',
        limitations:
          '길 가운데에서 직각으로 30m(넓은 길은 폭/2+22m) 안의 첫 건물까지 잰 값이다. 높이는 층수×3m로 어림했고, 담장·가로수·건물 저층부 후퇴는 반영하지 않는다.',
        feature_count: null,
      }),
    )
    const f = enclosureDraft(d, src)
    if (f) push(f)
  }
}

// ───────────────────────── 도판 화면에서 장면 하나 더 ─────────────────────────

/** 받은 속도 장면을 덧붙이고 'its-speed' 카드를 고친다 (손대거나 제외한 카드는 그대로) */
export function appendSpeedSnapshot(project: Project, snap: SpeedSnapshot, radiusM: number, upsert: (p: Project, drafts: DraftFact[]) => void): void {
  const prev = (project.collected['its:speed']?.features ?? []).map((f) => f.properties as unknown as SpeedSnapshot)
  const snaps = [...prev, snap].slice(-12)
  // collected는 이전 상태와 함께 쓰는 객체라 고치지 않고 새로 만든다 (그래야 도판이 다시 그려짐)
  project.collected = {
    ...project.collected,
    'its:speed': {
      dataset_id: 'its:speed',
      retrieved_at: snap.at,
      features: snaps.map((s) => ({ type: 'Feature' as const, geometry: null, properties: s as unknown as Record<string, unknown> })),
    },
  }
  const d = buildDiagramData(project)
  const text = d ? speedText(d, snaps) : null
  if (!text) return
  let src = project.sources.find((s) => s.dataset_id === 'its:trafficInfo')
  const rec = speedSource(snap.at, snaps, null, radiusM)
  if (src) Object.assign(src, { ...rec, source_id: src.source_id })
  else {
    src = { ...rec, source_id: nextNumber(project, 'S') }
    project.sources.push(src)
  }
  upsert(project, [
    { auto_key: 'its-speed', type: 'FACT', topic: '교통', text, sources: [src.source_id], confidence: 'medium', human_validation_required: false },
  ])
}
