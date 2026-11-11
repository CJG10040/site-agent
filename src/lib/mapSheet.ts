// 국토지리정보원 지도 도엽 번호 (1:50,000 → 1:5,000).
// 1:50,000 = 위도 두 자리 + 경도 끝자리 + 1° 칸을 15'씩 4×4로 나눈 순번(01~16, 북서부터)
// 1:5,000 = 그 15' 칸을 1.5'(0.025°)씩 10×10으로 나눈 순번(001~100, 북서부터) → 8자리 (예: 35616047)

const STEP50 = 0.25
const STEP5 = 0.025

function lonIntOf(digit: number): number {
  // 우리나라 경도 124~131° → 끝자리 4~9는 12x, 0~1은 13x
  return digit >= 4 ? 120 + digit : 130 + digit
}

export function sheet5000At(lon: number, lat: number): string {
  const latInt = Math.floor(lat)
  const lonInt = Math.floor(lon)
  const row = Math.min(3, Math.floor((latInt + 1 - lat) / STEP50))
  const col = Math.min(3, Math.floor((lon - lonInt) / STEP50))
  const top = latInt + 1 - row * STEP50
  const left = lonInt + col * STEP50
  const r = Math.min(9, Math.floor((top - lat) / STEP5 + 1e-9))
  const c = Math.min(9, Math.floor((lon - left) / STEP5 + 1e-9))
  return `${latInt}${lonInt % 10}${String(row * 4 + col + 1).padStart(2, '0')}${String(r * 10 + c + 1).padStart(3, '0')}`
}

/** 도엽 범위 [서, 남, 동, 북] (경위도) */
export function sheetBounds(code: string): [number, number, number, number] | null {
  if (!/^\d{8}$/.test(code)) return null
  const latInt = Number(code.slice(0, 2))
  const lonInt = lonIntOf(Number(code[2]))
  const n50 = Number(code.slice(3, 5)) - 1
  const n5 = Number(code.slice(5, 8)) - 1
  if (n50 < 0 || n50 > 15 || n5 < 0 || n5 > 99) return null
  const north = latInt + 1 - Math.floor(n50 / 4) * STEP50 - Math.floor(n5 / 10) * STEP5
  const west = lonInt + (n50 % 4) * STEP50 + (n5 % 10) * STEP5
  return [west, north - STEP5, west + STEP5, north]
}

/** 대지 중심 반경 안에 걸치는 1:5,000 도엽들 */
export function sheetsAround(lon: number, lat: number, radiusM: number): string[] {
  const dLat = radiusM / 110574
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180))
  const out = new Set<string>()
  const n = 12
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++) {
      const x = lon - dLon + (2 * dLon * i) / n
      const y = lat - dLat + (2 * dLat * j) / n
      // 원 밖 모서리는 빼되, 원에 걸치는 도엽은 남기도록 가장자리 점은 넉넉히
      if (((x - lon) / dLon) ** 2 + ((y - lat) / dLat) ** 2 > 1.05) continue
      out.add(sheet5000At(x, y))
    }
  return [...out].sort()
}
