// 공공데이터포털 — 국토교통부_(TAGO)_버스정류소정보.
//  getCrdntPrxmtSttnList: 좌표 주변(약 500m) 정류소 목록
//  getSttnThrghRouteList: 정류소를 지나는 노선 목록
// 2026-11-10 실제 키로 확인: CORS 허용, citycode·nodeno는 숫자로 옴, 광주 충장로에서 21곳 응답.

import { distanceM } from '../lib/geo'
import { dataGoKrGet, standardItems } from './dataGoKr'
import type { ApiKeys } from './keys'

const BASE = 'https://apis.data.go.kr/1613000/BusSttnInfoInqireService'
export const TRANSIT_SERVICE = '국토교통부_(TAGO)_버스정류소정보'
export const TRANSIT_PUBLIC_URL = `${BASE}/getCrdntPrxmtSttnList`

export interface BusRoute {
  routeid: string
  routeno: string
  routetp: string
  startnodenm: string
  endnodenm: string
}

export interface BusStop {
  nodeid: string
  nodenm: string
  nodeno: string
  citycode: string
  lon: number
  lat: number
  /** 대지 중심에서의 직선거리(m) */
  distance: number
  routes: BusRoute[] | null
  routeError: string | null
}

export interface TransitResult {
  stops: BusStop[]
  /** 노선을 조회한 정류소 수 */
  routeChecked: number
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())

/** 노선 조회는 가까운 정류소 몇 곳만 (요청 수 절약) */
const MAX_ROUTE_LOOKUPS = 10

export async function busStopsAround(keys: ApiKeys, lon: number, lat: number): Promise<TransitResult> {
  const data = await dataGoKrGet(
    keys,
    `${BASE}/getCrdntPrxmtSttnList`,
    { gpsLati: lat.toFixed(7), gpsLong: lon.toFixed(7), numOfRows: '100', pageNo: '1', _type: 'json' },
    TRANSIT_SERVICE,
  )
  const { items } = standardItems(data)
  const stops: BusStop[] = items
    .map((it) => {
      const sLon = Number(it.gpslong)
      const sLat = Number(it.gpslati)
      return {
        nodeid: s(it.nodeid),
        nodenm: s(it.nodenm),
        nodeno: s(it.nodeno),
        citycode: s(it.citycode),
        lon: sLon,
        lat: sLat,
        distance: Number.isFinite(sLon) && Number.isFinite(sLat) ? distanceM([lon, lat], [sLon, sLat]) : NaN,
        routes: null,
        routeError: null,
      }
    })
    .filter((x) => x.nodeid && Number.isFinite(x.distance))
    .sort((a, b) => a.distance - b.distance)

  const targets = stops.slice(0, MAX_ROUTE_LOOKUPS)
  await Promise.all(
    targets.map(async (stop) => {
      try {
        const r = await dataGoKrGet(
          keys,
          `${BASE}/getSttnThrghRouteList`,
          { cityCode: stop.citycode, nodeid: stop.nodeid, numOfRows: '200', pageNo: '1', _type: 'json' },
          TRANSIT_SERVICE,
        )
        stop.routes = standardItems(r).items.map((it) => ({
          routeid: s(it.routeid),
          routeno: s(it.routeno),
          routetp: s(it.routetp),
          startnodenm: s(it.startnodenm),
          endnodenm: s(it.endnodenm),
        }))
      } catch (e) {
        stop.routeError = e instanceof Error ? e.message : String(e)
      }
    }),
  )
  return { stops, routeChecked: targets.length }
}
