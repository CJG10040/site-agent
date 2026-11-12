// 15-B 콘타 모형 계산을 화면이 멈추지 않게 따로 돈다.

import { planContour, type ContourInput, type ContourPlan } from './contour'

export type ContourMessage = { type: 'progress'; text: string } | { type: 'done'; plan: ContourPlan } | { type: 'error'; message: string }

self.onmessage = (ev: MessageEvent<ContourInput>) => {
  const post = (m: ContourMessage) => (self as unknown as Worker).postMessage(m)
  try {
    const plan = planContour(ev.data, (text) => post({ type: 'progress', text }))
    post({ type: 'done', plan })
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
