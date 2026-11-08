import { useEffect, useRef, useState } from 'react'
import type { VWorldConfig } from '../sources/vworld'

interface Props {
  initial: VWorldConfig
  onSave: (config: VWorldConfig) => void
  onClose: () => void
}

export default function SettingsDialog({ initial, onSave, onClose }: Props) {
  const [key, setKey] = useState(initial.key)
  const [domain, setDomain] = useState(initial.domain)
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const pageUrl = `${window.location.origin}${window.location.pathname}`

  useEffect(() => {
    firstFieldRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="settings-title">설정</h2>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSave({ key, domain })
          }}
        >
          <section className="field">
            <label htmlFor="vworld-key">브이월드 인증키</label>
            <div className="input-row">
              <input
                id="vworld-key"
                ref={firstFieldRef}
                type={showKey ? 'text' : 'password'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="브이월드 마이페이지 › 인증키 관리에서 복사"
              />
              <button type="button" className="btn ghost" onClick={() => setShowKey((v) => !v)}>
                {showKey ? '숨기기' : '보기'}
              </button>
            </div>
            <p className="help">
              키는 <strong>이 브라우저에만</strong> 저장되고 GitHub 저장소에는 올라가지 않습니다. 브이월드에 보내는
              요청에만 사용됩니다.
            </p>
          </section>

          <section className="field">
            <span className="label">브이월드 서비스 URL에 등록할 주소</span>
            <div className="input-row">
              <code className="url-box">{pageUrl}</code>
              <button type="button" className="btn ghost" onClick={copyUrl}>
                {copied ? '복사됨' : '복사'}
              </button>
            </div>
            <p className="help">
              브이월드 인증키는 등록한 서비스 URL에서만 동작합니다. 지금 접속한 주소와 등록한 주소가 같은지
              확인하세요.
            </p>
          </section>

          <details className="advanced">
            <summary>고급: domain 파라미터 직접 지정</summary>
            <section className="field">
              <label htmlFor="vworld-domain">domain 값</label>
              <input
                id="vworld-domain"
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={`비워 두면 ${window.location.origin}`}
              />
              <p className="help">연결 진단에서 서비스 URL 관련 오류가 날 때만 바꿔 보세요.</p>
            </section>
          </details>

          <div className="dialog-actions">
            <button
              type="button"
              className="btn ghost danger"
              onClick={() => {
                setKey('')
                onSave({ key: '', domain })
              }}
            >
              키 삭제
            </button>
            <span className="spacer" />
            <button type="button" className="btn ghost" onClick={onClose}>
              닫기
            </button>
            <button type="submit" className="btn primary">
              저장
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
