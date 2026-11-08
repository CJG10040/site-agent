import { useEffect, useRef } from 'react'
import OlMap from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
import XYZ from 'ol/source/XYZ'
import VectorSource from 'ol/source/Vector'
import GeoJSON from 'ol/format/GeoJSON'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import { fromLonLat, toLonLat } from 'ol/proj'
import { defaults as defaultControls, ScaleLine } from 'ol/control'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style'
import 'ol/ol.css'
import { tileUrl, type BaseMap, type GeoFeature } from '../sources/vworld'

export interface MapFocus {
  lon: number
  lat: number
  zoom?: number
  /** 같은 위치로 다시 이동할 때도 반응하도록 매번 증가시키는 값 */
  seq: number
}

interface Props {
  vworldKey: string
  baseMap: BaseMap
  focus: MapFocus | null
  marker: { lon: number; lat: number } | null
  parcels: GeoFeature[]
  onMapClick: (lon: number, lat: number) => void
}

/** 광주·전남·전북을 함께 보는 시작 화면 */
const START = { lon: 126.95, lat: 35.45, zoom: 8 }
const ATTRIBUTION = '© 브이월드 (국토교통부)'

function readCssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export default function MapView({ vworldKey, baseMap, focus, marker, parcels, onMapClick }: Props) {
  const targetRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<OlMap | null>(null)
  const baseLayerRef = useRef<TileLayer<XYZ> | null>(null)
  const labelLayerRef = useRef<TileLayer<XYZ> | null>(null)
  const markerSourceRef = useRef<VectorSource | null>(null)
  const parcelSourceRef = useRef<VectorSource | null>(null)
  const clickRef = useRef(onMapClick)
  clickRef.current = onMapClick

  // 지도는 한 번만 만든다.
  useEffect(() => {
    if (!targetRef.current) return
    const accent = readCssVar('--accent', '#d9480f')

    const baseLayer = new TileLayer<XYZ>()
    const labelLayer = new TileLayer<XYZ>({ visible: false })
    const parcelSource = new VectorSource()
    const markerSource = new VectorSource()

    const map = new OlMap({
      target: targetRef.current,
      layers: [
        baseLayer,
        labelLayer,
        new VectorLayer({
          source: parcelSource,
          style: new Style({
            stroke: new Stroke({ color: accent, width: 2.5 }),
            fill: new Fill({ color: 'rgba(217, 72, 15, 0.14)' }),
          }),
        }),
        new VectorLayer({
          source: markerSource,
          style: new Style({
            image: new CircleStyle({
              radius: 7,
              fill: new Fill({ color: accent }),
              stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
            }),
          }),
        }),
      ],
      view: new View({
        center: fromLonLat([START.lon, START.lat]),
        zoom: START.zoom,
        minZoom: 6,
        maxZoom: 21,
      }),
      controls: defaultControls({ attributionOptions: { collapsible: true } }).extend([new ScaleLine()]),
    })

    map.on('singleclick', (evt) => {
      const [lon, lat] = toLonLat(evt.coordinate)
      clickRef.current(lon, lat)
    })

    mapRef.current = map
    baseLayerRef.current = baseLayer
    labelLayerRef.current = labelLayer
    markerSourceRef.current = markerSource
    parcelSourceRef.current = parcelSource

    return () => {
      map.setTarget(undefined)
      mapRef.current = null
    }
  }, [])

  // 배경지도: 키나 종류가 바뀌면 타일 소스를 교체
  useEffect(() => {
    const base = baseLayerRef.current
    const label = labelLayerRef.current
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

  // 위치 이동
  useEffect(() => {
    const view = mapRef.current?.getView()
    if (!view || !focus) return
    view.animate({
      center: fromLonLat([focus.lon, focus.lat]),
      zoom: focus.zoom ?? Math.max(view.getZoom() ?? 0, 17),
      duration: 450,
    })
  }, [focus])

  // 선택 지점 표시
  useEffect(() => {
    const src = markerSourceRef.current
    if (!src) return
    src.clear()
    if (marker) src.addFeature(new Feature(new Point(fromLonLat([marker.lon, marker.lat]))))
  }, [marker])

  // 필지 경계 표시
  useEffect(() => {
    const src = parcelSourceRef.current
    if (!src) return
    src.clear()
    const withGeometry = parcels.filter((f) => f.geometry)
    if (withGeometry.length === 0) return
    const features = new GeoJSON().readFeatures(
      { type: 'FeatureCollection', features: withGeometry },
      { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' },
    )
    src.addFeatures(features)
  }, [parcels])

  return (
    <div className="map-wrap">
      <div ref={targetRef} className="map" role="application" aria-label="대지 지도" />
      {!vworldKey.trim() && (
        <div className="map-empty">
          <p>브이월드 인증키를 입력하면 지도가 표시됩니다.</p>
        </div>
      )}
    </div>
  )
}
