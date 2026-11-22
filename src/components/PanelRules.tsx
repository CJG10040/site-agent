// 패널 규칙 (2026-11-21 묶음 D2): ⑥ '보통 도판 / 패널 모드' 보기 + 프로젝트 규칙 하나 + 도판 하나만 따로.
// 사용자 결정: 판 크기 = 지도 지름 mm / 범례·방위표·축척 각각 켜고 끄기(처음엔 켬) / 규칙은 패널 모드에만 / 글자 pt·선 mm.
// 다른 설정처럼 초안에 모았다가 '도판 생성'에서 다시 그림 (보기 바꾸기만 바로).

import { RotateCcw, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { addFontFiles, FONT_ACCEPT, removeFont, renameFamily, type FontRecord } from '../lib/fonts'
import { canListAll, loadAllFonts, useSystemFonts } from '../lib/systemFonts'
import { FONT } from '../diagrams/compose'
import { DEFAULT_RULES, LINE_STEP_LABEL, LINE_STEPS, mergeRules, rulesFor, SYM_STEPS, TEXT_STEPS } from '../diagrams/panelRules'
import { SYM_STEP_LABEL, TEXT_STEP_LABEL } from '../diagrams/typeScale'
import type { DiagramSettings, LineStep, PanelRules as Rules, PanelRulesEdit, SymStep, TextStep } from '../model/types'

/** 고친 칸에서 바탕과 같은 값은 뺌 (바꾼 것만 남김) */
function tidy(e: PanelRulesEdit, base: Rules): PanelRulesEdit | undefined {
  const out: PanelRulesEdit = {}
  for (const k of ['mapMM', 'rect', 'mapH', 'legend', 'north', 'scale', 'font', 'dpi'] as const) {
    if (e[k] !== undefined && e[k] !== base[k]) (out as Record<string, unknown>)[k] = e[k]
  }
  const text = Object.fromEntries(TEXT_STEPS.filter((s) => e.text?.[s] !== undefined && e.text[s] !== base.text[s]).map((s) => [s, e.text![s]]))
  const line = Object.fromEntries(LINE_STEPS.filter((s) => e.line?.[s] !== undefined && e.line[s] !== base.line[s]).map((s) => [s, e.line![s]]))
  const sym = Object.fromEntries(SYM_STEPS.filter((s) => e.sym?.[s] !== undefined && e.sym[s] !== base.sym[s]).map((s) => [s, e.sym![s]]))
  if (Object.keys(text).length) out.text = text
  if (Object.keys(line).length) out.line = line
  if (Object.keys(sym).length) out.sym = sym
  return Object.keys(out).length ? out : undefined
}

function Seg<T extends string | boolean>({ label, value, options, onChange, changed }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; changed?: boolean }) {
  return (
    <div className={`seg-field${changed ? ' rule-changed' : ''}`}>
      <span className="label">{label}</span>
      <div className="segmented small" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 숫자 칸: 치는 동안의 글은 따로 두고, 범위 안의 숫자가 되면 바로 반영 (칸을 떠나면 반영된 값으로) */
function Num({ label, unit, value, step, min, max, onChange, changed }: { label: string; unit: string; value: number; step: number; min: number; max: number; onChange: (v: number) => void; changed?: boolean }) {
  const [txt, setTxt] = useState(String(value))
  useEffect(() => setTxt(String(value)), [value])
  return (
    <label className={`num-field${changed ? ' rule-changed' : ''}`}>
      <span className="label">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={txt}
        onChange={(e) => {
          setTxt(e.target.value)
          const v = Number(e.target.value)
          if (e.target.value.trim() && Number.isFinite(v) && v >= min && v <= max) onChange(v)
        }}
        onBlur={() => setTxt(String(value))}
      />
      <span className="muted small">{unit}</span>
    </label>
  )
}

/** 글꼴 고르기 (2026-11-21 사용자 요청: 이름을 치지 않고 고름): 기본 · 올린 글꼴 · 이 컴퓨터에 깔린 글꼴 */
function FontPick({ value, fonts, onChange, changed }: { value: string; fonts: FontRecord[]; onChange: (v: string) => void; changed?: boolean }) {
  const uploaded = [...new Set(fonts.map((f) => f.family))]
  const sys = useSystemFonts()
  const system = sys.names.filter((n) => !uploaded.includes(n))
  // 다른 컴퓨터에서 고른 글꼴 등 지금 목록에 없는 이름도 그대로 보이게
  const missing = !!value && !uploaded.includes(value) && !system.includes(value)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const loadAll = async () => {
    setLoading(true)
    setMsg(null)
    const r = await loadAllFonts()
    setLoading(false)
    if (!r.ok) setMsg(r.message ?? null)
  }
  return (
    <div className={`seg-field font-field${changed ? ' rule-changed' : ''}`}>
      <span className="label">글꼴</span>
      <select aria-label="글꼴" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">기본 (Pretendard)</option>
        {missing && <option value={value}>{value} — 이 컴퓨터에 없음</option>}
        {uploaded.length > 0 && (
          <optgroup label="올린 글꼴">
            {uploaded.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </optgroup>
        )}
        {system.length > 0 && (
          <optgroup label={sys.full ? `이 컴퓨터 글꼴 (${system.length})` : '이 컴퓨터 글꼴 (자주 쓰는 것)'}>
            {system.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <span className="font-preview" style={{ fontFamily: value ? `'${value}', ${FONT}` : FONT }} aria-hidden="true">
        가나다 AaBb 123 대지 250m
      </span>
      {!sys.full && canListAll() && (
        <button type="button" className="link-btn small" disabled={loading} onClick={() => void loadAll()}>
          {loading ? '불러오는 중…' : '이 컴퓨터의 글꼴 모두 불러오기 (처음 한 번 브라우저가 허락을 물음)'}
        </button>
      )}
      {msg && <span className="small warn-text">{msg}</span>}
    </div>
  )
}

interface FormProps {
  /** 이 칸들이 얹히는 값 (전체 규칙이면 처음 값, 도판 하나면 전체 규칙) */
  base: Rules
  fonts: FontRecord[]
  edit: PanelRulesEdit | undefined
  onChange: (next: PanelRulesEdit | undefined) => void
  /** 도판 하나만 (해상도는 전체에서만) */
  one?: boolean
}

export function RulesForm({ base, fonts, edit, onChange, one = false }: FormProps) {
  const r = mergeRules(base, edit)
  const set = (patch: PanelRulesEdit) => {
    const next: PanelRulesEdit = {
      ...(edit ?? {}),
      ...patch,
      text: { ...(edit?.text ?? {}), ...(patch.text ?? {}) },
      line: { ...(edit?.line ?? {}), ...(patch.line ?? {}) },
      sym: { ...(edit?.sym ?? {}), ...(patch.sym ?? {}) },
    }
    onChange(tidy(next, base))
  }
  // 도판 하나만: 전체 규칙과 다른 칸 표시 / 전체 규칙: 처음 값과 다른 칸은 표시 안 함 (흔히 바꾸므로)
  const ch = (k: keyof Rules) => one && edit?.[k] !== undefined
  const cht = (s: TextStep) => one && edit?.text?.[s] !== undefined
  const chl = (s: LineStep) => one && edit?.line?.[s] !== undefined
  const chs = (s: SymStep) => one && edit?.sym?.[s] !== undefined
  return (
    <div className="rules-form">
      <div className="rules-row">
        <Seg
          label="지도 틀"
          value={r.rect}
          options={[
            [false, '설정대로 (원·정사각)'],
            [true, '직사각'],
          ]}
          onChange={(v) => set({ rect: v })}
          changed={ch('rect')}
        />
        <Num label={r.rect ? '가로' : '지도 지름'} unit="mm" value={r.mapMM} step={5} min={30} max={400} onChange={(v) => set({ mapMM: v })} changed={ch('mapMM')} />
        {r.rect && <Num label="세로" unit="mm" value={r.mapH} step={5} min={30} max={400} onChange={(v) => set({ mapH: v })} changed={ch('mapH')} />}
        <Seg
          label="범례"
          value={r.legend}
          options={[
            ['below', '아래'],
            ['right', '오른쪽'],
            ['none', '빼기'],
          ]}
          onChange={(v) => set({ legend: v })}
          changed={ch('legend')}
        />
        <Seg
          label="방위표"
          value={r.north}
          options={[
            [true, '켬'],
            [false, '끔'],
          ]}
          onChange={(v) => set({ north: v })}
          changed={ch('north')}
        />
        <Seg
          label="축척"
          value={r.scale}
          options={[
            [true, '켬'],
            [false, '끔'],
          ]}
          onChange={(v) => set({ scale: v })}
          changed={ch('scale')}
        />
      </div>
      <div className="rules-row">
        <span className="rules-head">글자 (pt)</span>
        {TEXT_STEPS.map((s) => (
          <Num key={s} label={TEXT_STEP_LABEL[s]} unit="pt" value={r.text[s]} step={0.5} min={2} max={36} onChange={(v) => set({ text: { [s]: v } })} changed={cht(s)} />
        ))}
      </div>
      <div className="rules-row">
        <span className="rules-head">선 (mm)</span>
        {LINE_STEPS.map((s) => (
          <Num key={s} label={LINE_STEP_LABEL[s]} unit="mm" value={r.line[s]} step={0.05} min={0.02} max={3} onChange={(v) => set({ line: { [s]: v } })} changed={chl(s)} />
        ))}
      </div>
      <div className="rules-row">
        <span className="rules-head">기호 지름 (mm)</span>
        {SYM_STEPS.map((s) => (
          <Num key={s} label={SYM_STEP_LABEL[s]} unit="mm" value={r.sym[s]} step={0.1} min={0.2} max={20} onChange={(v) => set({ sym: { [s]: v } })} changed={chs(s)} />
        ))}
      </div>
      <div className="rules-row">
        <FontPick value={r.font} fonts={fonts} onChange={(v) => set({ font: v })} changed={ch('font')} />
        {!one && (
          <Seg
            label="PNG 해상도"
            value={String(r.dpi)}
            options={[
              ['300', '300dpi'],
              ['600', '600dpi'],
            ]}
            onChange={(v) => set({ dpi: Number(v) })}
          />
        )}
      </div>
    </div>
  )
}

/** 올린 글꼴: 이 브라우저에만 */
function FontManager({ fonts, onRenamed }: { fonts: FontRecord[]; onRenamed: (from: string, to: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const families = [...new Set(fonts.map((f) => f.family))]
  const upload = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await addFontFiles(files)
      const parts = []
      if (r.added.length) parts.push(`${r.added.length}개 올림 (${[...new Set(r.added.map((f) => f.family))].join(', ')})`)
      if (r.skipped.length) parts.push(`건너뜀: ${r.skipped.join(', ')}`)
      setMsg(parts.join(' · '))
    } catch (e) {
      setMsg(`올리지 못함: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="font-manager">
      <div className="font-manager-head">
        <span className="rules-head">올린 글꼴</span>
        <button type="button" className="btn small" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={14} aria-hidden="true" /> {busy ? '읽는 중…' : '글꼴 파일 올리기'}
        </button>
        <input
          ref={input}
          type="file"
          accept={FONT_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            void upload([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
      </div>
      <p className="muted small">
        이 컴퓨터에 없는 글꼴을 쓸 때 올리세요(.ttf·.otf·.woff·.woff2). 이 브라우저에만 저장되고 저장소나 내보낸 프로젝트 파일에는 들어가지 않습니다. 도판 화면·PNG는 올린 글꼴로 그리고, SVG에는 글꼴 이름만 적어 일러스트레이터는 컴퓨터에 깔린 같은 이름의 글꼴로 엽니다. 굵기마다 파일이 따로면 함께 올리세요. 한글 글꼴은 커서 도판 화면이 조금 느려질 수 있습니다.
      </p>
      {msg && <p className="small">{msg}</p>}
      {families.length > 0 && (
        <ul className="font-list">
          {families.map((fam) => (
            <li key={fam}>
              <FamilyName
                name={fam}
                recs={fonts.filter((f) => f.family === fam)}
                onRename={async (to) => {
                  await renameFamily(fam, to)
                  onRenamed(fam, to)
                }}
              />
              <span className="font-files">
                {fonts
                  .filter((f) => f.family === fam)
                  .map((f) => (
                    <span key={f.id} className="font-file small">
                      <span style={{ fontFamily: `'${fam}'`, fontWeight: f.weight, fontStyle: f.italic ? 'italic' : 'normal' }}>가Aa {f.weight}</span>
                      <span className="muted"> {f.fileName} · {(f.size / 1048576).toFixed(1)}MB</span>
                      <button type="button" className="link-btn small" onClick={() => void removeFont(f.id)}>
                        지우기
                      </button>
                    </span>
                  ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 올린 글꼴 이름 맞추기 (일러스트레이터가 찾는 이름과 같게) — 치지 않고 고름: 파일에서 읽은 이름 · 이 컴퓨터 글꼴 이름 */
function FamilyName({ name, recs, onRename }: { name: string; recs: FontRecord[]; onRename: (to: string) => void | Promise<void> }) {
  const sys = useSystemFonts()
  const guessed = recs.some((r) => r.guessed)
  const read = [...new Set(recs.map((r) => r.readName).filter((x): x is string => !!x && x !== name))]
  const others = sys.names.filter((n) => n !== name && !read.includes(n))
  return (
    <label className="font-family-name">
      <span className="muted small">{guessed ? '이름 (파일 이름에서 짐작 — 다르면 고르세요)' : '이름'}</span>
      <select value={name} onChange={(e) => void onRename(e.target.value)}>
        <option value={name}>{name}</option>
        {read.map((n) => (
          <option key={n} value={n}>
            {n} — 처음 읽은 이름
          </option>
        ))}
        {others.length > 0 && (
          <optgroup label="이 컴퓨터 글꼴 이름으로 맞추기">
            {others.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  )
}

interface PanelProps {
  settings: DiagramSettings
  fonts: FontRecord[]
  /** 보기 바꾸기 (바로 저장) */
  setView: (panel: boolean) => void
  setSettings: (patch: Partial<DiagramSettings>) => void
}

/** ⑥ 위쪽: 보기 + 전체 규칙 */
export default function PanelRules({ settings, fonts, setView, setSettings }: PanelProps) {
  const on = !!settings.panelView
  const overrides = Object.keys(settings.panelOver ?? {}).length
  return (
    <section className={`panel-rules${on ? ' on' : ''}`}>
      <div className="panel-rules-head">
        <div className="segmented small" role="radiogroup" aria-label="도판 보기">
          {(
            [
              [false, '보통 도판'],
              [true, '패널 모드'],
            ] as const
          ).map(([v, l]) => (
            <button key={l} type="button" role="radio" aria-checked={on === v} className={on === v ? 'on' : ''} onClick={() => setView(v)}>
              {l}
            </button>
          ))}
        </div>
        <p className="muted small">
          {on
            ? '패널 모드: 제목·출처·캡션 없이 다이어그램만, 아래 규칙대로 그립니다. SVG·PNG는 mm 크기로 받습니다. 보드·리포트는 늘 보통 도판입니다.'
            : '패널 모드로 바꾸면 제목·출처 없이 다이어그램만, 정한 크기(mm)·글자·선으로 그려 일러스트레이터 등에서 조판하기 좋게 받을 수 있습니다.'}
        </p>
      </div>
      {on && (
        <>
          <div className="panel-rules-sub">
            <h3>패널 규칙</h3>
            <span className="muted small">모든 도판에 같은 규칙{overrides ? ` · 따로 바꾼 도판 ${overrides}장` : ''}</span>
            <span className="spacer" />
            <button type="button" className="btn small ghost" disabled={!settings.panelRules} onClick={() => setSettings({ panelRules: undefined })}>
              <RotateCcw size={14} aria-hidden="true" /> 처음 값으로
            </button>
          </div>
          <RulesForm base={DEFAULT_RULES} fonts={fonts} edit={settings.panelRules} onChange={(e) => setSettings({ panelRules: e })} />
          <FontManager
            fonts={fonts}
            onRenamed={(from, to) => {
              // 규칙이 옛 이름을 쓰고 있으면 새 이름으로 (전체 규칙 + 도판 하나만)
              const patch: Partial<DiagramSettings> = {}
              if (settings.panelRules?.font === from) patch.panelRules = { ...settings.panelRules, font: to }
              const over = settings.panelOver ?? {}
              if (Object.values(over).some((o) => o.font === from)) patch.panelOver = Object.fromEntries(Object.entries(over).map(([k, o]) => [k, o.font === from ? { ...o, font: to } : o]))
              if (Object.keys(patch).length) setSettings(patch)
            }}
          />
        </>
      )}
    </section>
  )
}

/** 도판 카드: 이 도판만 따로 */
export function PanelRulesOne({ id, settings, fonts, setSettings }: { id: string; settings: DiagramSettings; fonts: FontRecord[]; setSettings: (patch: Partial<DiagramSettings>) => void }) {
  const base = mergeRules(DEFAULT_RULES, settings.panelRules)
  const edit = settings.panelOver?.[id]
  const setEdit = (e: PanelRulesEdit | undefined) => {
    const next = { ...(settings.panelOver ?? {}) }
    if (e) next[id] = e
    else delete next[id]
    setSettings({ panelOver: Object.keys(next).length ? next : undefined })
  }
  const r = rulesFor(settings, id)
  // 54장 카드마다 칸을 다 그리면 무거우므로 펼쳤을 때만
  const [open, setOpen] = useState(!!edit)
  return (
    <details className="panel-one" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="small">
        이 도판만 따로{edit ? <span className="rule-badge">바꿈</span> : null}
        <span className="muted"> · 지도 {r.rect ? `${r.mapMM}×${r.mapH}` : r.mapMM}mm · 범례 {r.legend === 'below' ? '아래' : r.legend === 'right' ? '오른쪽' : '없음'}</span>
      </summary>
      {open && <RulesForm base={base} fonts={fonts} edit={edit} onChange={setEdit} one />}
      {open && edit && (
        <button type="button" className="link-btn small" onClick={() => setEdit(undefined)}>
          전체 규칙 따르기
        </button>
      )}
    </details>
  )
}
