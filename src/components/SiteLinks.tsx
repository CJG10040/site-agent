// API로 받을 수 없는 자료를 직접 확인하도록 여는 바로가기.
// 2026-11-09 확인: 토지이음 luLandDet.jsp?pnu= 로 필지 상세(토지이용계획)가 바로 열림(통합 후 새 PNU도 됨).
// 국토정보플랫폼 항공사진은 /ms/map/Aerial.do (좌표로 바로 여는 주소는 없음).

import { useMemo } from 'react'
import { centerOf, siteBoundary } from '../lib/geo'
import type { Site } from '../model/types'

interface LinkDef {
  id: string
  label: string
  detail: string
  href: string
}

export function siteLinks(site: Site): LinkDef[] {
  const boundary = siteBoundary(site)
  if (!boundary) return []
  const [lon, lat] = centerOf(boundary)
  const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`
  const address = site.address?.road || site.address?.parcel || site.parcels[0]?.addr || ''
  const links: LinkDef[] = [
    {
      id: 'roadview',
      label: '카카오맵 로드뷰',
      detail: '대지 중심의 거리 사진. 화면 위 날짜를 눌러 지난 로드뷰(과거 모습)도 볼 수 있음',
      href: `https://map.kakao.com/link/roadview/${ll}`,
    },
    {
      id: 'kakaomap',
      label: '카카오맵 위치',
      detail: '주변 가게·길찾기·대중교통 경로',
      href: `https://map.kakao.com/link/map/${encodeURIComponent('대지')},${ll}`,
    },
  ]
  if (address) {
    links.push({
      id: 'naver',
      label: '네이버 지도',
      detail: '주소 검색 결과. 거리뷰에서 연도별 사진 비교 가능',
      href: `https://map.naver.com/p/search/${encodeURIComponent(address)}`,
    })
  }
  for (const p of site.parcels.slice(0, 3)) {
    links.push({
      id: `eum:${p.pnu}`,
      label: site.parcels.length > 1 ? `토지이음 (${p.jibun || p.addr})` : '토지이음 토지이용계획',
      detail: '법적 효력이 있는 지역·지구 지정과 행위 제한 확인',
      href: `https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?pnu=${p.pnu}&mode=search&isNoScr=script`,
    })
  }
  links.push({
    id: 'ngii',
    label: '국토정보플랫폼 (과거 항공사진)',
    detail: '연도별 항공사진으로 대지의 옛 모습 비교 (열린 지도에서 대지 주소를 검색해야 함)',
    href: 'https://map.ngii.go.kr/ms/map/Aerial.do',
  })
  return links
}

export default function SiteLinks({ site, title = '직접 확인할 자료' }: { site: Site; title?: string }) {
  const links = useMemo(() => siteLinks(site), [site])
  if (links.length === 0) return null
  return (
    <section className="block site-links">
      <h3>{title}</h3>
      <p className="help">API로 받을 수 없는 자료입니다. 새 창에서 열립니다.</p>
      <ul>
        {links.map((l) => (
          <li key={l.id}>
            <a href={l.href} target="_blank" rel="noopener noreferrer">
              {l.label} ↗
            </a>
            <span className="muted small">{l.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
