// ④ 공간정보 › 수치지도 올리기: 국토지리정보원 1:5,000 수치지도 2.0 ZIP(도엽별)을 읽어 프로젝트에 넣고, 환경 계산을 다시 한다.

import { useState } from 'react'
import { centerOf, siteBoundary } from '../lib/geo'
import { sheetsAround } from '../lib/mapSheet'
import { applyEnv } from '../model/applyEnv'
import { applyNgiiSheets, hasNgii, removeNgii } from '../model/applyNgii'
import type { Project } from '../model/types'
import { computeEnv } from '../sources/env'
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
  const boundary = siteBoundary(project.site)
  if (!boundary) return null
  const center = centerOf(boundary)
  const R = project.collectedRadiusM ?? project.site.radiusM
  const needed = sheetsAround(center[0], center[1], R)
  const sheetProps = (project.collected[ngiiLayer('sheets')]?.features ?? []).map((f) => f.properties)
  const have = new Map(sheetProps.map((p) => [String(p.code), p]))
  const uploadedR = Math.min(...sheetProps.map((p) => Number(p.radiusM) || 0))
  const counts = NGII_KEYS.map((k) => [k, project.collected[ngiiLayer(k)]?.features.length ?? 0] as const).filter(([, n]) => n > 0)

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

  const onFiles = async (files: File[]) => {
    const zips = files.filter((f) => /\.zip$/i.test(f.name))
    if (!zips.length) {
      setMsg({ kind: 'error', text: '수치지도 2.0 ZIP 파일을 골라 주세요 (DXF·XML이 아니라 ZIP).' })
      return
    }
    setMsg(null)
    const sheets: NgiiSheet[] = []
    const problems: string[] = []
    for (const f of zips) {
      setBusy(`${f.name} 읽는 중`)
      await new Promise((r) => setTimeout(r, 20))
      try {
        const s = readNgiiZip(f.name, new Uint8Array(await f.arrayBuffer()), center, R)
        const n = Object.values(s.counts).reduce((a, b) => a + (b ?? 0), 0)
        if (!n) problems.push(`${s.code || f.name}: 대지 반경 ${R}m에 걸치지 않는 도엽`)
        else sheets.push(s)
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e))
      }
    }
    let after: Project | null = null
    if (sheets.length) {
      update((d) => {
        applyNgiiSheets(d, sheets, R)
        after = d
      })
    }
    const envText = sheets.length ? await recomputeEnv(after) : ''
    setBusy(null)
    const ok = sheets.map((s) => `${s.code}(${s.year ?? '연도 미상'}) 건물 ${fmt(s.counts.bldg ?? 0)}·도로 면 ${fmt(s.counts.road ?? 0)}·옹벽 등 ${fmt(s.counts.wall ?? 0)}`)
    setMsg({
      kind: problems.length && !sheets.length ? 'error' : 'ok',
      text: [ok.length ? `올렸습니다: ${ok.join(' / ')}.${envText}` : '', problems.length ? `건너뜀: ${problems.join(' / ')}` : ''].filter(Boolean).join(' '),
    })
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
      <h3>수치지도 올리기 (선택 · 더 정밀하게)</h3>
      <p className="help">
        국토정보플랫폼(map.ngii.go.kr)에서 1:5,000 <strong>수치지도 2.0</strong>을 아래 도엽 번호로 받아 <strong>ZIP 그대로</strong> 올리세요. 올리면 그 도엽 안은 건물(측량 도형·층수), 도로경계·인도, 옹벽·석축, 등고선·표고점(대지 주변 2m 지형)으로
        도판·환경 계산·3D·DXF를 다시 그립니다. 파일은 이 브라우저에만 저장됩니다.
      </p>
      <div className="ngii-sheets">
        <span className="label">반경 {R}m에 걸치는 도엽</span>
        {needed.map((code) => (
          <span key={code} className={`chip small${have.has(code) ? ' on' : ''}`} title={have.has(code) ? `${String(have.get(code)?.file ?? '')} 올림` : '아직 안 올림'}>
            {code}
            {have.has(code) ? ' ✓' : ''}
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
          accept=".zip,application/zip"
          multiple
          hidden
          disabled={!!busy}
          onChange={(e) => {
            const fs = [...(e.target.files ?? [])]
            e.target.value = ''
            void onFiles(fs)
          }}
        />
        <span>{busy ? `${busy}…` : '여기에 ZIP을 끌어다 놓거나 눌러서 고르기 (여러 개 한꺼번에)'}</span>
      </label>
      {hasNgii(project) && (
        <div className="ngii-status">
          <p className="small">
            올린 수치지도: {[...have.keys()].sort().join(', ')} · {counts.map(([k, n]) => `${NGII_LABEL[k]} ${fmt(n)}`).join(' · ')}
          </p>
          {uploadedR < R && <p className="notice">수치지도를 올린 뒤 조사 반경이 넓어졌습니다({uploadedR}m → {R}m). 같은 ZIP을 다시 올리면 넓은 범위로 읽습니다.</p>}
          {needed.some((c) => !have.has(c)) && <p className="small muted">안 올린 도엽 범위는 브이월드 건물·10m 지형을 그대로 씁니다.</p>}
          <button type="button" className="link-btn small" disabled={!!busy} onClick={() => void clear()}>
            수치지도 지우기
          </button>
        </div>
      )}
      {msg && <p className={`notice ${msg.kind === 'error' ? 'error' : 'ok'}`}>{msg.text}</p>}
    </section>
  )
}
