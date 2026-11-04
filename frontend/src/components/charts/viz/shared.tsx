"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export const fmt = (n: number): string => n.toLocaleString("en-US")

/** The value-first readout above a chart: what the pointer, tap or keyboard focus is on. Always in the DOM so screen readers hear it. */
export function Readout({ children, testId = "viz-readout", idle }: { children?: React.ReactNode; testId?: string; idle: string }) {
  return (
    <p data-testid={testId} aria-live="polite" className={cn("min-h-6 text-sm tabular-nums", children ? "text-foreground" : "text-muted-foreground")}>
      {children ?? idle}
    </p>
  )
}

/** Round the axis maximum up to 1, 2 or 5 times a power of ten and return 4 even steps. */
export function niceScale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] }
  const raw = max / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw
  return { top: step * 4, ticks: [0, 1, 2, 3, 4].map((i) => i * step) }
}

/** Width of an element, kept current as the container resizes (viewport changes, sheet expand). */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T>(null)
  const [width, setWidth] = React.useState(0)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** Position of an item in a list, as a CSS custom property that staggers entrance animation (capped so long lists stay quick). */
export const stagger = (i: number, stepMs = 28, capMs = 280): React.CSSProperties => ({ ["--viz-delay" as string]: `${Math.min(i * stepMs, capMs)}ms` })
