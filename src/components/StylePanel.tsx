// 도판 색: 묶음 고르기 + 테마색으로 만들기 + 색 직접 고치기 + 도판별 덮어쓰기 (14-A, 2026-11-12 사용자 결정).
// 보드 전체에 한 묶음(또는 테마색 조합)을 쓰고, 고친 색은 전체(settings.colors) 또는 도판 하나(settings.panelStyles[id])에 저장한다.

import { RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { EDIT_FIELDS, EDIT_LISTS, PALETTE_GROUPS, PALETTES, boardBase, paletteFor, paletteOf, type Palette } from '../diagrams/palette'
import { ORDERED_PANELS } from '../diagrams/panels'
import { panelLabel } from '../diagrams/render'
import { THEME_PAIRS, TONE_LABEL, themePalette } from '../diagrams/themePalette'
import type { DiagramSettings, PaletteEdit, PaletteId, PanelStyle, ThemeSpec } from '../model/types'

interface Props {
  settings: DiagramSettings
  setSettings: (patch: Partial<DiagramSettings>) => void
}

/** 새로 만들 때의 첫 조합: 앱 화면과 같은 '먹 + 레드라인' */
const DEFAULT_THEME: ThemeSpec = { color: THEME_PAIRS[0].color, point: THEME_PAIRS[0].point, harmony: 'complement', tone: 'light', variant: 0 }

/** 묶음 단추에 보이는 색 띠: 바탕 · 바탕 건물 · 단계 · 범주 · 강조 */
function Strip({ pal, wide = false }: { pal: Palette; wide?: boolean }) {
  const cs = wide ? [pal.paper, pal.base, ...pal.seq, pal.cat[0], pal.cat[1], pal.cat[2], pal.cat[3], pal.cat[4], pal.cat[5], pal.div[0], pal.div[4], pal.accent] : [pal.paper, pal.base, pal.seq[1], pal.seq[3], pal.cat[3], pal.cat[0], pal.accent]
  return (
    <span className={`pal-strip${wide ? ' wide' : ''}`} aria-hidden="true">
      {cs.map((c, i) => (
        <i key={i} style={{ background: c }} />
      ))}
    </span>
  )
}

function isEmptyEdit(e: PaletteEdit | undefined): boolean {
  if (!e) return true
  return !Object.entries(e).some(([, v]) => (Array.isArray(v) ? v.some(Boolean) : !!v))
}

const sameTheme = (a: ThemeSpec | undefined, b: ThemeSpec) =>
  !!a && a.color.toLowerCase() === b.color.toLowerCase() && (a.point ?? '').toLowerCase() === (b.point ?? '').toLowerCase() && a.tone === b.tone && (!!a.point || (a.harmony === b.harmony && a.variant === b.variant))

/** 예전 방식(포인트색 없음)으로 저장된 테마는 포인트색을 채워 새 방식 초안으로 */
const asDraft = (t: ThemeSpec | undefined): ThemeSpec => (t ? { ...t, point: t.point ?? DEFAULT_THEME.point } : DEFAULT_THEME)

/** 색 칸 하나: 바꾸는 동안은 화면에만, 손을 떼고 잠시 뒤 저장 (도판을 너무 자주 다시 그리지 않게) */
function ColorInput({ value, edited, label, onCommit, onReset }: { value: string; edited: boolean; label: string; onCommit: (v: string) => void; onReset: () => void }) {
  const [draft, setDraft] = useState(value)
  const timer = useRef<number | null>(null)
  useEffect(() => setDraft(value), [value])
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), [])
  const change = (v: string) => {
    setDraft(v)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => onCommit(v), 450)
  }
  return (
    <span className={`color-input${edited ? ' edited' : ''}`}>
      <input type="color" value={draft} aria-label={label} title={`${label} ${draft}`} onChange={(e) => change(e.target.value)} />
      {edited && (
        <button type="button" className="link-btn" aria-label={`${label} 묶음 색으로`} title="묶음 색으로" onClick={onReset}>
          <RotateCcw aria-hidden="true" />
        </button>
      )}
    </span>
  )
}

function Mini<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented small" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  )
}

export default function StylePanel({ settings, setSettings }: Props) {
  const [target, setTarget] = useState<string>('all')
  const styles = settings.panelStyles ?? {}
  const ps: PanelStyle | undefined = target === 'all' ? undefined : styles[target]
  const ownPalette = target !== 'all' && !!(ps?.palette || ps?.theme)
  const boardOnly = { palette: settings.palette, colors: settings.colors, theme: settings.theme }

  // 지금 고치는 대상의 '고치기 전' 묶음과 고친 값
  const basePal: Palette =
    target === 'all' ? boardBase(settings) : ps?.theme ? themePalette(ps.theme) : ps?.palette ? paletteOf(ps.palette) : paletteFor(boardOnly)
  const edit: PaletteEdit = (target === 'all' ? settings.colors : ps?.colors) ?? {}
  const eff = target === 'all' ? paletteFor(boardOnly) : paletteFor(settings, target)
  const currentTheme = target === 'all' ? settings.theme : ps?.theme

  // 테마색 초안 (고칠 곳을 바꾸면 그곳의 테마로)
  const [draft, setDraft] = useState<ThemeSpec>(() => asDraft(currentTheme))
  useEffect(() => {
    setDraft((d) => (currentTheme ? asDraft(currentTheme) : d))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])
  const draftPal = themePalette(draft)
  const draftInUse = sameTheme(currentTheme, draft)

  const savePanel = (next: PanelStyle | undefined) => {
    const all = { ...styles }
    if (!next || (!next.palette && !next.theme && isEmptyEdit(next.colors))) delete all[target]
    else all[target] = next
    setSettings({ panelStyles: Object.keys(all).length ? all : undefined })
  }
  const saveEdit = (next: PaletteEdit) => {
    const clean = isEmptyEdit(next) ? undefined : next
    if (target === 'all') setSettings({ colors: clean })
    else savePanel({ ...ps, colors: clean })
  }
  const setOne = (key: (typeof EDIT_FIELDS)[number]['key'], v: string | undefined) => saveEdit({ ...edit, [key]: v && v.toLowerCase() !== basePal[key].toLowerCase() ? v : undefined })
  const setList = (key: 'seq' | 'cat' | 'div', i: number, v: string | undefined) => {
    const list = [...(edit[key] ?? Array(basePal[key].length).fill(''))]
    list[i] = v && v.toLowerCase() !== basePal[key][i].toLowerCase() ? v : ''
    saveEdit({ ...edit, [key]: list.some(Boolean) ? list : undefined })
  }

  const pickPalette = (id: PaletteId) => {
    if (target === 'all') {
      // 묶음을 바꾸면 전체에서 고친 색·테마색은 비움 (다른 묶음 위에 얹으면 어색함)
      setSettings({ palette: id, theme: undefined, colors: undefined })
    } else savePanel(id === settings.palette && !settings.theme && isEmptyEdit(ps?.colors) ? undefined : { palette: id })
  }
  const useTheme = () => {
    if (target === 'all') setSettings({ theme: { ...draft }, colors: undefined })
    else savePanel({ theme: { ...draft } })
  }
  const overridden = Object.keys(styles).filter((id) => ORDERED_PANELS.some((p) => p.id === id))
  const editedCount = EDIT_FIELDS.filter((f) => !!edit[f.key]).length + EDIT_LISTS.reduce((n, l) => n + (edit[l.key]?.filter(Boolean).length ?? 0), 0)
  const activeId: PaletteId | null = target === 'all' ? (settings.theme ? 'theme' : settings.palette) : ps?.theme ? 'theme' : (ps?.palette ?? null)

  return (
    <section className="block style-panel" aria-label="도판 색">
      <div className="style-head">
        <h3>도판 색</h3>
        <label className="style-target">
          <span className="label">고칠 곳</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="all">보드 전체 (모든 도판)</option>
            {ORDERED_PANELS.map((p) => (
              <option key={p.id} value={p.id}>
                {panelLabel(p.id)}
                {styles[p.id] ? ' · 고침' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {target !== 'all' && (
        <p className="muted small">
          이 도판만 다른 색으로 만듭니다. 묶음을 고르지 않으면 보드 전체 색 위에 아래에서 고친 색만 얹습니다.{' '}
          {ps && (
            <button type="button" className="link-btn" onClick={() => savePanel(undefined)}>
              전체 색으로 되돌리기
            </button>
          )}
        </p>
      )}

      <div className="pal-groups">
        {target !== 'all' && (
          <div className="pal-group">
            <span className="pal-group-label">이 도판</span>
            <button type="button" role="radio" aria-checked={!ownPalette} className={`pal-btn${!ownPalette ? ' on' : ''}`} onClick={() => savePanel(isEmptyEdit(ps?.colors) ? undefined : { colors: ps?.colors })}>
              <Strip pal={paletteFor(boardOnly)} />
              <span>전체와 같은 묶음</span>
            </button>
          </div>
        )}
        {PALETTE_GROUPS.map((g) => (
          <div key={g} className="pal-group" role="radiogroup" aria-label={`${g} 묶음`}>
            <span className="pal-group-label">{g}</span>
            {PALETTES.filter((p) => p.group === g).map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={activeId === p.id} className={`pal-btn${activeId === p.id ? ' on' : ''}`} onClick={() => pickPalette(p.id)}>
                <Strip pal={p} />
                <span>{p.label}</span>
              </button>
            ))}
          </div>
        ))}
        <div className={`theme-maker${activeId === 'theme' ? ' on' : ''}`} aria-label="테마색 + 포인트색으로 만들기">
          <span className="pal-group-label">테마색 + 포인트색</span>
          <div className="theme-pairs" role="group" aria-label="추천 짝">
            {THEME_PAIRS.map((p) => {
              const on = draft.color.toLowerCase() === p.color && (draft.point ?? '').toLowerCase() === p.point
              return (
                <button key={p.name} type="button" aria-pressed={on} className={`theme-pair${on ? ' on' : ''}`} onClick={() => setDraft({ ...draft, color: p.color, point: p.point })} title={`테마색 ${p.color} · 포인트색 ${p.point}`}>
                  <span className="theme-pair-swatch" aria-hidden="true">
                    <i style={{ background: p.color }} />
                    <i style={{ background: p.point }} />
                  </span>
                  {p.name}
                </button>
              )
            })}
          </div>
          <div className="theme-row">
            <label className="theme-color">
              <input type="color" value={draft.color} aria-label="테마색" onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
              <span className="small">테마색</span>
              <code className="small">{draft.color}</code>
            </label>
            <label className="theme-color">
              <input type="color" value={draft.point ?? DEFAULT_THEME.point} aria-label="포인트색" onChange={(e) => setDraft({ ...draft, point: e.target.value })} />
              <span className="small">포인트색</span>
              <code className="small">{draft.point}</code>
            </label>
            <Mini label="바탕" value={draft.tone} options={Object.entries(TONE_LABEL) as [ThemeSpec['tone'], string][]} onChange={(v) => setDraft({ ...draft, tone: v })} />
            <span className="theme-preview">
              <Strip pal={draftPal} wide />
            </span>
            <button type="button" className={`btn small${draftInUse ? '' : ' primary'}`} disabled={draftInUse} onClick={useTheme}>
              {draftInUse ? '쓰는 중' : target === 'all' ? '이 조합을 보드 전체에' : '이 조합을 이 도판에'}
            </button>
          </div>
        </div>
        <p className="muted small theme-note">
          <strong>테마색</strong>은 단계색(옅음 → 진함)과 바탕·글자의 옅은 기운을, <strong>포인트색</strong>은 대지 강조와 양쪽 단계색의 뜨거운 쪽(더위·빠름)을 맡습니다.
          범주색은 칸의 뜻(노랑·주황·빨강·파랑·청록·보라·회색·갈색)을 지키며 두 색에 맞추고, 이웃한 색이 색약으로도 구분되게 밝기를 조정합니다. 추천 짝은 밝게·파스텔·어둡게에서
          이 검사를 모두 통과한 조합입니다. 물·녹지는 파랑·초록을 유지하고, 만든 뒤 아래 '색 직접 고치기'로 더 다듬을 수 있습니다.
        </p>
      </div>

      <details className="color-edit" open={editedCount > 0 || undefined}>
        <summary className="small">
          색 직접 고치기{editedCount ? ` (고친 색 ${editedCount}개)` : ''} — {target === 'all' ? '보드 전체' : panelLabel(target)}
        </summary>
        <div className="color-rows">
          <div className="color-row">
            {EDIT_FIELDS.map((f) => (
              <label key={f.key} className="color-cell">
                <ColorInput value={eff[f.key]} edited={!!edit[f.key]} label={f.label} onCommit={(v) => setOne(f.key, v)} onReset={() => setOne(f.key, undefined)} />
                <span className="small">{f.label}</span>
              </label>
            ))}
          </div>
          {EDIT_LISTS.map((l) => (
            <div key={l.key} className="color-row">
              <span className="color-row-label small">
                <strong>{l.label}</strong> <span className="muted">{l.note}</span>
              </span>
              <span className="color-list">
                {eff[l.key].map((c, i) => (
                  <ColorInput key={i} value={c} edited={!!edit[l.key]?.[i]} label={`${l.label} ${i + 1}`} onCommit={(v) => setList(l.key, i, v)} onReset={() => setList(l.key, i, undefined)} />
                ))}
              </span>
            </div>
          ))}
          <p className="muted small">
            원칙: 도판 하나에 주제색 한 계열, 모르는 값은 '미상' 회색, 강조색은 대지 하나. 용도지역은 관례 색(주거 노랑·상업 빨강·공업 보라·녹지 초록)을 지킵니다.
            {editedCount > 0 && (
              <>
                {' '}
                <button type="button" className="link-btn" onClick={() => saveEdit({})}>
                  고친 색 모두 묶음 색으로
                </button>
              </>
            )}
          </p>
        </div>
      </details>

      {overridden.length > 0 && (
        <p className="small style-overrides">
          <span className="muted">따로 색을 정한 도판:</span>{' '}
          {overridden.map((id, i) => (
            <span key={id}>
              {i > 0 && ', '}
              <button type="button" className="link-btn" onClick={() => setTarget(id)}>
                {panelLabel(id)}
                {styles[id]?.theme ? ` (테마색 ${styles[id]!.theme!.color})` : styles[id]?.palette ? ` (${paletteOf(styles[id]!.palette).label})` : ' (색 고침)'}
              </button>
            </span>
          ))}
        </p>
      )}
    </section>
  )
}
