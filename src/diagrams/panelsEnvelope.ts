// 건축 가능 영역 3D 도판 (2026-11-21 묶음 E6): ⑪ 법규 검토에서 정한 띄울 거리·최고 높이·계단으로 깎은 덩어리를
// 주변 건물과 함께 3D로. ⑪ 화면과 같은 계산(src/law/envelopeData.ts)을 써서 같은 덩어리가 나온다.
// 사용자 결정: 7 법규 개요 옆 새 도판 · 캡션에 '참고용·확인 필요' (법적 판정이 아님).

import { bcrOf, envelopeOf, farOf, simplifiedSlabs } from '../law/envelopeData'
import { loadOrdinances } from '../law/ordinances'
import type { PanelOutput } from './compose'
import type { DiagramData } from './data'
import { MAP_CX, MAP_CY } from './frame'
import { siteRingsXY } from './move'
import { mix } from './palette'
import type { PanelDef } from './panels'
import { to3d } from './view3d'

export const ENVELOPE_ID = 'envelope'

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

function siteFar(d: DiagramData): number {
  return Math.max(0, ...siteRingsXY(d).flat().map(([x, y]) => Math.hypot(x, y)))
}

const empty = (msg: string): PanelOutput => ({ layers: [], legend: [], summary: [], caption: '', empty: msg })

export const ENVELOPE_PANEL: PanelDef = {
  id: ENVELOPE_ID,
  title: '건축 가능 영역 (참고)',
  group: '땅의 조건',
  needs: "⑪ 법규 검토의 '건축 가능 영역'에서 띄울 거리·최고 높이를 정하세요.",
  // 대지가 가운데 크게, 덩어리가 높아도 둘레 건물이 조금 보이게 (대지 끝 × 2 + 40m, 100m 이상)
  frameR: (d) => Math.min(d.R, Math.max(100, Math.ceil((siteFar(d) * 2 + 40) / 10) * 10)),
  render: async (c): Promise<PanelOutput> => {
    const law = c.law
    if (!law) return empty("⑪ 법규 검토의 '건축 가능 영역'에서 띄울 거리·최고 높이를 정하면 그립니다")
    const table = await loadOrdinances()
    const { result: r, cap, region, zones, siteArea, used } = envelopeOf(c.d, law, table)
    if (!r) return empty('대지 경계가 없습니다')
    const slabs = simplifiedSlabs(r)
    if (!slabs.length) return empty('띄울 거리를 빼고 나면 지을 수 있는 곳이 없습니다 — ⑪에서 띄울 거리를 확인하세요')
    const env = law.env
    const floorStep = (env.step ?? 'floor') === 'floor'
    const floorH = env.floorH ?? 3.5

    // 바닥: 도로(너비만큼 옅게) + 대지 변(도로에 접한 변 = 건축선 쪽 굵게)
    const roadC = mix(c.pal.paper, c.pal.ink, c.pal.dark ? 0.2 : 0.1)
    const roads = c.d.roads
      .map((rd) => `<path d="${c.f.path(rd.geom)}" fill="none" stroke="${roadC}" stroke-width="${(Math.max(2, rd.width ?? 4) * c.f.s).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`)
      .join('')
    const X = (e: number) => (MAP_CX + e * c.f.s).toFixed(1)
    const Y = (n: number) => (MAP_CY - n * c.f.s).toFixed(1)
    const edges = r.edges
      .filter((e) => e.kind === 'road')
      .map((e) => `<line x1="${X(e.a[0])}" y1="${Y(e.a[1])}" x2="${X(e.b[0])}" y2="${Y(e.b[1])}" stroke="${c.pal.ink}" stroke-width="3" stroke-linecap="round"/>`)
      .join('')
    const flat: PanelOutput = {
      layers: [
        { id: '도로', svg: roads },
        { id: '도로에_접한_변', svg: edges },
      ],
      legend: [],
      summary: [],
      caption: '',
    }
    // 대지 안 기존 건물·설계안은 빼고 주변 건물만
    const d3 = { buildings: c.d.buildings.filter((b) => b.src !== 'design'), scenario: null }
    const site = `<path d="${c.f.path(c.d.boundary, false)}" fill="${c.pal.accent}" fill-opacity="0.06" stroke="${c.pal.accent}" stroke-width="2"/>`
    const out = to3d(flat, { d: d3, f: c.f, pal: c.pal, st: c.st, ty: c.ty }, site, 'clip-envelope', {
      stack: { slabs: slabs.map((s) => ({ bottom: s.bottom, top: s.top, rings: s.rings })), note: '강조색 덩어리 = 건축 가능 영역(참고)' },
    })

    const summary: string[] = []
    summary.push(`대지 약 ${fmt(siteArea || r.siteArea)}㎡ · 1층으로 쓸 수 있는 넓이 약 ${fmt(r.buildableArea)}㎡ (띄울 거리·정북 1.5m를 뺀 곳)`)
    summary.push(
      `가장 높은 곳 ${fmt(r.maxHeight, 1)}m${floorStep ? ` (${Math.round(r.maxHeight / floorH)}층, 층고 ${fmt(floorH, 1)}m 계단)` : ' (1m 계단)'}${r.unlimited && !env.maxHeight ? ` — 높이 제한을 넣지 않아 ${cap ? `${fmt(cap, 1)}m(검토서의 층수 × 층고 — 층수를 넣지 않았으면 가정한 층수)` : '그림용 높이'}에서 자름` : ''}`,
    )
    if (r.fullGfa !== null) summary.push(`덩어리를 층마다 꽉 채우면 연면적 약 ${fmt(r.fullGfa)}㎡ — 실제로는 건폐율·용적률로 더 작음`)
    const bcr = bcrOf(region, zones)
    const far = farOf(region, zones)
    if (bcr !== undefined || far !== undefined)
      summary.push(
        [bcr !== undefined ? `건폐율 상한 ${bcr}% → 건축면적 약 ${fmt((siteArea * bcr) / 100)}㎡` : '', far !== undefined ? `용적률 상한 ${far}% → 지상 연면적 약 ${fmt((siteArea * far) / 100)}㎡` : '']
          .filter(Boolean)
          .join(' · ') + (region ? ` (${region.org} 조례 표)` : ' (법 상한 — 조례로 더 낮을 수 있음)'),
      )
    summary.push(`띄울 거리: 건축선에서 ${used.road}m(${used.roadFrom === 'input' ? '넣은 값' : '조례'}) · 인접 대지에서 ${used.side}m(${used.sideFrom === 'input' ? '넣은 값' : '조례'}) · 최고 높이 ${env.maxHeight ? `${env.maxHeight}m` : '넣지 않음'}${law.apartment ? ' · 공동주택(정북 일조는 북쪽 도로·공원의 가운데 선부터)' : ''}`)
    if (!law.edgesValid) summary.push('대지 경계가 바뀌어 ⑪에서 손으로 고친 도로변을 쓰지 않음 — ⑪에서 다시 확인')
    if (r.unknownWidthRoads) summary.push(`너비를 모르는 도로에 접한 변 ${r.unknownWidthRoads}곳 — 4m 미만이면 건축선이 물러남`)
    if (r.sunUnknownNeighbor) summary.push('북쪽 대지의 용도지역을 자료로 알 수 없는 곳은 주거지역으로 보고 깎음')

    return {
      ...out,
      legend: [
        { color: mix(c.pal.paper, c.pal.accent, 0.45), label: '건축 가능 영역 (띄울 거리·정북 일조·최고 높이로 깎음)' },
        { color: c.pal.ink, label: '도로에 접한 변 (건축선 쪽)' },
        { color: roadC, label: '도로' },
        { color: c.pal.dark ? mix(c.pal.base, c.pal.ink, 0.25) : mix(c.pal.paper, c.pal.base, 0.9), label: '주변 건물' },
      ],
      legendTitle: '건축 가능 영역 (참고용)',
      summary,
      caption: `참고용·확인 필요 — 법적 판정이 아님 · ⑪ 법규 검토에서 넣은 대지 안의 공지(조례 별표, 건축법 제58조)·좁은 도로 건축선(제46조)·정북 일조(제61조 ①, 시행령 제86조)·최고 높이로 깎은 덩어리 · 건폐율·용적률, 도로 모퉁이 건축선, 공동주택 채광·동 사이 거리, 지구단위계획은 반영 안 함 · ${out.caption}`,
    }
  },
}
