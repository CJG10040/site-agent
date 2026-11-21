// ⑩ 3D 모형의 '설계안' 칸 (2026-11-21 묶음 C3, 사용자 결정: 올리기·관리는 ⑩에):
// 라이노 .3dm을 올려 매스로 쓸 레이어를 고르고 이름을 붙여 안으로 저장한다. 안마다 이름 바꾸기·지우기.
// 앱이 내보낸 .3dm(대지 중심 = 원점, 미터) 위에 그렸으면 위치가 그대로 맞는다.
// '주변 변경' 레이어(자료에 없는 새 건물 등)는 안이 아니라 '학생이 더한 건물'로 넣는다 (C5) — 모든 안에 공통.

import { useMemo, useState } from 'react'
import type { DiagramData } from '../diagrams/data'
import type { Read3dmResult } from '../export/read3dm'
import { meshToMassing } from '../lib/massing'
import { utmkToWgs84, wgs84ToUtmk } from '../lib/proj'
import { applyPlace, designMassing, dropDesignEnv, nextDesignName } from '../model/designs'
import { editsOf, newEditId } from '../model/edits'
import DesignPlacement, { anchorOffset, meshCenter } from './DesignPlacement'
import { newId, nowIso } from '../model/project'
import type { AddEdit, DesignScheme, Project } from '../model/types'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  data: DiagramData
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })
/** 매스로 쓸 레이어를 먼저 골라 둘 이름 */
const DESIGN_HINT = /설계|매스|계획|design|mass|scheme|proposal/i
const AROUND_HINT = /주변|변경|기존|참고|context|site|대지|지형|도로|건물/i
/** 주변 건물로 더할 레이어를 먼저 골라 둘 이름 */
const CHANGE_HINT = /주변\s*변경|변경|신축|새\s*건물|new|change/i

function metersBetween(a: [number, number], b: [number, number]): number {
  const kx = 111320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110574)
}

/**
 * 올릴 때 위치 정하기: 기준점이 대지 중심과 다르면 그 차이만큼 옮김, 기준점이 없는데 매스가 대지에서 멀면 대지 가운데로, 아니면 그대로
 */
function autoPlace(res: Read3dmResult, mesh: DesignScheme['mesh'], data: DiagramData): DesignScheme['place'] {
  const zero = { dx: 0, dy: 0, dz: 0, rot: 0 }
  if (res.anchor && metersBetween([res.anchor.lon, res.anchor.lat], data.center) >= 5) {
    const [dx, dy] = anchorOffset(res.anchor, data.center)
    return { ...zero, dx: Math.round(dx * 100) / 100, dy: Math.round(dy * 100) / 100 }
  }
  const [cx, cy] = meshCenter(mesh)
  if (Math.hypot(cx, cy) >= data.R) return { ...zero, dx: Math.round(-cx * 100) / 100, dy: Math.round(-cy * 100) / 100 }
  return zero
}

interface Pending {
  fileName: string
  res: Read3dmResult
  /** 매스(설계안)로 쓸 레이어 */
  pick: Set<string>
  /** 주변 건물로 더할 레이어 */
  around: Set<string>
  name: string
}

/** 고른 레이어들의 삼각형을 하나로 (1mm로 반올림) */
function mergeLayers(res: Read3dmResult, paths: Set<string>): DesignScheme['mesh'] {
  const positions: number[] = []
  const indices: number[] = []
  for (const path of paths) {
    const m = res.meshes[path]
    if (!m) continue
    const base = positions.length / 3
    for (const v of m.positions) positions.push(Math.round(v * 1000) / 1000)
    for (const i of m.indices) indices.push(base + i)
  }
  return { positions, indices }
}

export default function DesignSchemes({ project, update, data }: Props) {
  const designs = project.designs ?? []
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [drag, setDrag] = useState(false)

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setError(null)
    setPending(null)
    if (!/\.3dm$/i.test(f.name)) {
      setError('라이노 파일(.3dm)만 올릴 수 있습니다.')
      return
    }
    setBusy(`${f.name} 읽는 중…`)
    try {
      const { read3dm } = await import('../export/read3dm')
      const res = await read3dm(new Uint8Array(await f.arrayBuffer()))
      const withTris = res.layers.filter((l) => l.triangles > 0)
      if (!withTris.length) {
        setError('매스로 읽을 수 있는 물체가 없습니다. 메시·돌출·폴리서피스로 그린 매스가 있는지, 굽은 면이면 라이노에서 Mesh로 바꿔 저장했는지 확인하세요.')
        setBusy(null)
        return
      }
      const hinted = withTris.filter((l) => DESIGN_HINT.test(l.path))
      const pick = new Set((hinted.length ? hinted : withTris.filter((l) => !AROUND_HINT.test(l.path))).map((l) => l.path))
      if (!pick.size) withTris.forEach((l) => pick.add(l.path))
      const around = new Set(withTris.filter((l) => !pick.has(l.path) && CHANGE_HINT.test(l.path)).map((l) => l.path))
      setPending({ fileName: f.name, res, pick, around, name: nextDesignName(project) })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(null)
  }

  const save = () => {
    if (!pending || (!pending.pick.size && !pending.around.size)) return
    const anchor = pending.res.anchor ? { lat: pending.res.anchor.lat, lon: pending.res.anchor.lon } : null
    let scheme: DesignScheme | null = null
    if (pending.pick.size) {
      const mesh = mergeLayers(pending.res, pending.pick)
      scheme = {
        id: newId(),
        name: pending.name.trim() || nextDesignName(project),
        fileName: pending.fileName,
        layers: [...pending.pick],
        createdAt: nowIso(),
        mesh,
        place: autoPlace(pending.res, mesh, data),
        anchor,
      }
    }
    // 주변 변경 레이어 → 높이 단계별 발자국을 '학생이 더한 건물'로 (설계안과 같은 위치 맞춤)
    const adds: AddEdit[] = []
    if (pending.around.size) {
      const mesh = mergeLayers(pending.res, pending.around)
      const place = scheme ? scheme.place : autoPlace(pending.res, mesh, data)
      const m = meshToMassing(applyPlace(mesh, place))
      const [X0, Y0] = wgs84ToUtmk(data.center[0], data.center[1])
      const layers = [...pending.around].join(', ')
      const base = pending.fileName.replace(/\.3dm$/i, '')
      for (const b of m?.blocks ?? []) {
        adds.push({
          id: newEditId(),
          ring: b.rings[0].map(([x, y]) => utmkToWgs84(x + X0, y + Y0) as [number, number]),
          floors: null,
          heightM: b.height,
          use: '',
          name: `${base} 주변 변경`,
          reason: `라이노 '${layers}' 레이어`,
          source: 'rhino',
          createdAt: nowIso(),
        })
      }
    }
    update((d) => {
      if (scheme) {
        d.designs = [...(d.designs ?? []), scheme]
        d.scenario = scheme.id
      }
      if (adds.length) {
        const e = editsOf(d)
        d.edits = { ...e, adds: [...e.adds, ...adds] }
      }
    })
    setPending(null)
  }

  return (
    <section className="block design-schemes">
      <h3>설계안</h3>
      <p className="help">
        아래 작업대에서 받은 <strong>.3dm</strong>(대지 중심 = 원점, 미터)을 라이노에서 열고, 그 위에 매스를 그려 저장한 뒤 올리세요. 메시·돌출·폴리서피스를 읽고, 굽은 면은 라이노에서 <code>Mesh</code>로 바꾸거나 음영 보기로 한 번 본 뒤 저장해야 읽힙니다. 안을 여러 개 올려 위의 '보는 안'에서 고르면 도판과 3D 모형이 그 안으로 바뀝니다(⑥ 도판 위에도 같은 고르기가 있음).
      </p>

      {designs.length > 0 && (
        <ul className="scheme-list">
          {designs.map((d) => (
            <SchemeRow key={d.id} scheme={d} active={project.scenario === d.id} data={data} update={update} />
          ))}
        </ul>
      )}

      {!pending && (
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
            void onFile(e.dataTransfer.files[0])
          }}
        >
          <input type="file" accept=".3dm" hidden disabled={!!busy} onChange={(e) => void onFile(e.target.files?.[0])} />
          <span>{busy ?? '.3dm 파일을 끌어다 놓거나 눌러서 고르기'}</span>
        </label>
      )}
      {error && <p className="notice error small">{error}</p>}
      {pending && <PendingView pending={pending} setPending={setPending} data={data} onSave={save} />}
    </section>
  )
}

function PendingView({ pending, setPending, data, onSave }: { pending: Pending; setPending: (p: Pending | null) => void; data: DiagramData; onSave: () => void }) {
  const { res } = pending
  const ok = res.objects.filter((o) => o.status === 'ok').length
  const partial = res.objects.filter((o) => o.status === 'partial')
  const skipped = res.objects.filter((o) => o.status === 'skip')
  // 위치 확인: 지구 기준점이 대지 중심과 같은지, 매스가 대지 가까이에 있는지
  const anchorGap = res.anchor ? metersBetween([res.anchor.lon, res.anchor.lat], data.center) : null
  const picked = res.layers.filter((l) => pending.pick.has(l.path))
  const box = useMemo(() => {
    let b: number[] | null = null
    for (const l of picked) {
      const m = res.meshes[l.path]
      if (!m) continue
      for (let i = 0; i < m.positions.length; i += 3) {
        const x = m.positions[i]
        const y = m.positions[i + 1]
        b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y]
      }
    }
    return b
  }, [picked, res])
  const far = box ? Math.hypot((box[0] + box[2]) / 2, (box[1] + box[3]) / 2) : 0
  const placeOk = (anchorGap === null || anchorGap < 5) && far < data.R
  // 한 레이어는 매스와 주변 건물 중 하나로만
  const toggle = (path: string, which: 'pick' | 'around') => {
    const pick = new Set(pending.pick)
    const around = new Set(pending.around)
    const mine = which === 'pick' ? pick : around
    const other = which === 'pick' ? around : pick
    if (mine.has(path)) mine.delete(path)
    else {
      mine.add(path)
      other.delete(path)
    }
    setPending({ ...pending, pick, around })
  }
  return (
    <div className="scheme-pending">
      <p className="small">
        <strong>{pending.fileName}</strong> · 단위 {res.units} · 물체 {fmt(res.objects.length)}개 (읽음 {fmt(ok)}
        {partial.length ? ` · 일부만 ${partial.length}` : ''}
        {skipped.length ? ` · 못 읽음 ${skipped.length}` : ''})
      </p>
      <fieldset className="scheme-layers">
        <legend className="label">매스로 쓸 레이어</legend>
        {res.layers.map((l) => (
          <label key={l.path} className="check-row small">
            <input type="checkbox" checked={pending.pick.has(l.path)} disabled={!l.triangles} onChange={() => toggle(l.path, 'pick')} />
            {l.path} <span className="muted">— 물체 {l.objects}개{l.triangles ? `, 삼각형 ${fmt(l.triangles)}` : ', 매스 없음'}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="scheme-layers">
        <legend className="label">주변 건물로 더할 레이어 <span className="muted small">— 자료에 아직 없는 새 건물 등, 모든 안에 공통 (⑥ '학생이 고친 것'에서 되돌리기)</span></legend>
        {res.layers
          .filter((l) => l.triangles > 0)
          .map((l) => (
            <label key={l.path} className="check-row small">
              <input type="checkbox" checked={pending.around.has(l.path)} onChange={() => toggle(l.path, 'around')} />
              {l.path}
            </label>
          ))}
      </fieldset>
      {placeOk ? (
        <p className="small muted">위치: 대지 중심 원점 기준으로 맞습니다{res.anchor ? ' (파일의 지구 기준점이 대지 중심과 같음)' : ''}.</p>
      ) : (
        <p className="notice small">
          {anchorGap !== null && anchorGap >= 5
            ? `이 파일의 지구 기준점이 대지 중심에서 약 ${fmt(anchorGap)}m 떨어져 있어, 그 차이만큼 옮겨 놓습니다. `
            : `고른 매스가 대지 중심에서 약 ${fmt(far)}m 떨어져 있어, 대지 가운데로 옮겨 놓습니다. `}
          저장한 뒤 안 목록의 '위치 맞추기'에서 끌어 옮기거나 숫자로 고칠 수 있습니다.
        </p>
      )}
      {(partial.length > 0 || skipped.some((o) => o.kind !== '곡선' && o.kind !== '글자' && o.kind !== '점' && o.kind !== '해치')) && (
        <details className="small">
          <summary>읽지 못한 물체</summary>
          <ul>
            {[...partial, ...skipped.filter((o) => o.kind !== '곡선' && o.kind !== '글자' && o.kind !== '점' && o.kind !== '해치')].map((o) => (
              <li key={o.id}>
                {o.layer} · {o.name || o.kind} — {o.note}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="row">
        {pending.pick.size > 0 && (
          <label className="field inline">
            <span className="label">안 이름</span>
            <input value={pending.name} onChange={(e) => setPending({ ...pending, name: e.target.value })} maxLength={20} />
          </label>
        )}
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={() => setPending(null)}>
          취소
        </button>
        <button type="button" className="btn primary" disabled={!pending.pick.size && !pending.around.size} onClick={onSave}>
          {pending.pick.size ? (pending.around.size ? '안으로 저장 + 주변 건물 더하기' : '안으로 저장') : '주변 건물로 더하기'}
        </button>
      </div>
    </div>
  )
}

function SchemeRow({ scheme, active, data, update }: { scheme: DesignScheme; active: boolean; data: DiagramData; update: Props['update'] }) {
  const [confirm, setConfirm] = useState(false)
  const [placing, setPlacing] = useState(false)
  const { dx, dy, dz, rot } = scheme.place
  const moved = dx || dy || dz || rot
  const m = useMemo(() => designMassing(scheme), [scheme])
  const rename = (name: string) =>
    update((d) => {
      const s = d.designs?.find((x) => x.id === scheme.id)
      if (s) s.name = name
    })
  return (
    <li className={`scheme-row${active ? ' on' : ''}`}>
      <div className="scheme-main">
        <input className="scheme-name" value={scheme.name} onChange={(e) => rename(e.target.value)} aria-label="안 이름" maxLength={20} />
        <span className="muted small">
          {scheme.fileName} · {scheme.layers.join(', ')}
          {m ? ` · 가장 높은 곳 약 ${fmt(m.maxHeight, 1)}m · 위에서 본 넓이 약 ${fmt(m.footprint)}㎡` : ' · 매스로 바꾸지 못함'}
          {moved ? ` · 옮김 동 ${fmt(dx, 1)}·북 ${fmt(dy, 1)}·위 ${fmt(dz, 1)}m, ${fmt(rot, 1)}°` : ''}
        </span>
      </div>
      <button type="button" className="btn small ghost" aria-expanded={placing} onClick={() => setPlacing((v) => !v)}>
        {placing ? '위치 닫기' : '위치 맞추기'}
      </button>
      {confirm ? (
        <span className="row">
          <button
            type="button"
            className="btn small danger"
            onClick={() =>
              update((d) => {
                dropDesignEnv(d, scheme.id)
                d.designs = (d.designs ?? []).filter((x) => x.id !== scheme.id)
                if (d.scenario === scheme.id) delete d.scenario
                if (!d.designs.length) delete d.designs
              })
            }
          >
            지우기
          </button>
          <button type="button" className="btn small ghost" onClick={() => setConfirm(false)}>
            취소
          </button>
        </span>
      ) : (
        <button type="button" className="btn small ghost danger" onClick={() => setConfirm(true)}>
          지우기
        </button>
      )}
      {placing && (
        <div className="scheme-place">
          <DesignPlacement scheme={scheme} data={data} update={update} />
        </div>
      )}
    </li>
  )
}
