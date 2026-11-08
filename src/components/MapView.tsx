import { useEffect, useRef, type ReactNode } from 'react'
import OlMap from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
import XYZ from 'ol/source/XYZ'
import TileWMS from 'ol/source/TileWMS'
import VectorSource from 'ol/source/Vector'
import GeoJSON from 'ol/format/GeoJSON'
import Feature, { type FeatureLike } from 'ol/Feature'
import Point from 'ol/geom/Point'
import Draw from 'ol/interaction/Draw'
import Modify from 'ol/interaction/Modify'
import { fromLonLat, toLonLat } from 'ol/proj'
import { defaults as defaultControls, ScaleLine } from 'ol/control'
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style'
import type { Geometry as OlGeometry } from 'ol/geom'
import 'ol/ol.css'
import type { Geometry, Polygon } from 'geojson'
import { tileUrl, WMS_URL, type BaseMap, type GeoFeature } from '../sources/vworld'
import { densityClass, floorClass } from './mapStyles'

export interface MapFocus {
  lon: number
  lat: number
  zoom?: number
  /** 같은 위치로 다시 이동할 때도 반응하도록 매번 바꾸는 값 */
  seq: number
}

export interface MapFit {
  geometry: Geometry
  seq: number
}

export interface MapData {
  boundary?: Geometry | null
  radius?: Geometry | null
  parcels?: GeoFeature[]
  buildings?: GeoFeature[]
  roads?: GeoFeature[]
  statsAreas?: GeoFeature[]
  sun?: GeoFeature[]
  marker?: [number, number] | null
}

export type MapMode = 'click' | 'draw' | 'modify'

interface Props {
  vworldKey: string
  vworldDomain: string
  baseMap: BaseMap
  wms: string[]
  data: MapData
  focus?: MapFocus | null
  fit?: MapFit | null
  mode?: MapMode
  editable?: Polygon | null
  onMapClick?: (lon: number, lat: number) => void
  onDrawEnd?: (polygon: Polygon) => void
  onModifyEnd?: (polygon: Polygon) => void
  children?: ReactNode
}

const START = { lon: 126.95, lat: 35.45, zoom: 8 }
const ATTRIBUTION = '© 브이월드 (국토교통부)'
const FORMAT = new GeoJSON()
const PROJ = { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function toOlFeatures(features: GeoFeature[]): Feature<OlGeometry>[] {
  const withGeom = features.filter((f) => f.geometry)
  if (withGeom.length === 0) return []
  return FORMAT.readFeatures({ type: 'FeatureCollection', features: withGeom }, PROJ) as Feature<OlGeometry>[]
}

function toOlGeometry(g: Geometry): OlGeometry {
  return FORMAT.readGeometry(g, PROJ) as OlGeometry
}

function toPolygon(g: OlGeometry): Polygon {
  return FORMAT.writeGeometryObject(g, PROJ) as Polygon
}

const SUN_COLORS: Record<string, string> = { summer: '#e8590c', equinox: '#e0a100', winter: '#1c7ed6' }

export default function MapView({
  vworldKey,
  vworldDomain,
  baseMap,
  wms,
  data,
  focus,
  fit,
  mode = 'click',
  editable,
  onMapClick,
  onDrawEnd,
  onModifyEnd,
  children,
}: Props) {
  const targetRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<OlMap | null>(null)
  const baseRef = useRef<TileLayer<XYZ> | null>(null)
  const labelRef = useRef<TileLayer<XYZ> | null>(null)
  const wmsRefs = useRef(new Map<string, TileLayer<TileWMS>>())
  const sources = useRef<Record<string, VectorSource>>({})
  const editSourceRef = useRef<VectorSource | null>(null)
  const handlers = useRef({ onMapClick, onDrawEnd, onModifyEnd, mode })
  handlers.current = { onMapClick, onDrawEnd, onModifyEnd, mode }

  // ── 지도 생성 (한 번)
  useEffect(() => {
    if (!targetRef.current) return
    const accent = cssVar('--accent', '#d9480f')

    const make = (style: Style | ((f: FeatureLike) => Style | Style[]), zIndex: number) => {
      const source = new VectorSource()
      const layer = new VectorLayer({ source, style, zIndex })
      return { source, layer }
    }

    const buildingStyles = new Map<string, Style>()
    const buildings = make((f) => {
      const cls = floorClass(Number(f.get('grnd_flr')))
      let s = buildingStyles.get(cls.id)
      if (!s) {
        s = new Style({ fill: new Fill({ color: cls.color }), stroke: new Stroke({ color: 'rgba(40,40,60,0.35)', width: 0.6 }) })
        buildingStyles.set(cls.id, s)
      }
      return s
    }, 20)
    const densityStyles = new Map<string, Style>()
    const statsAreas = make((f) => {
      const cls = densityClass(f.get('ppltn_dnsty') as number | null)
      let s = densityStyles.get(cls.id)
      if (!s) {
        s = new Style({
          fill: new Fill({ color: `${cls.color}b3` }),
          stroke: new Stroke({ color: 'rgba(70,40,120,0.55)', width: 1 }),
        })
        densityStyles.set(cls.id, s)
      }
      return s
    }, 15)
    const roads = make(new Style({ stroke: new Stroke({ color: 'rgba(60,64,70,0.75)', width: 2.5 }) }), 25)
    const radius = make(
      new Style({ stroke: new Stroke({ color: 'rgba(80,76,68,0.9)', width: 1.5, lineDash: [8, 6] }) }),
      30,
    )
    const parcels = make(
      new Style({
        stroke: new Stroke({ color: accent, width: 1.5, lineDash: [5, 4] }),
        fill: new Fill({ color: 'rgba(217, 72, 15, 0.10)' }),
      }),
      40,
    )
    const boundary = make(
      new Style({ stroke: new Stroke({ color: accent, width: 3 }), fill: new Fill({ color: 'rgba(217, 72, 15, 0.12)' }) }),
      45,
    )
    const sun = make((f) => {
      const kind = f.get('kind')
      const color = SUN_COLORS[f.get('day') as string] ?? '#868e96'
      if (kind === 'sunring') {
        return new Style({ stroke: new Stroke({ color: 'rgba(120,120,120,0.55)', width: 1, lineDash: [3, 5] }) })
      }
      if (kind === 'sunpath') return new Style({ stroke: new Stroke({ color, width: 2.5 }) })
      const label = f.get('label') as string
      return new Style({
        image: new CircleStyle({ radius: 3.5, fill: new Fill({ color }), stroke: new Stroke({ color: '#fff', width: 1 }) }),
        text: label
          ? new Text({
              text: label,
              offsetY: -11,
              font: '600 11px Pretendard, sans-serif',
              fill: new Fill({ color }),
              stroke: new Stroke({ color: '#fff', width: 3 }),
            })
          : undefined,
      })
    }, 50)
    const marker = make(
      new Style({
        image: new CircleStyle({ radius: 7, fill: new Fill({ color: accent }), stroke: new Stroke({ color: '#fff', width: 2.5 }) }),
      }),
      60,
    )
    const edit = make(
      new Style({
        stroke: new Stroke({ color: accent, width: 3 }),
        fill: new Fill({ color: 'rgba(217, 72, 15, 0.12)' }),
        image: new CircleStyle({ radius: 5, fill: new Fill({ color: accent }) }),
      }),
      70,
    )

    const base = new TileLayer<XYZ>({ zIndex: 0 })
    const label = new TileLayer<XYZ>({ visible: false, zIndex: 1 })

    const map = new OlMap({
      target: targetRef.current,
      layers: [base, label, statsAreas.layer, buildings.layer, roads.layer, radius.layer, parcels.layer, boundary.layer, sun.layer, marker.layer, edit.layer],
      view: new View({ center: fromLonLat([START.lon, START.lat]), zoom: START.zoom, minZoom: 6, maxZoom: 21 }),
      controls: defaultControls({ attributionOptions: { collapsible: true } }).extend([new ScaleLine()]),
    })

    map.on('singleclick', (evt) => {
      if (handlers.current.mode !== 'click') return
      const [lon, lat] = toLonLat(evt.coordinate)
      handlers.current.onMapClick?.(lon, lat)
    })

    mapRef.current = map
    baseRef.current = base
    labelRef.current = label
    sources.current = {
      statsAreas: statsAreas.source,
      buildings: buildings.source,
      roads: roads.source,
      radius: radius.source,
      parcels: parcels.source,
      boundary: boundary.source,
      sun: sun.source,
      marker: marker.source,
    }
    editSourceRef.current = edit.source
    const wmsLayers = wmsRefs.current

    return () => {
      map.setTarget(undefined)
      mapRef.current = null
      wmsLayers.clear()
    }
  }, [])

  // ── 배경지도
  useEffect(() => {
    const base = baseRef.current
    const label = labelRef.current
    if (!base || !label) return
    if (!vworldKey.trim()) {
      base.setSource(null)
      label.setSource(null)
      label.setVisible(false)
      return
    }
    base.setSource(new XYZ({ url: tileUrl(vworldKey, baseMap), maxZoom: 19, attributions: ATTRIBUTION }))
    if (baseMap === 'Satellite') {
      label.setSource(new XYZ({ url: tileUrl(vworldKey, 'Hybrid'), maxZoom: 19 }))
      label.setVisible(true)
    } else {
      label.setSource(null)
      label.setVisible(false)
    }
  }, [vworldKey, baseMap])

  // ── 주제도 (WMS)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const current = wmsRefs.current
    const wanted = vworldKey.trim() ? wms : []
    for (const [id, layer] of current) {
      if (!wanted.includes(id)) {
        map.removeLayer(layer)
        current.delete(id)
      }
    }
    wanted.forEach((id, i) => {
      if (current.has(id)) return
      const layer = new TileLayer<TileWMS>({
        zIndex: 10 + i,
        minZoom: 13,
        opacity: 0.85,
        source: new TileWMS({
          url: WMS_URL,
          params: {
            LAYERS: id,
            STYLES: id,
            FORMAT: 'image/png',
            TRANSPARENT: 'TRUE',
            VERSION: '1.3.0',
            KEY: vworldKey.trim(),
            DOMAIN: vworldDomain,
          },
          projection: 'EPSG:3857',
          attributions: ATTRIBUTION,
        }),
      })
      map.addLayer(layer)
      current.set(id, layer)
    })
  }, [wms, vworldKey, vworldDomain])

  // ── 벡터 자료
  useEffect(() => {
    const s = sources.current
    const setOne = (key: string, g: Geometry | null | undefined) => {
      s[key]?.clear()
      if (g) s[key]?.addFeature(new Feature(toOlGeometry(g)))
    }
    const setMany = (key: string, features: GeoFeature[] | undefined) => {
      s[key]?.clear()
      if (features?.length) s[key]?.addFeatures(toOlFeatures(features))
    }
    setOne('boundary', data.boundary)
    setOne('radius', data.radius)
    setMany('parcels', data.parcels)
    setMany('buildings', data.buildings)
    setMany('roads', data.roads)
    setMany('statsAreas', data.statsAreas)
    setMany('sun', data.sun)
    s.marker?.clear()
    if (data.marker) s.marker?.addFeature(new Feature(new Point(fromLonLat(data.marker))))
  }, [data.boundary, data.radius, data.parcels, data.buildings, data.roads, data.statsAreas, data.sun, data.marker])

  // ── 이동·맞춤
  useEffect(() => {
    const view = mapRef.current?.getView()
    if (!view || !focus) return
    view.animate({
      center: fromLonLat([focus.lon, focus.lat]),
      zoom: focus.zoom ?? Math.max(view.getZoom() ?? 0, 17),
      duration: 450,
    })
  }, [focus])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !fit) return
    const extent = toOlGeometry(fit.geometry).getExtent()
    map.getView().fit(extent, { padding: [60, 60, 60, 60], maxZoom: 19, duration: 450 })
  }, [fit])

  // ── 그리기·수정
  useEffect(() => {
    const map = mapRef.current
    const editSource = editSourceRef.current
    if (!map || !editSource) return
    editSource.clear()

    if (mode === 'draw') {
      const draw = new Draw({ source: editSource, type: 'Polygon' })
      draw.on('drawend', (evt) => {
        const g = evt.feature.getGeometry()
        if (g) handlers.current.onDrawEnd?.(toPolygon(g))
        // 결과는 상위에서 경계로 다시 그리므로 임시 도형은 지운다
        window.setTimeout(() => editSource.clear(), 0)
      })
      map.addInteraction(draw)
      return () => {
        map.removeInteraction(draw)
      }
    }

    if (mode === 'modify' && editable) {
      const feature = new Feature(toOlGeometry(editable))
      editSource.addFeature(feature)
      const modify = new Modify({ source: editSource })
      modify.on('modifyend', () => {
        const g = feature.getGeometry()
        if (g) handlers.current.onModifyEnd?.(toPolygon(g))
      })
      map.addInteraction(modify)
      return () => {
        map.removeInteraction(modify)
      }
    }
    return undefined
  }, [mode, editable])

  return (
    <div className="map-wrap">
      <div ref={targetRef} className="map" role="application" aria-label="대지 지도" />
      {!vworldKey.trim() && (
        <div className="map-empty">
          <p>브이월드 인증키를 입력하면 지도가 표시됩니다.</p>
        </div>
      )}
      {children}
    </div>
  )
}
