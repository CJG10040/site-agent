// 모형을 일꾼(Web Worker)에 넘기기 (2026-11-17): 함수(높이 재기)는 넘길 수 없어 빼고 보낸 뒤,
// 일꾼에서 자료(samp·상판 zSpec)로 같은 함수를 다시 만든다.

import { deckZFn, roadAtFn, type Deck } from './bridges'
import { groundZ, waterAtFn } from './samplers'
import type { SiteModel } from './siteModel'

export type DeckData = Omit<Deck, 'zTop'>

type OnDeck = SiteModel['roadsOnDeck'][number]
type OnDeckData = Omit<OnDeck, 'deck'> & { deck: DeckData }

/** 함수를 뺀 모형 (structuredClone·postMessage로 보낼 수 있음) */
export type PackedModel = Omit<SiteModel, 'zAt' | 'roadAt' | 'waterAt' | 'decks' | 'samp' | 'roadsOnDeck' | 'walksOnDeck'> & {
  decks: DeckData[]
  samp: Omit<SiteModel['samp'], 'decks'> & { decks: DeckData[] }
  roadsOnDeck: OnDeckData[]
  walksOnDeck: OnDeckData[]
}

export function packModel(m: SiteModel): PackedModel {
  // 같은 상판이 decks·samp.decks·상판 위 도로·인도 여러 곳에 있음 — 한 번만 바꿔 같은 것으로 (보낼 때도 하나로 감)
  const memo = new Map<Deck, DeckData>()
  const strip = (d: Deck): DeckData => {
    let o = memo.get(d)
    if (!o) {
      const { zTop, ...rest } = d
      void zTop
      o = rest
      memo.set(d, o)
    }
    return o
  }
  const { zAt, roadAt, waterAt, decks, samp, roadsOnDeck, walksOnDeck, ...rest } = m
  void zAt
  void roadAt
  void waterAt
  return {
    ...rest,
    decks: decks.map(strip),
    samp: { ...samp, decks: samp.decks.map(strip) },
    roadsOnDeck: roadsOnDeck.map((o) => ({ ...o, deck: strip(o.deck) })),
    walksOnDeck: walksOnDeck.map((o) => ({ ...o, deck: strip(o.deck) })),
  }
}

export function unpackModel(p: PackedModel): SiteModel {
  const zAt = groundZ(p.samp.ground)
  const memo = new Map<DeckData, Deck>()
  const live = (d: DeckData): Deck => {
    let o = memo.get(d)
    if (!o) {
      o = { ...d, zTop: deckZFn(d.zSpec, zAt) }
      memo.set(d, o)
    }
    return o
  }
  const all = p.samp.decks.map(live)
  return {
    ...p,
    decks: p.decks.map(live),
    samp: { ...p.samp, decks: all },
    roadsOnDeck: p.roadsOnDeck.map((o) => ({ ...o, deck: live(o.deck) })),
    walksOnDeck: p.walksOnDeck.map((o) => ({ ...o, deck: live(o.deck) })),
    zAt,
    roadAt: roadAtFn(all, zAt),
    waterAt: waterAtFn(p.samp.water, p.samp.z0),
  }
}
