// 단면도: 대지 중심을 지나는 남북·동서 단면 (도판 설정의 각도만큼 함께 돌림).
// 지형선(10m 격자, 대지 중심 = 0m) + 잘린 건물(진하게) + 단면 가까이 있는 건물의 입면(연하게) + 대지 구간.
// 지도 틀 없이 도판 영역 전체에 그리고, 아래에 단면 위치를 보여 주는 작은 지도를 둔다.


import { wgs84ToUtmk } from '../lib/proj'
import { sampleAt } from '../lib/terrain'
import { arealRings } from '../lib/xy'
import type { XY } from '../lib/network'
import type { PanelOutput } from './compose'
import type { DiagramData } from './data'
import { niceLength } from './frame'
import { projOf, siteRingsXY } from './move'
import { mix } from './palette'
import type { PanelCtx, PanelDef } from './panels'

const fmt = (n: number, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits })
const DIR8 = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
const dir8 = (b: number) => DIR8[Math.round((((b % 360) + 360) % 360) / 45) % 8]
const FLOOR_M = 3
const UNKNOWN_H = 3
/** 단면 가까이(이 거리 안) 건물은 입면으로 */
const BEYOND_M = 40

interface Cut {
  s0: number
  s1: number
  h: number
  known: boolean
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
    const v = sampleAt(t.grid, t.rel, X, Y)
    return Number.isFinite(v) ? v : 0
  }
}

function sectionPanel(which: 'A' | 'B'): PanelDef {
  return {
    id: which === 'A' ? 'sectionA' : 'sectionB',
    title: which === 'A' ? '단면 1 (남북)' : '단면 2 (동서)',
    group: '지형',
    needs: "공간정보에서 '지형'과 '주변 건물'을 수집하세요.",
    render: (c): PanelOutput => {
      const d: DiagramData = c.d
      const L = d.R
      const rot = ((c.st.sectionAngle % 180) + 180) % 180
      // 왼쪽 끝 방위: A = 북(+각도), B = 서(+각도)
      const leftAz = which === 'A' ? rot : rot + 270
      const rightAz = leftAz + 180
      const ar = (rightAz * Math.PI) / 180
      const u: XY = [Math.sin(ar), Math.cos(ar)]
      const ground = groundSampler(c)
      const p = projOf(d)
      // 지형선
      const prof: { s: number; z: number }[] = []
      for (let s = -L; s <= L; s += 4) prof.push({ s, z: ground(s * u[0], s * u[1]) })
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
        const known = !!(b.floors && b.floors > 0)
        const h = known ? (b.floors as number) * FLOOR_M : UNKNOWN_H
        if (minD <= 0 && maxD >= 0) {
          for (const [s0, s1] of lineIntervals(rings, u)) if (s1 > -L && s0 < L) cuts.push({ s0: Math.max(-L, s0), s1: Math.min(L, s1), h, known })
        } else if (Math.min(Math.abs(minD), Math.abs(maxD)) <= BEYOND_M) {
          beyond.push({ s0: Math.max(-L, minS), s1: Math.min(L, maxS), h, known })
        }
      }
      const siteSpans = lineIntervals(siteRingsXY(d), u)
      // 세로 범위와 과장 배율
      let zMin = Math.min(...prof.map((q) => q.z))
      let zMax = Math.max(...prof.map((q) => q.z))
      for (const k of [...cuts, ...beyond]) zMax = Math.max(zMax, ground(((k.s0 + k.s1) / 2) * u[0], ((k.s0 + k.s1) / 2) * u[1]) + k.h)
      zMin = Math.floor(zMin / 5) * 5 - 5
      zMax = Math.ceil(zMax / 5) * 5 + 5
      const X0 = 60
      const X1 = 940
      const sx = (X1 - X0) / (2 * L)
      const TOP = 120
      const BASE = 560
      const vex = Math.max(1, Math.min(4, Math.floor((BASE - TOP) / ((zMax - zMin) * sx))))
      const sy = sx * vex
      const px = (s: number) => X0 + (s + L) * sx
      const py = (z: number) => BASE - (z - zMin) * sy
      const gz = (s: number) => ground(s * u[0], s * u[1])
      const cutColor = mix('#ffffff', c.pal.ink, 0.72)
      const beyondColor = mix('#ffffff', c.pal.ink, 0.22)
      const groundFill = mix('#ffffff', c.pal.ink, 0.1)
      // 그리기
      const rect = (k: Cut, color: string, extra = '') => {
        const base = Math.min(gz(k.s0), gz(k.s1), gz((k.s0 + k.s1) / 2))
        const x = px(k.s0)
        const w = Math.max(0.8, (k.s1 - k.s0) * sx)
        const y = py(base + k.h)
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${(py(base) - y).toFixed(1)}" fill="${color}"${extra}/>`
      }
      const beyondSvg = beyond.map((k) => rect(k, beyondColor)).join('')
      const cutSvg = cuts.map((k) => rect(k, cutColor, k.known ? '' : ` stroke="${c.pal.ink}" stroke-width="0.6" stroke-dasharray="2 2" fill-opacity="0.55"`)).join('')
      const line = prof.map((q, i) => `${i ? 'L' : 'M'}${px(q.s).toFixed(1)} ${py(q.z).toFixed(1)}`).join('')
      const groundPoly = `${line}L${px(L).toFixed(1)} ${(BASE + 30).toFixed(1)}L${px(-L).toFixed(1)} ${(BASE + 30).toFixed(1)}Z`
      let siteSvg = ''
      for (const [a, b] of siteSpans) {
        const pts: string[] = []
        for (let s = a; s <= b; s += 1) pts.push(`${px(s).toFixed(1)} ${py(gz(s)).toFixed(1)}`)
        siteSvg += `<path d="M${pts.join('L')}" fill="none" stroke="${c.pal.accent}" stroke-width="6" stroke-linecap="butt"/>`
        for (const s of [a, b]) siteSvg += `<line x1="${px(s).toFixed(1)}" y1="${(TOP - 10).toFixed(1)}" x2="${px(s).toFixed(1)}" y2="${py(gz(s)).toFixed(1)}" stroke="${c.pal.accent}" stroke-width="1" stroke-dasharray="4 4"/>`
      }
      if (siteSpans.length) {
        const mid = (siteSpans[0][0] + siteSpans[siteSpans.length - 1][1]) / 2
        siteSvg += `<text x="${px(mid).toFixed(1)}" y="${(TOP - 16).toFixed(1)}" font-size="16" font-weight="700" text-anchor="middle" fill="${c.pal.accent}">대지</text>`
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
      const scale = `<rect x="${X0}" y="${BASE + 72}" width="${(len * sx).toFixed(1)}" height="5" fill="${c.pal.ink}"/><text x="${(X0 + len * sx + 8).toFixed(1)}" y="${BASE + 79}" font-size="13" fill="${c.pal.ink}">${len >= 1000 ? `${len / 1000}km` : `${len}m`} (높이 ×${vex})</text>`
      // 위치 작은 지도
      const MR = 120
      const MCX = 500
      const MCY = 800
      const ms = MR / L
      const mp = ([x, y]: XY) => [MCX + x * ms, MCY - y * ms]
      const mpath = (rings: XY[][]) => rings.map((r) => r.map((q, i) => { const [a, b] = mp(q); return `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}` }).join('') + 'Z').join('')
      let mini = `<circle cx="${MCX}" cy="${MCY}" r="${MR}" fill="#ffffff" stroke="${c.pal.subtle}" stroke-width="1"/>`
      const bpaths = d.buildings.filter((b) => !b.underground).map((b) => mpath(arealRings(p, b.geom))).join('')
      mini += `<clipPath id="sec-${which}-clip"><circle cx="${MCX}" cy="${MCY}" r="${MR}"/></clipPath><g clip-path="url(#sec-${which}-clip)"><path d="${bpaths}" fill="${mix('#ffffff', c.pal.ink, 0.25)}"/></g>`
      mini += `<path d="${mpath(siteRingsXY(d))}" fill="${c.pal.accent}"/>`
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
      const siteZ = siteSpans.length ? gz((siteSpans[0][0] + siteSpans[siteSpans.length - 1][1]) / 2) : 0
      const tallest = [...cuts].sort((a, b) => b.h - a.h)[0]
      const leftZ = prof[0].z
      const rightZ = prof[prof.length - 1].z
      const summary = [
        `${dir8(leftAz)}쪽 끝 ${leftZ >= 0 ? '+' : ''}${fmt(leftZ)}m · 대지 ${siteZ >= 0 ? '+' : ''}${fmt(siteZ)}m · ${dir8(rightAz)}쪽 끝 ${rightZ >= 0 ? '+' : ''}${fmt(rightZ)}m (대지 중심 = 0m)`,
        tallest ? `잘린 건물 ${fmt(cuts.length)}개, 가장 높은 것 약 ${fmt(tallest.h)}m (대지에서 ${dir8(((tallest.s0 + tallest.s1) / 2 < 0 ? leftAz : rightAz))}쪽 ${fmt(Math.abs((tallest.s0 + tallest.s1) / 2))}m)` : '단면이 지나는 건물 없음',
      ]
      const unknown = cuts.filter((k) => !k.known).length
      return {
        layers: [
          { id: '입면_건물', svg: beyondSvg },
          { id: '지면', svg: `<path d="${groundPoly}" fill="${groundFill}"/><path d="${line}" fill="none" stroke="${c.pal.ink}" stroke-width="1.6"/>` },
          { id: '단면_건물', svg: cutSvg },
          { id: '대지', svg: siteSvg },
          { id: '높이_눈금', svg: axis + ends + scale },
          { id: '위치', svg: mini },
        ],
        legend: [
          { color: cutColor, label: '단면에 잘린 건물' },
          { color: beyondColor, label: `단면 ${BEYOND_M}m 안 건물 (입면)` },
          { color: c.pal.accent, label: '대지', shape: 'line' },
        ],
        legendTitle: `${which}–${which}′ 단면 · ${dir8(leftAz)} → ${dir8(rightAz)}${rot ? ` (${rot}° 돌림)` : ''} · 높이 ${vex === 1 ? '실제 비율' : `${vex}배 과장`}`,
        summary,
        caption: `지형: ${c.t ? (c.t.grid.source === 'ngii' ? '국토지리정보원 10m 격자' : '대체 자료(AWS Terrain Tiles)') : '자료 없음(평지로 그림)'} · 건물: GIS건물통합정보 층수×${FLOOR_M}m${unknown ? `(층수 모름 ${unknown}동은 ${UNKNOWN_H}m, 점선)` : ''} · ${c.date} 수집 · 단면 방향은 도판 설정에서 돌림`,
        hideBase: true,
        noFrame: true,
      }
    },
  }
}

export const SECTION_PANELS: PanelDef[] = [sectionPanel('A'), sectionPanel('B')]



