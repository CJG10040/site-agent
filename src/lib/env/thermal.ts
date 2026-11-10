// 실험: 여름 오후 열쾌적 (UTCI). 평균복사온도(Tmrt)는 햇빛·그늘·하늘 비율로 단순하게 어림한다.
// 짧은파: 맑은 하늘 직달 일사(Meinel 근사)·산란·지면 반사 / 긴파: 하늘(Brunt 계열 방사율)·벽·지면.
// 실제 표면 온도·재료·바람의 높이 변화는 반영하지 않으므로 '실험' 값이다.

import { utci } from './utci'

const SIGMA = 5.67e-8

export interface ThermalInput {
  ta: number
  rh: number
  /** 태양 고도(°) */
  alt: number
}

function dewPoint(ta: number, rh: number): number {
  const a = 17.62
  const b = 243.12
  const g = Math.log(Math.max(1, rh) / 100) + (a * ta) / (b + ta)
  return (b * g) / (a - g)
}

/** 서 있는 사람의 평균복사온도(℃). sunlit 햇빛 받음, svf 하늘 비율(0~1), tree 나무 그늘 아래 */
export function meanRadiantTemp(c: ThermalInput, sunlit: boolean, svf: number, tree: boolean): number {
  const alt = Math.max(0, c.alt)
  const sinA = Math.sin((alt * Math.PI) / 180)
  const am = sinA > 0.05 ? 1 / sinA : 20
  const I = alt > 0 ? 1367 * Math.pow(0.7, Math.pow(am, 0.678)) : 0
  const D = alt > 0 ? 120 * Math.pow(sinA, 0.4) : 0
  // 나무 아래: 하늘·직달을 대부분 가리고, 위쪽은 기온에 가까운 잎이 차지
  const sky = tree ? svf * 0.25 : svf
  const lit = sunlit && !tree
  const fp = 0.308 * Math.cos(((alt * (1 - (alt * alt) / 48402)) * Math.PI) / 180)
  const groundShort = 0.15 * ((lit ? I * sinA : 0) + D * sky)
  const K = 0.7 * ((lit ? fp * I : 0) + 0.5 * D * sky + 0.5 * groundShort)
  const taK = c.ta + 273.15
  const tdK = dewPoint(c.ta, c.rh) + 273.15
  const epsSky = Math.min(0.95, 0.787 + 0.764 * Math.log(tdK / 273))
  const Lsky = epsSky * SIGMA * taK ** 4
  const Lwall = 0.9 * SIGMA * (taK + (lit ? 6 : 2)) ** 4
  const Lground = 0.95 * SIGMA * (taK + (lit ? 14 : 3)) ** 4
  const Lup = sky * Lsky + (1 - sky) * Lwall
  const L = 0.97 * (0.5 * Lup + 0.5 * Lground)
  return Math.pow((K + L) / (0.97 * SIGMA), 0.25) - 273.15
}

export function utciAt(c: ThermalInput & { ws: number }, sunlit: boolean, svf: number, tree: boolean, windRatio: number): { tmrt: number; utci: number } {
  const tmrt = meanRadiantTemp(c, sunlit, svf, tree)
  return { tmrt, utci: utci(c.ta, tmrt, c.ws * windRatio, c.rh) }
}
