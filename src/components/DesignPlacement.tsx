// 설계안 위치 맞추기 (2026-11-21 묶음 C4): 원점이 다른 파일은 작은 배치도에서 매스를 끌어 옮기고, 숫자로 동·북·높이·돌리기를 맞춘다.
// 배치도: 대지 경계(빨강) + 주변 건물(회색) + 이 안의 매스 발자국(빨강 채움). 1칸 = 10m 눈금. 위쪽 = 북.

import { useMemo, useRef, useState } from 'react'
import type { DiagramData } from '../diagrams/data'
import type { Areal } from '../lib/geo'
import { meshToMassing } from '../lib/massing'
import { wgs84ToUtmk } from '../lib/proj'
import { dropDesignEnv } from '../model/designs'
import type { DesignScheme, Project } from '../model/types'

/** 도형의 고리들 (경위도) */
const arealRingsLL = (g: Areal): number[][][] => (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat())

type Place = DesignScheme['place']

interface Props {
  scheme: DesignScheme
  data: DiagramData
  update: (fn: (draft: Project) => void) => void
}

const VIEW = 300
const fmt = (n: number, d = 1) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

/** 지구 기준점이 대지 중심에서 떨어진 만큼 (대지 좌표 m) */
export function anchorOffset(anchor: { lat: number; lon: number }, center: [number, number]): [number, number] {
  const [ax, ay] = wgs84ToUtmk(anchor.lon, anchor.lat)
  const [cx, cy] = wgs84ToUtmk(center[0], center[1])
  return [ax - cx, ay - cy]
}

/** 매스 발자국 가운데 (파일 좌표, m) */
export function meshCenter(mesh: DesignScheme['mesh']): [number, number] {
  const P = mesh.positions
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = 0; i < P.length; i += 3) {
    x0 = Math.min(x0, P[i])
    x1 = Math.max(x1, P[i])
    y0 = Math.min(y0, P[i + 1])
    y1 = Math.max(y1, P[i + 1])
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2]
}

export default function DesignPlacement({ scheme, data, update }: Props) {
  const [live, setLive] = useState<Place | null>(null)
  const place = live ?? scheme.place
  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ start: [number, number]; base: Place } | null>(null)

  // 매스 발자국 (위치 맞춤 전) — 끄는 동안은 변환만 바꿈
  const raw = useMemo(() => meshToMassing(scheme.mesh), [scheme.mesh])
  const footD = useMemo(() => (raw ? raw.blocks.map((b) => b.rings.map((r) => `M${r.map(([x, y]) => `${x.toFixed(2)} ${(-y).toFixed(2)}`).join('L')}Z`).join('')).join('') : ''), [raw])

  // 대지 경계·주변 건물 (대지 좌표 m)
  const ctx = useMemo(() => {
    const [cx, cy] = wgs84ToUtmk(data.center[0], data.center[1])
    const toL = ([lon, lat]: number[]) => {
      const [x, y] = wgs84ToUtmk(lon, lat)
      return [x - cx, y - cy] as [number, number]
    }
    const path = (rings: number[][][]) => rings.map((r) => `M${r.map((p) => toL(p)).map(([x, y]) => `${x.toFixed(1)} ${(-y).toFixed(1)}`).join('L')}Z`).join('')
    const site = path(arealRingsLL(data.boundary))
    let ext = 0
    for (const r of arealRingsLL(data.boundary)) for (const p of r) ext = Math.max(ext, Math.hypot(...toL(p)))
    const half = Math.max(60, ext * 1.8)
    const blds = [...data.buildings.filter((b) => b.src !== 'design'), ...data.siteExisting]
      .filter((b) => {
        const r = arealRingsLL(b.geom)[0]
        if (!r?.length) return false
        const [x, y] = toL(r[0])
        return Math.abs(x) < half * 1.2 && Math.abs(y) < half * 1.2
      })
      .slice(0, 1500)
    return { site, half, bld: blds.filter((b) => !b.onSite).map((b) => path(arealRingsLL(b.geom))).join(''), existing: blds.filter((b) => b.onSite).map((b) => path(arealRingsLL(b.geom))).join('') }
  }, [data])

  const commit = (p: Place) =>
    update((d) => {
      const s = d.designs?.find((x) => x.id === scheme.id)
      if (s) s.place = { dx: round(p.dx), dy: round(p.dy), dz: round(p.dz), rot: Math.round(p.rot * 10) / 10 }
      // 옮긴 안의 환경 계산은 다시 해야 함
      dropDesignEnv(d, scheme.id)
    })
  const set = (patch: Partial<Place>) => commit({ ...place, ...patch })

  const toLocal = (e: { clientX: number; clientY: number }): [number, number] | null => {
    const svg = svgRef.current
    const m = svg?.getScreenCTM()
    if (!svg || !m) return null
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const q = pt.matrixTransform(m.inverse())
    return [q.x, -q.y]
  }

  const h = ctx.half
  // 눈금: 배치도에 선이 열 개 남짓 되게 10·20·50·100m 중에서
  const tick = [10, 20, 50, 100].find((t) => (2 * h) / t <= 14) ?? 200
  const grid: string[] = []
  for (let v = -Math.floor(h / tick) * tick; v <= h; v += tick) grid.push(`M${v} ${-h}V${h}M${-h} ${v}H${h}`)
  const [mcx, mcy] = meshCenter(scheme.mesh)
  const a = (place.rot * Math.PI) / 180
  const placedCx = mcx * Math.cos(a) - mcy * Math.sin(a) + place.dx
  const placedCy = mcx * Math.sin(a) + mcy * Math.cos(a) + place.dy
  const outOfView = Math.abs(placedCx) > h || Math.abs(placedCy) > h

  return (
    <div className="placement">
      <svg
        ref={svgRef}
        className="placement-map"
        viewBox={`${-h} ${-h} ${2 * h} ${2 * h}`}
        width={VIEW}
        height={VIEW}
        role="img"
        aria-label="설계안 배치도 — 매스를 끌어 옮기기"
        onPointerMove={(e) => {
          if (!drag.current) return
          const p = toLocal(e)
          if (!p) return
          const [sx, sy] = drag.current.start
          setLive({ ...drag.current.base, dx: drag.current.base.dx + p[0] - sx, dy: drag.current.base.dy + p[1] - sy })
        }}
        onPointerUp={() => {
          if (drag.current && live) commit(live)
          drag.current = null
          setLive(null)
        }}
      >
        <path d={grid.join('')} className="placement-grid" />
        <path d={ctx.bld} className="placement-bld" />
        <path d={ctx.existing} className="placement-existing" />
        <path d={ctx.site} className="placement-site" />
        <g
          className="placement-mass"
          transform={`translate(${place.dx} ${-place.dy}) rotate(${-place.rot})`}
          onPointerDown={(e) => {
            const p = toLocal(e)
            if (!p) return
            ;(e.target as Element).setPointerCapture?.(e.pointerId)
            drag.current = { start: p, base: place }
          }}
        >
          <path d={footD} />
        </g>
        <path d={`M0 ${-h * 0.92}l-${h * 0.03} ${h * 0.07}h${h * 0.06}z`} className="placement-north" />
      </svg>
      <div className="placement-fields">
        <p className="muted small">매스(빨강)를 끌어 옮기거나 숫자로 맞추세요. 눈금 {tick}m, 위쪽 = 북, 점선 = 대지 안 기존 건물.</p>
        {outOfView && <p className="notice small">매스가 배치도 밖에 있습니다 (대지 중심에서 약 {fmt(Math.hypot(placedCx, placedCy), 0)}m). '대지 가운데로'를 눌러 보세요.</p>}
        <div className="placement-grid-fields">
          <NumField label="동쪽으로 (m)" value={place.dx} onChange={(v) => set({ dx: v })} />
          <NumField label="북쪽으로 (m)" value={place.dy} onChange={(v) => set({ dy: v })} />
          <NumField label="위로 (m)" value={place.dz} onChange={(v) => set({ dz: v })} />
          <NumField label="돌리기 (°, 반시계)" value={place.rot} step={0.5} onChange={(v) => set({ rot: ((((v + 180) % 360) + 360) % 360) - 180 })} />
        </div>
        <div className="row">
          <button type="button" className="btn small" onClick={() => set({ dx: -(mcx * Math.cos(a) - mcy * Math.sin(a)), dy: -(mcx * Math.sin(a) + mcy * Math.cos(a)) })}>
            대지 가운데로
          </button>
          {scheme.anchor && (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                const [ox, oy] = anchorOffset(scheme.anchor!, data.center)
                set({ dx: ox, dy: oy, rot: 0 })
              }}
            >
              파일 기준점대로
            </button>
          )}
          <button type="button" className="btn small ghost" onClick={() => commit({ dx: 0, dy: 0, dz: 0, rot: 0 })}>
            파일 좌표 그대로
          </button>
        </div>
      </div>
    </div>
  )
}

const round = (v: number) => Math.round(v * 100) / 100

function NumField({ label, value, step = 0.5, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null)
  return (
    <label className="field inline">
      <span className="label">{label}</span>
      <input
        type="number"
        step={step}
        value={text ?? String(Math.round(value * 100) / 100)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== null && text.trim() !== '' && Number.isFinite(Number(text))) onChange(Number(text))
          setText(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </label>
  )
}
