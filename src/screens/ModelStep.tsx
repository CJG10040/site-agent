// ⑩ 3D 모형 (2026-11-12 사용자 요청: 3D 모형 관련을 목차에서 따로). 렌더링 모델(실제 크기 .3dm·DXF)과 콘타 모형(15-B)을 만드는 작업대.
// 분석 단계(①~⑨)와 따로 '모형 만들기' 목차로 나눈다. 1:1,000 수치지도·정밀도로지도 올리기도 여기서 열 수 있다.

import { lazy, Suspense, useMemo } from 'react'
import NgiiUpload from '../components/NgiiUpload'
import { buildDiagramData } from '../diagrams/data'
import { collectedDate } from '../diagrams/render'
import { defaultHalf, halfOptionsFor } from '../export/modelBuild'
import { DXF_LAYERS } from '../export/toDxf'
import { nowIso } from '../model/project'
import type { Project } from '../model/types'
import type { VWorldConfig } from '../sources/vworld'

// 작업대·3D 미리보기는 이 화면을 열 때만 불러옴
const ModelWorkbench = lazy(() => import('../components/ModelWorkbench'))

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  config: VWorldConfig
  onGoData: () => void
  onGoSite: () => void
}

export default function ModelStep({ project, update, config, onGoData, onGoSite }: Props) {
  // 자료가 바뀔 때만 다시 (결론 고치기 같은 다른 변경에는 그대로)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => buildDiagramData(project), [project.collected, project.site, project.edits?.hides])
  const halfOptions = useMemo(() => (data ? halfOptionsFor(data) : []), [data])
  const meta = {
    title: project.brief.projectName || '대지',
    address: project.site.address?.road || project.site.address?.parcel || project.site.parcels[0]?.addr || '',
    collected: collectedDate(project),
  }
  const baseName = (project.brief.projectName || '대지').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30)
  const sheets = (project.collected['ngii:sheets']?.features ?? []).map((f) => f.properties)
  const n1000 = sheets.filter((p) => Number(p.scale) === 1000).length
  const n5000 = sheets.length - n1000
  const hdSections = [...new Set((project.collected['hd:files']?.features ?? []).flatMap((f) => (f.properties.sections as string[]) ?? []))]

  return (
    <div className="form-page wide model-page">
      <header className="form-head">
        <p className="eyebrow">⑩ 3D 모형</p>
        <h2>렌더링 모델과 콘타 모형 만들기</h2>
        <p className="muted">
          수집한 자료로 대지 주변을 3D로 만들어 라이노(.3dm)·DXF로 내려받습니다. 돌려 보며 무엇이 들어가는지·파일이 얼마나 클지 확인한 뒤 받으세요. 대지 중심 = 원점(m, 위쪽 = 북), 높이 0 = 대지 중심
          지면입니다.
        </p>
      </header>

      {!data ? (
        <p className="notice">
          대지가 정해지지 않았습니다.{' '}
          <button type="button" className="link-btn" onClick={onGoSite}>
            ③ 대지 정하기
          </button>
        </p>
      ) : (
        <>
          <section className="block model-sources">
            <h3>모형에 쓰는 자료</h3>
            <ul className="small">
              <li>
                건물·도로·필지·공원: {project.collectedAt ? `④ 공간정보 (${collectedDate(project)} 수집)` : '아직 수집 전 — 건물·도로가 비어 있을 수 있음'}
                {!project.collectedAt && (
                  <>
                    {' '}
                    <button type="button" className="link-btn" onClick={onGoData}>
                      ④ 공간정보 수집
                    </button>
                  </>
                )}
              </li>
              <li>
                수치지도: {sheets.length ? `${n1000 ? `1:1,000 ${n1000}도엽` : ''}${n1000 && n5000 ? ' + ' : ''}${n5000 ? `1:5,000 ${n5000}도엽` : ''} — 건물 측량 도형·층수, 대지 주변 2m 지형${n1000 ? ', 가로수·정류장·가로등·횡단보도·담장' : ''}` : '없음 — 지형은 10m 격자, 건물은 브이월드'}
              </li>
              <li>정밀도로지도: {hdSections.length ? `구간 ${hdSections.length}개 — 차선·노면표시·연석·보도 면` : '없음'}</li>
            </ul>
            <details>
              <summary className="small">수치지도·정밀도로지도 올리기 (④ 공간정보와 같은 칸)</summary>
              <NgiiUpload project={project} update={update} config={config} />
            </details>
          </section>

          <Suspense fallback={<p className="loading">작업대 불러오는 중…</p>}>
            <ModelWorkbench
              asPage
              data={data}
              baseName={baseName}
              meta={meta}
              halfOptions={halfOptions}
              initialHalf={defaultHalf(halfOptions)}
              onExported={() =>
                update((d) => {
                  d.modelExportedAt = nowIso()
                })
              }
              render={project.renderModel}
              onRender={(r) =>
                update((d) => {
                  d.renderModel = r
                })
              }
              contour={project.contour}
              onContour={(c) =>
                update((d) => {
                  d.contour = c
                })
              }
            />
          </Suspense>

          <details className="block">
            <summary className="small">파일에 든 것</summary>
            <p className="small">
              <strong>.3dm</strong> (레이어 이름 한글): 지형 면(메시)·등고선·계곡선, 건물(대지 안·주변·층수 모름), 도로 면·도로중심선, 필지, 공원·녹지, 하천, 대지 경계. 1:1,000
              수치지도·정밀도로지도를 올렸으면 가로수(수관·줄기)·정류장 쉘터·가로등·횡단보도·담장·가드레일·차선(색·겹선·점선)·노면표시·연석·보도 면까지. 땅에 놓이는 선·면은 지형 높이를
              따라 얹었고, 라이노의 지구 위치(Earth Anchor)에 원점 경위도·해발을 넣었습니다. 건물 높이는 실측 높이가 있으면 그 값, 없으면 층수 × 용도별 층고(주거 3m·비주거 4m·공장·창고 5m)
              어림입니다(층수 모르면 발자국만).
            </p>
            <p className="small">
              <strong>DXF</strong> (AutoCAD R12, 레이어 이름 영문 — 한글이 깨지지 않게): 지형은 면 대신 등고선(선마다 높이 값), 나머지는 높이 0 평면 선입니다.
            </p>
            <table>
              <tbody>
                {DXF_LAYERS.map((l) => (
                  <tr key={l.name}>
                    <td>{l.name}</td>
                    <td>{l.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </div>
  )
}
