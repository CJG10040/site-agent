// 14-B 부드러운 표현 (2026-11-12 사용자 결정): 칸 자료를 매끄럽게 칠하기, 지형 음영 기복, 바람 흐름선.
// 칸 값은 그대로 두고 '그리는 방식'만 바꾼다 — 설정에서 '칸 그대로'를 고르면 예전처럼 칸이 보이게 칠한다.

/** 값 칸 (행 = 위(북)에서 아래, 열 = 서에서 동) */
export interface ValueGrid {
  nx: number
  ny: number
  at: (k: number) => number
}

/**
 * 칸 좌표(fx = 열, fy = 행, 칸 가운데 = 정수 + 0.5)의 값.
 * smooth면 주변 4칸을 이어 보간(값이 없는 칸은 빼고 가중치를 다시 나눔). 가장 가까운 칸이 비어 있으면(건물 등) 비움 그대로.
 */
export function sampleGrid(g: ValueGrid, fx: number, fy: number, smooth: boolean): number {
  const nc = Math.floor(fx)
  const nr = Math.floor(fy)
  if (nc < 0 || nr < 0 || nc >= g.nx || nr >= g.ny) return NaN
  const nearest = g.at(nr * g.nx + nc)
  if (!smooth || !Number.isFinite(nearest)) return nearest
  const c0 = Math.floor(fx - 0.5)
  const r0 = Math.floor(fy - 0.5)
  const tx = fx - 0.5 - c0
  const ty = fy - 0.5 - r0
  let s = 0
  let sw = 0
  for (let j = 0; j < 2; j++) {
    const r = r0 + j
    if (r < 0 || r >= g.ny) continue
    const wy = j ? ty : 1 - ty
    for (let i = 0; i < 2; i++) {
      const c = c0 + i
      if (c < 0 || c >= g.nx) continue
      const v = g.at(r * g.nx + c)
      if (!Number.isFinite(v)) continue
      const w = (i ? tx : 1 - tx) * wy
      s += w * v
      sw += w
    }
  }
  return sw > 1e-9 ? s / sw : nearest
}

/**
 * 음영 기복: 북서쪽 위(방위 315°, 고도 45°)에서 빛을 비춘 밝기 배율 (평지 = 1).
 * 도시의 작은 기복도 보이게 10m 격자는 높이를 3배로 과장하고, 옹벽 단차가 든 촘촘한 수치지도 지형(5m 이하 칸)은 1.5배만.
 */
export function hillshadeExaggeration(cell: number): number {
  return cell <= 5 ? 1.5 : 3
}

/** 값 없는 칸은 빼고 3×3 평균 (passes번) */
function boxBlur(z: ArrayLike<number>, nx: number, ny: number, passes: number): Float32Array {
  let cur = Float32Array.from(z as ArrayLike<number>)
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(nx * ny)
    for (let r = 0; r < ny; r++)
      for (let c = 0; c < nx; c++) {
        const v0 = cur[r * nx + c]
        if (!Number.isFinite(v0)) {
          next[r * nx + c] = NaN
          continue
        }
        let s = 0
        let n = 0
        for (let j = -1; j <= 1; j++)
          for (let i = -1; i <= 1; i++) {
            const rr = r + j
            const cc = c + i
            if (rr < 0 || cc < 0 || rr >= ny || cc >= nx) continue
            const v = cur[rr * nx + cc]
            if (!Number.isFinite(v)) continue
            s += v
            n++
          }
        next[r * nx + c] = s / n
      }
    cur = next
  }
  return cur
}

export function hillshade(zRaw: ArrayLike<number>, nx: number, ny: number, cell: number, exaggerate = hillshadeExaggeration(cell)): Float32Array {
  // 음영만 살짝 고른 높이로 — 지형 자료의 작은 꺾임(옹벽 단차를 넣으며 생긴 쐐기 등)이 비탈처럼 보이지 않게
  const z = boxBlur(zRaw, nx, ny, cell <= 5 ? 3 : 1)
  const out = new Float32Array(nx * ny).fill(1)
  const az = (315 * Math.PI) / 180
  const alt = (45 * Math.PI) / 180
  const Lx = Math.sin(az) * Math.cos(alt)
  const Ly = Math.cos(az) * Math.cos(alt)
  const Lz = Math.sin(alt)
  const at = (r: number, c: number) => {
    const v = z[Math.min(ny - 1, Math.max(0, r)) * nx + Math.min(nx - 1, Math.max(0, c))]
    return Number.isFinite(v) ? v : NaN
  }
  for (let r = 0; r < ny; r++)
    for (let c = 0; c < nx; c++) {
      const z0 = at(r, c)
      if (!Number.isFinite(z0)) continue
      const e = at(r, c + 1)
      const w = at(r, c - 1)
      const n = at(r - 1, c)
      const s = at(r + 1, c)
      const dzdx = ((Number.isFinite(e) ? e : z0) - (Number.isFinite(w) ? w : z0)) / (2 * cell)
      const dzdy = ((Number.isFinite(n) ? n : z0) - (Number.isFinite(s) ? s : z0)) / (2 * cell)
      const nxv = -dzdx * exaggerate
      const nyv = -dzdy * exaggerate
      const len = Math.hypot(nxv, nyv, 1)
      const shade = Math.max(0, (nxv * Lx + nyv * Ly + Lz) / len)
      out[r * nx + c] = Math.max(0.72, Math.min(1.2, 1 + 0.9 * (shade - Lz)))
    }
  return out
}

/** 색에 밝기 배율을 곱함 (1보다 크면 밝게) */
export function shadeRgb(c: [number, number, number], f: number): [number, number, number] {
  if (f >= 1) return [c[0] + (255 - c[0]) * (f - 1), c[1] + (255 - c[1]) * (f - 1), c[2] + (255 - c[2]) * (f - 1)]
  return [c[0] * f, c[1] * f, c[2] * f]
}

export type Pt = [number, number]

/**
 * 흐름선 (Jobard–Lefer 방식을 줄인 것): 고르게 뿌린 씨앗에서 흐름 방향으로 앞뒤로 따라가며 선을 긋고,
 * 이미 그은 선과 너무 가까워지면 멈춘다. 좌표는 미터, vel이 null이면(건물·범위 밖) 멈춘다.
 * @param R 그릴 원의 반지름(m) — 원 밖으로 나가면 멈춤
 */
export function traceStreamlines(vel: (x: number, y: number) => Pt | null, R: number, opts: { sep?: number; step?: number; minSpeed?: number } = {}): Pt[][] {
  const dsep = opts.sep ?? R / 16
  const dtest = dsep * 0.45
  const h = opts.step ?? dsep / 6
  const minSpeed = opts.minSpeed ?? 0.04
  const bucket = dtest
  const hash = new Map<string, Pt[]>()
  const key = (x: number, y: number) => `${Math.floor(x / bucket)},${Math.floor(y / bucket)}`
  const near = (x: number, y: number, d: number) => {
    const bx = Math.floor(x / bucket)
    const by = Math.floor(y / bucket)
    const span = Math.ceil(d / bucket)
    for (let i = -span; i <= span; i++)
      for (let j = -span; j <= span; j++) {
        const pts = hash.get(`${bx + i},${by + j}`)
        if (!pts) continue
        for (const p of pts) if ((p[0] - x) ** 2 + (p[1] - y) ** 2 < d * d) return true
      }
    return false
  }
  const unit = (v: Pt): Pt | null => {
    const m = Math.hypot(v[0], v[1])
    return m < minSpeed ? null : [v[0] / m, v[1] / m]
  }
  const maxSteps = Math.ceil((4 * R) / h)
  const trace = (seed: Pt, dir: 1 | -1): Pt[] => {
    const pts: Pt[] = []
    let p = seed
    for (let i = 0; i < maxSteps; i++) {
      const v1 = vel(p[0], p[1])
      const u1 = v1 && unit(v1)
      if (!u1) break
      const mid: Pt = [p[0] + 0.5 * h * dir * u1[0], p[1] + 0.5 * h * dir * u1[1]]
      const v2 = vel(mid[0], mid[1])
      const u2 = v2 && unit(v2)
      if (!u2) break
      const q: Pt = [p[0] + h * dir * u2[0], p[1] + h * dir * u2[1]]
      if (Math.hypot(q[0], q[1]) > R) break
      if (near(q[0], q[1], dtest)) break
      // 제자리를 맴돌면 멈춤
      if (pts.length > 8) {
        const back = pts[pts.length - 8]
        if (Math.hypot(q[0] - back[0], q[1] - back[1]) < h * 1.5) break
      }
      pts.push(q)
      p = q
    }
    return pts
  }
  // 씨앗: 고른 격자 (가운데부터 바깥으로 — 대지 주변 선이 먼저 자리를 잡게)
  const seeds: Pt[] = []
  for (let x = -R; x <= R; x += dsep) for (let y = -R; y <= R; y += dsep) if (Math.hypot(x, y) < R * 0.97) seeds.push([x + (Math.round(y / dsep) & 1 ? dsep * 0.5 : 0), y])
  seeds.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]))
  const lines: Pt[][] = []
  for (const s of seeds) {
    if (near(s[0], s[1], dsep * 0.9)) continue
    if (!vel(s[0], s[1])) continue
    const back = trace(s, -1)
    const fwd = trace(s, 1)
    const line = [...back.reverse(), s, ...fwd]
    if ((line.length - 1) * h < dsep * 1.2) continue
    for (const p of line) {
      const k = key(p[0], p[1])
      const arr = hash.get(k)
      if (arr) arr.push(p)
      else hash.set(k, [p])
    }
    lines.push(line)
  }
  return lines
}

/** 흐름선 → SVG (선 + 일정 간격 화살촉). toPx = 미터 → 도판 좌표 */
export function streamlineSvg(lines: Pt[][], toPx: (p: Pt) => Pt, color: string, opts: { width?: number; every?: number } = {}): string {
  const width = opts.width ?? 1.1
  const every = opts.every ?? 90
  let d = ''
  let heads = ''
  for (const line of lines) {
    const px = line.map(toPx)
    // 점 줄이기 (1.5px보다 가까운 점은 건너뜀)
    const kept: Pt[] = [px[0]]
    for (let i = 1; i < px.length; i++) {
      const q = kept[kept.length - 1]
      if (Math.hypot(px[i][0] - q[0], px[i][1] - q[1]) >= 1.5 || i === px.length - 1) kept.push(px[i])
    }
    if (kept.length < 2) continue
    d += kept.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('')
    // 화살촉: 선 길이를 따라 every px마다 (가운데부터)
    let acc = 0
    let next = every * 0.55
    for (let i = 1; i < kept.length; i++) {
      const [x0, y0] = kept[i - 1]
      const [x1, y1] = kept[i]
      const seg = Math.hypot(x1 - x0, y1 - y0)
      while (acc + seg >= next) {
        const t = (next - acc) / seg
        const x = x0 + (x1 - x0) * t
        const y = y0 + (y1 - y0) * t
        const ux = (x1 - x0) / seg
        const uy = (y1 - y0) / seg
        const a = 5
        heads += `M${(x + ux * a).toFixed(1)} ${(y + uy * a).toFixed(1)}L${(x - ux * a - uy * a * 0.8).toFixed(1)} ${(y - uy * a + ux * a * 0.8).toFixed(1)}L${(x - ux * a + uy * a * 0.8).toFixed(1)} ${(y - uy * a - ux * a * 0.8).toFixed(1)}Z`
        next += every
      }
      acc += seg
    }
  }
  return `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="0.62" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/><path d="${heads}" fill="${color}" fill-opacity="0.75"/>`
}
