// 라이노 .3dm 내려받기: 화면 쪽 도우미 — 일꾼(model3dm.worker.ts)에 모형을 넘겨 만들고 다 되면 일꾼을 닫는다.
// 일꾼을 못 띄우거나(오래된 브라우저 등) 모형을 못 넘기면 예전처럼 화면 쪽에서 만든다 (그동안 화면이 잠시 멈출 수 있음).

import type { Model3dmInput, Model3dmMessage } from './model3dm.worker'
import { packModel } from './modelTransfer'
import type { SiteModel } from './siteModel'
import type { ExportMeta, ExportStep, RenderOptions } from './to3dm'

async function onMainThread(m: SiteModel, meta: ExportMeta, onStep: ExportStep | undefined, ro: RenderOptions): Promise<Uint8Array> {
  const { siteModelTo3dm } = await import('./to3dm')
  return siteModelTo3dm(m, meta, onStep, ro)
}

export function siteModelTo3dmInWorker(m: SiteModel, meta: ExportMeta, onStep?: ExportStep, ro: RenderOptions = {}): Promise<Uint8Array> {
  let w: Worker
  try {
    w = new Worker(new URL('./model3dm.worker.ts', import.meta.url), { type: 'module' })
  } catch (e) {
    console.warn('라이노 일꾼을 띄우지 못해 화면 쪽에서 만듦', e)
    return onMainThread(m, meta, onStep, ro)
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    let started = false
    let settled = false
    const end = () => {
      settled = true
      w.terminate()
    }
    w.onmessage = (ev: MessageEvent<Model3dmMessage>) => {
      if (settled) return
      const msg = ev.data
      if (msg.type === 'step') {
        started = true
        onStep?.(msg.label, msg.frac)
      } else if (msg.type === 'done') {
        end()
        resolve(msg.bytes)
      } else {
        end()
        reject(new Error(msg.message))
      }
    }
    w.onerror = (ev) => {
      if (settled) return
      ev.preventDefault()
      end()
      // 일꾼 파일을 못 불러온 것이면(아직 시작 전) 화면 쪽에서 다시
      if (!started) {
        console.warn('라이노 일꾼 파일을 불러오지 못해 화면 쪽에서 만듦', ev.message)
        onMainThread(m, meta, onStep, ro).then(resolve, reject)
      } else reject(new Error(ev.message || '라이노 파일을 만드는 중 오류가 났습니다'))
    }
    const job: Model3dmInput = { model: packModel(m), meta, ro }
    try {
      w.postMessage(job)
    } catch (e) {
      // 모형을 넘기지 못함 (넘길 수 없는 값이 섞임) → 화면 쪽에서
      console.warn('모형을 라이노 일꾼에 넘기지 못해 화면 쪽에서 만듦', e)
      end()
      onMainThread(m, meta, onStep, ro).then(resolve, reject)
    }
  })
}
