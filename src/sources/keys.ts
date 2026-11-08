// 브이월드 외 공공데이터 인증키. 브이월드 키와 마찬가지로 이 브라우저에만 저장하고 저장소에는 올리지 않는다.

import { readSetting, writeSetting } from '../lib/storage'

export interface ApiKeys {
  /** 통계청 SGIS 서비스ID (consumer_key) */
  sgisKey: string
  /** 통계청 SGIS 보안키 (consumer_secret) */
  sgisSecret: string
  /** 공공데이터포털 일반 인증키 */
  dataGoKr: string
}

const STORAGE: Record<keyof ApiKeys, string> = {
  sgisKey: 'site-agent:sgis-key',
  sgisSecret: 'site-agent:sgis-secret',
  dataGoKr: 'site-agent:datagokr-key',
}

export function loadKeys(): ApiKeys {
  return {
    sgisKey: readSetting(STORAGE.sgisKey) ?? '',
    sgisSecret: readSetting(STORAGE.sgisSecret) ?? '',
    dataGoKr: readSetting(STORAGE.dataGoKr) ?? '',
  }
}

export function saveKeys(keys: ApiKeys): boolean {
  let ok = true
  for (const k of Object.keys(STORAGE) as (keyof ApiKeys)[]) {
    ok = writeSetting(STORAGE[k], keys[k].trim()) && ok
  }
  return ok
}

/**
 * 공공데이터포털은 같은 키를 'Encoding'(%2B 등 포함)과 'Decoding' 두 형태로 준다.
 * 주소에 넣을 때 다시 인코딩하므로, Encoding 형태를 붙여넣었으면 한 번 풀어 둔다.
 */
export function normalizeDataGoKrKey(key: string): string {
  const k = key.trim()
  if (!/%[0-9A-Fa-f]{2}/.test(k)) return k
  try {
    return decodeURIComponent(k)
  } catch {
    return k
  }
}
