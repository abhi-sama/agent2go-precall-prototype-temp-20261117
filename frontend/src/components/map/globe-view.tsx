"use client"

import type { Feature, Polygon, MultiPolygon } from "geojson"
import * as React from "react"
import Globe, { type GlobeMethods } from "react-globe.gl"
import { MeshPhongMaterial } from "three"
import type { MapColors } from "./map-colors"

type CountryShape = Feature<Polygon | MultiPolygon, { name: string }>

export interface GlobeCountry {
  code: string
  name: string
  color: string
  lat: number
  lng: number
  label: string
  aria: string
}

export interface GlobeViewProps {
  shapes: CountryShape[]
  countries: GlobeCountry[]
  colors: MapColors
  /** Zoom the camera onto this country (the drill-down transition). */
  focus: { lat: number; lng: number; nonce: number } | null
  onSelectCountry: (code: string) => void
  onReady?: () => void
}

/** Great-circle angle in radians between two lat/lng points given in degrees. */
function angleBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const cos =
    Math.sin(a.lat * rad) * Math.sin(b.lat * rad) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((a.lng - b.lng) * rad)
  return Math.acos(Math.min(1, Math.max(-1, cos)))
}

/**
 * Interactive 3D globe (react-globe.gl, three.js) drawn from the bundled country shapes: no
 * texture or tile download. Drag to rotate (mouse or touch). Each country with activity gets a
 * tappable marker, and its outline is tappable too.
 */
export default function GlobeView({ shapes, countries, colors, focus, onSelectCountry, onReady }: GlobeViewProps) {
  const wrap = React.useRef<HTMLDivElement>(null)
  const globe = React.useRef<GlobeMethods | undefined>(undefined)
  const [size, setSize] = React.useState({ width: 0, height: 0 })
  const select = React.useRef(onSelectCountry)
  const anchors = React.useMemo(() => new Map(countries.map((c) => [c.code, { lat: c.lat, lng: c.lng }])), [countries])
  const colorByCode = React.useMemo(() => new Map(countries.map((c) => [c.code, c.color])), [countries])

  React.useEffect(() => {
    select.current = onSelectCountry
  })

  React.useEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const handleReady = React.useCallback(() => {
    const g = globe.current
    if (!g) return
    const controls = g.controls()
    // Pinch or scroll to spread out crowded regions such as Europe; never pan off the globe.
    controls.enablePan = false
    controls.minDistance = 160
    controls.maxDistance = 520
    controls.zoomSpeed = 0.6
    // No auto-rotation: tap targets that drift are hard to hit, and the globe stays still until touched.
    onReady?.()
  }, [onReady])

  // Aim the first view at where the activity is.
  React.useEffect(() => {
    const g = globe.current
    if (!g || countries.length === 0) return
    const lat = countries.reduce((n, c) => n + c.lat, 0) / countries.length
    const lng = countries.reduce((n, c) => n + c.lng, 0) / countries.length
    g.pointOfView({ lat: Math.max(-35, Math.min(55, lat)), lng, altitude: 1.9 }, 0)
    // Only on first measure; later data changes must not yank the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width > 0])

  React.useEffect(() => {
    const g = globe.current
    if (!g || !focus) return
    g.pointOfView({ lat: focus.lat, lng: focus.lng, altitude: 0.7 }, 900)
  }, [focus])

  // The ocean: a plain coloured sphere, so no texture is ever downloaded.
  const seaMaterial = React.useMemo(() => new MeshPhongMaterial({ color: colors.sea, shininess: 6 }), [colors.sea])

  const makeMarker = React.useCallback(
    (d: object) => {
      const c = d as GlobeCountry
      const el = document.createElement("button")
      el.type = "button"
      el.dataset.testid = `globe-marker-${c.code}`
      el.dataset.code = c.code
      el.setAttribute("aria-label", c.aria)
      el.textContent = c.code
      el.className =
        "pointer-events-auto flex size-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-2 border-background bg-primary text-xs font-bold text-primary-foreground shadow-lift outline-offset-2 focus-visible:outline-2"
      el.onclick = () => select.current(c.code)
      return el
    },
    [],
  )

  return (
    <div ref={wrap} className="size-full">
      {size.width > 0 && (
        <Globe
          ref={globe}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          globeMaterial={seaMaterial}
          showAtmosphere
          atmosphereColor={colors.high}
          atmosphereAltitude={0.12}
          onGlobeReady={handleReady}
          polygonsData={shapes}
          polygonGeoJsonGeometry="geometry"
          polygonCapColor={(d) => colorByCode.get((d as CountryShape).properties.name) ?? colors.land}
          polygonSideColor={() => "rgba(0,0,0,0)"}
          polygonStrokeColor={() => colors.border}
          polygonAltitude={(d) => (colorByCode.has((d as CountryShape).properties.name) ? 0.025 : 0.006)}
          polygonsTransitionDuration={0}
          onPolygonClick={(d) => {
            const code = (d as CountryShape).properties.name
            if (colorByCode.has(code)) select.current(code)
          }}
          htmlElementsData={countries}
          htmlLat="lat"
          htmlLng="lng"
          htmlAltitude={0.06}
          htmlElement={makeMarker}
          htmlElementVisibilityModifier={(el) => {
            // Markers on the far side of the globe must not catch taps or focus. The library's own
            // far-side check can lag behind the camera, so the angle to the view centre is used.
            const a = anchors.get(el.dataset.code ?? "")
            const pov = globe.current?.pointOfView()
            const visible = !a || !pov || angleBetween(pov, a) < Math.acos(1 / (1 + pov.altitude)) * 0.92
            el.style.opacity = visible ? "1" : "0"
            el.style.pointerEvents = visible ? "auto" : "none"
            el.tabIndex = visible ? 0 : -1
            el.setAttribute("aria-hidden", visible ? "false" : "true")
          }}
        />
      )}
    </div>
  )
}
