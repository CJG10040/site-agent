// 설계안 (2026-11-21 묶음 C): 라이노에서 올린 내 매스를 '보는 안'으로 골라 도판·환경 계산·3D에 넣는다.
// 좌표: 대지 중심 = 원점(EPSG:5179 미터, x 동·y 북) — ⑩에서 내보낸 .3dm과 같음. 높이 z는 파일 그대로(0 = 대지 중심 지면).

import { meshToMassing, type Massing } from '../lib/massing'
import type { EnvResult } from '../sources/env'
import type { DesignScheme, Project } from './types'

/** 지금 보는 설계안 (없거나 지워졌으면 null = 현황) */
export function activeDesign(p: Pick<Project, 'designs' | 'scenario'>): DesignScheme | null {
  if (!p.scenario) return null
  return p.designs?.find((d) => d.id === p.scenario) ?? null
}

/** 위치 맞춤을 적용한 삼각형 (대지 좌표, m) */
export function placedMesh(d: DesignScheme): { positions: number[]; indices: number[] } {
  return applyPlace(d.mesh, d.place)
}

/** 삼각형에 위치 맞춤(돌린 뒤 옮김)을 적용 */
export function applyPlace(mesh: DesignScheme['mesh'], place: DesignScheme['place']): { positions: number[]; indices: number[] } {
  const { dx, dy, dz, rot } = place
  if (!dx && !dy && !dz && !rot) return mesh
  const a = (rot * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const P = mesh.positions
  const out = new Array<number>(P.length)
  for (let i = 0; i < P.length; i += 3) {
    out[i] = P[i] * c - P[i + 1] * s + dx
    out[i + 1] = P[i] * s + P[i + 1] * c + dy
    out[i + 2] = P[i + 2] + dz
  }
  return { positions: out, indices: mesh.indices }
}

/** 안이 바뀌었는지 가늠하는 짧은 서명 (도판·계산 다시 할 때) */
export function designKey(d: DesignScheme): string {
  const P = d.mesh.positions
  const probe = P.length ? `${P[0].toFixed(2)},${P[P.length - 1].toFixed(2)}` : ''
  const { dx, dy, dz, rot } = d.place
  return `${d.id}:${P.length}:${d.mesh.indices.length}:${probe}:${dx.toFixed(2)},${dy.toFixed(2)},${dz.toFixed(2)},${rot.toFixed(2)}`
}

/** 보는 안 서명: 현황이면 '' */
export function scenarioSig(p: Pick<Project, 'designs' | 'scenario'>): string {
  const d = activeDesign(p)
  return d ? designKey(d) : ''
}

const massMemo = new Map<string, Massing | null>()

/** 2.5D 덩어리 (같은 안·같은 위치면 다시 계산하지 않음) */
export function designMassing(d: DesignScheme): Massing | null {
  const k = designKey(d)
  if (massMemo.has(k)) return massMemo.get(k)!
  const m = meshToMassing(placedMesh(d))
  if (massMemo.size > 12) massMemo.delete(massMemo.keys().next().value!)
  massMemo.set(k, m)
  return m
}

// ───────────────────────── 안마다 환경 계산 (C6) ─────────────────────────
// 현황 결과는 'env:result'(사실 카드도 여기서), 설계안 결과는 'env:result@안 서명' — 안을 옮기면 서명이 바뀌어 다시 계산해야 함

export const ENV_KEY = 'env:result'

/** 보는 안의 환경 계산 결과가 담기는 자리 */
export function envKeyOf(p: Pick<Project, 'designs' | 'scenario'>): string {
  const d = activeDesign(p)
  return d ? `${ENV_KEY}@${designKey(d)}` : ENV_KEY
}

/** 설계안 하나의 환경 계산 결과를 지움 (안을 지우거나 옮겼을 때) — keep은 남김 */
export function dropDesignEnv(p: Project, id: string, keep?: string): void {
  const prefix = `${ENV_KEY}@${id}:`
  const next = { ...p.collected }
  let changed = false
  for (const k of Object.keys(next))
    if (k.startsWith(prefix) && k !== keep) {
      delete next[k]
      changed = true
    }
  if (changed) p.collected = next
}

/** 보는 설계안의 환경 계산 결과 담기 (사실 카드는 현황 결과로만 만듦) */
export function storeDesignEnv(p: Project, e: EnvResult): void {
  const d = activeDesign(p)
  if (!d) return
  const key = envKeyOf(p)
  dropDesignEnv(p, d.id, key)
  p.collected = {
    ...p.collected,
    [key]: { dataset_id: key, retrieved_at: e.computedAt, features: [{ type: 'Feature' as const, geometry: null, properties: e as unknown as Record<string, unknown> }] },
  }
}

/** 다음 안 이름: A안, B안, … */
export function nextDesignName(p: Pick<Project, 'designs'>): string {
  const used = new Set((p.designs ?? []).map((d) => d.name))
  for (let i = 0; i < 26; i++) {
    const n = `${String.fromCharCode(65 + i)}안`
    if (!used.has(n)) return n
  }
  return `안 ${(p.designs?.length ?? 0) + 1}`
}
