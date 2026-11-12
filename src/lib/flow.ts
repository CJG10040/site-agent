// 14-C 물길: 지형 격자에서 빗물이 모이는 길 (D8 흐름 누적).
// 1) 웅덩이 채우기: 우선순위 범람(Barnes 2014, priority-flood + ε) — 가장자리·자료 없는 칸을 출구로 두고 낮은 칸부터 안으로 채워
//    물이 고이는 칸이 없게 한다 (평지는 아주 작은 기울기 ε로 출구 쪽으로 흐르게).
// 2) 흐름 방향: 8방향 중 가장 가파르게 내려가는 이웃.
// 3) 흐름 누적: 높은 칸부터 자기 칸 수를 아래 칸에 더함 → 각 칸으로 모이는 빗물의 집수 칸 수.
// 하수관·도로 배수·건물은 반영하지 않는다 (지형만).

const DX = [1, 1, 0, -1, -1, -1, 0, 1]
const DY = [0, 1, 1, 1, 0, -1, -1, -1]

class MinHeap {
  private k: number[] = []
  private v: number[] = []
  get size() {
    return this.k.length
  }
  push(key: number, val: number) {
    const k = this.k
    const v = this.v
    k.push(key)
    v.push(val)
    let i = k.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= k[i]) break
      ;[k[p], k[i]] = [k[i], k[p]]
      ;[v[p], v[i]] = [v[i], v[p]]
      i = p
    }
  }
  pop(): number {
    const k = this.k
    const v = this.v
    const top = v[0]
    const lk = k.pop()!
    const lv = v.pop()!
    if (k.length) {
      k[0] = lk
      v[0] = lv
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < k.length && k[l] < k[m]) m = l
        if (r < k.length && k[r] < k[m]) m = r
        if (m === i) break
        ;[k[m], k[i]] = [k[i], k[m]]
        ;[v[m], v[i]] = [v[i], v[m]]
        i = m
      }
    }
    return top
  }
}

export interface FlowResult {
  /** 흘러가는 아래 칸 (-1 = 출구) */
  down: Int32Array
  /** 이 칸으로 모이는 칸 수 (자기 포함), 자료 없는 칸 0 */
  acc: Float32Array
  /** 웅덩이를 채워 올린 높이 (채운 깊이 = fill − z) */
  fill: Float64Array
}

/** z: 행 = 북→남, 열 = 서→동. NaN = 자료 없음 */
export function flowAccumulation(z: ArrayLike<number>, nx: number, ny: number, cell: number): FlowResult {
  const N = nx * ny
  const fill = new Float64Array(N)
  const done = new Uint8Array(N)
  const heap = new MinHeap()
  const eps = 1e-4
  for (let k = 0; k < N; k++) {
    const v = z[k]
    if (!Number.isFinite(v)) {
      done[k] = 1
      fill[k] = NaN
      continue
    }
    fill[k] = v
    const r = (k / nx) | 0
    const c = k % nx
    let edge = r === 0 || c === 0 || r === ny - 1 || c === nx - 1
    if (!edge)
      for (let d = 0; d < 8 && !edge; d++) {
        const kk = (r + DY[d]) * nx + c + DX[d]
        if (!Number.isFinite(z[kk])) edge = true
      }
    if (edge) {
      done[k] = 1
      heap.push(v, k)
    }
  }
  while (heap.size) {
    const k = heap.pop()
    const r = (k / nx) | 0
    const c = k % nx
    for (let d = 0; d < 8; d++) {
      const rr = r + DY[d]
      const cc = c + DX[d]
      if (rr < 0 || cc < 0 || rr >= ny || cc >= nx) continue
      const kk = rr * nx + cc
      if (done[kk]) continue
      done[kk] = 1
      if (fill[kk] <= fill[k]) fill[kk] = fill[k] + eps
      heap.push(fill[kk], kk)
    }
  }
  // 흐름 방향
  const down = new Int32Array(N).fill(-1)
  for (let k = 0; k < N; k++) {
    if (!Number.isFinite(fill[k])) continue
    const r = (k / nx) | 0
    const c = k % nx
    let best = 0
    for (let d = 0; d < 8; d++) {
      const rr = r + DY[d]
      const cc = c + DX[d]
      if (rr < 0 || cc < 0 || rr >= ny || cc >= nx) continue
      const kk = rr * nx + cc
      if (!Number.isFinite(fill[kk])) continue
      const drop = (fill[k] - fill[kk]) / (cell * (d % 2 ? Math.SQRT2 : 1))
      if (drop > best) {
        best = drop
        down[k] = kk
      }
    }
  }
  // 흐름 누적 (높은 칸부터)
  const order = Array.from({ length: N }, (_, k) => k).filter((k) => Number.isFinite(fill[k]))
  order.sort((a, b) => fill[b] - fill[a])
  const acc = new Float32Array(N)
  for (const k of order) acc[k] += 1
  for (const k of order) if (down[k] >= 0) acc[down[k]] += acc[k]
  return { down, acc, fill }
}
