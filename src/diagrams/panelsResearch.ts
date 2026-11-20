// 스케일별 주요 이슈 (2026-11-18 사용자 요청·인터뷰: 거시 → 미시 — 대한민국 → 광역 → 시·군·구 → 동 → 대지 주변 — 각 관점의 주요 이슈를
// 다이어그램으로, ⑥ 도판에만). 자료: ⑤ 사실 카드의 정성 조사(챗봇 웹 조사) 중 학생이 제외하지 않은 카드.
// 지도가 아닌 그림: 위에서 아래로 한 단씩 안쪽으로 들어가는 계단 — 단마다 스케일·지역 이름과 이슈(주제 색 점 + 제목 + 시점).

import { ISSUE_YEARS, RESEARCH_THEMES } from '../model/researchScales'
import { esc, FONT, textWidth, type LegendItem, type PanelOutput } from './compose'
import { mix } from './palette'
import type { PanelDef } from './panels'

/** 글 폭에 맞게 자름 */
function fit(s: string, maxW: number, size: number): string {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(`${out}${ch}…`, size) > maxW) break
    out += ch
  }
  return `${out}…`
}

const X0 = 40
const X1 = 960
const Y0 = 40
const Y1 = 960
const STEP = 34
const MAX_ITEMS = 4

export const RESEARCH_PANEL: PanelDef = {
  id: 'scaleIssues',
  title: '스케일별 주요 이슈 (대한민국 → 대지 주변)',
  group: '사회·경제',
  needs: "⑤ 사실 카드 맨 위 '정성 조사'에서 챗봇 답을 붙여 넣으면 그립니다 (제외한 카드는 빠짐).",
  render: (c): PanelOutput => {
    const tiers = c.d.research ?? []
    const total = tiers.reduce((s, t) => s + t.items.length, 0)
    if (!total) return { layers: [], legend: [], summary: [], caption: '', empty: "정성 조사 카드가 없습니다 — ⑤ 사실 카드의 '정성 조사'에서 챗봇 답을 붙여 넣으세요", noFrame: true, hideBase: true, noScale: true }
    const pal = c.pal
    // 주제 색: 범주색 중 서로 잘 갈리는 셋 (이슈 = 파랑 계열 · 역사 = 주황 계열 · 문화 = 청록 계열, 묶음마다 다름)
    const THEME_CAT = [3, 1, 4]
    const themeColor = (th: string) => pal.cat[THEME_CAT[Math.max(0, RESEARCH_THEMES.indexOf(th as (typeof RESEARCH_THEMES)[number]))]] ?? pal.cat[0]
    const n = tiers.length
    const gap = 10
    const H = (Y1 - Y0 - gap * (n - 1)) / n
    const parts: string[] = []
    const lines: string[] = []
    tiers.forEach((t, i) => {
      const x = X0 + i * STEP
      const y = Y0 + i * (H + gap)
      const w = X1 - x
      // 단 바탕: 거시일수록 옅게, 미시로 갈수록 조금 진하게
      const fill = mix(pal.paper, pal.seq[Math.min(pal.seq.length - 1, i)], pal.dark ? 0.28 : 0.22)
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${H}" rx="10" fill="${fill}" stroke="${pal.ink}" stroke-opacity="0.35" stroke-width="1.2"/>`)
      // 위 단에서 내려오는 계단 선
      if (i > 0) {
        const px = X0 + (i - 1) * STEP + 16
        parts.push(`<path d="M${px} ${y - gap - 4} V${y + 26} H${x}" fill="none" stroke="${pal.ink}" stroke-opacity="0.45" stroke-width="1.5"/>`)
      }
      // 왼쪽: 스케일·지역
      const lx = x + 18
      const labW = 178
      parts.push(`<text x="${lx}" y="${y + 34}" font-family="${FONT}" font-size="23" font-weight="600" fill="${pal.ink}">${esc(t.scale)}</text>`)
      if (t.place) parts.push(`<text x="${lx}" y="${y + 60}" font-family="${FONT}" font-size="15" fill="${pal.subtle}">${esc(fit(t.place, labW - 10, 15))}</text>`)
      parts.push(`<text x="${lx}" y="${y + H - 16}" font-family="${FONT}" font-size="13" fill="${pal.subtle}">${t.items.length ? `이슈 ${t.items.length}개` : ''}</text>`)
      // 오른쪽: 이슈 (주제 색 점 + 제목 + 시점)
      const rx = x + labW + 12
      const rw = X1 - rx - 16
      const shown = t.items.slice(0, MAX_ITEMS)
      const lh = Math.min(34, (H - 24) / Math.max(1, shown.length + (t.items.length > MAX_ITEMS ? 1 : 0)))
      if (!shown.length) parts.push(`<text x="${rx}" y="${y + 36}" font-family="${FONT}" font-size="16" fill="${pal.subtle}">조사 없음</text>`)
      shown.forEach((it, k) => {
        const ty = y + 30 + k * lh
        const when = it.when && it.when !== '모름' ? ` (${it.when})` : ''
        const size = 17
        parts.push(`<circle cx="${rx + 7}" cy="${ty - 6}" r="6" fill="${themeColor(it.theme)}"/>`)
        parts.push(
          `<text x="${rx + 20}" y="${ty}" font-family="${FONT}" font-size="${size}" fill="${pal.ink}">${esc(fit(it.title, rw - 20 - textWidth(when, 14), size))}<tspan font-size="14" fill="${pal.subtle}">${esc(when)}</tspan></text>`,
        )
      })
      if (t.items.length > MAX_ITEMS) parts.push(`<text x="${rx + 20}" y="${y + 30 + shown.length * lh}" font-family="${FONT}" font-size="14" fill="${pal.subtle}">외 ${t.items.length - MAX_ITEMS}개</text>`)
      lines.push(`${t.scale}${t.place ? `(${t.place})` : ''}: ${t.items.length ? t.items.map((it) => it.title).join(' · ') : '조사 없음'}`)
    })
    const used = RESEARCH_THEMES.filter((th) => tiers.some((t) => t.items.some((it) => it.theme === th)))
    const legend: LegendItem[] = used.map((th) => ({ color: themeColor(th), label: th }))
    const ids = tiers.flatMap((t) => t.items.map((it) => it.id))
    return {
      layers: [{ id: '스케일별 주요 이슈', svg: parts.join(''), noClip: true }],
      legend,
      legendTitle: '주제',
      summary: [`정성 조사 ${total}건 (${ids.join(', ')})`, ...lines],
      caption: `자료: 챗봇 웹 조사 ${total}건 (학생이 제외한 것은 뺌) — 출처는 사실 카드마다 · 이슈·갈등·개발 계획은 최근 ${ISSUE_YEARS}년 · 정성 자료라 빠진 이슈가 있을 수 있음`,
      noFrame: true,
      hideBase: true,
      noScale: true,
    }
  },
}
