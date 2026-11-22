// 자료 받기 도우미 (2026-11-22 묶음 H3): 이 대지에 필요한 파일 · 바로 가는 링크.
// 사용자 결정(2026-11-22): 받기·폴더 정리는 학생이 직접 — 크롬 Claude 지시문·다운로드 폴더 자동 정리는 뺌

import { downloadNeeds, NGII_PLATFORM, VWORLD_BUNDLE_LIST } from '../lib/downloadHelper'
import { itemsForSite, rescanFolder, useLocalData } from '../lib/localData'

interface Props {
  address: string
  center: [number, number]
  radiusM: number
  /** 프로젝트에 이미 넣은 도엽 */
  have: Set<string>
}

export default function DownloadHelper({ address, center, radiusM, have }: Props) {
  const local = useLocalData()
  const needs = downloadNeeds(address, center, radiusM)
  const site = local.index ? itemsForSite(local.index, center, radiusM) : null
  const inFolder5 = new Set(site?.sheets5.map((i) => i.code) ?? [])
  const inFolder1 = new Set(site?.sheets1.map((i) => i.code) ?? [])
  const miss5 = needs.sheets5.filter((c) => !have.has(c) && !inFolder5.has(c))
  const miss1 = needs.sheets1.filter((c) => !have.has(c) && !inFolder1.has(c))
  return (
    <details className="dl-helper" open={miss5.length > 0 || undefined}>
      <summary>
        <strong>자료 받기 도우미</strong>{' '}
        <span className="muted small">
          — 이 대지에 1:5,000 {miss5.length ? `${miss5.length}도엽 더 필요` : '다 있음'} · 1:1,000 {miss1.length ? `${miss1.length}도엽 더 받을 수 있음` : '다 있음'}
        </span>
      </summary>
      <ol className="dl-steps small">
        <li>
          <strong>1:5,000 수치지도</strong> —{' '}
          {needs.bundle ? (
            <>
              대지 주소의 <strong>시군구 묶음 한 파일</strong>(<code>{needs.bundle.file}</code>)이면 그 구·군의 도엽이 다 들어 있습니다.{' '}
              <a href={VWORLD_BUNDLE_LIST(`${needs.bundle.sido}_${needs.bundle.sgg}`)} target="_blank" rel="noreferrer">
                브이월드 목록 열기
              </a>{' '}
              (로그인 후 그 파일의 [다운로드])
            </>
          ) : (
            <>
              주소로 시군구를 알지 못했습니다 —{' '}
              <a href={VWORLD_BUNDLE_LIST('')} target="_blank" rel="noreferrer">
                브이월드 시군구 묶음 목록
              </a>
              에서 대지의 구·군 파일을 받으세요.
            </>
          )}
          {miss5.length > 0 && <span className="muted"> 필요한 도엽: {needs.sheets5.join(', ')}</span>}
          {needs.sheets5.length > 0 && miss5.length > 0 && <span className="muted"> · 반경이 옆 구·군에 걸치면 그 묶음도</span>}
        </li>
        <li>
          <strong>1:1,000 수치지도</strong>(선택 · 더 자세히) — 도엽 {needs.sheets1.length}장{miss1.length ? ` 중 ${miss1.length}장 없음` : ' 모두 있음'}.{' '}
          <a href={NGII_PLATFORM} target="_blank" rel="noreferrer">
            국토정보플랫폼 열기
          </a>{' '}
          (로그인 → 공간정보 다운로드 → 수치지도 1:1,000 Ver2.0)
          {miss1.length > 0 && <span className="muted"> 도엽: {miss1.join(', ')}</span>}
        </li>
        <li>
          <strong>정밀도로지도</strong>(선택 · 3D 모형의 차선·연석) —{' '}
          <a href={NGII_PLATFORM} target="_blank" rel="noreferrer">
            국토정보플랫폼 열기
          </a>{' '}
          (대지 주변 구간을 골라 받기)
        </li>
        <li>
          <strong>둘 곳</strong>: 받은 파일을 연결한 자료 폴더 안 아무 곳(하위 폴더로 나눠도 됨)에 두면, 앱을 열 때 알아서 찾아 이 대지에 넣습니다. 앱을 연 채로 넣었으면{' '}
          {local.state === 'ready' ? (
            <button type="button" className="link-btn small" onClick={() => void rescanFolder()}>
              다시 훑기
            </button>
          ) : (
            '위에서 자료 폴더를 연결하세요'
          )}
          . 압축은 풀지 말고 받은 ZIP 그대로 두세요(1:1,000은 .ngi·.nda 낱개도 됨).
        </li>
      </ol>
    </details>
  )
}
