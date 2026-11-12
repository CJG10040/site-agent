// 15-B 레이저 판 도면 미리보기: 재료 판마다 조각 배치 (외곽 분홍 · 구멍 빨강 · 새김 파랑), 라이노 파일과 같은 배치.

import { useMemo } from 'react'
import { placedShapes, type ContourPlan } from '../export/contour'
import type { XY } from '../export/siteModel'

const COLOR = { outer: '#ff00ff', inner: '#ff0000', engrave: '#0000ff' }

const pathOf = (pts: XY[], closed: boolean) => (pts.length < 2 ? '' : `M${pts.map(([x, y]) => `${x.toFixed(1)} ${(-y).toFixed(1)}`).join('L')}${closed ? 'Z' : ''}`)

export default function ContourSheets({ plan }: { plan: ContourPlan }) {
  const sheets = useMemo(
    () =>
      plan.groups.flatMap((g) =>
        g.sheets.map((s, i) => {
          let outer = ''
          let inner = ''
          let engrave = ''
          let area = 0
          const ids: string[] = []
          for (const pl of g.placed) {
            if (pl.sheet !== i) continue
            const piece = plan.pieces[pl.piece]
            const sh = placedShapes(plan, piece, pl)
            outer += pathOf(sh.outer, true)
            for (const h of sh.holes) inner += pathOf(h, true)
            for (const e of sh.engrave) engrave += pathOf(e.pts, false)
            for (const t of sh.text) engrave += pathOf(t, false)
            area += piece.area * (1000 / plan.scale) ** 2
            ids.push(piece.id)
          }
          return {
            key: `${g.material}-${i}`,
            title: `${g.material === 'plate' ? `판 재료 ${g.thickness}mm` : `도로 재료 ${g.thickness}mm`} ${i + 1}/${g.sheets.length}`,
            s,
            outer,
            inner,
            engrave,
            use: area / (s.w * s.h),
            ids,
          }
        }),
      ),
    [plan],
  )
  return (
    <div className="contour-sheets">
      {sheets.map((sh) => (
        <figure key={sh.key} className={`contour-sheet${sh.s.oversize ? ' oversize' : ''}`}>
          <svg viewBox={`0 ${-sh.s.h} ${sh.s.w} ${sh.s.h}`} role="img" aria-label={`${sh.title}: 조각 ${sh.ids.join(', ')}`}>
            <rect x={0} y={-sh.s.h} width={sh.s.w} height={sh.s.h} className="contour-sheet-board" />
            <path d={sh.engrave} stroke={COLOR.engrave} strokeWidth={0.6} fill="none" vectorEffect="non-scaling-stroke" opacity={0.75} />
            <path d={sh.inner} stroke={COLOR.inner} strokeWidth={1} fill="none" vectorEffect="non-scaling-stroke" />
            <path d={sh.outer} stroke={COLOR.outer} strokeWidth={1} fill="none" vectorEffect="non-scaling-stroke" />
          </svg>
          <figcaption className="small">
            {sh.title}
            {sh.s.oversize ? ' — 재료 판보다 큰 조각' : ''} · 조각 {sh.ids.length}개 · 쓰는 비율 {Math.round(sh.use * 100)}%
          </figcaption>
        </figure>
      ))}
    </div>
  )
}
