import { useCallback, useEffect, useState } from 'react'
import type { StepId } from '../model/types'

// 주소창의 # 뒤를 화면 위치로 쓴다. GitHub Pages는 서버 라우팅이 없으므로 해시 방식이 안전하다.
//   #/                  → 프로젝트 목록
//   #/p/<id>/<step>     → 프로젝트의 특정 단계

export type Route = { name: 'home' } | { name: 'project'; id: string; step: StepId }

const STEP_IDS: StepId[] = ['brief', 'question', 'site', 'data', 'facts', 'diagrams', 'observe', 'interpret', 'report', 'model']

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'p' && parts[1]) {
    const step = STEP_IDS.includes(parts[2] as StepId) ? (parts[2] as StepId) : 'brief'
    return { name: 'project', id: decodeURIComponent(parts[1]), step }
  }
  return { name: 'home' }
}

export function routeToHash(route: Route): string {
  return route.name === 'home' ? '#/' : `#/p/${encodeURIComponent(route.id)}/${route.step}`
}

export function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((next: Route) => {
    const hash = routeToHash(next)
    if (window.location.hash !== hash) window.location.hash = hash
    else setRoute(next)
  }, [])

  return [route, navigate]
}
