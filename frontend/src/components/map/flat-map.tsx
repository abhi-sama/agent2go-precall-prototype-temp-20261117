"use client"

import type { EChartsOption, ECharts } from "echarts"
import type { FeatureCollection, Geometry } from "geojson"
import * as React from "react"
import { canvasFontFamily } from "@/lib/css-color"
import { cn } from "@/lib/utils"
import type { MapColors } from "./map-colors"

export interface FlatRegion {
  /** Matches a shape's `properties.name`. */
  name: string
  /** Fill. Absent means the region carries no data and stays the neutral land colour. */
  color?: string
  /** Short label drawn on the region (state code, country code). */
  label?: string
  tooltip?: string
  selected?: boolean
}

export interface FlatMarker {
  id: string
  name: string
  lon: number
  lat: number
  color: string
  selected: boolean
  tooltip: string
}

export interface FlatMapProps {
  /** Registered once per key; reuse the key for the same shapes. */
  mapKey: string
  shapes: FeatureCollection<Geometry, { name: string }>
  regions: FlatRegion[]
  markers?: FlatMarker[]
  frame: { zoom: number; center: [number, number] } | null
  colors: MapColors
  animate: boolean
  ariaLabel: string
  className?: string
  onRegionClick: (name: string) => void
  onMarkerClick?: (id: string) => void
}

/**
 * Flat real-world map drawn with Apache ECharts' geo component from the bundled shapes. No tiles,
 * no key, no network. Regions and markers are tappable; the same actions are always available as
 * real buttons in the surrounding panel, so the canvas itself never has to be the only way in.
 */
export function FlatMap({ mapKey, shapes, regions, markers = [], frame, colors, animate, ariaLabel, className, onRegionClick, onMarkerClick }: FlatMapProps) {
  const host = React.useRef<HTMLDivElement>(null)
  const chartRef = React.useRef<ECharts | null>(null)
  const handlers = React.useRef({ onRegionClick, onMarkerClick })
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    handlers.current = { onRegionClick, onMarkerClick }
  })

  React.useEffect(() => {
    let disposed = false
    let ro: ResizeObserver | undefined
    ;(async () => {
      const echarts = await import("echarts")
      if (disposed || !host.current) return
      echarts.registerMap(mapKey, shapes as never)
      const chart = echarts.init(host.current, undefined, { renderer: "canvas" })
      chartRef.current = chart
      chart.on("click", (p) => {
        const e = p as { componentType?: string; seriesType?: string; name?: string; data?: { id?: string } }
        if (e.seriesType === "scatter" && e.data?.id) handlers.current.onMarkerClick?.(e.data.id)
        else if (e.componentType === "geo" && e.name) handlers.current.onRegionClick(e.name)
      })
      // Skip a resize that races unmount or a collapsed host: ECharts throws inside its view-coordinate update
      // (null transform) when a geo/map chart is resized at zero size or after disposal.
      const el = host.current
      ro = new ResizeObserver(() => {
        if (disposed || chart.isDisposed() || !el.clientWidth || !el.clientHeight) return
        chart.resize()
      })
      ro.observe(el)
      setReady(true)
    })()
    return () => {
      disposed = true
      ro?.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
      setReady(false)
    }
    // The chart is created once per set of shapes.
  }, [mapKey, shapes])

  const option = React.useMemo<EChartsOption>(() => {
    const byName = new Map(regions.map((r) => [r.name, r]))
    return {
      animation: animate,
      animationDuration: 450,
      backgroundColor: "transparent",
      textStyle: { color: colors.text, fontFamily: canvasFontFamily() },
      tooltip: {
        trigger: "item",
        confine: true,
        backgroundColor: colors.popover,
        borderColor: colors.border,
        textStyle: { color: colors.text },
        formatter: (p: unknown) => {
          const e = p as { componentType?: string; name?: string; data?: { tooltip?: string } }
          return e.data?.tooltip ?? byName.get(e.name ?? "")?.tooltip ?? ""
        },
      },
      geo: {
        map: mapKey,
        roam: false,
        aspectScale: 1,
        ...(frame ? { zoom: frame.zoom, center: frame.center } : {}),
        itemStyle: { areaColor: colors.land, borderColor: colors.border, borderWidth: 0.6 },
        emphasis: { disabled: false, itemStyle: { areaColor: colors.land }, label: { show: false } },
        select: { disabled: true },
        label: { show: false },
        regions: regions.map((r) => ({
          name: r.name,
          tooltip: { show: Boolean(r.tooltip) },
          itemStyle: {
            areaColor: r.color ?? colors.land,
            borderColor: r.selected ? colors.text : colors.border,
            borderWidth: r.selected ? 2 : r.color ? 1 : 0.6,
          },
          emphasis: r.color ? { itemStyle: { areaColor: r.color, borderColor: colors.text, borderWidth: 2 }, label: { show: Boolean(r.label), color: colors.text } } : { disabled: true },
          label: { show: Boolean(r.label && r.color), formatter: r.label, color: colors.text, fontSize: 11, fontWeight: 600 },
        })),
      },
      series: markers.length
        ? [
            {
              type: "scatter" as const,
              coordinateSystem: "geo" as const,
              symbolSize: 20,
              z: 5,
              label: { show: true, position: "right" as const, formatter: "{b}", color: colors.text, fontSize: 13, fontWeight: 600, textBorderColor: colors.sea, textBorderWidth: 3 },
              data: markers.map((m) => ({
                id: m.id,
                name: m.name,
                value: [m.lon, m.lat],
                tooltip: m.tooltip,
                itemStyle: { color: m.color, borderColor: m.selected ? colors.high : colors.text, borderWidth: m.selected ? 4 : 2 },
              })),
            },
          ]
        : [],
    }
  }, [regions, markers, frame, colors, animate, mapKey])

  React.useEffect(() => {
    if (ready) chartRef.current?.setOption(option, { notMerge: true })
  }, [ready, option])

  return <div ref={host} role="img" aria-label={ariaLabel} data-testid="flat-map-canvas" className={cn("size-full", className)} />
}
