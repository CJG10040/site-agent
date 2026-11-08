import { useState } from 'react'

interface Props {
  label: string
  presets: string[]
  value: string[]
  onChange: (next: string[]) => void
}

/** 미리 정한 태그 + 직접 입력 태그 */
export default function TagPicker({ label, presets, value, onChange }: Props) {
  const [custom, setCustom] = useState('')
  const all = [...presets, ...value.filter((v) => !presets.includes(v))]
  const toggle = (t: string) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t])
  const add = () => {
    const items = custom
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !value.includes(s))
    if (items.length) onChange([...value, ...items])
    setCustom('')
  }
  return (
    <fieldset className="field tag-picker">
      <legend className="label">{label}</legend>
      <div className="chips">
        {all.map((t) => (
          <button key={t} type="button" className={`chip small${value.includes(t) ? ' on' : ''}`} aria-pressed={value.includes(t)} onClick={() => toggle(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="input-row">
        <input
          type="text"
          value={custom}
          placeholder="직접 입력 (쉼표로 여러 개)"
          aria-label={`${label} 직접 입력`}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="btn small" onClick={add} disabled={!custom.trim()}>
          추가
        </button>
      </div>
    </fieldset>
  )
}
