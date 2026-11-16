// 라이노 .3dm 쓰기를 화면이 멈추지 않게 따로 돈다 (2026-11-17 사용자 요청: 파일 쓰는 단계에서 화면이 멈춤).
// 라이노 모듈(wasm)도 여기서 불러오고, 일이 끝나면 일꾼째 닫아 wasm 메모리가 쌓이지 않게 한다 (model3dmJob.ts).

import { unpackModel, type PackedModel } from './modelTransfer'
import { siteModelTo3dm, type ExportMeta, type RenderOptions } from './to3dm'

export interface Model3dmInput {
  model: PackedModel
  meta: ExportMeta
  ro: RenderOptions
}

export type Model3dmMessage = { type: 'step'; label: string; frac?: number } | { type: 'done'; bytes: Uint8Array } | { type: 'error'; message: string }

self.onmessage = async (ev: MessageEvent<Model3dmInput>) => {
  const post = (m: Model3dmMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)
  try {
    const { model, meta, ro } = ev.data
    const bytes = await siteModelTo3dm(unpackModel(model), meta, (label, frac) => post({ type: 'step', label, frac }), ro)
    post({ type: 'done', bytes }, [bytes.buffer])
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
