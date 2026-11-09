// 리포트·패널용 분석 지도 그림 만들기.
// 화면 밖에 OpenLayers 지도를 하나 그려서 여러 레이어 캔버스를 한 장으로 합치고,
// 제목·범례·방위·축척·출처를 덧그린다.
// 브이월드 배경지도 타일은 CORS를 허용(2026-11-09 확인)해서 그림으로 저장할 수 있다.
// 혹시 배경지도 때문에 저장이 막히면 배경 없이 다시 그린다.

import OlMap from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
import XYZ from 'ol/source/XYZ'
import VectorSource from 'ol/source/Vector'
import GeoJSON from 'ol/format/GeoJSON'
import Feature, { type FeatureLike } from 'ol/Feature'
import Point from 'ol/geom/Point'
import { fromLonLat, getPointResolution } from 'ol/proj'
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style'
import type { Geometry as OlGeometry } from 'ol/geom'
import type { Geometry } from 'geojson'
import { densityClass, floorClass } from '../components/mapStyles'
import type { GeoFeature } from '../sources/vworld'
import { tileUrl } from '../sources/vworld'

export interface LegendItem {
  color: string
  label: string
  shape?: 'box' | 'dot' | 'line'
}

export interface MapObservationMark {
  lon: number
  lat: number
  label: string
  kind: 'normal' | 'differ' | 'discovery'
}

export interface AnalysisMapSpec {
  title: string
  subtitle?: string
  vworldKey: string
  boundary: Geometry | null
  radius: Geometry | null
  buildings?: GeoFeature[]
  statsAreas?: GeoFeature[]
  sun?: GeoFeature[]
  observations?: MapObservationMark[]
  fitTo: Geometry
  legendTitle: string
  legend: LegendItem[]
  /** 논리 픽셀 (실제 그림은 2배) */
  width: number
  height: number
}

const PR = 2
const FORMAT = new GeoJSON()
const PROJ = { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }
const ACCENT = '#d9480f'
const OBS_COLORS = { normal: '#343a40', differ: '#c92a2a', discovery: '#0c8599' }
const SUN_COLORS: Record<string, string> = { summer: '#e8590c', equinox: '#e0a100', winter: '#1c7ed6' }
const FONT = 'Pretendard, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif'

function readFeatures(features: GeoFeature[] | undefined): Feature<OlGeometry>[] {
  const withGeom = (features ?? []).filter((f) => f.geometry)
  if (!withGeom.length) return []
  return FORMAT.readFeatures({ type: 'FeatureCollection', features: withGeom }, PROJ) as Feature<OlGeometry>[]
}

function vector(features: Feature<OlGeometry>[], style: Style | ((f: FeatureLike) => Style), z: number) {
  return new VectorLayer({ source: new VectorSource({ features }), style, zIndex: z })
}

function buildLayers(spec: AnalysisMapSpec, withBase: boolean) {
  const layers: (TileLayer<XYZ> | VectorLayer)[] = []
  if (withBase && spec.vworldKey.trim()) {
    layers.push(
      new TileLayer({
        zIndex: 0,
        opacity: 0.9,
        source: new XYZ({ url: tileUrl(spec.vworldKey, 'white'), crossOrigin: 'anonymous', maxZoom: 19 }),
      }),
    )
  }
  const densityStyles = new Map<string, Style>()
  layers.push(
    vector(
      readFeatures(spec.statsAreas),
      (f) => {
        const cls = densityClass(f.get('ppltn_dnsty') as number | null)
        let s = densityStyles.get(cls.id)
        if (!s) {
          s = new Style({ fill: new Fill({ color: `${cls.color}cc` }), stroke: new Stroke({ color: 'rgba(70,40,120,0.7)', width: 1.2 }) })
          densityStyles.set(cls.id, s)
        }
        return s
      },
      10,
    ),
  )
  const floorStyles = new Map<string, Style>()
  layers.push(
    vector(
      readFeatures(spec.buildings),
      (f) => {
        const cls = floorClass(Number(f.get('grnd_flr')))
        let s = floorStyles.get(cls.id)
        if (!s) {
          s = new Style({ fill: new Fill({ color: cls.color }), stroke: new Stroke({ color: 'rgba(40,40,60,0.45)', width: 0.6 }) })
          floorStyles.set(cls.id, s)
        }
        return s
      },
      20,
    ),
  )
  if (spec.radius) {
    layers.push(vector([new Feature(FORMAT.readGeometry(spec.radius, PROJ) as OlGeometry)], new Style({ stroke: new Stroke({ color: 'rgba(60,56,50,0.9)', width: 2, lineDash: [10, 7] }) }), 30))
  }
  if (spec.boundary) {
    layers.push(
      vector(
        [new Feature(FORMAT.readGeometry(spec.boundary, PROJ) as OlGeometry)],
        new Style({ stroke: new Stroke({ color: ACCENT, width: 3.5 }), fill: new Fill({ color: 'rgba(217,72,15,0.18)' }) }),
        40,
      ),
    )
  }
  layers.push(
    vector(
      readFeatures(spec.sun),
      (f) => {
        const kind = f.get('kind')
        const color = SUN_COLORS[f.get('day') as string] ?? '#868e96'
        if (kind === 'sunring') return new Style({ stroke: new Stroke({ color: 'rgba(110,110,110,0.7)', width: 1.2, lineDash: [4, 6] }) })
        if (kind === 'sunpath') return new Style({ stroke: new Stroke({ color, width: 3.5 }) })
        const label = f.get('label') as string
        return new Style({
          image: new CircleStyle({ radius: 4.5, fill: new Fill({ color }), stroke: new Stroke({ color: '#fff', width: 1.5 }) }),
          text: label
            ? new Text({ text: label, offsetY: -14, font: `700 13px ${FONT}`, fill: new Fill({ color }), stroke: new Stroke({ color: '#fff', width: 3.5 }) })
            : undefined,
        })
      },
      50,
    ),
  )
  const obsFeatures = (spec.observations ?? []).map((o) => {
    const f = new Feature(new Point(fromLonLat([o.lon, o.lat])))
    f.setProperties({ label: o.label, kind: o.kind })
    return f
  })
  layers.push(
    vector(
      obsFeatures,
      (f) =>
        new Style({
          image: new CircleStyle({
            radius: 13,
            fill: new Fill({ color: OBS_COLORS[(f.get('kind') as MapObservationMark['kind']) ?? 'normal'] }),
            stroke: new Stroke({ color: '#fff', width: 2.5 }),
          }),
          text: new Text({ text: String(f.get('label')), font: `700 13px ${FONT}`, fill: new Fill({ color: '#fff' }) }),
        }),
      60,
    ),
  )
  return layers
}

function waitRender(map: OlMap, ms = 15000): Promise<void> {
  return new Promise((resolve) => {
    const t = window.setTimeout(resolve, ms)
    map.once('rendercomplete', () => {
      window.clearTimeout(t)
      resolve()
    })
  })
}

/** OpenLayers 공식 예제(지도 내보내기)의 레이어 캔버스 합치기 방식 */
function composite(map: OlMap, w: number, h: number): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = w * PR
  out.height = h * PR
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  const viewport = map.getViewport()
  if (!viewport) return out
  viewport
    .querySelectorAll<HTMLCanvasElement>('.ol-layer canvas, canvas.ol-layer')
    .forEach((canvas) => {
      if (canvas.width <= 0) return
      const parent = canvas.parentNode as HTMLElement | null
      const opacity = parent?.style.opacity || canvas.style.opacity
      ctx.globalAlpha = opacity === '' || opacity === undefined ? 1 : Number(opacity)
      const tr = canvas.style.transform
      let m: number[]
      const match = tr ? tr.match(/^matrix\(([^(]*)\)$/) : null
      if (match) m = match[1].split(',').map(Number)
      else m = [parseFloat(canvas.style.width) / canvas.width, 0, 0, parseFloat(canvas.style.height) / canvas.height, 0, 0]
      ctx.setTransform(m[0] * PR, m[1] * PR, m[2] * PR, m[3] * PR, m[4] * PR, m[5] * PR)
      ctx.drawImage(canvas, 0, 0)
    })
  ctx.globalAlpha = 1
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  return out
}

function niceLength(metersPerPx: number): number {
  const target = metersPerPx * 140
  const steps = [10, 20, 50, 100, 200, 250, 500, 1000, 2000]
  return steps.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), steps[0])
}

function decorate(canvas: HTMLCanvasElement, map: OlMap, spec: AnalysisMapSpec, note: string | null) {
  const ctx = canvas.getContext('2d')!
  ctx.scale(PR, PR)
  const W = spec.width
  const H = spec.height
  const pad = 16

  // 제목
  ctx.font = `700 20px ${FONT}`
  const titleW = ctx.measureText(spec.title).width
  ctx.font = `400 13px ${FONT}`
  const subW = spec.subtitle ? ctx.measureText(spec.subtitle).width : 0
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.fillRect(pad - 8, pad - 8, Math.max(titleW, subW) + 16, spec.subtitle ? 52 : 34)
  ctx.fillStyle = '#1d1d1b'
  ctx.textBaseline = 'top'
  ctx.font = `700 20px ${FONT}`
  ctx.fillText(spec.title, pad, pad - 2)
  if (spec.subtitle) {
    ctx.font = `400 13px ${FONT}`
    ctx.fillStyle = '#5c5a55'
    ctx.fillText(spec.subtitle, pad, pad + 24)
  }

  // 범례 (오른쪽 아래)
  if (spec.legend.length) {
    ctx.font = `400 13px ${FONT}`
    const rowH = 20
    const maxLabel = Math.max(...spec.legend.map((l) => ctx.measureText(l.label).width), ctx.measureText(spec.legendTitle).width)
    const boxW = maxLabel + 44
    const boxH = 30 + spec.legend.length * rowH
    const x = W - boxW - pad
    const y = H - boxH - pad - 18
    ctx.fillStyle = 'rgba(255,255,255,0.94)'
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'
    ctx.fillRect(x, y, boxW, boxH)
    ctx.strokeRect(x, y, boxW, boxH)
    ctx.fillStyle = '#1d1d1b'
    ctx.font = `700 13px ${FONT}`
    ctx.fillText(spec.legendTitle, x + 10, y + 8)
    ctx.font = `400 13px ${FONT}`
    spec.legend.forEach((l, i) => {
      const ly = y + 30 + i * rowH
      ctx.fillStyle = l.color
      if (l.shape === 'dot') {
        ctx.beginPath()
        ctx.arc(x + 17, ly + 7, 6, 0, Math.PI * 2)
        ctx.fill()
      } else if (l.shape === 'line') {
        ctx.fillRect(x + 10, ly + 5, 16, 4)
      } else {
        ctx.fillRect(x + 10, ly + 1, 16, 12)
        ctx.strokeStyle = 'rgba(0,0,0,0.2)'
        ctx.strokeRect(x + 10, ly + 1, 16, 12)
      }
      ctx.fillStyle = '#1d1d1b'
      ctx.fillText(l.label, x + 34, ly)
    })
  }

  // 방위 (오른쪽 위)
  const nx = W - pad - 18
  const ny = pad + 6
  ctx.fillStyle = '#1d1d1b'
  ctx.beginPath()
  ctx.moveTo(nx, ny)
  ctx.lineTo(nx + 9, ny + 26)
  ctx.lineTo(nx, ny + 20)
  ctx.lineTo(nx - 9, ny + 26)
  ctx.closePath()
  ctx.fill()
  ctx.font = `700 13px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText('N', nx, ny + 30)
  ctx.textAlign = 'left'

  // 축척 (왼쪽 아래)
  const view = map.getView()
  const res = view.getResolution() ?? 1
  const mpp = getPointResolution('EPSG:3857', res, view.getCenter() ?? [0, 0])
  const len = niceLength(mpp)
  const px = len / mpp
  const sx = pad
  const sy = H - pad - 26
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.fillRect(sx - 6, sy - 6, px + 70, 30)
  ctx.fillStyle = '#1d1d1b'
  ctx.fillRect(sx, sy + 8, px, 4)
  ctx.fillRect(sx, sy + 2, 2, 12)
  ctx.fillRect(sx + px - 2, sy + 2, 2, 12)
  ctx.font = `400 12px ${FONT}`
  ctx.fillText(len >= 1000 ? `${len / 1000}km` : `${len}m`, sx + px + 8, sy + 3)

  // 출처 (아래)
  ctx.font = `400 11px ${FONT}`
  ctx.fillStyle = '#5c5a55'
  const credit = note ?? '배경지도 © 브이월드(국토교통부)'
  ctx.textAlign = 'right'
  ctx.fillText(credit, W - pad, H - pad + 2)
  ctx.textAlign = 'left'
}

async function renderOnce(spec: AnalysisMapSpec, withBase: boolean): Promise<string> {
  const container = document.createElement('div')
  container.style.cssText = `position:fixed;left:-20000px;top:0;width:${spec.width}px;height:${spec.height}px;`
  document.body.appendChild(container)
  const map = new OlMap({
    target: container,
    layers: buildLayers(spec, withBase),
    view: new View({ center: fromLonLat([127, 35.5]), zoom: 10, maxZoom: 20 }),
    controls: [],
    interactions: [],
    pixelRatio: PR,
  })
  try {
    const extent = (FORMAT.readGeometry(spec.fitTo, PROJ) as OlGeometry).getExtent()
    map.getView().fit(extent, { size: [spec.width, spec.height], padding: [70, 40, 50, 40], maxZoom: 19 })
    const done = waitRender(map)
    map.renderSync()
    await done
    const canvas = composite(map, spec.width, spec.height)
    decorate(canvas, map, spec, withBase && spec.vworldKey.trim() ? null : '배경지도 없이 그림')
    return canvas.toDataURL('image/png') // 배경지도가 CORS를 막으면 여기서 오류
  } finally {
    map.setTarget(undefined)
    container.remove()
  }
}

export async function renderAnalysisMap(spec: AnalysisMapSpec): Promise<{ dataUrl: string; withBase: boolean }> {
  try {
    return { dataUrl: await renderOnce(spec, true), withBase: !!spec.vworldKey.trim() }
  } catch {
    return { dataUrl: await renderOnce(spec, false), withBase: false }
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',')
  const mime = head.match(/data:([^;]+)/)?.[1] ?? 'image/png'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}
