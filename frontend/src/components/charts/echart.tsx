"use client"

import type { EChartsOption, ECharts } from "echarts"
import * as React from "react"
import { useDocumentTheme } from "@/hooks/use-document-theme"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { canvasFontFamily, resolveCssColor } from "@/lib/css-color"
import { CHART_ANIMATION_MS } from "./palette"
import { cn } from "@/lib/utils"

const TOKENS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6"] as const
const FALLBACK = ["#f54900", "#2a78d6", "#1baf7a", "#6250d6", "#e87ba4", "#eda100"]

export interface EChartProps {
  option: EChartsOption
  /** Plain-language description for screen readers; charts are not otherwise accessible. */
  ariaLabel: string
  className?: string
  height?: number | string
  onReady?: (chart: ECharts) => void
}

/**
 * Apache ECharts wrapper for later tickets (heatmaps, sankey, radar and other charts Recharts lacks).
 * Loads ECharts lazily, themes from the design tokens (re-reads on light/dark change), resizes with
 * its container and turns animation off for reduced motion. Pass only an `option`; never raw HTML.
 */
export function EChart({ option, ariaLabel, className, height = 280, onReady }: EChartProps) {
  const host = React.useRef<HTMLDivElement>(null)
  const chartRef = React.useRef<ECharts | null>(null)
  const docTheme = useDocumentTheme()
  const reduced = useReducedMotion()
  const [ready, setReady] = React.useState(false)

  const themed = React.useMemo<EChartsOption>(() => {
    const text = resolveCssColor("--foreground", docTheme === "dark" ? "#f1ede9" : "#2a2420")
    const muted = resolveCssColor("--muted-foreground", "#7a716a")
    const line = resolveCssColor("--chart-grid", "#e5e0db")
    return {
      color: TOKENS.map((t, i) => resolveCssColor(t, FALLBACK[i])),
      textStyle: { color: text, fontFamily: canvasFontFamily() },
      animation: !reduced,
      animationDuration: CHART_ANIMATION_MS,
      animationEasing: "cubicOut",
      backgroundColor: "transparent",
      grid: { left: 8, right: 12, top: 24, bottom: 8, containLabel: true },
      xAxis: { axisLine: { lineStyle: { color: line } }, axisLabel: { color: muted }, splitLine: { lineStyle: { color: line } } },
      yAxis: { axisLine: { lineStyle: { color: line } }, axisLabel: { color: muted }, splitLine: { lineStyle: { color: line } } },
      tooltip: { backgroundColor: resolveCssColor("--popover", "#fff"), borderColor: line, textStyle: { color: text } },
      legend: { textStyle: { color: muted } },
      ...option,
    }
    // Theme and motion are the invalidation keys; `option` identity is the caller's.
  }, [option, docTheme, reduced])

  React.useEffect(() => {
    let disposed = false
    let ro: ResizeObserver | undefined
    ;(async () => {
      const echarts = await import("echarts")
      if (disposed || !host.current) return
      const chart = echarts.init(host.current, undefined, { renderer: "canvas" })
      chartRef.current = chart
      // Skip a resize that races unmount or a collapsed host: ECharts throws inside its view-coordinate update
      // (null transform) when a geo/map chart is resized at zero size or after disposal.
      const el = host.current
      ro = new ResizeObserver(() => {
        if (disposed || chart.isDisposed() || !el.clientWidth || !el.clientHeight) return
        chart.resize()
      })
      ro.observe(el)
      setReady(true)
      onReady?.(chart)
    })()
    return () => {
      disposed = true
      ro?.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
      setReady(false)
    }
    // onReady is intentionally not a dependency: the chart is created once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    if (ready) chartRef.current?.setOption(themed, { notMerge: true })
  }, [ready, themed])

  return <div ref={host} role="img" aria-label={ariaLabel} data-testid="echart" className={cn("w-full", className)} style={{ height }} />
}
