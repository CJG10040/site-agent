// 14-F 분해 다이어그램 (2026-11-12 사용자 결정: 기본 구성 + 학생이 층을 더하기·빼기·순서 바꾸기).
// 여러 도판의 그림을 비스듬히 본 판으로 층층이 띄워 쌓고, 대지 모서리를 세로 점선으로 이어 층끼리 위치를 맞춰 보게 한다.
// 층마다 도판 하나(그 도판의 평면 그림, 글자는 뺌) 또는 '대지' 판(대지만 강조).

import type { DiagramSettings } from '../model/types'
import { esc, type LegendItem, type PanelOutput } from './compose'
import { MAP_CX, MAP_CY, MAP_R, SHEET_W } from './frame'
import { mix } from './palette'
import type { PanelDef } from './panels'

export const EXPLODED_ID = 'exploded'
export const SITE_LAYER = 'site'
/** 기본 구성 (아래 → 위): 지형 · 물·녹지 · 교통(도로·대중교통) · 건물 · 대지 */
export const EXPLODED_DEFAULT = ['terrain', 'green', 'roads', 'transit', 'figure', SITE_LAYER]

export function explodedLayers(st: Pick<DiagramSettings, 'exploded'>): string[] {
  return st.exploded?.layers?.length ? st.exploded.layers : EXPLODED_DEFAULT
}

export function explodedAz(st: Pick<DiagramSettings, 'exploded' | 'cam3d'>): number {
  return st.exploded?.az ?? st.cam3d?.az ?? 225
}

/** 판 하나의 평면 → 화면 변환 (크기 k, 판 가운데 cx·cy) */
function plate(az: number, tilt: number, k: number, cx: number, cy: number) {
  const A = (az * Math.PI) / 180
  const T = (tilt * Math.PI) / 180
  const sinA = Math.sin(A)
  const cosA = Math.cos(A)
  const sinT = Math.sin(T)
  const P = (px: number, py: number): [number, number] => {
    const X = (px - MAP_CX) * k
    const Y = (MAP_CY - py) * k
    return [cx - X * cosA + Y * sinA, cy + (X * sinA + Y * cosA) * sinT]
  }
  const m = [-k * cosA, k * sinT * sinA, -k * sinA, -k * sinT * cosA, cx + k * (MAP_CX * cosA + MAP_CY * sinA), cy - k * sinT * (MAP_CX * sinA - MAP_CY * cosA)]
  return { P, matrix: `matrix(${m.map((v) => v.toFixed(5)).join(' ')})` }
}

const stripTexts = (svg: string) => svg.replace(/<text\b[\s\S]*?<\/text>/g, '')

export const EXPLODED_PANEL: PanelDef = {
  id: EXPLODED_ID,
  title: '분해 다이어그램',
  group: '종합',
  needs: '이 카드에서 층으로 쌓을 도판을 고르세요.',
  render: async (c): Promise<PanelOutput> => {
    const ids = explodedLayers(c.st)
    if (!c.basePanel) return { layers: [], legend: [], summary: [], caption: '', empty: '그릴 수 없습니다' }
    const label = (id: string) => (id === SITE_LAYER ? '대지' : (c.panelLabel?.(id) ?? id).replace(/^도판 \d+ /, ''))
    // 층 그림 모으기 (자료가 없는 층은 빼고 알림)
    const plates: { id: string; out: PanelOutput | null }[] = []
    const skipped: string[] = []
    for (const id of ids) {
      if (id === SITE_LAYER) {
        plates.push({ id, out: null })
        continue
      }
      const o = await c.basePanel(id).catch(() => null)
      if (!o || o.empty || o.noFrame) skipped.push(label(id))
      else plates.push({ id, out: o })
    }
    if (!plates.length) return { layers: [], legend: [], summary: [], caption: '', empty: '쌓을 층에 그릴 자료가 없습니다' }

    const az = explodedAz(c.st)
    const tilt = 30
    const n = plates.length
    const sinT = Math.sin((tilt * Math.PI) / 180)
    // 판 크기: 높이로는 전체가 도판 위쪽(약 30~980px)에, 폭으로는 오른쪽 층 이름 자리(약 230px)를 남기게
    const k = Math.min(930 / (1 + 0.62 * (n - 1)) / (2 * MAP_R * sinT), (SHEET_W - 270) / (2 * MAP_R))
    const H = 2 * MAP_R * sinT * k
    // 남는 높이는 판 사이를 벌리는 데 (판 높이의 90%까지)
    const gap = n > 1 ? Math.min(H * 0.9, (930 - H) / (n - 1)) : 0
    const cx = 30 + MAP_R * k
    const bottomCy = 975 - H / 2
    const shape =
      c.f.shape === 'circle' ? `<circle cx="${MAP_CX}" cy="${MAP_CY}" r="${MAP_R}"/>` : `<rect x="${MAP_CX - MAP_R}" y="${MAP_CY - MAP_R}" width="${MAP_R * 2}" height="${MAP_R * 2}"/>`
    const filled = (fill: string, extra = '') => shape.replace('/>', ` fill="${fill}"${extra}/>`)
    const clip = `<defs><clipPath id="exploded-clip">${shape}</clipPath></defs>`
    const sitePath = c.f.path(c.d.boundary, false)
    const siteRing = (c.d.boundary.type === 'Polygon' ? c.d.boundary.coordinates[0] : c.d.boundary.coordinates[0][0]).map(([lon, lat]) => c.f.pt(lon, lat))
    // 대지 모서리 (많으면 띄엄띄엄 6개)
    const corners = siteRing.length > 7 ? Array.from({ length: 6 }, (_, i) => siteRing[Math.floor((i * (siteRing.length - 1)) / 6)]) : siteRing.slice(0, -1)

    let svg = clip
    const tops: [number, number][][] = []
    plates.forEach((p, i) => {
      const cy = bottomCy - i * gap
      const pl = plate(az, tilt, k, cx, cy)
      const body =
        p.id === SITE_LAYER
          ? `<path d="${sitePath}" fill="${c.pal.accent}" fill-opacity="0.85" stroke="${c.pal.accent}" stroke-width="3"/>`
          : p.out!.layers.map((l) => `<g>${stripTexts(l.svg)}</g>`).join('') +
            `<path d="${sitePath}" fill="none" stroke="${c.pal.accent}" stroke-width="3" stroke-dasharray="${i === n - 1 ? '' : '8 6'}"/>`
      svg +=
        `<g id="층_${i + 1}_${esc(label(p.id).replace(/[\s·()]+/g, '_'))}">` +
        `<g transform="translate(0 6) ${pl.matrix}">${filled(mix(c.pal.paper, c.pal.ink, c.pal.dark ? 0.22 : 0.14), p.id === SITE_LAYER ? ' fill-opacity="0.25"' : '')}</g>` +
        `<g transform="${pl.matrix}">${filled(c.pal.paper, p.id === SITE_LAYER ? ' fill-opacity="0.3"' : '')}<g clip-path="url(#exploded-clip)">${body}</g>${filled('none', ` stroke="${c.pal.ink}" stroke-opacity="0.45" stroke-width="1" vector-effect="non-scaling-stroke"`)}</g>` +
        // 층 이름: 판 오른쪽 끝에서 끌어낸 선
        (() => {
          const ex = cx + k * MAP_R
          const lx = ex + 26
          return `<path d="M${(ex + 4).toFixed(1)} ${cy.toFixed(1)}H${(lx - 6).toFixed(1)}" stroke="${c.pal.subtle}" stroke-width="1"/><text x="${lx.toFixed(1)}" y="${(cy + 6).toFixed(1)}" font-size="18" font-weight="700" fill="${c.pal.ink}"><tspan fill="${c.pal.subtle}" font-weight="400">${String(i + 1).padStart(2, '0')}  </tspan>${esc(label(p.id))}</text>`
        })() +
        `</g>`
      tops.push(corners.map(([x, y]) => pl.P(x, y)))
    })
    // 대지 모서리를 잇는 세로 점선 (아래 판 → 위 판)
    let ties = ''
    if (n > 1)
      for (let j = 0; j < corners.length; j++) {
        const [x0, y0] = tops[0][j]
        const [x1, y1] = tops[n - 1][j]
        ties += `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`
      }
    svg += ties ? `<path id="대지_잇는_선" d="${ties}" stroke="${c.pal.accent}" stroke-width="1.2" stroke-dasharray="3 4" stroke-opacity="0.8"/>` : ''

    // 범례: 층마다 앞 두 개
    const legend: LegendItem[] = []
    for (const p of [...plates].reverse()) {
      if (p.id === SITE_LAYER) {
        legend.push({ color: c.pal.accent, label: '대지 (점선 = 층을 잇는 대지 모서리)' })
        continue
      }
      for (const li of p.out!.legend.slice(0, 2)) if (legend.length < 15) legend.push({ ...li, label: `${label(p.id)} · ${li.label}` })
    }
    return {
      layers: [{ id: '분해_층', svg, noClip: true }],
      legend,
      legendTitle: `층 (위 → 아래): ${[...plates].reverse().map((p) => label(p.id)).join(' · ')}`,
      summary: [
        `${n}개 층을 아래부터 쌓음: ${plates.map((p) => label(p.id)).join(' → ')}`,
        ...plates.filter((p) => p.out?.summary[0]).map((p) => `${label(p.id)} — ${p.out!.summary[0]}`),
        skipped.length ? `자료가 없어 뺀 층: ${skipped.join(', ')}` : '',
      ].filter(Boolean),
      caption: `분해 다이어그램 · 각 층은 해당 도판의 평면 그림(글자는 뺌)을 같은 축척·같은 방향으로 겹쳐 띄움 · 붉은 점선은 대지 모서리 · ${['북', '북동', '동', '남동', '남', '남서', '서', '북서'][Math.round(az / 45) % 8]}쪽에서 ${tilt}° 내려다봄 · 판 사이 간격은 높이가 아님 · 출처는 각 도판 참고`,
      noFrame: true,
      hideBase: true,
    }
  },
}
