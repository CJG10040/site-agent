import { useEffect, useMemo, useState } from 'react'
import type { PanelOutput } from '../diagrams/compose'
import { svgBlob, svgToPng, zipBlob } from '../diagrams/export'
import { siteOverview } from '../diagrams/overview'
import { PALETTES } from '../diagrams/palette'
import { ORDERED_PANELS, PANEL_GROUP_ORDER, panelNumber, type PanelDef } from '../diagrams/panels'
import { buildPanelPrompt, parsePanelAnswer } from '../diagrams/prompt'
import { collectedDate, DEFAULT_SETTINGS, panelFileName } from '../diagrams/render'
import { useDiagrams, type CachedPanel } from '../diagrams/useDiagrams'
import { DXF_LAYERS, siteModelToDxf } from '../export/toDxf'
import { wgs84ToUtmk } from '../lib/proj'
import { upsertDrafts } from '../model/applyCollection'
import { appendSpeedSnapshot } from '../model/applyMove'
import { downloadBlob, nowIso } from '../model/project'
import { splitPrompt } from '../model/prompts'
import type { DiagramSettings, PanelNote, Project } from '../model/types'
import { snapshotLabel, timeBand, toSnapshot, trafficInBox } from '../sources/its'
import type { ApiKeys } from '../sources/keys'
import type { VWorldConfig } from '../sources/vworld'
import { SEASONS } from '../sources/wind'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  config: VWorldConfig
  keys: ApiKeys
  onGoData: () => void
  onNext: () => void
}

/** 대지 경계 꼭짓점이 원점(대지 중심)에서 가장 먼 거리 (x·y 중 큰 쪽, 내보낼 정사각형 범위의 최소값) */
function siteFarM(d: { center: [number, number]; boundary: { type: string; coordinates: unknown } }): number {
  const [X0, Y0] = wgs84ToUtmk(d.center[0], d.center[1])
  const polys = (d.boundary.type === 'Polygon' ? [d.boundary.coordinates] : d.boundary.coordinates) as number[][][][]
  let far = 0
  for (const p of polys)
    for (const [lo, la] of p[0]) {
      const [x, y] = wgs84ToUtmk(lo, la)
      far = Math.max(far, Math.abs(x - X0), Math.abs(y - Y0))
    }
  return far
}

const EMPTY_NOTE: PanelNote = { conclusion: '', suggestions: [], include: true, source: null, updatedAt: '' }

function noteOf(project: Project, id: string): PanelNote {
  return { ...EMPTY_NOTE, ...(project.diagrams?.panels[id] ?? {}) }
}

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg-field">
      <span className="label">{label}</span>
      <div className="segmented small" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Viewer({ panel, def, onClose, onSvg, onPng }: { panel: CachedPanel; def: PanelDef; onClose: () => void; onSvg: () => void; onPng: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="diagram-viewer" role="dialog" aria-modal="true" aria-label={def.title} onClick={(e) => e.stopPropagation()}>
        <img src={panel.url} alt={def.title} />
        <div className="row">
          <button type="button" className="btn small" onClick={onSvg}>
            SVG
          </button>
          <button type="button" className="btn small" onClick={onPng}>
            PNG
          </button>
          <span className="spacer" />
          <button type="button" className="btn small ghost" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

export default function DiagramStep({ project, update, config, keys, onGoData, onNext }: Props) {
  const { data, settings, panels, busy, terrain } = useDiagrams(project, config.key)
  const [viewing, setViewing] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [chatbot, setChatbot] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [copied, setCopied] = useState<number | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const [speedBusy, setSpeedBusy] = useState(false)
  const [modelBusy, setModelBusy] = useState<'3dm' | 'dxf' | null>(null)
  const [modelStep, setModelStep] = useState('')
  const [modelMsg, setModelMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [modelHalf, setModelHalf] = useState<number | null>(null)
  // 처음 열 때 결론이 하나도 없으면 챗봇 상자를 펼쳐 둔다 (그 뒤로는 사용자가 연 대로)
  const [chatOpen, setChatOpen] = useState(() => !Object.values(project.diagrams?.panels ?? {}).some((n) => n.conclusion.trim()))

  const overview = useMemo(() => (data ? siteOverview(project, data, terrain) : null), [data, project, terrain])

  const setSettings = (patch: Partial<DiagramSettings>) =>
    update((d) => {
      const cur = d.diagrams ?? { settings: { ...DEFAULT_SETTINGS }, panels: {} }
      cur.settings = { ...DEFAULT_SETTINGS, ...cur.settings, ...patch }
      d.diagrams = cur
    })

  const patchNote = (id: string, patch: Partial<PanelNote>) =>
    update((d) => {
      const cur = d.diagrams ?? { settings: { ...DEFAULT_SETTINGS }, panels: {} }
      cur.panels = { ...cur.panels, [id]: { ...EMPTY_NOTE, ...cur.panels[id], ...patch, updatedAt: nowIso() } }
      d.diagrams = cur
    })

  /** 실시간 도로 속도 한 장면 더 받기 (출근·낮·퇴근 시간 비교용) */
  const fetchSpeed = async () => {
    if (!data || speedBusy) return
    setSpeedBusy(true)
    setMsg(null)
    try {
      const R = data.R
      const [lon, lat] = data.center
      const dLat = R / 110574
      const dLon = R / (111320 * Math.cos((lat * Math.PI) / 180))
      const snap = toSnapshot(await trafficInBox(keys, [lon - dLon, lat - dLat, lon + dLon, lat + dLat]))
      if (!Object.keys(snap.speeds).length) throw new Error('이 범위에 속도 자료가 있는 도로가 없습니다')
      const last = data.speedSnaps[data.speedSnaps.length - 1]
      if (last && snap.created && last.created === snap.created)
        throw new Error(`아직 새 자료가 없습니다 (${snapshotLabel(last)} 자료가 최신, 약 5분마다 갱신)`)
      update((d) => {
        appendSpeedSnapshot(d, snap, R, upsertDrafts)
        const cur = d.diagrams ?? { settings: { ...DEFAULT_SETTINGS }, panels: {} }
        cur.settings = { ...DEFAULT_SETTINGS, ...cur.settings, speedSnap: -1 }
        d.diagrams = cur
      })
      setMsg({ kind: 'ok', text: `${snapshotLabel(snap)}(${timeBand(snap)}) 속도 장면을 더했습니다. 사실 카드 '교통'도 고쳤습니다.` })
    } catch (e) {
      setMsg({ kind: 'error', text: `속도를 받지 못했습니다: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setSpeedBusy(false)
    }
  }

  // ── 3D 모형·CAD 밑그림: 범위(정사각형 반쪽)는 대지가 다 들어가는 것만
  const siteFar = useMemo(() => (data ? siteFarM(data) : 0), [data])
  const halfOptions = useMemo(() => {
    if (!data) return []
    const opts = [...new Set([150, 300, 500, 1000, data.R])].filter((h) => h <= data.R && h >= siteFar + 20).sort((a, b) => a - b)
    return opts.length ? opts : [Math.max(data.R, Math.ceil(siteFar + 20))]
  }, [data, siteFar])
  const half = modelHalf !== null && halfOptions.includes(modelHalf) ? modelHalf : (halfOptions.find((h) => h >= 300) ?? halfOptions[halfOptions.length - 1])
  const sideLabel = (h: number) => (h * 2 >= 1000 ? `${(h * 2) / 1000}km` : `${h * 2}m`)

  const exportModel = async (kind: '3dm' | 'dxf') => {
    if (!data || modelBusy || !half) return
    setModelBusy(kind)
    setModelMsg(null)
    setModelStep('지형·건물·도로 준비')
    try {
      await new Promise((r) => setTimeout(r, 30))
      const { buildSiteModel } = await import('../export/siteModel')
      const m = await buildSiteModel(data, half)
      const meta = {
        title: project.brief.projectName || '대지',
        address: project.site.address?.road || project.site.address?.parcel || project.site.parcels[0]?.addr || '',
        collected: collectedDate(project),
      }
      const name = `${(project.brief.projectName || '대지').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30)}_${kind === '3dm' ? '3D' : '평면'}_${sideLabel(half)}`
      if (kind === '3dm') {
        const { siteModelTo3dm } = await import('../export/to3dm')
        const bytes = await siteModelTo3dm(m, meta, setModelStep)
        downloadBlob(`${name}.3dm`, new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
      } else {
        downloadBlob(`${name}.dxf`, new Blob([siteModelToDxf(m, meta)], { type: 'application/dxf' }))
      }
      const unknown = m.buildings.filter((b) => b.top === null).length
      setModelMsg({
        kind: 'ok',
        text: `${kind === '3dm' ? '라이노 파일' : 'DXF'}을 내려받았습니다 — 가로·세로 ${sideLabel(half)}, 건물 ${m.buildings.length.toLocaleString('ko-KR')}동(층수 모름 ${unknown}동은 발자국만), 등고선 ${m.contours.length}개(${m.contourStep}m 간격)${m.terrainSource === 'terrarium' ? ', 지형은 대체 자료(약 30m)' : m.terrainSource ? '' : ', 지형 자료 없음'}.`,
      })
    } catch (e) {
      setModelMsg({ kind: 'error', text: `만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setModelBusy(null)
      setModelStep('')
    }
  }

  const ready = ORDERED_PANELS.filter((p) => panels[p.id] && !panels[p.id].out.empty)
  const written = ORDERED_PANELS.filter((p) => noteOf(project, p.id).conclusion.trim()).length

  const prompt = useMemo(
    () => buildPanelPrompt(project, ready.map((p) => ({ id: p.id, out: panels[p.id].out as PanelOutput }))),
    // 결론을 쓰는 동안에도 프롬프트에 반영되도록 project 전체에 따름
    [project, panels, ready],
  )
  const parts = splitPrompt(prompt, 9000)

  const copy = async (text: string, i: number) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(i)
      window.setTimeout(() => setCopied(null), 1500)
    } catch {
      setMsg({ kind: 'error', text: '복사하지 못했습니다. 프롬프트를 직접 선택해 복사하세요.' })
    }
  }

  const importAnswer = () => {
    const r = parsePanelAnswer(answer)
    const ids = Object.keys(r.byId)
    if (!ids.length) {
      setMsg({ kind: 'error', text: "답변에서 '### [도판] 도판id' 와 '결론1:' 형식을 찾지 못했습니다. 챗봇에게 형식을 지켜 달라고 다시 요청해 보세요." })
      return
    }
    update((d) => {
      const cur = d.diagrams ?? { settings: { ...DEFAULT_SETTINGS }, panels: {} }
      const t = nowIso()
      for (const id of ids) {
        const prev = { ...EMPTY_NOTE, ...cur.panels[id] }
        cur.panels[id] = { ...prev, suggestions: r.byId[id].slice(0, 4), updatedAt: t }
      }
      cur.chatLog = [...(cur.chatLog ?? []), { at: t, chatbot: chatbot.trim(), prompt, answer, matched: ids.length }]
      d.diagrams = cur
    })
    setAnswer('')
    setMsg({ kind: 'ok', text: `${ids.length}개 도판에 결론 후보를 붙였습니다. 각 도판에서 후보를 눌러 고르거나 고쳐 쓰세요.${r.unknown.length ? ` (알아보지 못한 제목 ${r.unknown.length}개)` : ''}` })
  }

  const downloadSvg = (def: PanelDef) => {
    const p = panels[def.id]
    if (p) downloadBlob(panelFileName(project, def, 'svg'), svgBlob(p.svg))
  }
  const downloadPng = async (def: PanelDef) => {
    const p = panels[def.id]
    if (!p) return
    try {
      downloadBlob(panelFileName(project, def, 'png'), await svgToPng(p.svg, settings.pngWidth, settings.background === 'white' ? '#ffffff' : null))
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }
  const downloadAll = async (kind: 'svg' | 'png') => {
    setExporting(kind)
    try {
      const files: { name: string; data: Blob | string }[] = []
      for (const def of ready) {
        const p = panels[def.id]
        files.push({
          name: panelFileName(project, def, kind),
          data: kind === 'svg' ? `<?xml version="1.0" encoding="UTF-8"?>\n${p.svg}` : await svgToPng(p.svg, settings.pngWidth, settings.background === 'white' ? '#ffffff' : null),
        })
      }
      const name = (project.brief.projectName || '대지').replace(/[\\/:*?"<>|\s]+/g, '_')
      downloadBlob(`${name}_도판_${kind.toUpperCase()}.zip`, await zipBlob(files))
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setExporting(null)
    }
  }

  if (!data) {
    return (
      <div className="form-page wide">
        <header className="form-head">
          <p className="eyebrow">⑥ 도판</p>
          <h2>도판으로 보고 결론 한 문장 쓰기</h2>
        </header>
        <div className="notice">
          <p>먼저 대지를 정하고 공간정보를 수집해야 도판을 그릴 수 있습니다.</p>
          <button type="button" className="btn small" onClick={onGoData}>
            공간정보 수집하러 가기
          </button>
        </div>
      </div>
    )
  }

  const viewDef = viewing ? ORDERED_PANELS.find((p) => p.id === viewing) : null

  return (
    <div className="form-page wide diagrams-page">
      <header className="form-head">
        <p className="eyebrow">⑥ 도판</p>
        <h2>도판으로 보고 결론 한 문장 쓰기</h2>
        <p className="muted">
          도판 한 장에는 사실 하나만 담았습니다. 각 도판에서 <strong>무엇을 판단할 수 있는지 한 문장</strong>으로 적어 보세요. 챗봇에게 결론 후보를 받을 수도 있습니다. 적은
          결론은 해석 단계의 프롬프트와 리포트에 함께 들어갑니다. 모르는 값은 회색 '미상'으로 두었습니다.
        </p>
      </header>

      {!project.collectedAt && (
        <p className="notice">
          아직 공간정보를 수집하지 않았습니다.{' '}
          <button type="button" className="link-btn" onClick={onGoData}>
            공간정보 수집
          </button>
        </p>
      )}

      {overview && (
        <section className="overview-card">
          <div>
            <h3>대지</h3>
            <dl>
              {overview.site.map((it) => (
                <div key={it.label}>
                  <dt>{it.label}</dt>
                  <dd>
                    {it.value}
                    {it.note && <span className="muted small"> {it.note}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h3>주변 (반경 {data.R}m)</h3>
            <dl>
              {overview.around.map((it) => (
                <div key={it.label}>
                  <dt>{it.label}</dt>
                  <dd>
                    {it.value}
                    {it.note && <span className="muted small"> {it.note}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="muted small overview-note">{overview.note}</p>
        </section>
      )}

      <section className="diagram-settings">
        <Seg label="틀" value={settings.frame} options={[{ v: 'circle', label: '원형' }, { v: 'square', label: '사각형' }]} onChange={(v) => setSettings({ frame: v })} />
        <Seg label="색" value={settings.palette} options={PALETTES.map((p) => ({ v: p.id, label: p.label }))} onChange={(v) => setSettings({ palette: v })} />
        <Seg label="바탕" value={settings.background} options={[{ v: 'white', label: '흰색' }, { v: 'none', label: '투명' }]} onChange={(v) => setSettings({ background: v })} />
        <Seg
          label="대지 표시"
          value={settings.siteMark}
          options={[
            { v: 'outline', label: '경계선' },
            { v: 'fill', label: '채움' },
            { v: 'dot', label: '점' },
          ]}
          onChange={(v) => setSettings({ siteMark: v })}
        />
        <label className="num-field">
          <span className="label">고층 기준</span>
          <input type="number" min={3} max={60} value={settings.highFloors} onChange={(e) => setSettings({ highFloors: Math.max(3, Number(e.target.value) || 10) })} />
          <span className="muted small">층 이상</span>
        </label>
        <label className="num-field">
          <span className="label">저층 기준</span>
          <input type="number" min={1} max={20} value={settings.lowFloors} onChange={(e) => setSettings({ lowFloors: Math.max(1, Number(e.target.value) || 4) })} />
          <span className="muted small">층 이하</span>
        </label>
        <Seg
          label="그림자·일조 날짜"
          value={settings.sunDay}
          options={[
            { v: 'winter', label: '동지' },
            { v: 'equinox', label: '춘·추분' },
            { v: 'summer', label: '하지' },
          ]}
          onChange={(v) => setSettings({ sunDay: v })}
        />
        <label className="num-field">
          <span className="label">그림자 시각 {settings.sunHour}시</span>
          <input type="range" min={7} max={18} step={1} value={settings.sunHour} onChange={(e) => setSettings({ sunHour: Number(e.target.value) })} />
        </label>
        <label className="num-field">
          <span className="label">단면 방향 {settings.sectionAngle}°</span>
          <input type="range" min={0} max={165} step={15} value={settings.sectionAngle} onChange={(e) => setSettings({ sectionAngle: Number(e.target.value) })} />
        </label>
        {data?.env && (
          <label className="num-field">
            <span className="label">계획 층수 (가시권)</span>
            <input type="number" min={1} max={80} value={settings.planFloors} onChange={(e) => setSettings({ planFloors: Math.max(1, Math.min(80, Number(e.target.value) || 5)) })} />
            <span className="muted small">층 × 3m</span>
          </label>
        )}
        {data?.wind && (
          <Seg label="바람장미" value={settings.windSeason} options={SEASONS.map((s, i) => ({ v: i, label: s }))} onChange={(v) => setSettings({ windSeason: v })} />
        )}
        {data && (data.speedSnaps.length > 0 || project.dataSelection?.includes('traffic')) && (
          <div className="seg-field speed-field">
            <span className="label">도로 속도 장면</span>
            <div className="row">
              {data.speedSnaps.length > 0 && (
                <select
                  value={settings.speedSnap >= 0 && settings.speedSnap < data.speedSnaps.length ? settings.speedSnap : data.speedSnaps.length - 1}
                  onChange={(e) => setSettings({ speedSnap: Number(e.target.value) })}
                  aria-label="도로 속도 장면"
                >
                  {data.speedSnaps.map((s, i) => (
                    <option key={s.at} value={i}>
                      {snapshotLabel(s)} · {timeBand(s)}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="btn small" disabled={speedBusy || !keys.itsKey.trim()} onClick={() => void fetchSpeed()} title={keys.itsKey.trim() ? '' : '설정에서 국가교통정보센터 키를 넣으세요'}>
                {speedBusy ? '받는 중…' : '지금 한 번 더 받기'}
              </button>
            </div>
          </div>
        )}
        <Seg label="PNG 크기" value={settings.pngWidth} options={[{ v: 2000, label: '2000px' }, { v: 4000, label: '4000px' }]} onChange={(v) => setSettings({ pngWidth: v })} />
        <div className="diagram-export">
          <button type="button" className="btn small" disabled={!!exporting || busy || !ready.length} onClick={() => void downloadAll('svg')}>
            {exporting === 'svg' ? '묶는 중…' : 'SVG 모두 (ZIP)'}
          </button>
          <button type="button" className="btn small" disabled={!!exporting || busy || !ready.length} onClick={() => void downloadAll('png')}>
            {exporting === 'png' ? '만드는 중…' : 'PNG 모두 (ZIP)'}
          </button>
        </div>
      </section>

      <section className="block export-3d">
        <h3>3D 모형·CAD 밑그림 내보내기</h3>
        <p className="muted small">
          대지 중심 = 원점(단위 m, 위쪽 = 북), 높이 0 = 대지 중심 지면. 지형은 국토지리정보원 등고선으로 만든 <strong>10m 격자</strong>라 1m 안팎의 높낮이는 정확하지 않고,
          건물 높이는 <strong>층수 × 3m 어림</strong>입니다(층수 모르면 발자국만). 원점의 실제 좌표(EPSG:5179·5186·경위도)는 파일 안에 적어 둡니다.
        </p>
        <div className="row">
          <span className="label">범위 (가로·세로)</span>
          <div className="segmented small" role="radiogroup" aria-label="내보낼 범위">
            {halfOptions.map((h) => (
              <button key={h} type="button" role="radio" aria-checked={half === h} className={half === h ? 'on' : ''} onClick={() => setModelHalf(h)}>
                {sideLabel(h)}
                {h === data.R ? ' (수집 반경)' : ''}
              </button>
            ))}
          </div>
          <button type="button" className="btn small primary" disabled={!!modelBusy} onClick={() => void exportModel('3dm')}>
            {modelBusy === '3dm' ? `만드는 중… ${modelStep}` : '라이노 .3dm'}
          </button>
          <button type="button" className="btn small" disabled={!!modelBusy} onClick={() => void exportModel('dxf')}>
            {modelBusy === 'dxf' ? `만드는 중… ${modelStep}` : 'DXF (평면 밑그림)'}
          </button>
        </div>
        {modelMsg && <p className={`notice ${modelMsg.kind === 'error' ? 'error' : 'ok'}`}>{modelMsg.text}</p>}
        <details>
          <summary className="small">파일에 든 것</summary>
          <p className="small">
            <strong>.3dm</strong> (레이어 이름 한글): 지형 면(메시)·등고선·계곡선, 건물(대지 안·주변·층수 모름), 도로 면(도로중심선 폭)·도로중심선, 필지, 공원·녹지, 하천, 대지
            경계. 땅에 놓이는 선·면은 지형 높이를 따라 얹었고, 라이노의 지구 위치(Earth Anchor)에 원점 경위도·해발을 넣었습니다. 문서 사용자 텍스트에 좌표·자료 설명이 있습니다.
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
      </section>

      <details className="block chat-box" open={chatOpen} onToggle={(e) => setChatOpen(e.currentTarget.open)}>
        <summary>
          <strong>챗봇에게 도판별 결론 후보 받기</strong> <span className="muted small">— 결론 {written}/{ready.length}개 작성</span>
        </summary>
        <ol className="steps-list">
          <li>
            프롬프트를 복사해 챗봇에 붙여넣으세요{parts.length > 1 ? ` (길어서 ${parts.length}개로 나눔 — 차례로 붙여넣기)` : ''}.
            <div className="row">
              {parts.map((p, i) => (
                <button key={i} type="button" className="btn small" disabled={busy && !ready.length} onClick={() => void copy(p, i)}>
                  {copied === i ? '복사됨' : parts.length > 1 ? `프롬프트 ${i + 1}/${parts.length} 복사` : '프롬프트 복사'}
                </button>
              ))}
              {busy && <span className="muted small">도판을 그리는 중이라 아직 모든 도판이 들어가지 않았습니다.</span>}
            </div>
          </li>
          <li>
            챗봇의 답변 전체를 붙여넣고 [후보 넣기]를 누르세요.
            <input type="text" className="chatbot-name" placeholder="쓴 챗봇 이름 (선택)" value={chatbot} onChange={(e) => setChatbot(e.target.value)} />
            <textarea rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="### [도판] use&#10;결론1: …&#10;결론2: …" />
            <div className="row">
              <button type="button" className="btn primary small" disabled={!answer.trim()} onClick={importAnswer}>
                후보 넣기
              </button>
            </div>
          </li>
        </ol>
        {msg && <p className={`notice ${msg.kind === 'error' ? 'error' : 'ok'}`}>{msg.text}</p>}
      </details>

      {busy && <p className="loading">도판을 그리는 중… ({Object.keys(panels).length}/{ORDERED_PANELS.length})</p>}

      {PANEL_GROUP_ORDER.map((g) => {
        const defs = ORDERED_PANELS.filter((p) => p.group === g)
        return (
          <section key={g} className="diagram-group">
            <h3>{g}</h3>
            <div className="diagram-grid">
              {defs.map((def) => {
                const p = panels[def.id]
                const note = noteOf(project, def.id)
                const empty = p?.out.empty
                return (
                  <article key={def.id} className={`diagram-card${empty ? ' empty' : ''}`}>
                    <button type="button" className="diagram-thumb" onClick={() => p && setViewing(def.id)} aria-label={`${def.title} 크게 보기`} disabled={!p}>
                      {p ? <img src={p.url} alt={def.title} loading="lazy" /> : <span className="muted small">그리는 중…</span>}
                    </button>
                    <div className="diagram-body">
                      <h4>
                        <span className="muted">{String(panelNumber(def.id)).padStart(2, '0')}</span> {def.title}
                      </h4>
                      {empty ? (
                        <p className="muted small">
                          {empty}. {def.needs}
                        </p>
                      ) : (
                        <ul className="diagram-summary">
                          {(p?.out.summary ?? []).map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      )}
                      {!empty && (
                        <>
                          <label className="field">
                            <span className="label">결론 한 문장</span>
                            <textarea
                              rows={2}
                              value={note.conclusion}
                              placeholder="이 도판에서 대지에 대해 판단할 수 있는 것"
                              onChange={(e) => patchNote(def.id, { conclusion: e.target.value, source: 'user' })}
                            />
                          </label>
                          {note.suggestions.length > 0 && (
                            <div className="suggestions">
                              <span className="muted small">챗봇 후보 (눌러서 쓰기)</span>
                              {note.suggestions.map((s, i) => (
                                <button key={i} type="button" className={`chip small suggestion${note.conclusion === s ? ' on' : ''}`} onClick={() => patchNote(def.id, { conclusion: s, source: 'chatbot' })}>
                                  {s}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="row diagram-actions">
                            <label className="check-row small">
                              <input type="checkbox" checked={note.include} onChange={(e) => patchNote(def.id, { include: e.target.checked })} />
                              리포트에 넣기
                            </label>
                            <span className="spacer" />
                            <button type="button" className="btn small ghost" disabled={!p} onClick={() => downloadSvg(def)}>
                              SVG
                            </button>
                            <button type="button" className="btn small ghost" disabled={!p} onClick={() => void downloadPng(def)}>
                              PNG
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        )
      })}

      <div className="panel-foot">
        <p className="muted small">결론 {written}개 작성 · 결론은 해석 단계 프롬프트와 리포트에 함께 들어갑니다.</p>
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={onNext}>
          현장 관찰로
        </button>
      </div>

      {viewing && viewDef && panels[viewing] && (
        <Viewer panel={panels[viewing]} def={viewDef} onClose={() => setViewing(null)} onSvg={() => downloadSvg(viewDef)} onPng={() => void downloadPng(viewDef)} />
      )}
    </div>
  )
}
