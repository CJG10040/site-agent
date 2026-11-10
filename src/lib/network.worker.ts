// 길의 연결 계산을 화면이 멈추지 않게 따로 돈다.

import { angularChoice, buildNetwork, midpoint, type XY } from './network'

export interface NetworkJob {
  lines: XY[][]
  /** 수집 반경 (넓은 규모 선택도의 범위) */
  displayR: number
  /** 걷는 규모 반경 */
  walkR: number
  /** 넓은 규모에서 반경 바깥으로 더 넣는 여유 */
  wideBuffer: number
  maxOrigins: number
}

export type NetworkMessage =
  | { type: 'progress'; stage: 'walk' | 'wide'; done: number; total: number }
  | {
      type: 'done'
      edges: XY[][]
      nachWalk: (number | null)[]
      nachWide: (number | null)[]
      originsWalk: number
      originsWide: number
      wideEdges: number
    }
  | { type: 'error'; message: string }

const round = (v: number) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null)

self.onmessage = (ev: MessageEvent<NetworkJob>) => {
  const job = ev.data
  try {
    const net = buildNetwork(job.lines)
    const post = (m: NetworkMessage) => (self as unknown as Worker).postMessage(m)
    const walk = angularChoice(net, {
      radius: job.walkR,
      maxOrigins: job.maxOrigins,
      onProgress: (done, total) => post({ type: 'progress', stage: 'walk', done, total }),
    })
    const inc = new Uint8Array(net.edges.length)
    const lim = job.displayR + job.wideBuffer
    net.edges.forEach((e, i) => {
      const m = midpoint(e)
      if (Math.hypot(m[0], m[1]) <= lim) inc[i] = 1
    })
    const wide = angularChoice(net, {
      radius: null,
      include: inc,
      maxOrigins: job.maxOrigins,
      onProgress: (done, total) => post({ type: 'progress', stage: 'wide', done, total }),
    })
    post({
      type: 'done',
      edges: net.edges.map((e) => e.coords.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as XY)),
      nachWalk: Array.from(walk.nach, round),
      nachWide: Array.from(wide.nach, round),
      originsWalk: walk.origins,
      originsWide: wide.origins,
      wideEdges: inc.reduce((a, b) => a + b, 0),
    })
  } catch (e) {
    ;(self as unknown as Worker).postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) } satisfies NetworkMessage)
  }
}
