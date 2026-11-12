// 14-D 두 주제 겹쳐 보기 (2026-11-12 사용자 결정, archiMap의 '인구밀도 + 건물 용도' 같은 겹친 도판 참고).
// 도판 둘을 골라 한 장에: 아래 도판은 그대로, 위 도판은 투명하게 또는 선만(면을 테두리로 바꿈).
// 칸이 3개(겹쳐 보기 1~3) — 앞 칸을 채우면 다음 칸이 ⑥에 나타난다.

import type { DiagramSettings, OverlaySpec } from '../model/types'
import type { LegendItem, PanelLayer, PanelOutput } from './compose'
import { mix } from './palette'
import type { PanelDef } from './panels'

export const OVERLAY_SLOTS = 3
export const OVERLAY_IDS = Array.from({ length: OVERLAY_SLOTS }, (_, i) => `overlay${i + 1}`)

export function isOverlayId(id: string): boolean {
  return OVERLAY_IDS.includes(id)
}

export function overlaySpec(st: Pick<DiagramSettings, 'overlays'>, id: string): OverlaySpec | null {
  const i = OVERLAY_IDS.indexOf(id)
  const s = i >= 0 ? st.overlays?.[i] : null
  return s && s.base && s.top ? s : null
}

/** 면(fill)을 그 색의 테두리로 바꿈 — 글자·그림(image)은 그대로 */
export function outlineSvg(svg: string, width = 1.3, adjust: (color: string) => string = (x) => x): string {
  return svg.replace(/<(path|circle|rect|polygon|ellipse|g)\b([^>]*?)(\/?)>/g, (m, tag: string, attrs: string, close: string) => {
    const fm = /\sfill="([^"]+)"/.exec(attrs)
    if (!fm) return m
    const fill = fm[1]
    if (fill === 'none' || fill.startsWith('url(')) return m
    const a = attrs
      .replace(/\sfill="[^"]*"/, ' fill="none"')
      .replace(/\sfill-opacity="[^"]*"/, '')
      .replace(/\sstroke="[^"]*"/, '')
      .replace(/\sstroke-width="[^"]*"/, '')
      .replace(/\sstroke-opacity="[^"]*"/, '')
    return `<${tag}${a} stroke="${adjust(fill)}" stroke-width="${width}"${close}>`
  })
}

function emptyOut(text: string): PanelOutput {
  return { layers: [], legend: [], summary: [], caption: '', empty: text }
}

export function overlayPanel(slot: number): PanelDef {
  const id = OVERLAY_IDS[slot]
  return {
    id,
    title: `겹쳐 보기 ${slot + 1}`,
    group: '겹쳐 보기',
    needs: '이 카드에서 아래 도판과 위 도판을 고르세요.',
    // 틀은 아래 도판의 틀을 빌림 (render.ts)
    frameFrom: (st) => overlaySpec(st, id)?.base ?? null,
    render: async (c): Promise<PanelOutput> => {
      const spec = overlaySpec(c.st, id)
      if (!spec) return emptyOut('겹칠 두 도판을 고르세요')
      if (!c.basePanel) return emptyOut('겹쳐 그릴 수 없습니다')
      const label = (x: string) => c.panelLabel?.(x) ?? x
      const [b, t] = await Promise.all([c.basePanel(spec.base).catch(() => null), c.basePanel(spec.top).catch(() => null)])
      if (!b || b.empty) return emptyOut(`아래 도판(${label(spec.base)})에 그릴 자료가 없습니다`)
      if (!t || t.empty) return emptyOut(`위 도판(${label(spec.top)})에 그릴 자료가 없습니다`)
      if (b.noFrame || t.noFrame) return emptyOut('지도가 아닌 도판(단면·그래프)은 겹칠 수 없습니다')
      const op = Math.max(0.15, Math.min(1, spec.opacity))
      const lines = spec.mode === 'lines'
      // 선만: 옅은 색(낮은 단계)도 보이게 글자색 쪽으로 조금 진하게
      const darker = (col: string) => (/^#[0-9a-f]{6}$/i.test(col) ? mix(col, c.pal.ink, 0.28) : col)
      const bottom: PanelLayer[] = b.layers.map((l) => ({ ...l, id: `아래_${l.id}` }))
      // 위 도판의 회색 바탕(건물·도로)은 아래 도판과 겹쳐 지저분해지므로 뺌
      const top: PanelLayer[] = t.layers
        .filter((l) => !/^바탕/.test(l.id))
        .map((l) => ({ ...l, id: `위_${l.id}`, svg: `<g opacity="${op.toFixed(2)}">${lines ? outlineSvg(l.svg, 1.4, darker) : l.svg}</g>` }))
      const topLegend: LegendItem[] = t.legend.map((li) => ({ ...li, label: `위 · ${li.label}`, ...(lines && !li.glyph ? { shape: 'line' as const, color: darker(li.color) } : {}) }))
      const pick = (o: PanelOutput) => o.summary.slice(0, 2)
      return {
        layers: [...bottom, ...top],
        legend: [...b.legend, ...topLegend],
        legendTitle: `아래: ${b.legendTitle ?? label(spec.base)} · 위: ${t.legendTitle ?? label(spec.top)}${lines ? ' (선만)' : ` (투명 ${Math.round((1 - op) * 100)}%)`}`,
        summary: [`겹친 도판: 아래 ${label(spec.base)} + 위 ${label(spec.top)}`, ...pick(b).map((s) => `아래 — ${s}`), ...pick(t).map((s) => `위 — ${s}`)],
        caption: `겹쳐 보기 · 아래 ${label(spec.base)}: ${b.caption} / 위 ${label(spec.top)}: ${t.caption}`,
      }
    },
  }
}

export const OVERLAY_PANELS: PanelDef[] = OVERLAY_IDS.map((_, i) => overlayPanel(i))
