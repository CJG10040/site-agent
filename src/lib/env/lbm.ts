// 실험: 2D 바람 흐름 (D2Q9 격자 볼츠만, BGK). 바람이 왼쪽(격자 x=0)에서 들어와 오른쪽으로 나간다.
// 평면 계산은 바람이 지붕 위로 넘지 못해, 낮은 건물이 빽빽한 동네는 통째로 벽이 된다. 그래서
// 높은 건물(FULL_H 이상)만 막힌 칸으로 두고, 낮은 건물 칸은 높이에 비례해 바람을 줄이는 '스며드는 칸'으로 둔다.
// 도시 바람의 실제 난류·높이 방향 흐름은 담지 못한다 — 건물 배치에 따라 빨라지는 곳·멈추는 곳을 비교하는 정도의 참고용.

import type { XY } from '../network'

const EX = [0, 1, 0, -1, 0, 1, -1, -1, 1]
const EY = [0, 0, 1, 0, -1, 1, 1, -1, -1]
const W = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36]
const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6]
/** 이 높이(m) 이상인 건물은 바람이 못 지나감 */
export const FULL_H = 20
/** 낮은 건물 칸에서 줄이는 속도 비율의 최대 */
const MAX_DAMP = 0.02

export interface WindFlow {
  /** 바람이 불어오는 방위(나침반 °) */
  fromAz: number
  /** 격자 한 변 칸 수, 칸 크기(m) */
  n: number
  cell: number
  /** 격자 → 대지 중심 기준 좌표: 흐름 방향 d, 왼쪽 l */
  d: XY
  l: XY
  /** 들어오는 바람 대비 평균 속도 (건물 칸 NaN), 행 = 격자 y(왼쪽 방향), 열 = 격자 x(흐름 방향) */
  ratio: Float32Array
  steps: number
  stable: boolean
}

export function lbmWind(
  heightAt: (x: number, y: number) => number,
  fromAz: number,
  side: number,
  opts: { n?: number; steps?: number; avg?: number; uIn?: number; tau?: number; maxDamp?: number; onProgress?: (f: number) => void } = {},
): WindFlow {
  const n = opts.n ?? 160
  const maxDamp = opts.maxDamp ?? MAX_DAMP
  const steps = opts.steps ?? 2400
  const avgFrom = steps - (opts.avg ?? 800)
  const uIn = opts.uIn ?? 0.1
  const tau = opts.tau ?? 0.6
  const cell = side / n
  const to = ((fromAz + 180) * Math.PI) / 180
  const d: XY = [Math.sin(to), Math.cos(to)]
  const l: XY = [-d[1], d[0]]
  const N = n * n
  const solid = new Uint8Array(N)
  /** 스며드는 칸의 속도 감쇠 (0이면 빈 땅) */
  const damp = new Float32Array(N)
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      if (i < 3 || i > n - 4) continue
      const s = (i + 0.5 - n / 2) * cell
      const t = (j + 0.5 - n / 2) * cell
      const h = heightAt(s * d[0] + t * l[0], s * d[1] + t * l[1])
      if (h >= FULL_H) solid[j * n + i] = 1
      else if (h > 0) damp[j * n + i] = (maxDamp * h) / FULL_H
    }
  let f = new Float32Array(9 * N)
  let g = new Float32Array(9 * N)
  const feq = (q: number, rho: number, ux: number, uy: number) => {
    const eu = EX[q] * ux + EY[q] * uy
    return W[q] * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * (ux * ux + uy * uy))
  }
  for (let k = 0; k < N; k++) for (let q = 0; q < 9; q++) f[q * N + k] = solid[k] ? 0 : feq(q, 1, uIn, 0)
  const inlet = Array.from({ length: 9 }, (_, q) => feq(q, 1, uIn, 0))
  const sum = new Float64Array(N)
  let samples = 0
  let stable = true
  const om = 1 / tau
  for (let step = 0; step < steps; step++) {
    // 충돌
    for (let k = 0; k < N; k++) {
      if (solid[k]) continue
      let rho = 0
      let ux = 0
      let uy = 0
      for (let q = 0; q < 9; q++) {
        const v = f[q * N + k]
        rho += v
        ux += v * EX[q]
        uy += v * EY[q]
      }
      ux /= rho
      uy /= rho
      const dm = damp[k]
      if (dm > 0) {
        ux *= 1 - dm
        uy *= 1 - dm
      }
      const usq = 1.5 * (ux * ux + uy * uy)
      for (let q = 0; q < 9; q++) {
        const eu = EX[q] * ux + EY[q] * uy
        const eq = W[q] * rho * (1 + 3 * eu + 4.5 * eu * eu - usq)
        f[q * N + k] += om * (eq - f[q * N + k])
      }
      if (step >= avgFrom && dm === 0) sum[k] += Math.hypot(ux, uy)
    }
    if (step >= avgFrom) samples++
    // 흐름 (끌어오기) + 막힌 칸에서 되튐, 위아래는 이어 붙임
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i
        if (solid[k]) continue
        for (let q = 0; q < 9; q++) {
          const si = i - EX[q]
          const sj = (j - EY[q] + n) % n
          if (si < 0 || si >= n) {
            g[q * N + k] = si < 0 ? inlet[q] : f[q * N + k]
            continue
          }
          const sk = sj * n + si
          g[q * N + k] = solid[sk] ? f[OPP[q] * N + k] : f[q * N + sk]
        }
      }
    // 들어오는 곳 = 평형, 나가는 곳 = 옆 칸 복사
    for (let j = 0; j < n; j++) {
      const k0 = j * n
      for (let q = 0; q < 9; q++) g[q * N + k0] = inlet[q]
      const kL = j * n + n - 1
      for (let q = 0; q < 9; q++) g[q * N + kL] = g[q * N + kL - 1]
    }
    const tmp = f
    f = g
    g = tmp
    if (step % 200 === 0) {
      // 발산 확인
      const v = f[N + ((n / 2) | 0) * n + ((n / 2) | 0)]
      if (!Number.isFinite(v)) {
        stable = false
        break
      }
      opts.onProgress?.(step / steps)
    }
  }
  const ratio = new Float32Array(N)
  // 건물 칸(막힌 칸·스며드는 칸)은 값 없음
  for (let k = 0; k < N; k++) ratio[k] = solid[k] || damp[k] > 0 || !samples || !stable ? NaN : sum[k] / samples / uIn
  return { fromAz, n, cell, d, l, ratio, steps, stable }
}
