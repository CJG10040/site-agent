// ④ 공간정보 › 수치지도 올리기: 국토지리정보원 1:5,000 수치지도 2.0 ZIP(도엽별)을 읽어 프로젝트에 넣고, 환경 계산을 다시 한다.
// 15-F(2026-11-12): 1:1,000 수치지도 2.0(NGI·NDA, 낱개 또는 ZIP)과 정밀도로지도 ZIP도 같은 곳에 — 파일 안을 보고 종류를 가림.

import { Check } from 'lucide-react'
import { unzipSync } from 'fflate'
import { useEffect, useRef, useState } from 'react'
import { connectFolder, disconnectFolder, folderSupported, itemsForSite, regrantFolder, rescanFolder, useLocalData, type LocalItem } from '../lib/localData'
import { centerOf, siteBoundary } from '../lib/geo'
import { sheetsAround } from '../lib/mapSheet'
import { applyEnv } from '../model/applyEnv'
import { applyHdSets, hasHd, removeHd } from '../model/applyHd'
import { applyNgiiSheets, hasNgii, removeNgii } from '../model/applyNgii'
import type { Project } from '../model/types'
import { computeEnv } from '../sources/env'
import { HD_KEYS, HD_LABEL, hdLayer, readHdZip, type HdSet } from '../sources/hdMap'
import { readNgi1000 } from '../sources/ngii1000'
import { NGII_KEYS, NGII_LABEL, ngiiLayer, readNgiiZip, type NgiiSheet } from '../sources/ngiiMap'
import type { VWorldConfig } from '../sources/vworld'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  config: VWorldConfig
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')

export default function NgiiUpload({ project, update, config }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [drag, setDrag] = useState(false)
  // 내 PC 자료 폴더 (2026-11-22 묶음 H2): 대지에 걸친 도엽·정밀도로지도를 알아서 넣음
  const local = useLocalData()
  const autoDone = useRef(false)
  const boundary = siteBoundary(project.site)
  const center: [number, number] = boundary ? centerOf(boundary) : [0, 0]
  const R = project.collectedRadiusM ?? project.site.radiusM
  const haveCodes = new Set((project.collected[ngiiLayer('sheets')]?.features ?? []).map((f) => String(f.properties.code)))
  const site = boundary && local.index ? itemsForSite(local.index, center, R) : null
  const fromFolder: LocalItem[] = site
    ? [...site.sheets5.filter((i) => !haveCodes.has(i.code!)), ...site.sheets1.filter((i) => !haveCodes.has(i.code!)), ...(hasHd(project) ? [] : site.hd)]
    : []
  useEffect(() => {
    if (local.state !== 'ready' || autoDone.current || busy || !fromFolder.length) return
    autoDone.current = true
    void loadFolder(fromFolder)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.state, fromFolder.length])
  if (!boundary) return null
  const needed = sheetsAround(center[0], center[1], R)
  const sheetProps = (project.collected[ngiiLayer('sheets')]?.features ?? []).map((f) => f.properties)
  const have = new Map(sheetProps.map((p) => [String(p.code), p]))
  const uploadedR = Math.min(...sheetProps.map((p) => Number(p.radiusM) || 0))
  const counts = NGII_KEYS.map((k) => [k, project.collected[ngiiLayer(k)]?.features.length ?? 0] as const).filter(([, n]) => n > 0)
  const codes5 = [...have.entries()].filter(([, p]) => Number(p.scale ?? 5000) !== 1000).map(([c]) => c).sort()
  const codes1 = [...have.entries()].filter(([, p]) => Number(p.scale) === 1000).map(([c]) => c).sort()
  const hdFiles = (project.collected[hdLayer('files')]?.features ?? []).map((f) => f.properties)
  const hdSections = [...new Set(hdFiles.flatMap((p) => (p.sections as string[]) ?? []))].sort()
  const hdCounts = HD_KEYS.filter((k) => k !== 'ground').map((k) => [k, project.collected[hdLayer(k)]?.features.length ?? 0] as const).filter(([, n]) => n > 0)

  /** 환경 계산을 이미 했으면 새 건물·지형으로 다시 */
  const recomputeEnv = async (after: Project | null) => {
    if (!after || !after.collected['env:result']) return ''
    setBusy('환경 계산 다시 하는 중')
    try {
      const r = await computeEnv(after, config, (t) => setBusy(`환경 계산 다시 하는 중 · ${t}`))
      update((d) => applyEnv(d, r, null))
      return ' 일조·하늘·가시권·바람·열쾌적도 다시 계산했습니다.'
    } catch (e) {
      return ` 환경 계산은 다시 하지 못했습니다(${e instanceof Error ? e.message : String(e)}).`
    }
  }

  const loadFolder = async (list: LocalItem[]) => {
    setBusy('자료 폴더에서 꺼내는 중')
    const files: File[] = []
    for (const it of list) {
      try {
        files.push(await it.get())
      } catch (e) {
        setMsg({ kind: 'error', text: `${it.path}: ${e instanceof Error ? e.message : String(e)}` })
      }
    }
    await onFiles(files, '자료 폴더에서 넣었습니다')
  }

  const onFiles = async (files: File[], okLabel = '올렸습니다') => {
    const usable = files.filter((f) => /\.(zip|ngi|nda)$/i.test(f.name))
    if (!usable.length) {
      setMsg({ kind: 'error', text: '수치지도 2.0 ZIP(1:5,000), NGI·NDA(1:1,000) 또는 정밀도로지도 ZIP을 골라 주세요 (DXF·XML·XLSX는 쓰지 않음).' })
      return
    }
    setMsg(null)
    const sheets: NgiiSheet[] = []
    const hdSets: HdSet[] = []
    const problems: string[] = []
    // 이번에 올리는 ZIP들 사이에서만 겹침을 뺌 (같은 파일을 다시 올리면 새로 읽은 것으로 바꿈 — 읽기 방식이 나아졌을 때)
    const seenHd = new Set<string>()
    // 1:1,000 NGI·NDA 짝 (낱개 파일 + ZIP 안)
    const ngiPairs = new Map<string, { ngi?: Uint8Array; nda?: Uint8Array; name: string }>()
    const addPart = (path: string, bytes: Uint8Array) => {
      const name = path.replace(/\\/g, '/').split('/').pop()!
      const m = name.match(/^(.+)\.(ngi|nda)$/i)
      if (!m) return
      const rec = ngiPairs.get(m[1]) ?? { name: `${m[1]}.ngi` }
      if (m[2].toLowerCase() === 'ngi') rec.ngi = bytes
      else rec.nda = bytes
      ngiPairs.set(m[1], rec)
    }
    for (const f of usable) {
      setBusy(`${f.name} 읽는 중`)
      await new Promise((r) => setTimeout(r, 20))
      try {
        const bytes = new Uint8Array(await f.arrayBuffer())
        if (/\.(ngi|nda)$/i.test(f.name)) {
          addPart(f.name, bytes)
          continue
        }
        // ZIP: 안의 파일 이름만 먼저 보고 종류를 가림
        const names: string[] = []
        unzipSync(bytes, {
          filter: (e) => {
            names.push(e.name)
            return false
          },
        })
        if (names.some((n) => /\.ngi$/i.test(n))) {
          for (const [path, b] of Object.entries(unzipSync(bytes, { filter: (e) => /\.(ngi|nda)$/i.test(e.name) }))) addPart(path, b)
        } else if (names.some((n) => /(laneline|surfacelinemark|roadmarking|surfacemark|roadborder|pathway)\.shp$/i.test(n))) {
          const h = readHdZip(f.name, bytes, center, R, seenHd)
          const n = Object.values(h.counts).reduce((a, b) => a + (b ?? 0), 0)
          if (!n) problems.push(`${f.name}: 대지 반경 ${R}m 안에 차선·노면표시가 없음 (이미 올린 구간과 겹치는 것만 있거나 범위 밖)`)
          else hdSets.push(h)
        } else {
          const s = readNgiiZip(f.name, bytes, center, R)
          const n = Object.values(s.counts).reduce((a, b) => a + (b ?? 0), 0)
          if (!n) problems.push(`${s.code || f.name}: 대지 반경 ${R}m에 걸치지 않는 도엽`)
          else sheets.push(s)
        }
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e))
      }
    }
    for (const [, pair] of ngiPairs) {
      if (!pair.ngi) {
        problems.push(`${pair.name.replace(/\.ngi$/i, '.nda')}: 짝이 되는 .ngi가 없음`)
        continue
      }
      setBusy(`${pair.name} 읽는 중`)
      await new Promise((r) => setTimeout(r, 10))
      try {
        const s = readNgi1000(pair.name, pair.ngi, pair.nda ?? null, center, R)
        const n = Object.values(s.counts).reduce((a, b) => a + (b ?? 0), 0)
        if (!pair.nda) problems.push(`${s.code}: .nda(속성)가 없어 층수·이름 없이 읽음`)
        if (!n) problems.push(`${s.code}: 대지 반경 ${R}m에 걸치지 않는 도엽`)
        else sheets.push(s)
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e))
      }
    }
    let after: Project | null = null
    if (sheets.length || hdSets.length) {
      update((d) => {
        if (sheets.length) applyNgiiSheets(d, sheets, R)
        if (hdSets.length) applyHdSets(d, hdSets, R)
        after = d
      })
    }
    const envText = sheets.length ? await recomputeEnv(after) : ''
    setBusy(null)
    const ok = sheets.map(
      (s) =>
        `${s.scale === 1000 ? '1:1,000 ' : ''}${s.code}(${s.year ?? '연도 미상'}) 건물 ${fmt(s.counts.bldg ?? 0)}·도로 면 ${fmt(s.counts.road ?? 0)}${s.scale === 1000 ? `·가로수 ${fmt(s.counts.tree ?? 0)}·정류장 ${fmt(s.counts.stop ?? 0)}` : `·옹벽 등 ${fmt(s.counts.wall ?? 0)}`}`,
    )
    const okHd = hdSets.map((h) => `정밀도로지도 ${h.sections.join('·')} 차선 ${fmt(h.counts.lane ?? 0)}·노면표시 ${fmt(h.counts.mark ?? 0)}`)
    setMsg({
      kind: problems.length && !sheets.length && !hdSets.length ? 'error' : 'ok',
      text: [ok.length || okHd.length ? `${okLabel}: ${[...ok, ...okHd].join(' / ')}.${envText}` : '', problems.length ? `건너뜀: ${problems.join(' / ')}` : ''].filter(Boolean).join(' '),
    })
  }

  const clearHd = () => {
    update((d) => removeHd(d))
    setMsg({ kind: 'ok', text: '정밀도로지도를 지웠습니다.' })
  }

  const clear = async () => {
    let after: Project | null = null
    update((d) => {
      removeNgii(d)
      after = d
    })
    const envText = await recomputeEnv(after)
    setBusy(null)
    setMsg({ kind: 'ok', text: `수치지도를 지웠습니다. 건물·지형은 브이월드·10m 격자로 돌아갑니다.${envText}` })
  }

  return (
    <section className="block ngii-box">
      <h3>수치지도·정밀도로지도 올리기 (선택 · 더 정밀하게)</h3>
      <p className="help">
        국토정보플랫폼(map.ngii.go.kr)에서 1:5,000 <strong>수치지도 2.0</strong>을 아래 도엽 번호로 받아 <strong>ZIP 그대로</strong> 올리세요. 올리면 그 도엽 안은 건물(측량 도형·층수), 도로경계·인도, 옹벽·석축, 등고선·표고점(대지 주변 2m 지형)으로
        도판·환경 계산·3D·DXF를 다시 그립니다. 파일은 이 브라우저에만 저장됩니다.
      </p>
      <p className="help">
        더 자세히: <strong>1:1,000 수치지도 2.0</strong>은 <strong>.ngi와 .nda를 함께</strong>(또는 둘을 담은 ZIP) 올리면 도로중심선 폭·횡단보도·정류장·가로수·담장·가로등까지 들어갑니다. 1:5,000과 해가 다르면
        아래 <strong>항목별로 쓸 자료</strong>에서 항목마다 어느 쪽을 쓸지 고릅니다(기본은 새 자료).{' '}
        <strong>정밀도로지도</strong> ZIP은 차선·노면표시·연석·보도 면을 렌더링 모델(.3dm)에 넣습니다. 여러 파일을 한꺼번에 끌어다 놓아도 종류를 알아서 가립니다.
      </p>
      <div className="local-folder">
        {local.state === 'unsupported' ? (
          <p className="small muted">내 PC 자료 폴더 연결은 크롬·엣지에서만 됩니다 — 아래에 파일을 올려 주세요.</p>
        ) : local.state === 'none' ? (
          <>
            <button type="button" className="btn small" onClick={() => void connectFolder()}>
              내 PC 자료 폴더 연결
            </button>
            <span className="small muted">
              {' '}
              국토정보플랫폼에서 받은 수치지도(도엽 ZIP·시군구 묶음·1:1,000)·정밀도로지도·10m 지형 타일을 한 폴더에 두면, 대지에 걸친 것을 앱이 알아서 찾아 넣습니다. 자료는 PC 밖으로 나가지 않습니다.
            </span>
          </>
        ) : local.state === 'prompt' ? (
          <>
            <button type="button" className="btn small primary" onClick={() => void regrantFolder()}>
              자료 폴더 다시 허락
            </button>
            <span className="small muted"> 브라우저를 다시 열면 폴더 허락이 풀릴 때가 있습니다.</span>
          </>
        ) : local.state === 'scanning' ? (
          <span className="small">{local.progress ?? '자료 폴더 훑는 중'}…</span>
        ) : local.state === 'error' ? (
          <>
            <span className="small warn-text">{local.message}</span>{' '}
            <button type="button" className="btn small" onClick={() => void connectFolder()}>
              다시 연결
            </button>
          </>
        ) : local.index ? (
          <>
            <p className="small">
              <strong>자료 폴더 '{local.index.folder}'</strong> — 1:5,000 {new Set(local.index.items.filter((i) => i.kind === 'ngii5').map((i) => i.code)).size}도엽
              {local.index.bundles ? `(묶음 ${local.index.bundles}개 안 포함)` : ''} · 1:1,000 {new Set(local.index.items.filter((i) => i.kind === 'ngii1').map((i) => i.code)).size}도엽 · 정밀도로지도{' '}
              {local.index.items.filter((i) => i.kind === 'hd').length}개 · 10m 지형 {local.index.dem ? `타일 ${local.index.dem.tiles.toLocaleString('ko-KR')}장(지형은 이 타일로)` : '없음(공개 지형)'}
            </p>
            {site && (
              <p className="small">
                이 대지: 1:5,000 {site.sheets5.length}/{site.sheets5.length + site.missing5.length}도엽 있음
                {site.missing5.length ? <span className="muted"> (없음 {site.missing5.join(', ')})</span> : ''} · 1:1,000 {new Set(site.sheets1.map((i) => i.code)).size}도엽
                {fromFolder.length ? (
                  <>
                    {' '}
                    ·{' '}
                    <button type="button" className="link-btn small" disabled={!!busy} onClick={() => void loadFolder(fromFolder)}>
                      아직 안 넣은 {fromFolder.length}개 넣기
                    </button>
                  </>
                ) : (
                  ' · 모두 넣음'
                )}
              </p>
            )}
            {local.index.problems.length > 0 && <p className="small warn-text">{local.index.problems.join(' / ')}</p>}
            <button type="button" className="link-btn small" onClick={() => void rescanFolder()}>
              다시 훑기
            </button>{' '}
            <button type="button" className="link-btn small" onClick={() => void disconnectFolder()}>
              연결 끊기
            </button>
          </>
        ) : null}
        {!folderSupported && null}
      </div>
      <div className="ngii-sheets">
        <span className="label">반경 {R}m에 걸치는 도엽</span>
        {needed.map((code) => (
          <span key={code} className={`chip small${have.has(code) ? ' on' : ''}`} title={have.has(code) ? `${String(have.get(code)?.file ?? '')} 올림` : '아직 안 올림'}>
            {code}
            {have.has(code) && <Check className="icon" aria-hidden="true" />}
          </span>
        ))}
      </div>
      <label
        className={`ngii-drop${drag ? ' drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          void onFiles([...e.dataTransfer.files])
        }}
      >
        <input
          type="file"
          accept=".zip,.ngi,.nda,application/zip"
          multiple
          hidden
          disabled={!!busy}
          onChange={(e) => {
            const fs = [...(e.target.files ?? [])]
            e.target.value = ''
            void onFiles(fs)
          }}
        />
        <span>{busy ? `${busy}…` : '여기에 ZIP·NGI·NDA를 끌어다 놓거나 눌러서 고르기 (여러 개 한꺼번에)'}</span>
      </label>
      {hasNgii(project) && (
        <div className="ngii-status">
          <p className="small">
            올린 수치지도: {codes5.length ? `1:5,000 ${codes5.join(', ')}` : ''}
            {codes5.length && codes1.length ? ' / ' : ''}
            {codes1.length ? `1:1,000 ${codes1.length}도엽 (${codes1[0]}~${codes1[codes1.length - 1]})` : ''} · {counts.map(([k, n]) => `${NGII_LABEL[k]} ${fmt(n)}`).join(' · ')}
          </p>
          {uploadedR < R && <p className="notice">수치지도를 올린 뒤 조사 반경이 넓어졌습니다({uploadedR}m → {R}m). 같은 ZIP을 다시 올리면 넓은 범위로 읽습니다.</p>}
          {needed.some((c) => !have.has(c)) && <p className="small muted">안 올린 도엽 범위는 브이월드 건물·10m 지형을 그대로 씁니다.</p>}
          <button type="button" className="link-btn small" disabled={!!busy} onClick={() => void clear()}>
            수치지도 지우기
          </button>
        </div>
      )}
      {hasHd(project) && (
        <div className="ngii-status">
          <p className="small">
            올린 정밀도로지도: 구간 {hdSections.join(', ')} · {hdCounts.map(([k, n]) => `${HD_LABEL[k]} ${fmt(n)}`).join(' · ')}
          </p>
          <button type="button" className="link-btn small" disabled={!!busy} onClick={clearHd}>
            정밀도로지도 지우기
          </button>
        </div>
      )}
      {msg && <p className={`notice ${msg.kind === 'error' ? 'error' : 'ok'}`}>{msg.text}</p>}
    </section>
  )
}
