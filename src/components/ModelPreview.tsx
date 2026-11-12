// 15-A 작업대의 3D 미리보기: three.js를 이 컴포넌트가 처음 그려질 때만 불러온다 (앱 첫 화면 무게는 그대로).
// 마우스 왼쪽 끌기 = 돌리기, 휠 = 확대, 오른쪽 끌기 = 옮기기 (휴대폰은 한 손가락·두 손가락).

import { useEffect, useRef, useState } from 'react'
import type { SiteModel } from '../export/siteModel'

interface Props {
  model: SiteModel
  /** 바탕색 */
  paper?: string
  onReady?: (info: { triangles: number; ms: number }) => void
}

type View = 'sw' | 'top' | 'se' | 'n'

export default function ModelPreview({ model, paper = '#f3f1ec', onReady }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const setViewRef = useRef<((v: View) => void) | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    let cleanup = () => {}
    setState('loading')
    void (async () => {
      try {
        const t0 = performance.now()
        const [THREE, { OrbitControls }, { buildPreview }] = await Promise.all([import('three'), import('three/examples/jsm/controls/OrbitControls.js'), import('../export/previewScene')])
        const el = ref.current
        if (!alive || !el) return
        const w = Math.max(200, el.clientWidth)
        const h = Math.max(200, el.clientHeight)
        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
        renderer.setSize(w, h)
        el.appendChild(renderer.domElement)
        const scene = new THREE.Scene()
        scene.background = new THREE.Color(paper)
        const half = model.half
        const camera = new THREE.PerspectiveCamera(35, w / h, Math.max(0.5, half / 400), half * 30)
        camera.up.set(0, 0, 1)
        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.12
        controls.maxPolarAngle = Math.PI / 2 - 0.03
        controls.screenSpacePanning = true
        const parts = buildPreview(model)
        scene.add(parts.group)
        scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a0, 1.6))
        const sun = new THREE.DirectionalLight(0xffffff, 1.8)
        sun.position.set(-half, half * 0.8, half * 1.6)
        scene.add(sun)
        const setView = (v: View) => {
          // 세로로 긴 창이면 가로 화각이 좁으니 더 멀리서
          const d = (half * 2.4) / Math.min(1, camera.aspect)
          controls.target.set(0, 0, 0)
          if (v === 'top') camera.position.set(0, -0.001, d * 1.05)
          else if (v === 'se') camera.position.set(d * 0.6, -d * 0.7, d * 0.55)
          else if (v === 'n') camera.position.set(0, d * 0.9, d * 0.5)
          else camera.position.set(-d * 0.6, -d * 0.7, d * 0.55)
          controls.update()
          dirty = true
        }
        setViewRef.current = setView
        let dirty = true
        setView('sw')
        controls.addEventListener('change', () => (dirty = true))
        const ro = new ResizeObserver(() => {
          const ww = Math.max(200, el.clientWidth)
          const hh = Math.max(200, el.clientHeight)
          renderer.setSize(ww, hh)
          camera.aspect = ww / hh
          camera.updateProjectionMatrix()
          dirty = true
        })
        ro.observe(el)
        let raf = 0
        const tick = () => {
          // 움직일 때만 다시 그림
          if (controls.update() || dirty) {
            renderer.render(scene, camera)
            dirty = false
          }
          raf = requestAnimationFrame(tick)
        }
        tick()
        setState('ready')
        onReady?.({ triangles: parts.triangles, ms: Math.round(performance.now() - t0) })
        cleanup = () => {
          cancelAnimationFrame(raf)
          ro.disconnect()
          controls.dispose()
          parts.dispose()
          renderer.dispose()
          if (renderer.domElement.parentElement === el) el.removeChild(renderer.domElement)
        }
      } catch (e) {
        if (!alive) return
        setErr(e instanceof Error ? e.message : String(e))
        setState('error')
      }
    })()
    return () => {
      alive = false
      setViewRef.current = null
      cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, paper])

  return (
    <div className="model-preview-wrap">
      <div className="model-preview" ref={ref} aria-label="3D 미리보기 (끌어서 돌리기, 휠로 확대)" role="img" />
      {state === 'loading' && <p className="model-preview-note">3D 미리보기 불러오는 중…</p>}
      {state === 'error' && <p className="model-preview-note error">미리보기를 그리지 못했습니다: {err}</p>}
      {state === 'ready' && (
        <div className="model-preview-views" role="group" aria-label="보는 방향">
          {(
            [
              ['sw', '남서'],
              ['se', '남동'],
              ['n', '북쪽'],
              ['top', '위'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} type="button" className="btn small" onClick={() => setViewRef.current?.(v)}>
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
