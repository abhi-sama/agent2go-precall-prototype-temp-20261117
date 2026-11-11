"use client"

import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react"
import dynamic from "next/dynamic"
import * as React from "react"
import { BlockSkeleton } from "@/components/state/states"
import { useDocumentTheme, useThemeSignature } from "@/hooks/use-document-theme"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { resolveCssColor } from "@/lib/css-color"
import { IS_LOCAL_BUILD } from "@/lib/env"
import { detectWebGL } from "@/lib/webgl"
import { cn } from "@/lib/utils"
import { describeField, layoutBars, mixHex, type FieldCell } from "./bar-field-model"
import type { FieldColors, FieldControls, FieldStats } from "./bar-field-scene"

const BarFieldScene = dynamic(() => import("./bar-field-scene"), {
  ssr: false,
  loading: () => <BlockSkeleton className="size-full" />,
})

export type BarFieldUnavailable = "webgl" | "lost" | "error"

export interface BarFieldProps {
  rows: { id: string; label: string }[]
  cols: { id: string; label: string }[]
  cells: FieldCell[]
  /** The value that gets the tallest bar and the darkest colour. */
  max: number
  /** Appended to a value in the screen-reader summary, for example "%". */
  unit: string
  selected: { rowId: string; colId: string } | null
  onSelect: (rowId: string, colId: string) => void
  /** One line for a cell: shown under the chart while hovering or after a tap. */
  readout: (rowId: string, colId: string) => string
  /** The 3D view cannot run (no WebGL, context lost, error). The caller shows its 2D equivalent. */
  onUnavailable: (reason: BarFieldUnavailable) => void
  className?: string
}

class SceneBoundary extends React.Component<{ onError: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * An interactive 3D bar chart for a rows-by-columns measure (react-three-fiber, MIT; `three` OrbitControls).
 * Where it adds insight over the flat heatmap: you can turn the field to see a tall bar hidden behind another, and the
 * height makes the strongest cells obvious at a glance. It never replaces the 2D chart or table; it sits beside them.
 *
 * - Touch: one finger rotates, two fingers pinch to zoom and pan, a tap picks a bar (the nearest bar within a
 *   fingertip when the tap lands beside a slim one). The page still scrolls past the chart with the wheel or a swipe
 *   that starts outside it; zoom with Ctrl or Cmd + wheel, a pinch, or the buttons.
 * - Keyboard: arrows turn, plus and minus zoom, zero resets.
 * - Reduced motion: no bar rise, no glide after a flick, no animated button steps. The scene is still until moved.
 * - Cost: one draw call, a few hundred triangles, drawn only when something changes, 2x pixels at most.
 */
export function BarField({ rows, cols, cells, max, unit, selected, onSelect, readout, onUnavailable, className }: BarFieldProps) {
  const reducedMotion = useReducedMotion()
  const theme = useDocumentTheme()
  const themeSignature = useThemeSignature()
  const host = React.useRef<HTMLDivElement>(null)
  const controlsRef = React.useRef<FieldControls | null>(null)
  const rowLabels = React.useRef<(HTMLElement | null)[]>([])
  const colLabels = React.useRef<(HTMLElement | null)[]>([])
  const [hover, setHover] = React.useState<number | null>(null)
  const supported = React.useSyncExternalStore(
    () => () => {},
    detectWebGL,
    () => true,
  )

  const bars = React.useMemo(
    () => layoutBars(rows.map((r) => r.id), cols.map((c) => c.id), cells, max),
    [rows, cols, cells, max],
  )
  const selectedIndex = selected ? bars.findIndex((b) => b.rowId === selected.rowId && b.colId === selected.colId) : -1

  const colors = React.useMemo<FieldColors>(() => {
    void themeSignature // tokens are re-read whenever the Astryx theme or scheme changes
    const dark = theme === "dark"
    const card = resolveCssColor("--card", dark ? "#262120" : "#ffffff")
    const primary = resolveCssColor("--primary", "#ea580c")
    const ink = resolveCssColor("--foreground", dark ? "#f1ede9" : "#2a2420")
    return {
      low: mixHex(primary, card, dark ? 0.4 : 0.25),
      high: primary,
      zero: mixHex(ink, card, 0.12),
      floor: card,
      grid: resolveCssColor("--chart-grid", dark ? "#3a3430" : "#e5e0db"),
      ink,
    }
  }, [theme, themeSignature])

  const rowLabel = React.useCallback((id: string) => rows.find((r) => r.id === id)?.label ?? id, [rows])
  const colLabel = React.useCallback((id: string) => cols.find((c) => c.id === id)?.label ?? id, [cols])
  const summary = React.useMemo(() => describeField(bars, rowLabel, colLabel, unit), [bars, rowLabel, colLabel, unit])

  React.useEffect(() => {
    if (!supported) onUnavailable("webgl")
    // Once per mount: the caller decides what to show instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported])

  const onStats = React.useCallback((s: FieldStats) => {
    const el = host.current
    if (!el) return
    const d = el.dataset
    d.ready = "true"
    d.frames = String(s.frames)
    d.drawCalls = String(s.drawCalls)
    d.triangles = String(s.triangles)
    d.azimuth = String(s.azimuth)
    d.polar = String(s.polar)
    d.distance = String(s.distance)
    d.intro = s.intro
  }, [])

  const lastProbe = React.useRef("")
  const onProbe = React.useMemo(
    () =>
      IS_LOCAL_BUILD
        ? (points: { x: number; y: number; visible: boolean }[]) => {
            const json = JSON.stringify(points.map((p) => [Math.round(p.x), Math.round(p.y)]))
            if (json !== lastProbe.current && host.current) {
              lastProbe.current = json
              host.current.dataset.bars = json
            }
          }
        : undefined,
    [],
  )

  const onPick = React.useCallback(
    (index: number) => {
      const b = bars[index]
      if (b) onSelect(b.rowId, b.colId)
    },
    [bars, onSelect],
  )

  const shownIndex = hover ?? (selectedIndex >= 0 ? selectedIndex : null)
  const shown = shownIndex === null ? null : bars[shownIndex]

  if (!supported) return null

  return (
    <div className={cn("flex flex-col gap-2", className)} data-testid="bar-field-root">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id="bar-field-help" className="min-w-0 text-xs text-muted-foreground">
          Drag to rotate. Pinch, or Ctrl or ⌘ and scroll, to zoom. Tap a bar for detail.
          {reducedMotion ? " Reduced motion is on, so the view stays still until you move it." : ""}
        </p>
        <div role="group" aria-label="3D view controls" className="flex gap-1">
          {([["zoom-in", "Zoom in", ZoomIn, "+"], ["zoom-out", "Zoom out", ZoomOut, "-"], ["reset", "Reset view", RotateCcw, "0"]] as const).map(([id, label, Icon, key]) => (
            <button
              key={id}
              type="button"
              data-testid={`bar-field-${id}`}
              aria-label={label}
              title={label}
              onClick={() => controlsRef.current?.key(key)}
              className="inline-flex size-11 items-center justify-center rounded-lg border bg-card transition-[background-color,transform] duration-150 ease-out hover:bg-muted active:scale-[0.98]"
            >
              <Icon className="size-4" aria-hidden />
            </button>
          ))}
        </div>
      </div>

      <div
        ref={host}
        data-testid="bar-field"
        data-motion={reducedMotion ? "reduced" : "full"}
        data-bar-count={bars.length}
        data-selected={selectedIndex >= 0 ? `${bars[selectedIndex].rowId}|${bars[selectedIndex].colId}` : ""}
        role="group"
        aria-roledescription="3D chart"
        aria-label={summary}
        aria-describedby="bar-field-help"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.metaKey || e.ctrlKey || e.altKey) return
          if (controlsRef.current?.key(e.key)) e.preventDefault()
        }}
        className="relative h-[24rem] w-full overflow-hidden rounded-xl border bg-card outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring sm:h-[28rem] lg:h-[32rem]"
      >
        <SceneBoundary onError={() => onUnavailable("error")}>
          <BarFieldScene
            bars={bars}
            rows={rows.length}
            cols={cols.length}
            colors={colors}
            selected={selectedIndex >= 0 ? selectedIndex : null}
            reducedMotion={reducedMotion}
            rowLabels={rowLabels}
            colLabels={colLabels}
            controlsRef={controlsRef}
            onPick={onPick}
            onHover={setHover}
            onStats={onStats}
            onProbe={onProbe}
            onLost={() => onUnavailable("lost")}
          />
        </SceneBoundary>
        {/* Axis names follow the floor edges nearest the camera. Decorative: the table view is the accessible twin. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden text-xs text-foreground">
          {rows.map((r, i) => (
            <span
              key={r.id}
              ref={(el) => {
                rowLabels.current[i] = el
              }}
              data-testid="bar-field-row-label"
              style={{ visibility: "hidden" }}
              className="absolute left-0 top-0 block w-max truncate whitespace-nowrap font-medium leading-4"
            >
              {r.label}
            </span>
          ))}
          {cols.map((c, i) => (
            <span
              key={c.id}
              ref={(el) => {
                colLabels.current[i] = el
              }}
              data-testid="bar-field-col-label"
              style={{ visibility: "hidden" }}
              className="absolute left-0 top-0 block w-max whitespace-nowrap font-medium leading-4 tabular-nums"
            >
              {c.label}
            </span>
          ))}
        </div>
      </div>

      <p data-testid="bar-field-readout" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {shown ? readout(shown.rowId, shown.colId) : "Rows are themes, columns are territories. Bar height and colour are the share of the territory's free-text responses."}
      </p>
    </div>
  )
}
