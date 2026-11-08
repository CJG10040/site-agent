// 브라우저 저장소 접근 도우미.
// 사생활 보호 모드나 저장소 차단 환경에서는 localStorage 접근 자체가 예외를 던질 수 있으므로 모두 감싼다.

export function readSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeSetting(key: string, value: string): boolean {
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}
