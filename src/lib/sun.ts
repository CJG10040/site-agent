// 태양 궤적 계산 (SunCalc). 시각은 모두 한국 표준시(KST, UTC+9) 기준.

import * as SunCalc from 'suncalc'
import { destination, point } from '@turf/turf'
import type { Feature, LineString, Point, Polygon } from 'geojson'
import { radiusCircle } from './geo'

export type SunDayKey = 'summer' | 'equinox' | 'winter'

export const SUN_DAYS: { key: SunDayKey; label: string; month: number; day: number }[] = [
  { key: 'summer', label: '하지', month: 6, day: 21 },
  { key: 'equinox', label: '춘·추분', month: 3, day: 20 },
  { key: 'winter', label: '동지', month: 12, day: 22 },
]

/** KST 시각 → Date */
function kst(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute))
}

function deg(rad: number): number {
  return (rad * 180) / Math.PI
}

function formatKstTime(d: Date): string {
  const h = (d.getUTCHours() + 9) % 24
  return `${h}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

export interface SunSummary {
  key: SunDayKey
  label: string
  noonAltitude: number // 남중고도(°)
  noonTime: string // 남중 시각 (KST)
  sunrise: string
  sunset: string
  dayLength: string // "14시간 25분"
  sunriseAzimuth: number // 일출 방위 (북=0°, 시계방향)
  sunsetAzimuth: number
}

/** SunCalc 방위(남=0, 서쪽 +) → 나침반 방위(북=0, 시계방향) */
function compassBearing(azimuthRad: number): number {
  return (deg(azimuthRad) + 180 + 360) % 360
}

export function sunSummaries(lon: number, lat: number, year = new Date().getFullYear()): SunSummary[] {
  return SUN_DAYS.map((d) => {
    const noonGuess = kst(year, d.month, d.day, 12)
    const times = SunCalc.getTimes(noonGuess, lat, lon)
    // 극지방이 아니면 일출·일몰은 항상 있다. 혹시 없으면 남중 시각으로 대신한다.
    const sunriseT = times.sunrise ?? times.solarNoon
    const sunsetT = times.sunset ?? times.solarNoon
    const noon = SunCalc.getPosition(times.solarNoon, lat, lon)
    const rise = SunCalc.getPosition(sunriseT, lat, lon)
    const set = SunCalc.getPosition(sunsetT, lat, lon)
    const minutes = Math.round((sunsetT.getTime() - sunriseT.getTime()) / 60000)
    return {
      key: d.key,
      label: d.label,
      noonAltitude: deg(noon.altitude),
      noonTime: formatKstTime(times.solarNoon),
      sunrise: formatKstTime(sunriseT),
      sunset: formatKstTime(sunsetT),
      dayLength: `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`,
      sunriseAzimuth: compassBearing(rise.azimuth),
      sunsetAzimuth: compassBearing(set.azimuth),
    }
  })
}

type SunFeature = Feature<LineString | Point | Polygon, Record<string, unknown>>

/**
 * 평면 태양 궤적도: 대지 중심에서 태양 방향으로, 고도가 낮을수록 멀리 찍는다 (등거리 극좌표).
 * 반지름 radiusM 원이 지평선(고도 0°), 중심이 천정(고도 90°).
 */
export function sunPathFeatures(lon: number, lat: number, radiusM: number, year = new Date().getFullYear()): SunFeature[] {
  const out: SunFeature[] = []
  const center = point([lon, lat])
  const place = (altitudeRad: number, azimuthRad: number) => {
    const r = radiusM * (1 - altitudeRad / (Math.PI / 2))
    return destination(center, r, compassBearing(azimuthRad), { units: 'meters' }).geometry.coordinates
  }

  // 고도 기준 원: 0°(지평선), 30°, 60°
  for (const alt of [0, 30, 60]) {
    out.push({
      type: 'Feature',
      geometry: radiusCircle([lon, lat], radiusM * (1 - alt / 90)),
      properties: { kind: 'sunring', label: `${alt}°` },
    })
  }

  for (const d of SUN_DAYS) {
    const coords: number[][] = []
    for (let m = 4 * 60; m <= 21 * 60; m += 10) {
      const t = kst(year, d.month, d.day, Math.floor(m / 60), m % 60)
      const pos = SunCalc.getPosition(t, lat, lon)
      if (pos.altitude <= 0) continue
      coords.push(place(pos.altitude, pos.azimuth))
      if (m % 60 === 0) {
        out.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: place(pos.altitude, pos.azimuth) },
          properties: { kind: 'sunhour', day: d.key, label: m % 180 === 0 ? `${m / 60}시` : '' },
        })
      }
    }
    if (coords.length >= 2) {
      out.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { kind: 'sunpath', day: d.key, label: d.label },
      })
    }
  }
  return out
}

/** 정해진 날(하지·춘추분·동지)의 KST 시각에 태양 고도(°)와 나침반 방위(°, 북=0 시계방향) */
export function sunAt(lon: number, lat: number, day: SunDayKey, hour: number, year = new Date().getFullYear()): { altitude: number; azimuth: number } {
  const d = SUN_DAYS.find((x) => x.key === day) ?? SUN_DAYS[2]
  const h = Math.floor(hour)
  const pos = SunCalc.getPosition(kst(year, d.month, d.day, h, Math.round((hour - h) * 60)), lat, lon)
  return { altitude: deg(pos.altitude), azimuth: compassBearing(pos.azimuth) }
}
