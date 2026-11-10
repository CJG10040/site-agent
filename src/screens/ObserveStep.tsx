import { useEffect, useMemo, useRef, useState } from 'react'
import FactLinker from '../components/FactLinker'
import SiteLinks from '../components/SiteLinks'
import MapView, { type MapFit, type MapObservation } from '../components/MapView'
import MapToolbar from '../components/MapToolbar'
import { PhotoThumb, PhotoViewer } from '../components/PhotoThumb'
import SpeechButton from '../components/SpeechButton'
import TagPicker from '../components/TagPicker'
import { centerOf, radiusCircle, siteBoundary } from '../lib/geo'
import { formatObservedAt, processPhoto, timeBand, toLocalInput } from '../lib/photos'
import { deletePhotos, putPhoto } from '../model/db'
import {
  ACTION_PRESETS,
  ACTOR_PRESETS,
  createObservation,
  describeRelative,
  observationsOf,
  patchObservation,
  SENSE_PRESETS,
} from '../model/observations'
import { newId, nowIso } from '../model/project'
import { mergeObservations, readProjectFile, storeIncomingPhotos } from '../model/transfer'
import type { Card, ObservationDetail, Project } from '../model/types'
import { effectiveDomain, type BaseMap, type VWorldConfig } from '../sources/vworld'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  config: VWorldConfig
  baseMap: BaseMap
  onBaseMap: (b: BaseMap) => void
  onGoFacts: () => void
}

type View = 'list' | 'compare'

const BANDS = ['전체', '오전', '오후', '저녁', '밤', '새벽', '시간 미상']

function numberOf(id: string): string {
  return String(Number(id.split('-')[1] ?? '')) || id
}

function kindOf(o: ObservationDetail): MapObservation['kind'] {
  if (o.links.some((l) => l.relation === 'differ')) return 'differ'
  if (o.discovery) return 'discovery'
  return 'normal'
}

export default function ObserveStep({ project, update, config, baseMap, onBaseMap, onGoFacts }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<View>('list')
  const [band, setBand] = useState('전체')
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [viewPhoto, setViewPhoto] = useState<string | null>(null)
  const [wms, setWms] = useState<string[]>([])
  const [fit, setFit] = useState<MapFit | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const albumRef = useRef<HTMLInputElement>(null)
  const mergeRef = useRef<HTMLInputElement>(null)
  const pendingNew = useRef(false)

  const observations = observationsOf(project)
  const selected = observations.find((o) => o.id === selectedId) ?? null
  const facts = project.cards.filter((c) => c.type === 'FACT' && c.status !== 'rejected')

  const boundary = useMemo(() => siteBoundary(project.site), [project.site])
  const radius = useMemo(() => (boundary ? radiusCircle(centerOf(boundary), project.site.radiusM) : null), [boundary, project.site.radiusM])

  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || !(radius ?? boundary)) return
    fitted.current = true
    setFit({ geometry: (radius ?? boundary)!, seq: Date.now() })
  }, [radius, boundary])

  const filtered = band === '전체' ? observations : observations.filter((o) => timeBand(o.observation!.observedAt).band === band)

  const mapObs: MapObservation[] = useMemo(
    () =>
      observations
        .filter((o) => o.observation!.location)
        .map((o) => ({
          id: o.id,
          lon: o.observation!.location!.lon,
          lat: o.observation!.location!.lat,
          label: numberOf(o.id),
          kind: kindOf(o.observation!),
          selected: o.id === selectedId,
        })),
    [observations, selectedId],
  )

  const patch = (fn: (card: Card, d: ObservationDetail, draft: Project) => void) => {
    if (!selectedId) return
    update((draft) => patchObservation(draft, selectedId, (c, d) => fn(c, d, draft)))
  }

  const newObservation = (): string => {
    let id = ''
    update((d) => {
      const c = createObservation(d)
      d.cards.push(c)
      id = c.id
    })
    setSelectedId(id)
    setView('list')
    setPicking(false)
    setMsg(null)
    return id
  }

  const addPhotos = async (files: File[], targetId: string | null) => {
    if (files.length === 0) return
    const obsId = targetId ?? newObservation()
    setBusy(`사진 ${files.length}장 처리 중…`)
    setMsg(null)
    const added: { id: string; takenAt: string | null; lon: number | null; lat: number | null }[] = []
    const errors: string[] = []
    for (const file of files) {
      try {
        const p = await processPhoto(file)
        const id = newId()
        await putPhoto({ id, projectId: project.id, ...p, originalName: file.name, createdAt: nowIso() })
        added.push({ id, takenAt: p.takenAt, lon: p.lon, lat: p.lat })
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e))
      }
    }
    const withGps = added.find((a) => a.lon !== null && a.lat !== null)
    const withTime = added.find((a) => a.takenAt)
    update((draft) =>
      patchObservation(draft, obsId, (_c, d) => {
        d.photoIds.push(...added.map((a) => a.id))
        if (!d.location && withGps) {
          d.location = { lon: withGps.lon!, lat: withGps.lat!, source: 'exif' }
          d.relative = describeRelative(draft, withGps.lon!, withGps.lat!)
        }
        if (!d.observedAt && withTime) {
          d.observedAt = withTime.takenAt
          d.timeSource = 'exif'
        }
      }),
    )
    setBusy(null)
    const notes: string[] = [`사진 ${added.length}장을 붙였습니다.`]
    if (added.length && !withGps) notes.push('사진에 위치 정보가 없습니다 (휴대폰 브라우저는 위치를 지우는 경우가 많습니다). 현재 위치나 지도에서 지정하세요.')
    if (errors.length) notes.push(errors.join(' '))
    setMsg({ kind: errors.length ? 'error' : 'info', text: notes.join(' ') })
  }

  /** 파일 선택 결과 처리: '촬영해서/사진으로 관찰'이면 새 관찰, 편집 중이면 그 관찰에 붙인다 */
  const onFiles = (input: HTMLInputElement) => {
    const files = input.files ? Array.from(input.files) : []
    const target = pendingNew.current ? null : selectedId
    pendingNew.current = false
    input.value = ''
    if (files.length === 0) return
    void addPhotos(files, target)
  }

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setMsg({ kind: 'error', text: '이 브라우저는 위치 기능을 지원하지 않습니다.' })
      return
    }
    setBusy('현재 위치를 찾는 중…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { longitude: lon, latitude: lat, accuracy } = pos.coords
        patch((_c, d, draft) => {
          d.location = { lon, lat, source: 'gps' }
          d.relative = describeRelative(draft, lon, lat)
        })
        setBusy(null)
        setMsg({ kind: 'info', text: `현재 위치를 넣었습니다 (오차 약 ${Math.round(accuracy)}m).` })
      },
      (err) => {
        setBusy(null)
        setMsg({ kind: 'error', text: err.code === err.PERMISSION_DENIED ? '위치 사용이 허용되지 않았습니다. 지도에서 지정하세요.' : '현재 위치를 찾지 못했습니다.' })
      },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  const removePhoto = (photoId: string) => {
    if (!window.confirm('이 사진을 관찰에서 지울까요? 되돌릴 수 없습니다.')) return
    patch((_c, d) => {
      d.photoIds = d.photoIds.filter((p) => p !== photoId)
    })
    void deletePhotos([photoId])
  }

  const deleteObservation = () => {
    if (!selected) return
    if (!window.confirm(`${selected.id} 관찰을 지울까요? 붙은 사진도 함께 지워지며 되돌릴 수 없습니다.`)) return
    const photos = selected.observation!.photoIds
    update((d) => {
      d.cards = d.cards.filter((c) => c.id !== selected.id)
    })
    void deletePhotos(photos)
    setSelectedId(null)
  }

  const mergeFromFile = async (file: File) => {
    setBusy('다른 기기의 관찰을 합치는 중…')
    setMsg(null)
    try {
      const { project: incoming, photos } = await readProjectFile(file)
      const needed = new Set(incoming.cards.flatMap((c) => c.observation?.photoIds ?? []))
      await storeIncomingPhotos(
        photos.filter((p) => needed.has(p.id)),
        project.id,
      )
      let result: ReturnType<typeof mergeObservations> | null = null
      update((d) => {
        result = mergeObservations(d, incoming)
      })
      const r = result as ReturnType<typeof mergeObservations> | null
      if (r) {
        setMsg({
          kind: 'info',
          text: `새 관찰 ${r.added}개, 갱신 ${r.updated}개, 그대로 ${r.unchanged}개.${
            r.droppedLinks ? ` 다른 프로젝트에서 온 관찰이라 관련 사실 연결 ${r.droppedLinks}개는 지웠습니다. 다시 연결하세요.` : ''
          }`,
        })
      }
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  // ── 비교 보기 자료
  const factById = new Map(facts.map((f) => [f.id, f]))
  const differPairs = observations.flatMap((o) =>
    o.observation!.links.filter((l) => l.relation === 'differ').map((l) => ({ obs: o, fact: factById.get(l.cardId) })),
  )
  const matchPairs = observations.flatMap((o) =>
    o.observation!.links.filter((l) => l.relation === 'match').map((l) => ({ obs: o, fact: factById.get(l.cardId) })),
  )
  const discoveries = observations.filter((o) => o.observation!.discovery)

  const det = selected?.observation ?? null
  const { band: selBand, weekend } = timeBand(det?.observedAt ?? null)

  return (
    <div className="split">
      <aside className="split-panel">
        <header className="panel-head">
          <p className="eyebrow">⑦ 현장 관찰</p>
          <h2>현장에서 본 것, 느낀 것</h2>
        </header>

        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFiles(e.target)} />
        <input ref={albumRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target)} />
        <input ref={mergeRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void mergeFromFile(f) }} />

        {busy && <p className="loading">{busy}</p>}
        {msg && <p className={`notice ${msg.kind === 'error' ? 'error' : ''}`}>{msg.text}</p>}

        {!selected ? (
          <>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => newObservation()}>
                새 관찰
              </button>
              <button type="button" className="btn" onClick={() => { pendingNew.current = true; cameraRef.current?.click() }}>
                촬영해서 관찰
              </button>
              <button type="button" className="btn" onClick={() => { pendingNew.current = true; albumRef.current?.click() }}>
                사진으로 관찰
              </button>
            </div>

            <div className="segmented" role="tablist" aria-label="보기">
              <button type="button" role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
                관찰 목록 <span className="count">{observations.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={view === 'compare'} className={view === 'compare' ? 'on' : ''} onClick={() => setView('compare')}>
                자료와 비교 <span className="count">{differPairs.length}</span>
              </button>
            </div>

            {view === 'list' && (
              <>
                <div className="chips">
                  {BANDS.map((b) => (
                    <button key={b} type="button" className={`chip small${band === b ? ' on' : ''}`} aria-pressed={band === b} onClick={() => setBand(b)}>
                      {b}
                    </button>
                  ))}
                </div>
                {filtered.length === 0 ? (
                  <p className="empty">
                    {observations.length === 0
                      ? '아직 관찰이 없습니다. 현장에서 본 장면, 사람들의 움직임, 소리·냄새, 예상과 달랐던 점을 기록하세요.'
                      : '이 시간대의 관찰이 없습니다.'}
                  </p>
                ) : (
                  <ul className="obs-list">
                    {filtered.map((o) => {
                      const d = o.observation!
                      const k = kindOf(d)
                      return (
                        <li key={o.id}>
                          <button type="button" className="obs-item" onClick={() => { setSelectedId(o.id); pendingNew.current = false }}>
                            <span className={`obs-num kind-${k}`}>{numberOf(o.id)}</span>
                            <span className="obs-body">
                              <span className="obs-text">{o.text || <em className="muted">(관찰 문장 없음)</em>}</span>
                              <span className="obs-meta">
                                {o.id} · {formatObservedAt(d.observedAt)} · {d.relative ?? (d.location ? '위치 있음' : '위치 없음')}
                                {d.photoIds.length ? ` · 사진 ${d.photoIds.length}` : ''}
                              </span>
                            </span>
                            {k === 'differ' && <span className="badge danger">다름</span>}
                            {k === 'discovery' && <span className="badge teal">새 발견</span>}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )}

            {view === 'compare' && (
              <div className="compare">
                <p className="help">
                  공공데이터와 현장이 다른 지점은 오류가 아니라 <strong>설계 질문의 출발점</strong>입니다. 다음 단계(해석·가설)에서 챗봇에게 함께
                  보냅니다.
                </p>
                <h3>현장과 다름 <span className="count">{differPairs.length}</span></h3>
                {differPairs.length === 0 && <p className="muted small">아직 없습니다. 관찰에서 관련 사실을 고르고 '현장과 다름'을 누르세요.</p>}
                {differPairs.map(({ obs, fact }, i) => (
                  <div key={`${obs.id}-${i}`} className="pair differ">
                    <p>
                      <span className="card-id">{fact?.id ?? '?'}</span> 자료: {fact?.text ?? '(지워진 사실)'}
                    </p>
                    <p>
                      <button type="button" className="link-btn left" onClick={() => setSelectedId(obs.id)}>
                        {obs.id}
                      </button>{' '}
                      현장: {obs.text || '(문장 없음)'}
                    </p>
                  </div>
                ))}
                <h3>자료에 없던 새로운 발견 <span className="count">{discoveries.length}</span></h3>
                {discoveries.map((o) => (
                  <div key={o.id} className="pair discovery">
                    <button type="button" className="link-btn left" onClick={() => setSelectedId(o.id)}>
                      {o.id}
                    </button>{' '}
                    {o.text || '(문장 없음)'}
                  </div>
                ))}
                <h3>일치 <span className="count">{matchPairs.length}</span></h3>
                {matchPairs.map(({ obs, fact }, i) => (
                  <div key={`${obs.id}-m${i}`} className="pair match">
                    <span className="card-id">{fact?.id ?? '?'}</span> ↔ <span className="card-id">{obs.id}</span> {obs.text}
                  </div>
                ))}
                <button type="button" className="link-btn left" onClick={onGoFacts}>
                  사실 카드에서 보기
                </button>
              </div>
            )}

            <details className="transfer-help">
              <summary>휴대폰으로 현장에서 기록하려면</summary>
              <ol>
                <li>PC에서 오른쪽 위 [내보내기]로 프로젝트 파일을 저장해 휴대폰으로 옮깁니다 (카카오톡 나에게 보내기, 클라우드 등).</li>
                <li>휴대폰에서 이 사이트를 열고 [설정]에 키를 입력한 뒤, 첫 화면의 [프로젝트 파일 가져오기]로 엽니다.</li>
                <li>현장에서 [촬영해서 관찰]·[현재 위치]·[음성 입력]으로 기록합니다.</li>
                <li>휴대폰에서 [내보내기] → 그 파일을 PC로 옮겨, PC의 이 화면에서 아래 [다른 기기의 관찰 합치기]를 누릅니다.</li>
              </ol>
              <button type="button" className="btn small" onClick={() => mergeRef.current?.click()}>
                다른 기기의 관찰 합치기
              </button>
            </details>
            <details className="advanced">
              <summary>현장 가기 전에: 로드뷰·토지이음·과거 항공사진</summary>
              <SiteLinks site={project.site} title="바로가기" />
            </details>
          </>
        ) : (
          <div className="obs-editor">
            <div className="row">
              <button type="button" className="btn ghost small" onClick={() => { setSelectedId(null); setPicking(false) }}>
                ← 목록
              </button>
              <span className="card-id">{selected.id}</span>
              <span className="spacer" />
              <button type="button" className="btn ghost small danger" onClick={deleteObservation}>
                관찰 지우기
              </button>
            </div>

            <div className="field">
              <span className="label">사진</span>
              <div className="photo-strip">
                {det!.photoIds.map((pid, i) => (
                  <PhotoThumb key={pid} id={pid} alt={`${selected.id} 사진 ${i + 1}`} onClick={() => setViewPhoto(pid)} onRemove={() => removePhoto(pid)} />
                ))}
              </div>
              <div className="row">
                <button type="button" className="btn small" onClick={() => { pendingNew.current = false; cameraRef.current?.click() }}>
                  촬영
                </button>
                <button type="button" className="btn small" onClick={() => { pendingNew.current = false; albumRef.current?.click() }}>
                  사진 추가
                </button>
              </div>
            </div>

            <label className="field">
              <span className="label">무엇을 보았나요? (관찰 문장)</span>
              <textarea
                rows={3}
                value={selected.text}
                placeholder="예: 지도상 보행로보다 담장 옆 비공식 통로로 더 많이 지나간다."
                onChange={(e) => patch((c) => void (c.text = e.target.value))}
              />
              <SpeechButton onText={(t) => patch((c) => void (c.text = c.text ? `${c.text} ${t}` : t))} />
            </label>

            <div className="field">
              <span className="label">위치</span>
              <p className="stat-line">
                {det!.location
                  ? `${det!.relative ?? ''} (${det!.location.source === 'exif' ? '사진 정보' : det!.location.source === 'gps' ? '현재 위치' : '지도에서 지정'})`
                  : '아직 없음'}
              </p>
              <div className="row">
                <button type="button" className="btn small" onClick={useCurrentLocation}>
                  현재 위치
                </button>
                <button type="button" className={`btn small${picking ? ' primary' : ''}`} onClick={() => setPicking((v) => !v)} aria-pressed={picking}>
                  {picking ? '지도를 누르세요 (취소)' : '지도에서 지정'}
                </button>
                {det!.location && (
                  <button type="button" className="btn ghost small" onClick={() => patch((_c, d) => { d.location = null; d.relative = null })}>
                    위치 지우기
                  </button>
                )}
              </div>
            </div>

            <div className="field">
              <label className="label" htmlFor="obs-time">
                언제 보았나요?
              </label>
              <div className="row">
                <input
                  id="obs-time"
                  type="datetime-local"
                  value={det!.observedAt ?? ''}
                  onChange={(e) => patch((_c, d) => { d.observedAt = e.target.value || null; d.timeSource = 'manual' })}
                />
                <button type="button" className="btn small" onClick={() => patch((_c, d) => { d.observedAt = toLocalInput(new Date()); d.timeSource = 'now' })}>
                  지금
                </button>
              </div>
              <p className="help">
                {det!.observedAt ? `${selBand}${weekend === null ? '' : weekend ? ' · 주말' : ' · 평일'}` : '시간대별 차이를 보려면 시간을 남기세요.'}
                {det!.timeSource === 'exif' && ' (사진 촬영 시각)'}
              </p>
            </div>

            <TagPicker label="감각 (소리·냄새·빛·온도 등)" presets={SENSE_PRESETS} value={det!.senses} onChange={(v) => patch((_c, d) => void (d.senses = v))} />
            <TagPicker label="누가 있었나요?" presets={ACTOR_PRESETS} value={det!.actors} onChange={(v) => patch((_c, d) => void (d.actors = v))} />
            <TagPicker label="무엇을 하고 있었나요?" presets={ACTION_PRESETS} value={det!.actions} onChange={(v) => patch((_c, d) => void (d.actions = v))} />

            <label className="field">
              <span className="label">나의 느낌 (불편했던 점, 기억에 남은 장면, 예상과 달랐던 점)</span>
              <textarea rows={2} value={det!.feeling} onChange={(e) => patch((_c, d) => void (d.feeling = e.target.value))} />
            </label>

            <label className="field">
              <span className="label">날씨·상황</span>
              <input type="text" value={det!.weather} placeholder="예: 흐림, 장날, 퇴근 시간" onChange={(e) => patch((_c, d) => void (d.weather = e.target.value))} />
            </label>

            <label className="check-row">
              <input type="checkbox" checked={det!.discovery} onChange={(e) => patch((_c, d) => void (d.discovery = e.target.checked))} />
              지도·공공데이터에 없던 <strong>새로운 발견</strong>이다
            </label>

            <FactLinker facts={facts} links={det!.links} onChange={(links) => patch((_c, d) => void (d.links = links))} />
          </div>
        )}
      </aside>

      <section className="split-map">
        <MapView
          vworldKey={config.key}
          vworldDomain={effectiveDomain(config)}
          baseMap={baseMap}
          wms={wms}
          data={{ boundary, radius, observations: mapObs }}
          fit={fit}
          mode="click"
          onObservationClick={(id) => {
            setSelectedId(id)
            setPicking(false)
          }}
          onMapClick={(lon, lat) => {
            if (!picking || !selectedId) return
            patch((_c, d, draft) => {
              d.location = { lon, lat, source: 'map' }
              d.relative = describeRelative(draft, lon, lat)
            })
            setPicking(false)
          }}
        >
          <MapToolbar baseMap={baseMap} onBaseMap={onBaseMap} wms={wms} onWms={setWms} />
          {picking && <div className="map-hint">관찰한 위치를 지도에서 누르세요</div>}
          <div className="map-legend">
            <div className="legend-item">
              <p className="legend-title">현장 관찰</p>
              <p className="legend-row">
                <i className="dot" style={{ background: '#343a40' }} /> 관찰 <i className="dot" style={{ background: '#c92a2a' }} /> 자료와 다름{' '}
                <i className="dot" style={{ background: '#0c8599' }} /> 새 발견
              </p>
            </div>
          </div>
        </MapView>
      </section>

      {viewPhoto && <PhotoViewer id={viewPhoto} onClose={() => setViewPhoto(null)} />}
    </div>
  )
}
