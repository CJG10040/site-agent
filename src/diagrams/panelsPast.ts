// 과거와 현재 도판 (2026-11-22 사용자 결정: 새 단계 — 나란히(과거 | 현재) · 옛 물길 · 시기별 시가지 · 길의 변화).
// ⑥ 도판 목록 밖(PANEL_GROUP_ORDER에 없음)이라 번호 없이 그린다. 그리는 방식은 다른 도판과 같아 SVG·PNG·리포트에 그대로.

import { booleanIntersects } from '@turf/turf'
import type { Bld } from './data'
import type { Areal } from '../lib/geo'
import type { PanelOutput } from './compose'
import { centroidOf } from './frame'
import { mix, steps } from './palette'
import type { PanelCtx, PanelDef } from './panels'

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

const empty = (msg: string): PanelOutput => ({ layers: [], legend: [], summary: [], caption: '', empty: msg })

function inFrame(c: PanelCtx, g: Areal): boolean {
  const ct = centroidOf(g)
  return !!ct && c.f.inside(ct[0], ct[1])
}

const existing = (c: PanelCtx): Bld[] => c.d.buildings.filter((b) => b.src !== 'design')

/** 지금 물: 수치지도 실폭하천·호수(올렸으면) + 도시계획 하천 구역 */
function waterNow(c: PanelCtx): Areal[] {
  const ng = (c.d.ngii?.water ?? []).filter((w) => w.kind !== 'bank').map((w) => w.geom)
  const up = c.d.parks.filter((p) => p.extra.kind === 'river').map((p) => p.geom)
  return [...ng, ...up]
}

function roadsSvg(c: PanelCtx, color: string, w: number, op = 1): string {
  const d = c.d.roads.map((r) => c.f.path(r.geom)).join('')
  return d ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-opacity="${op}" stroke-linecap="round" stroke-linejoin="round"/>` : ''
}

/** 옛 사진 한 장 (+ 지금 도로 선 = 길의 변화) */
export function pastPhotoDef(title: string): PanelDef {
  return {
    id: 'pastPhoto',
    title,
    group: '과거와 현재',
    needs: '옛 항공사진을 올리고 세 점으로 위치를 맞추세요.',
    render: (c): PanelOutput => {
      const p = c.past
      if (!p?.layer) return empty('옛 사진이 이 도판 범위에 들어오지 않습니다 — 세 점을 다시 확인하세요')
      const L = p.layer
      const road = c.pal.accent
      const layers = [{ id: '옛_사진', svg: `<image href="${L.href}" width="${L.width}" height="${L.height}" transform="${L.matrix}" preserveAspectRatio="none"/>` }]
      if (p.roadsOver) layers.push({ id: '지금_도로', svg: roadsSvg(c, road, 1.6, 0.85) })
      return {
        layers,
        legend: p.roadsOver ? [{ color: road, label: '지금 도로 (겹친 선과 다른 곳 = 새로 난 길·없어진 길)', shape: 'line' }] : [],
        summary: [`${p.name}${p.year ? ` (${p.year}년)` : ''} — 세 점으로 지금 지도에 맞춤`, ...(p.roadsOver ? ['강조색 선 = 지금 도로 — 사진의 옛 길과 겹치지 않는 곳이 새로 나거나 없어진 길'] : [])],
        caption: `옛 항공사진: 학생이 올린 그림(${p.name}), 세 점으로 위치 맞춤 — 가장자리·높은 땅은 몇 m 어긋날 수 있음${p.roadsOver ? ` · 지금 도로: ${c.date} 수집` : ''}`,
        hideBase: false,
      }
    },
  }
}

/** 지금 지도 그림 (건물·도로·물) */
export const PRESENT_MAP: PanelDef = {
  id: 'presentMap',
  title: '지금 (지도)',
  group: '과거와 현재',
  needs: '공간정보를 수집하세요.',
  render: (c): PanelOutput => {
    const bld = existing(c)
      .map((b) => c.f.path(b.geom, false))
      .join('')
    const water = waterNow(c)
      .map((g) => c.f.path(g))
      .join('')
    const waterC = mix(c.pal.paper, '#3b82c4', 0.55)
    return {
      layers: [
        { id: '물', svg: water ? `<path d="${water}" fill="${waterC}"/>` : '' },
        { id: '도로', svg: roadsSvg(c, mix(c.pal.paper, c.pal.ink, 0.35), 1.2) },
        { id: '건물', svg: bld ? `<path d="${bld}" fill="${c.pal.base}"/>` : '' },
      ],
      legend: [
        { color: c.pal.base, label: '건물' },
        { color: mix(c.pal.paper, c.pal.ink, 0.35), label: '도로', shape: 'line' },
        ...(water ? [{ color: waterC, label: '하천·호수' }] : []),
      ],
      summary: [`지금 건물 ${fmt(existing(c).filter((b) => inFrame(c, b.geom)).length)}동`],
      caption: `건물·도로·하천(수치지도 실폭하천, 도시계획 하천) · ${c.date} 수집`,
    }
  },
}

/** 옛 물길: 브이월드 하천망(옛 물길이 섞임)과 지금 물, 옛 물길 위에 선 건물 */
export const OLD_RIVER: PanelDef = {
  id: 'oldRiver',
  title: '옛 물길과 지금',
  group: '과거와 현재',
  needs: "공간정보에서 '하천'을 수집하세요.",
  render: (c): PanelOutput => {
    const old = c.d.oldRivers
    if (!old.length) return empty('반경 안에 하천망 자료가 없습니다')
    const now = waterNow(c)
    const bs = existing(c).filter((b) => inFrame(c, b.geom))
    const onOld = bs.filter((b) => old.some((r) => booleanIntersects(b.geom, r.geom)) && !now.some((w) => booleanIntersects(b.geom, w)))
    const oldC = mix(c.pal.paper, '#3b82c4', 0.28)
    const nowC = mix(c.pal.paper, '#1c5fa8', 0.7)
    const hit = c.pal.accent
    const p = (gs: Areal[]) => gs.map((g) => c.f.path(g)).join('')
    const others = bs.filter((b) => !onOld.includes(b))
    const names = [...new Set(old.map((r) => r.name))].join('·')
    return {
      layers: [
        { id: '옛_물길', svg: `<path d="${p(old.map((r) => r.geom))}" fill="${oldC}" stroke="#3b82c4" stroke-width="1" stroke-dasharray="5 4"/>` },
        { id: '지금_물', svg: now.length ? `<path d="${p(now)}" fill="${nowC}"/>` : '' },
        { id: '건물', svg: `<path d="${others.map((b) => c.f.path(b.geom, false)).join('')}" fill="${c.pal.base}"/>` },
        { id: '옛_물길_위_건물', svg: onOld.length ? `<path d="${onOld.map((b) => c.f.path(b.geom, false)).join('')}" fill="${hit}"/>` : '' },
      ],
      legend: [
        { color: oldC, label: `옛 물길 (하천망 ${names})` },
        ...(now.length ? [{ color: nowC, label: '지금 하천 (수치지도·도시계획)' }] : []),
        { color: hit, label: '옛 물길 위에 선 건물' },
      ],
      summary: [
        `하천망(${names})이 지금 물길과 다른 곳에 건물 ${fmt(onOld.length)}동 — 물길을 메우거나 옮긴 땅일 수 있음`,
        ...(onOld.some((b) => b.onSite) ? ['대지 안에도 옛 물길이 지나감 — 지반·침수 이력 확인 거리'] : []),
      ],
      caption: `옛 물길: 브이월드 하천망(지금 물길과 다른 옛 자료가 섞임 — 정확한 시기는 모름) · 지금 하천: 수치지도 실폭하천·도시계획 하천 · ${c.date} 수집`,
    }
  },
}

export const GROWTH_YEARS = [1970, 1990, 2010] as const

/** 시기별 시가지: 그 해에 이미 있던 건물(사용승인 연도) — 지금 건물만으로 본 것이라 그 뒤 헐린 건물은 없음 */
export function growthDef(year: number | null): PanelDef {
  return {
    id: year ? `growth${year}` : 'growthNow',
    title: year ? `${year}년의 시가지` : '지금의 시가지',
    group: '과거와 현재',
    needs: "공간정보에서 '주변 건물'을 수집하세요.",
    render: (c): PanelOutput => {
      const bs = existing(c)
      if (!bs.length) return empty('건물 자료가 없습니다')
      const known = bs.filter((b) => b.year !== null)
      const was = year ? known.filter((b) => b.year! <= year) : bs
      const later = year ? known.filter((b) => b.year! > year) : []
      const unknown = year ? bs.filter((b) => b.year === null) : []
      const col = steps(c.pal, 4)[3]
      const faint = mix(c.pal.paper, c.pal.ink, 0.07)
      const path = (list: Bld[]) => list.map((b) => c.f.path(b.geom, false)).join('')
      const inside = (list: Bld[]) => list.filter((b) => inFrame(c, b.geom)).length
      return {
        layers: [
          { id: '바탕_도로', svg: roadsSvg(c, mix(c.pal.paper, c.pal.ink, 0.12), 0.8) },
          { id: '그_뒤_건물', svg: later.length || unknown.length ? `<path d="${path([...later, ...unknown])}" fill="${faint}"/>` : '' },
          { id: '그_해의_건물', svg: `<path d="${path(was)}" fill="${col}"/>` },
        ],
        legend: [
          { color: col, label: year ? `${year}년까지 지은 건물 (지금 남은 것)` : '지금 건물' },
          ...(year ? [{ color: faint, label: '그 뒤에 지었거나 연도 모름' }] : []),
        ],
        summary: [year ? `${year}년까지 지은 건물 ${fmt(inside(was))}동 (지금 ${fmt(inside(bs))}동 가운데, 연도 모름 ${fmt(inside(unknown))}동)` : `지금 건물 ${fmt(inside(bs))}동`],
        caption: `건축물대장 사용승인 연도로 본 시가지 — 지금 남은 건물만이라 그 뒤 헐린 옛 건물은 나오지 않음 · 도로는 지금 도로 · ${c.date} 수집`,
      }
    },
  }
}

export const GROWTH_DEFS: PanelDef[] = [...GROWTH_YEARS.map((y) => growthDef(y)), growthDef(null)]
