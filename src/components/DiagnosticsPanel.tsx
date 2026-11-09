import { useState } from 'react'
import { runKeyDiagnostics } from '../sources/keyDiagnostics'
import type { ApiKeys } from '../sources/keys'
import { effectiveDomain, runDiagnostics, type CheckResult, type VWorldConfig } from '../sources/vworld'

interface Props {
  config: VWorldConfig
  keys: ApiKeys
}

export default function DiagnosticsPanel({ config, keys }: Props) {
  const [results, setResults] = useState<CheckResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [ranAt, setRanAt] = useState<Date | null>(null)

  const run = async () => {
    setBusy(true)
    const [vworld, others] = await Promise.all([runDiagnostics(config), runKeyDiagnostics(keys)])
    setResults([...vworld, ...others])
    setRanAt(new Date())
    setBusy(false)
  }

  const allOk = results?.every((r) => r.ok)

  return (
    <div className="panel-body">
      <p className="help">
        브이월드 지도·검색·주소·데이터 API와 SGIS·공공데이터포털(서비스별)·카카오 키가 실제로 응답하는지 확인합니다.
        키를 바꾸거나 활용신청이 승인된 뒤 다시 실행하세요.
      </p>

      <dl className="env">
        <dt>현재 접속 주소</dt>
        <dd className="mono">
          {window.location.origin}
          {window.location.pathname}
        </dd>
        <dt>domain 파라미터</dt>
        <dd className="mono">{effectiveDomain(config)}</dd>
        <dt>인증키</dt>
        <dd>{config.key.trim() ? `입력됨 (${config.key.trim().length}자)` : '입력 안 됨'}</dd>
      </dl>

      <button type="button" className="btn primary block" onClick={() => void run()} disabled={busy}>
        {busy ? '진단 중…' : '연결 진단 실행'}
      </button>

      {results && (
        <>
          <div className={`notice ${allOk ? 'ok' : 'error'}`}>
            <strong>{allOk ? '모든 항목이 정상입니다.' : '확인이 필요한 항목이 있습니다.'}</strong>
            {ranAt && <span className="muted"> · {ranAt.toLocaleTimeString('ko-KR')}</span>}
          </div>
          <ul className="checks">
            {results.map((r) => (
              <li key={r.id} className={r.ok ? 'ok' : 'fail'}>
                <span className="mark" aria-hidden="true">
                  {r.ok ? '✓' : '✕'}
                </span>
                <div>
                  <p className="check-label">
                    {r.label} <span className="muted">{r.ms > 0 ? `${r.ms}ms` : ''}</span>
                  </p>
                  <p className="check-summary">{r.summary}</p>
                  {r.hint && <p className="hint">{r.hint}</p>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
