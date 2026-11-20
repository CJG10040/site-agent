// 도판 근거 목록 (2026-11-21 사용자 결정): 점 자료로 만드는 도판이 '어떤 시설로 그렸는지'를 함께 내고,
// ⑥ 카드 아래에서 이름·주소·지도 링크로 확인해 틀린 것은 바로 뺀다. 도판 그림·내보내는 파일에는 넣지 않는다.

import type { HideLayer } from '../model/types'
import type { BasisGroup, BasisItem } from './compose'
import type { Pt } from './data'
import type { Frame } from './frame'

export function basisItem(f: Frame, layer: HideLayer, p: Pt, kind: string, note?: string): BasisItem {
  return {
    layer,
    name: p.name,
    kind,
    lon: p.lon,
    lat: p.lat,
    distM: f.polar(p.lon, p.lat).d,
    addr: p.addr,
    url: p.url,
    note: [note, p.note].filter(Boolean).join(' · ') || undefined,
  }
}

/** 묶음으로 나눠 가까운 순으로. order가 있으면 그 순서, 없으면 많은 묶음부터 */
export function groupBasis(entries: { group: string; item: BasisItem }[], order?: string[]): BasisGroup[] {
  const m = new Map<string, BasisItem[]>()
  for (const { group: k, item: x } of entries) {
    const l = m.get(k)
    if (l) l.push(x)
    else m.set(k, [x])
  }
  const keys = [...m.keys()].sort((a, b) => {
    if (order) {
      const ia = order.indexOf(a)
      const ib = order.indexOf(b)
      if (ia !== ib) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
    }
    return m.get(b)!.length - m.get(a)!.length
  })
  return keys.map((k) => ({ title: k, items: m.get(k)!.sort((a, b) => a.distM - b.distM) }))
}

/** 정류소 노선 목록 (자료에 같은 번호가 여러 번 있으면 한 번씩, 많으면 앞 8개 + 수) */
export function routesNote(routes: string | undefined): string | undefined {
  const list = [...new Set((routes ?? '').split(',').map((x) => x.trim()).filter(Boolean))]
  if (!list.length) return undefined
  return `노선 ${list.slice(0, 8).join(', ')}${list.length > 8 ? ` 외 ${list.length - 8}개` : ''}`
}

const storeMemo = new WeakMap<Pt[], BasisGroup[]>()

/** 상가 도판 3장(업종·낮밤·대지 주변 비교)이 함께 쓰는 목록: 업종 대분류 묶음, 분류 = 중분류 · 소분류 */
export function storeBasis(f: Frame, stores: Pt[]): BasisGroup[] {
  let g = storeMemo.get(stores)
  if (!g) {
    g = groupBasis(stores.map((p) => ({ group: `상가 · ${p.kind}`, item: basisItem(f, 'store', p, [p.label, p.detail].filter(Boolean).join(' · ') || p.kind) })))
    storeMemo.set(stores, g)
  }
  return g
}

/** 원래 자료에 장소 페이지가 없을 때: 카카오맵에 이름과 좌표로 핀을 꽂는 공개 링크 */
export function mapLinkOf(x: Pick<BasisItem, 'name' | 'lon' | 'lat' | 'url'>): string {
  if (x.url) return x.url
  const name = (x.name || '위치').replace(/,/g, ' ')
  return `https://map.kakao.com/link/map/${encodeURIComponent(name)},${x.lat.toFixed(6)},${x.lon.toFixed(6)}`
}
