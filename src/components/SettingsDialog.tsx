import { useEffect, useRef, useState } from 'react'
import type { ApiKeys } from '../sources/keys'
import type { VWorldConfig } from '../sources/vworld'

interface Props {
  initial: VWorldConfig
  initialKeys: ApiKeys
  onSave: (config: VWorldConfig, keys: ApiKeys) => void
  onClose: () => void
}

function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  inputRef,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  inputRef?: React.Ref<HTMLInputElement>
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="input-row">
      <input
        id={id}
        ref={inputRef}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
      />
      <button type="button" className="btn ghost" onClick={() => setShow((v) => !v)}>
        {show ? '숨기기' : '보기'}
      </button>
    </div>
  )
}

export default function SettingsDialog({ initial, initialKeys, onSave, onClose }: Props) {
  const [key, setKey] = useState(initial.key)
  const [domain, setDomain] = useState(initial.domain)
  const [keys, setKeys] = useState<ApiKeys>(initialKeys)
  const [copied, setCopied] = useState(false)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const pageUrl = `${window.location.origin}${window.location.pathname}`
  const setK = (k: keyof ApiKeys, v: string) => setKeys((x) => ({ ...x, [k]: v }))

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
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="settings-title">설정</h2>
        <p className="help">
          모든 키는 <strong>이 브라우저에만</strong> 저장되고 GitHub 저장소에는 올라가지 않습니다. 칸을 비우고 저장하면 그 키가
          지워집니다.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSave({ key, domain }, keys)
          }}
        >
          <fieldset className="settings-group">
            <legend>브이월드 (지도·공간정보·토지 자료)</legend>
            <div className="field">
              <label htmlFor="vworld-key" className="label">
                인증키
              </label>
              <SecretInput
                id="vworld-key"
                inputRef={firstFieldRef}
                value={key}
                onChange={setKey}
                placeholder="브이월드 마이페이지 › 인증키 관리에서 복사"
              />
            </div>
            <div className="field">
              <span className="label">서비스 URL에 등록할 주소</span>
              <div className="input-row">
                <code className="url-box">{pageUrl}</code>
                <button type="button" className="btn ghost" onClick={copyUrl}>
                  {copied ? '복사됨' : '복사'}
                </button>
              </div>
            </div>
            <details className="advanced">
              <summary>고급: domain 파라미터 직접 지정</summary>
              <div className="field">
                <label htmlFor="vworld-domain" className="label">
                  domain 값
                </label>
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
              </div>
            </details>
          </fieldset>

          <fieldset className="settings-group">
            <legend>통계청 SGIS (인구·가구·사업체)</legend>
            <div className="field">
              <label htmlFor="sgis-key" className="label">
                서비스ID (consumer_key)
              </label>
              <SecretInput id="sgis-key" value={keys.sgisKey} onChange={(v) => setK('sgisKey', v)} placeholder="SGIS 개발지원센터 › 마이페이지 › 인증키" />
            </div>
            <div className="field">
              <label htmlFor="sgis-secret" className="label">
                보안키 (consumer_secret)
              </label>
              <SecretInput id="sgis-secret" value={keys.sgisSecret} onChange={(v) => setK('sgisSecret', v)} placeholder="" />
            </div>
          </fieldset>

          <fieldset className="settings-group">
            <legend>공공데이터포털 (건축물대장·버스정류소·기후·상가정보)</legend>
            <div className="field">
              <label htmlFor="datagokr-key" className="label">
                일반 인증키
              </label>
              <SecretInput
                id="datagokr-key"
                value={keys.dataGoKr}
                onChange={(v) => setK('dataGoKr', v)}
                placeholder="마이페이지 › 개발계정 › 일반 인증키 (Encoding·Decoding 둘 다 가능)"
              />
            </div>
          </fieldset>

          <fieldset className="settings-group">
            <legend>카카오 (주변 시설 검색)</legend>
            <div className="field">
              <label htmlFor="kakao-key" className="label">
                REST API 키
              </label>
              <SecretInput
                id="kakao-key"
                value={keys.kakaoRest}
                onChange={(v) => setK('kakaoRest', v)}
                placeholder="카카오 디벨로퍼스 › 내 애플리케이션 › 앱 키 › REST API 키"
              />
              <p className="help">카카오 디벨로퍼스에서 앱의 '카카오맵' 사용 설정을 켜야 검색이 됩니다.</p>
            </div>
          </fieldset>

          <div className="dialog-actions">
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
