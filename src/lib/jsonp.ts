// JSONP 호출 도우미.
// 브이월드 API는 CORS 헤더를 보내지 않아 fetch로는 브라우저에서 응답을 읽을 수 없다.
// 대신 callback 파라미터를 주면 `callback({...})` 형태의 스크립트로 응답하므로 <script> 태그로 받는다.

export class JsonpError extends Error {
  readonly code: 'TIMEOUT' | 'SCRIPT_ERROR' | 'NO_CALLBACK'

  constructor(code: JsonpError['code'], message: string) {
    super(message)
    this.name = 'JsonpError'
    this.code = code
  }
}

let counter = 0

type CallbackHost = Record<string, ((data: unknown) => void) | undefined>

export function jsonp<T>(
  url: string,
  params: Record<string, string>,
  timeoutMs = 12000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const callbackName = `__siteAgentJsonp_${Date.now()}_${counter++}`
    const host = window as unknown as CallbackHost
    const script = document.createElement('script')
    let settled = false

    const finish = () => {
      settled = true
      window.clearTimeout(timer)
      // 시간 초과 뒤 늦게 도착한 응답이 오류를 내지 않도록 빈 함수로 남겨 둔다.
      host[callbackName] = () => {}
      script.remove()
    }

    const timer = window.setTimeout(() => {
      if (settled) return
      finish()
      reject(new JsonpError('TIMEOUT', '응답 시간이 초과되었습니다.'))
    }, timeoutMs)

    host[callbackName] = (data: unknown) => {
      if (settled) return
      finish()
      resolve(data as T)
    }

    script.onerror = () => {
      if (settled) return
      finish()
      reject(new JsonpError('SCRIPT_ERROR', '서버에 연결하지 못했습니다. (네트워크 또는 차단 문제)'))
    }

    // 스크립트가 실행됐는데도 콜백이 호출되지 않았다면 JSONP 형식이 아닌 응답이다.
    script.onload = () => {
      if (settled) return
      finish()
      reject(new JsonpError('NO_CALLBACK', '응답이 JSONP 형식이 아닙니다. 이 API는 중계 서버가 필요할 수 있습니다.'))
    }

    const query = new URLSearchParams({ ...params, callback: callbackName })
    script.src = `${url}?${query.toString()}`
    script.async = true
    document.head.appendChild(script)
  })
}
