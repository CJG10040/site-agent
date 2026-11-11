// Phase 10: 환경 계산 결과를 프로젝트에 담고 사실 카드를 만든다 (수집이 끝난 뒤 따로 돌므로 다른 카드는 건드리지 않음).

import { buildDiagramData, type DiagramData } from '../diagrams/data'
import { siteRingsXY } from '../diagrams/move'
import { rasterize, unpackGrid, type GridSpec } from '../lib/env/grid'
import type { XY } from '../lib/network'
import { FLOOR_M, windName, type EnvResult } from '../sources/env'
import { upsertDrafts, type DraftFact } from './applyCollection'
import { apiSource } from './applyNearby'
import { nextNumber } from './project'
import { fmt } from './textUtil'
import type { Project } from './types'

const VWORLD_LICENSE = '브이월드 오픈API 이용약관에 따름 (출처 표기 필요)'
const DIR8 = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
const pctText = (x: number) => `${Math.round(x * 100)}%`
export const ENV_KEYS = ['env-sun', 'env-sky', 'env-view', 'env-trees', 'env-wind', 'env-heat', 'env-error']

function siteMask(g: GridSpec, rings: XY[][]): Uint8Array {
  const m = new Uint8Array(g.nx * g.ny)
  rasterize(g, rings, (k) => (m[k] = 1))
  return m
}

function nearMask(g: GridSpec, rings: XY[][], dist: number, R: number): Uint8Array {
  const m = new Uint8Array(g.nx * g.ny)
  for (let r = 0; r < g.ny; r++)
    for (let c = 0; c < g.nx; c++) {
      const x = g.x0 + (c + 0.5) * g.cell
      const y = g.y0 - (r + 0.5) * g.cell
      if (Math.hypot(x, y) > R) continue
      for (const ring of rings)
        for (let i = 1; i < ring.length; i++) {
          const [ax, ay] = ring[i - 1]
          const [bx, by] = ring[i]
          const dx = bx - ax
          const dy = by - ay
          const L2 = dx * dx + dy * dy
          const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0
          if (Math.hypot(ax + dx * t - x, ay + dy * t - y) <= dist) m[r * g.nx + c] = 1
        }
    }
  return m
}

function radiusMask(g: GridSpec, R: number): Uint8Array {
  const m = new Uint8Array(g.nx * g.ny)
  for (let r = 0; r < g.ny; r++)
    for (let c = 0; c < g.nx; c++) if (Math.hypot(g.x0 + (c + 0.5) * g.cell, g.y0 - (r + 0.5) * g.cell) <= R) m[r * g.nx + c] = 1
  return m
}

function drafts(d: DiagramData, e: EnvResult, src: string): DraftFact[] {
  const out: DraftFact[] = []
  const site = siteRingsXY(d)
  const F = (auto_key: string, text: string, confidence: DraftFact['confidence'] = 'medium', type: DraftFact['type'] = 'FACT'): DraftFact => ({
    auto_key,
    type,
    topic: '환경 계산',
    text,
    sources: [src],
    confidence,
    human_validation_required: confidence === 'low',
  })

  // 일조
  const w = unpackGrid(e.fine.winter)
  const sm = siteMask(w, site)
  const cont = unpackGrid(e.fine.cont)
  const total = unpackGrid(e.fine.total)
  const eq = unpackGrid(e.fine.equinox)
  const su = unpackGrid(e.fine.summer)
  let n = 0
  let sw = 0
  let se = 0
  let ss = 0
  let n2 = 0
  let n4 = 0
  for (let k = 0; k < sm.length; k++) {
    if (!sm[k]) continue
    n++
    sw += w.at(k)
    se += eq.at(k)
    ss += su.at(k)
    if (cont.at(k) >= 120) n2++
    if (total.at(k) >= 240) n4++
  }
  if (n)
    out.push(
      F(
        'env-sun',
        `건물·지형 그림자로 계산한 대지 안 하루 일조시간은 평균 동지 ${fmt(sw / n / 60, 1)}시간, 춘·추분 ${fmt(se / n / 60, 1)}시간, 하지 ${fmt(ss / n / 60, 1)}시간이다. 동지에 09~15시 연속 2시간 이상 해가 드는 곳은 대지의 ${pctText(n2 / n)}, 08~16시 합계 4시간 이상은 ${pctText(n4 / n)}이다 (대지 안 기존 건물은 없다고 본 계산값, 판정용 아님).`,
      ),
    )

  // 개방감
  const svf = unpackGrid(e.coarse.svf)
  const rm = radiusMask(svf, d.R)
  const vals: number[] = []
  for (let k = 0; k < rm.length; k++) if (rm[k] && Number.isFinite(svf.at(k))) vals.push(svf.at(k))
  vals.sort((a, b) => a - b)
  const maxA = e.sky.horizon.reduce((bi, v, i, arr) => (v > arr[bi] ? i : bi), 0)
  out.push(
    F(
      'env-sky',
      `대지 가운데 눈높이(1.5m)에서 하늘이 보이는 비율(개방감)은 ${pctText(e.sky.svf)}이고${e.sky.horizon[maxA] > 1 ? `, 가장 높게 가리는 쪽은 ${DIR8[Math.round(maxA / 45) % 8]}쪽(올려본각 ${fmt(e.sky.horizon[maxA])}°)이다` : ', 주변이 거의 트여 있다'}. 반경 안 건물 밖 땅의 개방감 중앙값은 ${vals.length ? pctText(vals[vals.length >> 1]) : '—'}이다.`,
    ),
  )

  // 가시권
  const view = unpackGrid(e.coarse.view)
  const heights = [10, 20, 40, 80]
  const cnt = heights.map(() => 0)
  let nv = 0
  for (let k = 0; k < rm.length; k++) {
    if (!rm[k]) continue
    const v = view.at(k)
    if (!Number.isFinite(v)) continue
    nv++
    heights.forEach((h, i) => v <= h && cnt[i]++)
  }
  if (nv)
    out.push(
      F(
        'env-view',
        `대지 가운데에 지은 건물의 꼭대기가 반경 안 건물 밖 땅(눈높이 1.5m)에서 보이는 비율은 높이 ${heights.map((h, i) => `${h}m(약 ${Math.round(h / FLOOR_M)}층) ${pctText(cnt[i] / nv)}`).join(', ')}이다 (건물·지형 가림 계산값).`,
      ),
    )

  // 수목
  if (e.trees) {
    const t = unpackGrid(e.trees)
    const tr = radiusMask(t, d.R)
    const near = nearMask(t, site, 30, Math.min(d.R, 200))
    let a = 0
    let b = 0
    let c = 0
    let dd = 0
    for (let k = 0; k < tr.length; k++) {
      if (tr[k]) {
        a++
        if (t.raw[k] === 1) b++
      }
      if (near[k]) {
        c++
        if (t.raw[k] === 1) dd++
      }
    }
    out.push(
      F(
        'env-trees',
        `위성영상 색으로 찾은 초록 덮개(나무 그늘·풀밭)는 반경 안 땅의 ${pctText(a ? b / a : 0)}, 대지 경계 30m 안의 ${pctText(c ? dd / c : 0)}이다 (그림자 속 나무·낙엽수는 빠질 수 있는 최소치).`,
        'low',
      ),
    )
  }

  // 바람 실험
  const parts: string[] = []
  for (const wnd of e.winds) {
    if (!wnd.stable) continue
    const g = unpackGrid(wnd.ratio)
    const near: number[] = []
    for (let r = 0; r < g.ny; r++)
      for (let c = 0; c < g.nx; c++) {
        const v = g.at(r * g.nx + c)
        if (!Number.isFinite(v)) continue
        const s = g.x0 + (c + 0.5) * g.cell
        const tt = g.y0 - (r + 0.5) * g.cell
        const x = s * wnd.d[0] + tt * wnd.l[0]
        const y = s * wnd.d[1] + tt * wnd.l[1]
        if (Math.abs(x) > 120 || Math.abs(y) > 120) continue
        let close = false
        for (const ring of site)
          for (let i = 1; i < ring.length && !close; i++) {
            const [ax, ay] = ring[i - 1]
            const [bx, by] = ring[i]
            const dx = bx - ax
            const dy = by - ay
            const L2 = dx * dx + dy * dy
            const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0
            if (Math.hypot(ax + dx * t - x, ay + dy * t - y) <= 30) close = true
          }
        if (close) near.push(v)
      }
    if (near.length) parts.push(`${wnd.season} ${windName(wnd.fromAz)}풍일 때 대지 주변 30m는 들어오는 바람의 평균 ${fmt(near.reduce((a, b) => a + b, 0) / near.length, 2)}배`)
  }
  if (parts.length)
    out.push(F('env-wind', `2D 바람 흐름 실험(격자 볼츠만)에서 ${parts.join(', ')}이다. 높은 건물(20m 이상)만 막고 낮은 건물은 바람이 줄며 지나가게 단순화한 평면 계산이라 실제 바람과 다를 수 있다.`, 'low'))

  // 열쾌적 실험
  const utciPacked = e.fine.utci ?? e.coarse.utci
  if (utciPacked && e.thermal) {
    const u = unpackGrid(utciPacked)
    const near = nearMask(u, site, 30, Math.min(d.R, 200))
    const v: number[] = []
    for (let k = 0; k < near.length; k++) if (near[k] && Number.isFinite(u.at(k))) v.push(u.at(k))
    if (v.length) {
      v.sort((a, b) => a - b)
      out.push(
        F(
          'env-heat',
          `더운 여름 오후(${e.thermal.label}, 기온 ${fmt(e.thermal.ta, 1)}℃·습도 ${fmt(e.thermal.rh)}%) 조건의 체감 더위(UTCI) 실험에서 대지 주변 30m는 ${fmt(v[0], 1)}~${fmt(v[v.length - 1], 1)}℃(중앙 ${fmt(v[v.length >> 1], 1)}℃)이다. 그늘·바람을 단순하게 어림한 실험값이다.`,
          'low',
        ),
      )
    }
  }
  return out
}

/** 환경 계산 결과를 담고 카드를 만든다 */
export function applyEnv(project: Project, e: EnvResult | null, error: string | null): void {
  project.collected = {
    ...project.collected,
    ...(e
      ? {
          'env:result': {
            dataset_id: 'env:result',
            retrieved_at: e.computedAt,
            features: [{ type: 'Feature' as const, geometry: null, properties: e as unknown as Record<string, unknown> }],
          },
        }
      : {}),
  }
  const src = apiSource({
    source_name: '대지해석 에이전트 환경 계산 (브라우저)',
    dataset_name: '일조시간·개방감·가시권·수목·바람 흐름 실험·여름 열쾌적 실험',
    dataset_id: 'env:result',
    retrieved_at: e?.computedAt ?? new Date().toISOString(),
    geometry: `대지 중심 반경 ${e?.R ?? project.collectedRadiusM ?? project.site.radiusM}m (일조 세부는 200m)`,
    spatial_scale: '2m·4m 칸',
    raw_ref: e ? 'env:result' : null,
    unit: '시간, %, m, ℃',
    license: VWORLD_LICENSE,
    reliability: 'computed',
    limitations:
      '건물 높이는 층수×3m(모르면 3m), 대지 안 기존 건물은 없다고 보고, 반경 밖 건물은 빠진다. 지형은 10m 격자. 수목은 위성영상 색으로 찾은 최소치. 바람·열쾌적은 단순화한 실험이다. 모두 참고용이며 일조권·인허가 판정에 쓸 수 없다.',
    original_url: '',
    feature_count: null,
    status: error ? 'error' : 'ok',
    error,
  })
  const prev = project.sources.find((s) => s.dataset_id === 'env:result')
  let srcId: string
  if (prev) {
    Object.assign(prev, { ...src, source_id: prev.source_id })
    srcId = prev.source_id
  } else {
    srcId = nextNumber(project, 'S')
    project.sources.push({ ...src, source_id: srcId })
  }
  if (!e) {
    upsertDrafts(project, [
      {
        auto_key: 'env-error',
        type: 'UNKNOWN',
        topic: '환경 계산',
        text: `환경 계산을 하지 못했다 (${error}). 다시 수집하거나 '주변 건물'을 함께 골라야 한다.`,
        sources: [srcId],
        confidence: 'low',
        human_validation_required: true,
      },
    ])
    return
  }
  const d = buildDiagramData(project)
  if (!d) return
  // 지난번 오류 카드는 지우고 새로
  project.cards = project.cards.filter((c) => c.auto_key !== 'env-error' || c.edited)
  upsertDrafts(project, drafts(d, e, srcId))
}
