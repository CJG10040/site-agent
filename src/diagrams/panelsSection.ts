// 단면도: 대지 중심을 지나는 남북·동서 단면 (도판 설정의 각도만큼 함께 돌림).
// 지형선(대지 중심 = 0m) + 잘린 건물(진하게) + 단면 가까이 있는 건물의 입면(연하게) + 대지 구간 + 주요 높이·거리 표기.
// 범위는 기본 '대지와 주변'(2026-11-12 사용자 요청), 설정에서 '반경 전체'. 높이는 기본 실제 비율.
// 지도 틀 없이 도판 영역 전체에 그리고, 아래에 단면 위치를 보여 주는 작은 지도를 둔다.

import { wgs84ToUtmk } from '../lib/proj'
import { terrainSourceLabel } from '../lib/terrain'
import { relAt } from '../lib/terrainSite'
import { arealRings } from '../lib/xy'
import type { XY } from '../lib/network'
import type { PanelOutput } from './compose'
import { bldHeight, HEIGHT_SHORT, UNKNOWN_H, type DiagramData } from './data'
import { niceLength } from './frame'
import { projOf, siteRingsXY } from './move'
import { mix } from './palette'
import type { PanelCtx, PanelDef } from './panels'

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })
const DIR8 = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
const dir8 = (b: number) => DIR8[Math.round((((b % 360) + 360) % 360) / 45) % 8]
/** 단면 가까이(이 거리 안) 건물은 입면으로 */
const BEYOND_M = 40

interface Cut {
  s0: number
  s1: number
  h: number
  known: boolean
  floors: number | null
  /** 자료의 실측 높이 */
  measured: boolean
}

/** 직선 p(s) = o + s·u 와 고리들의 교차 구간 (짝홀) */
function lineIntervals(rings: XY[][], u: XY): [number, number][] {
  const ss: number[] = []
  // 직선의 법선
  const nx = -u[1]
  const ny = u[0]
  for (const ring of rings)
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1]
      const b = ring[i]
      const da = a[0] * nx + a[1] * ny
      const db = b[0] * nx + b[1] * ny
      if (da > 0 === db > 0 || da === db) continue
      const t = da / (da - db)
      const px = a[0] + (b[0] - a[0]) * t
      const py = a[1] + (b[1] - a[1]) * t
      ss.push(px * u[0] + py * u[1])
    }
  ss.sort((a, b) => a - b)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < ss.length; i += 2) out.push([ss[i], ss[i + 1]])
  return out
}

function groundSampler(c: PanelCtx): (x: number, y: number) => number {
  const t = c.t
  if (!t) return () => 0
  const p = projOf(c.d)
  return (x, y) => {
    const [X, Y] = wgs84ToUtmk(p.lon0 + x / p.kx, p.lat0 + y / p.ky)
    const v = relAt(t, X, Y)
    return Number.isFinite(v) ? v : 0
  }
}

/** 높이 글: +1.2 / −0.4 / ±0 */
const sgn = (z: number) => `${z >= 0.05 ? '+' : z <= -0.05 ? '−' : '±'}${fmt(Math.abs(z), 1)}`
const HALO = 'stroke="#ffffff" stroke-width="4" paint-order="stroke" stroke-linejoin="round"'

function sectionPanel(which: 'A' | 'B'): PanelDef {
  return {
    id: which === 'A' ? 'sectionA' : 'sectionB',
    title: which === 'A' ? '단면 1 (남북)' : '단면 2 (동서)',
    group: '지형',
    needs: "공간정보에서 '지형'과 '주변 건물'을 수집하세요.",
    render: (c): PanelOutput => {
      const d: DiagramData = c.d
      const rot = ((c.st.sectionAngle % 180) + 180) % 180
      // 왼쪽 끝 방위: A = 북(+각도), B = 서(+각도)
      const leftAz = which === 'A' ? rot : rot + 270
      const rightAz = leftAz + 180
      const ar = (rightAz * Math.PI) / 180
      const u: XY = [Math.sin(ar), Math.cos(ar)]
      const ground = groundSampler(c)
      const p = projOf(d)
      const siteRings = siteRingsXY(d)
      const siteSpans = lineIntervals(siteRings, u)
      const far = Math.max(0, ...siteRings.flat().map(([x, y]) => Math.hypot(x, y)))
      const sMinSite = siteSpans.length ? siteSpans[0][0] : -far
      const sMaxSite = siteSpans.length ? siteSpans[siteSpans.length - 1][1] : far
      // 범위: 기본은 대지와 주변 — 대지 양쪽으로 대지 길이의 0.75배(80~200m). 설정에서 '반경 전체'
      const wide = c.st.sectionRange === 'radius'
      const margin = Math.max(80, Math.min(200, (sMaxSite - sMinSite) * 0.75))
      const L = wide ? d.R : Math.min(d.R, Math.ceil((Math.max(Math.abs(sMinSite), Math.abs(sMaxSite)) + margin) / 10) * 10)
      // 지형선
      const step = Math.max(1, Math.min(4, L / 150))
      const prof: { s: number; z: number }[] = []
      for (let s = -L; s <= L + 0.01; s += step) prof.push({ s, z: ground(s * u[0], s * u[1]) })
      // 건물: 잘린 것 + 가까운 것
      const cuts: Cut[] = []
      const beyond: Cut[] = []
      const n: XY = [-u[1], u[0]]
      for (const b of d.buildings) {
        if (b.underground) continue
        const rings = arealRings(p, b.geom)
        const outer = rings[0] ?? []
        let minD = Infinity
        let maxD = -Infinity
        let minS = Infinity
        let maxS = -Infinity
        for (const [x, y] of outer) {
          const dd = x * n[0] + y * n[1]
          const ss = x * u[0] + y * u[1]
          if (dd < minD) minD = dd
          if (dd > maxD) maxD = dd
          if (ss < minS) minS = ss
          if (ss > maxS) maxS = ss
        }
        if (maxS < -L || minS > L) continue
        const bh = bldHeight(b)
        const info = { h: bh ?? UNKNOWN_H, known: bh !== null, floors: b.floors, measured: !!(b.heightM && b.heightM > 0) }
        if (minD <= 0 && maxD >= 0) {
          for (const [s0, s1] of lineIntervals(rings, u)) if (s1 > -L && s0 < L) cuts.push({ s0: Math.max(-L, s0), s1: Math.min(L, s1), ...info })
        } else if (Math.min(Math.abs(minD), Math.abs(maxD)) <= BEYOND_M) {
          beyond.push({ s0: Math.max(-L, minS), s1: Math.min(L, maxS), ...info })
        }
      }
      // 세로 범위와 과장 배율
      const tMin = Math.min(...prof.map((q) => q.z))
      const tMax = Math.max(...prof.map((q) => q.z))
      let zMax = tMax
      for (const k of [...cuts, ...beyond]) zMax = Math.max(zMax, ground(((k.s0 + k.s1) / 2) * u[0], ((k.s0 + k.s1) / 2) * u[1]) + k.h)
      const zMin = Math.floor(tMin / 5) * 5 - 5
      zMax = Math.ceil(zMax / 5) * 5 + 5
      const X0 = 60
      const X1 = 940
      const sx = (X1 - X0) / (2 * L)
      const TOP = 120
      const BASE = 560
      // 높이 과장: 기본 실제 비율(1:1), 도판 설정에서 ×2·×4. 칸(이름표 자리 30px 빼고)을 넘으면 넘지 않는 만큼만
      const want = [1, 2, 4].includes(c.st.sectionVex) ? c.st.sectionVex : 1
      const fit = (BASE - TOP - 30) / ((zMax - zMin) * sx)
      const vex = Math.min(want, fit)
      const vexShown = Math.round(vex * 10) / 10
      const sy = sx * vex
      const px = (s: number) => X0 + (s + L) * sx
      const py = (z: number) => BASE - (z - zMin) * sy
      const gz = (s: number) => ground(s * u[0], s * u[1])
      const cutColor = mix('#ffffff', c.pal.ink, 0.72)
      const beyondColor = mix('#ffffff', c.pal.ink, 0.22)
      const groundFill = mix('#ffffff', c.pal.ink, 0.1)
      const baseOf = (k: Cut) => Math.min(gz(k.s0), gz(k.s1), gz((k.s0 + k.s1) / 2))
      // 그리기
      const rect = (k: Cut, color: string, extra = '') => {
        const base = baseOf(k)
        const x = px(k.s0)
        const w = Math.max(0.8, (k.s1 - k.s0) * sx)
        const y = py(base + k.h)
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${(py(base) - y).toFixed(1)}" fill="${color}"${extra}/>`
      }
      const beyondSvg = beyond.map((k) => rect(k, beyondColor)).join('')
      const cutSvg = cuts.map((k) => rect(k, cutColor, k.known ? '' : ` stroke="${c.pal.ink}" stroke-width="0.6" stroke-dasharray="2 2" fill-opacity="0.55"`)).join('')
      const line = prof.map((q, i) => `${i ? 'L' : 'M'}${px(q.s).toFixed(1)} ${py(q.z).toFixed(1)}`).join('')
      const groundPoly = `${line}L${px(L).toFixed(1)} ${(BASE + 30).toFixed(1)}L${px(-L).toFixed(1)} ${(BASE + 30).toFixed(1)}Z`
      const visSite = siteSpans.map(([a0, b0]) => [Math.max(-L, a0), Math.min(L, b0)] as [number, number]).filter(([a0, b0]) => b0 > a0)
      let siteSvg = ''
      for (const [a0, b0] of visSite) {
        const pts: string[] = []
        for (let s = a0; s < b0; s += step) pts.push(`${px(s).toFixed(1)} ${py(gz(s)).toFixed(1)}`)
        pts.push(`${px(b0).toFixed(1)} ${py(gz(b0)).toFixed(1)}`)
        siteSvg += `<path d="M${pts.join('L')}" fill="none" stroke="${c.pal.accent}" stroke-width="6" stroke-linecap="butt"/>`
        for (const s of [a0, b0]) siteSvg += `<line x1="${px(s).toFixed(1)}" y1="${(TOP - 10).toFixed(1)}" x2="${px(s).toFixed(1)}" y2="${py(gz(s)).toFixed(1)}" stroke="${c.pal.accent}" stroke-width="1" stroke-dasharray="4 4"/>`
      }
      if (visSite.length) {
        const mid = (visSite[0][0] + visSite[visSite.length - 1][1]) / 2
        siteSvg += `<text x="${px(mid).toFixed(1)}" y="${(TOP - 16).toFixed(1)}" font-size="16" font-weight="700" text-anchor="middle" fill="${c.pal.accent}">대지</text>`
      }

      // ── 주요 높이·거리 표기 (2026-11-12 사용자 요청: 주요 부분의 높이도 함께)
      let notes = ''
      // 대지 지반: 가운데(+ 양 끝이 0.5m 넘게 다르면 양 끝도), 흙 속에
      if (visSite.length) {
        const a0 = visSite[0][0]
        const b0 = visSite[visSite.length - 1][1]
        const mid = (a0 + b0) / 2
        notes += `<text x="${px(mid).toFixed(1)}" y="${(py(gz(mid)) + 24).toFixed(1)}" font-size="13" font-weight="700" text-anchor="middle" fill="${c.pal.accent}">대지 지반 ${sgn(gz(mid))}m</text>`
        if ((b0 - a0) * sx >= 180)
          for (const s of [a0, b0]) {
            if (Math.abs(gz(s) - gz(mid)) < 0.5) continue
            notes += `<text x="${(px(s) + (s === a0 ? 4 : -4)).toFixed(1)}" y="${(py(gz(s)) + 24).toFixed(1)}" font-size="12" text-anchor="${s === a0 ? 'start' : 'end'}" fill="${c.pal.accent}">${sgn(gz(s))}m</text>`
          }
      }
      // 양 끝 지반
      notes += `<text x="${(X0 + 4).toFixed(1)}" y="${(py(prof[0].z) + 20).toFixed(1)}" font-size="12" fill="${c.pal.subtle}">${sgn(prof[0].z)}m</text>`
      notes += `<text x="${(X1 - 4).toFixed(1)}" y="${(py(prof[prof.length - 1].z) + 20).toFixed(1)}" font-size="12" text-anchor="end" fill="${c.pal.subtle}">${sgn(prof[prof.length - 1].z)}m</text>`
      // 지형 기복이 3m 넘으면 가장 높은 곳·낮은 곳
      if (tMax - tMin >= 3) {
        const hi = prof.reduce((m, x) => (x.z > m.z ? x : m))
        const lo = prof.reduce((m, x) => (x.z < m.z ? x : m))
        for (const [q, top] of [
          [hi, true],
          [lo, false],
        ] as const) {
          const X = px(q.s)
          const Y = py(q.z)
          notes += `<path d="M${X.toFixed(1)} ${(Y + (top ? -3 : 3)).toFixed(1)}l-5 ${top ? -8 : 8}h10z" fill="${c.pal.subtle}"/><text x="${X.toFixed(1)}" y="${(Y + (top ? -15 : 27)).toFixed(1)}" font-size="12" text-anchor="middle" fill="${c.pal.subtle}" ${HALO}>${top ? '높은 곳' : '낮은 곳'} ${sgn(q.z)}m</text>`
        }
      }
      // 대지 양옆 첫 건물(단면에 잘린 것): 대지 경계에서 거리 치수
      const leftAdj = cuts.filter((k) => k.s1 <= sMinSite + 0.5).sort((a, b) => b.s1 - a.s1)[0]
      const rightAdj = cuts.filter((k) => k.s0 >= sMaxSite - 0.5).sort((a, b) => a.s0 - b.s0)[0]
      const dim = (s0: number, s1: number) => {
        const gap = s1 - s0
        if (gap < 1 || gap * sx < 26) return ''
        const y = Math.min(py(gz(s0)), py(gz(s1))) - 12
        const x0 = px(s0)
        const x1 = px(s1)
        return (
          `<g stroke="${c.pal.ink}" stroke-width="1"><line x1="${x0.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y.toFixed(1)}"/>` +
          `<line x1="${x0.toFixed(1)}" y1="${(y - 5).toFixed(1)}" x2="${x0.toFixed(1)}" y2="${(y + 5).toFixed(1)}"/><line x1="${x1.toFixed(1)}" y1="${(y - 5).toFixed(1)}" x2="${x1.toFixed(1)}" y2="${(y + 5).toFixed(1)}"/></g>` +
          `<text x="${((x0 + x1) / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" font-size="12" text-anchor="middle" fill="${c.pal.ink}" ${HALO}>${fmt(gap)}m</text>`
        )
      }
      if (leftAdj) notes += dim(leftAdj.s1, sMinSite)
      if (rightAdj) notes += dim(sMaxSite, rightAdj.s0)
      // 건물 높이 이름표: 대지 양옆 첫 건물 → 높은 건물 순, 겹치면 위로 비키거나 뺌 (8개까지)
      const labelOf = (k: Cut) => `${fmt(k.h)}m${k.floors ? ` · ${k.floors}층` : ''}${k.measured ? ' (실측)' : ''}`
      const order: Cut[] = []
      for (const k of [leftAdj, rightAdj, ...[...cuts].sort((a, b) => b.h - a.h)]) if (k && k.known && !order.includes(k)) order.push(k)
      const boxes: { x0: number; x1: number; y0: number; y1: number }[] = []
      let nLabels = 0
      for (const k of order) {
        if (nLabels >= 8) break
        const text = labelOf(k)
        const w = text.length * 7.2 + 8
        const cx = (px(k.s0) + px(k.s1)) / 2
        const topY = py(baseOf(k) + k.h)
        let placed = false
        for (let tryN = 0, y = topY - 8; tryN < 4 && !placed; tryN++, y -= 18) {
          const bx = { x0: cx - w / 2, x1: cx + w / 2, y0: y - 13, y1: y + 3 }
          if (bx.y0 < TOP - 30) break
          if (boxes.some((o) => o.x0 < bx.x1 && bx.x0 < o.x1 && o.y0 < bx.y1 && bx.y0 < o.y1)) continue
          boxes.push(bx)
          placed = true
          if (tryN) notes += `<line x1="${cx.toFixed(1)}" y1="${(y + 3).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(topY - 2).toFixed(1)}" stroke="${c.pal.subtle}" stroke-width="0.8"/>`
          notes += `<text x="${cx.toFixed(1)}" y="${y.toFixed(1)}" font-size="12.5" font-weight="${k === leftAdj || k === rightAdj ? 700 : 500}" text-anchor="middle" fill="${c.pal.ink}" ${HALO}>${text}</text>`
        }
        if (placed) nLabels++
      }

      // 높이 눈금 (왼쪽)
      const tick = niceLength((zMax - zMin) / 4)
      let axis = `<line x1="${X0}" y1="${py(zMin)}" x2="${X0}" y2="${py(zMax)}" stroke="${c.pal.subtle}" stroke-width="1"/>`
      for (let z = Math.ceil(zMin / tick) * tick; z <= zMax; z += tick) {
        axis += `<line x1="${X0 - 6}" y1="${py(z).toFixed(1)}" x2="${X0}" y2="${py(z).toFixed(1)}" stroke="${c.pal.subtle}"/><text x="${X0 - 9}" y="${(py(z) + 4).toFixed(1)}" font-size="12" text-anchor="end" fill="${c.pal.subtle}">${z > 0 ? '+' : ''}${fmt(z)}</text>`
      }
      axis += `<text x="${X0 - 9}" y="${(py(zMax) - 12).toFixed(1)}" font-size="12" text-anchor="end" fill="${c.pal.subtle}">m</text>`
      // 끝 표시
      const ends = `<text x="${X0}" y="${BASE + 56}" font-size="17" font-weight="700" fill="${c.pal.ink}">${which}  ${dir8(leftAz)}</text><text x="${X1}" y="${BASE + 56}" font-size="17" font-weight="700" text-anchor="end" fill="${c.pal.ink}">${dir8(rightAz)}  ${which}′</text>`
      // 가로 축척
      const len = niceLength(L * 0.4)
      const scale = `<rect x="${X0}" y="${BASE + 72}" width="${(len * sx).toFixed(1)}" height="5" fill="${c.pal.ink}"/><text x="${(X0 + len * sx + 8).toFixed(1)}" y="${BASE + 79}" font-size="13" fill="${c.pal.ink}">${len >= 1000 ? `${len / 1000}km` : `${len}m`} (높이 ×${fmt(vexShown, 1)})</text>`
      // 위치 작은 지도
      const MR = 120
      const MCX = 500
      const MCY = 800
      const ms = MR / L
      const mp = ([x, y]: XY) => [MCX + x * ms, MCY - y * ms]
      const mpath = (rings: XY[][]) => rings.map((r) => r.map((q, i) => { const [a, b] = mp(q); return `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}` }).join('') + 'Z').join('')
      let mini = `<circle cx="${MCX}" cy="${MCY}" r="${MR}" fill="#ffffff" stroke="${c.pal.subtle}" stroke-width="1"/>`
      const bpaths = d.buildings
        .filter((b) => !b.underground)
        .map((b) => arealRings(p, b.geom))
        .filter((rs) => (rs[0] ?? []).some(([x, y]) => Math.hypot(x, y) < L * 1.5))
        .map((rs) => mpath(rs))
        .join('')
      mini += `<clipPath id="sec-${which}-clip"><circle cx="${MCX}" cy="${MCY}" r="${MR}"/></clipPath><g clip-path="url(#sec-${which}-clip)"><path d="${bpaths}" fill="${mix('#ffffff', c.pal.ink, 0.25)}"/><path d="${mpath(siteRings)}" fill="${c.pal.accent}"/></g>`
      const other: XY = which === 'A' ? [Math.sin(((rot + 90) * Math.PI) / 180), Math.cos(((rot + 90) * Math.PI) / 180)] : [Math.sin(((rot + 180) * Math.PI) / 180), Math.cos(((rot + 180) * Math.PI) / 180)]
      const seg = (v: XY, color: string, w: number, dash = '') => {
        const [a1, b1] = mp([-v[0] * L, -v[1] * L])
        const [a2, b2] = mp([v[0] * L, v[1] * L])
        return `<line x1="${a1.toFixed(1)}" y1="${b1.toFixed(1)}" x2="${a2.toFixed(1)}" y2="${b2.toFixed(1)}" stroke="${color}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
      }
      mini += seg(other, c.pal.subtle, 1, '4 4') + seg(u, c.pal.ink, 2.4)
      const [la, lb] = mp([-u[0] * (L + 14 / ms), -u[1] * (L + 14 / ms)])
      const [ra, rb] = mp([u[0] * (L + 14 / ms), u[1] * (L + 14 / ms)])
      mini += `<text x="${la.toFixed(1)}" y="${(lb + 5).toFixed(1)}" font-size="14" font-weight="700" text-anchor="middle" fill="${c.pal.ink}">${which}</text><text x="${ra.toFixed(1)}" y="${(rb + 5).toFixed(1)}" font-size="14" font-weight="700" text-anchor="middle" fill="${c.pal.ink}">${which}′</text>`
      mini += `<path d="M${MCX + MR - 6} ${MCY - MR + 8} l7 18 l-7 -5 l-7 5 z" fill="${c.pal.ink}"/><text x="${MCX + MR - 6}" y="${MCY - MR + 40}" font-size="12" font-weight="700" text-anchor="middle" fill="${c.pal.ink}">N</text>`
      // 요약
      const siteZ = visSite.length ? gz((visSite[0][0] + visSite[visSite.length - 1][1]) / 2) : 0
      const tallest = [...cuts].sort((a, b) => b.h - a.h)[0]
      const leftZ = prof[0].z
      const rightZ = prof[prof.length - 1].z
      const adjText = (k: Cut | undefined, side: string, gap: number) =>
        k ? `${side}쪽 첫 건물: 대지 경계에서 ${fmt(Math.max(0, gap))}m, 높이 약 ${fmt(k.h)}m${k.floors ? `(${k.floors}층)` : ''}${k.known ? '' : ' — 층수 모름'}` : `${side}쪽: 단면 범위 안에 잘리는 건물 없음`
      const summary = [
        `${dir8(leftAz)}쪽 끝 ${sgn(leftZ)}m · 대지 ${sgn(siteZ)}m · ${dir8(rightAz)}쪽 끝 ${sgn(rightZ)}m (대지 중심 = 0m, 단면 길이 ${fmt(2 * L)}m)`,
        adjText(leftAdj, dir8(leftAz), leftAdj ? sMinSite - leftAdj.s1 : 0),
        adjText(rightAdj, dir8(rightAz), rightAdj ? rightAdj.s0 - sMaxSite : 0),
        tallest ? `잘린 건물 ${fmt(cuts.length)}개, 가장 높은 것 약 ${fmt(tallest.h)}m (대지 중심에서 ${dir8((tallest.s0 + tallest.s1) / 2 < 0 ? leftAz : rightAz)}쪽 ${fmt(Math.abs((tallest.s0 + tallest.s1) / 2))}m)` : '단면이 지나는 건물 없음',
      ]
      const unknown = cuts.filter((k) => !k.known).length
      return {
        layers: [
          { id: '입면_건물', svg: beyondSvg },
          { id: '지면', svg: `<path d="${groundPoly}" fill="${groundFill}"/><path d="${line}" fill="none" stroke="${c.pal.ink}" stroke-width="1.6"/>` },
          { id: '단면_건물', svg: cutSvg },
          { id: '대지', svg: siteSvg },
          { id: '높이_거리_표기', svg: notes },
          { id: '높이_눈금', svg: axis + ends + scale },
          { id: '위치', svg: mini },
        ],
        legend: [
          { color: cutColor, label: '단면에 잘린 건물 (숫자 = 높이·층수)' },
          { color: beyondColor, label: `단면 ${BEYOND_M}m 안 건물 (입면)` },
          { color: c.pal.accent, label: '대지', shape: 'line' },
        ],
        legendTitle: `${which}–${which}′ 단면 · ${dir8(leftAz)} → ${dir8(rightAz)}${rot ? ` (${rot}° 돌림)` : ''} · ${wide ? '수집 반경 전체' : '대지와 주변'} ${fmt(2 * L)}m · 높이 ${vexShown >= 0.95 && vexShown <= 1.05 ? '실제 비율' : `×${fmt(vexShown, 1)}`}`,
        summary,
        caption: `지형: ${c.t ? terrainSourceLabel(c.t.grid.source, c.t.grid.version) : '자료 없음(평지로 그림)'} · 건물: ${d.ngii ? '수치지도·GIS건물통합정보' : 'GIS건물통합정보'} ${HEIGHT_SHORT}${unknown ? `(층수 모름 ${unknown}동은 ${UNKNOWN_H}m, 점선)` : ''} · 높이는 대지 중심 지반 = 0m · 거리 치수는 대지 경계에서 단면에 잘린 첫 건물까지 · ${c.date} 수집 · 방향·범위·높이 과장은 도판 설정에서`,
        hideBase: true,
        noFrame: true,
      }
    },
  }
}

export const SECTION_PANELS: PanelDef[] = [sectionPanel('A'), sectionPanel('B')]
