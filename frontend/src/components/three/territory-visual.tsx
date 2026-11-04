"use client"

import { Box, Grid2x2, Lock, RotateCcw } from "lucide-react"
import dynamic from "next/dynamic"
import * as React from "react"
import { BlockSkeleton } from "@/components/state/states"
import { Button } from "@/components/ui/button"
import { useDocumentTheme } from "@/hooks/use-document-theme"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import type { TerritoryActivity } from "@/lib/data/types"
import { log } from "@/lib/log/logger"
import { cn } from "@/lib/utils"
import { readSceneColors, type SceneColors } from "./scene-colors"
import { TerritoryGrid2D } from "./territory-grid-2d"
import type { SceneControl } from "./territory-scene"

const TerritoryScene = dynamic(() => import("./territory-scene"), {
  ssr: false,
  loading: () => <BlockSkeleton className="h-full w-full" />,
})

let webglCache: boolean | undefined
function detectWebGL(): boolean {
  if (webglCache !== undefined) return webglCache
  try {
    const canvas = document.createElement("canvas")
    webglCache = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"))
  } catch {
    webglCache = false
  }
  return webglCache
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

const LEGEND = [
  { key: "calls", label: "Distinct calls", cls: "bg-chart-1" },
  { key: "hcps", label: "Engaged HCPs", cls: "bg-chart-2" },
  { key: "responses", label: "Responses", cls: "bg-chart-3" },
] as const

function Metric({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn("size-3 rounded-sm", cls)} aria-hidden />
      <div className="flex flex-col leading-tight">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-lg font-semibold tabular-nums">{value.toLocaleString("en-US")}</span>
      </div>
    </div>
  )
}

export function TerritoryVisual({ items, className }: { items: TerritoryActivity[]; className?: string }) {
  const reducedMotion = useReducedMotion()
  const theme = useDocumentTheme()

  // null on the server and during hydration; a boolean on the client (WebGL availability is fixed per page).
  const webgl = React.useSyncExternalStore(
    () => () => {},
    detectWebGL,
    () => null,
  )
  const [sceneFailed, setSceneFailed] = React.useState(false)
  const [preferred, setPreferred] = React.useState<"3d" | "2d">("3d")
  const [visible, setVisible] = React.useState(true)
  const stageRef = React.useRef<HTMLDivElement>(null)
  const control = React.useRef<SceneControl>({ rotation: 0 })
  const drag = React.useRef<{ x: number; start: number } | null>(null)

  const inScope = items.filter((t) => t.inScope)
  const lockedCount = items.length - inScope.length
  const defaultId = (inScope.find((t) => t.isOwn) ?? inScope[0])?.territoryId ?? null
  // The user's pick wins while it is still valid for the current data; otherwise the default applies.
  const [picked, setSelectedId] = React.useState<string | null>(null)
  const selectedId = inScope.some((t) => t.territoryId === picked) ? picked : defaultId
  const selected = items.find((t) => t.territoryId === selectedId && t.inScope) ?? null

  const use3d = preferred === "3d" && webgl === true && !sceneFailed
  const renderer = use3d ? "3d" : "2d"

  React.useEffect(() => {
    if (webgl !== null) log.info("territory visual ready", { renderer, webgl: webgl === true, reduced_motion: reducedMotion })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webgl, renderer])
  // Tokens are re-read whenever the applied theme class changes.
  const colors = React.useMemo<SceneColors | null>(() => (use3d ? readSceneColors(theme) : null), [use3d, theme])
  React.useEffect(() => {
    const el = stageRef.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 })
    io.observe(el)
    return () => io.disconnect()
  }, [use3d])

  const rotateBy = (delta: number) => {
    control.current.rotation += delta
    control.current.invalidate?.()
  }

  const allZero = inScope.every((t) => t.distinctCalls === 0 && t.distinctEngagedHcps === 0 && t.responseCount === 0)

  return (
    <section
      aria-label="Territory map"
      data-testid="territory-visual"
      data-renderer={renderer}
      className={cn("overflow-hidden rounded-2xl border bg-card shadow-card", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Territory map</h3>
          <p className="text-xs text-muted-foreground">Schematic, not to scale. Column height shows relative volume.</p>
        </div>
        <div className="flex items-center gap-1.5">
          {use3d && (
            <Button variant="ghost" size="icon" aria-label="Reset rotation" onClick={() => { control.current.rotation = 0; control.current.invalidate?.() }}>
              <RotateCcw aria-hidden />
            </Button>
          )}
          <div role="group" aria-label="View" className="flex rounded-xl border p-0.5">
            <Button
              variant={preferred === "3d" ? "default" : "ghost"}
              size="sm"
              disabled={webgl === false}
              aria-pressed={preferred === "3d"}
              data-testid="view-3d"
              onClick={() => setPreferred("3d")}
              className="min-w-14"
            >
              <Box aria-hidden /> 3D
            </Button>
            <Button
              variant={preferred === "2d" || !use3d ? "default" : "ghost"}
              size="sm"
              aria-pressed={preferred === "2d" || !use3d}
              data-testid="view-2d"
              onClick={() => setPreferred("2d")}
              className="min-w-14"
            >
              <Grid2x2 aria-hidden /> 2D
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="relative min-h-[18rem] bg-hero-glow p-2 sm:min-h-[22rem]">
          {use3d ? (
            <div
              ref={stageRef}
              data-testid="territory-3d"
              role="application"
              aria-label="Interactive 3D territory map. Drag sideways or use the arrow keys to rotate. A list of territories follows."
              tabIndex={0}
              className="h-[18rem] w-full cursor-grab touch-pan-y outline-offset-2 select-none active:cursor-grabbing sm:h-[22rem]"
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") { e.preventDefault(); rotateBy(-0.2) }
                if (e.key === "ArrowRight") { e.preventDefault(); rotateBy(0.2) }
              }}
              onPointerDown={(e) => {
                drag.current = { x: e.clientX, start: control.current.rotation }
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                if (!drag.current) return
                control.current.rotation = drag.current.start + (e.clientX - drag.current.x) * 0.008
                control.current.invalidate?.()
              }}
              onPointerUp={() => { drag.current = null }}
              onPointerCancel={() => { drag.current = null }}
            >
              {colors && (
                <SceneBoundary onError={() => { setSceneFailed(true); log.warn("3d scene failed", { renderer: "3d", status: "error" }) }}>
                  <TerritoryScene
                    items={items}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    colors={colors}
                    controlRef={control}
                    reducedMotion={reducedMotion}
                    visible={visible}
                  />
                </SceneBoundary>
              )}
            </div>
          ) : webgl === null ? (
            <BlockSkeleton className="h-[18rem] w-full sm:h-[22rem]" />
          ) : (
            <TerritoryGrid2D items={items} selectedId={selectedId} onSelect={setSelectedId} />
          )}
          {allZero && (
            <p className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-background/90 px-3 py-1 text-xs font-medium shadow-card">
              No activity in this range
            </p>
          )}
        </div>

        <div className="flex flex-col gap-4 border-t p-4 lg:border-t-0 lg:border-l" data-testid="territory-detail">
          {selected ? (
            <>
              <div>
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{selected.regionName}</p>
                <p className="text-lg font-semibold tracking-tight">
                  {selected.name} <span className="font-mono text-xs font-normal text-muted-foreground">{selected.territoryId}</span>
                </p>
              </div>
              <Metric label={LEGEND[0].label} value={selected.distinctCalls} cls={LEGEND[0].cls} />
              <Metric label={LEGEND[1].label} value={selected.distinctEngagedHcps} cls={LEGEND[1].cls} />
              <Metric label={LEGEND[2].label} value={selected.responseCount} cls={LEGEND[2].cls} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No territory in your scope.</p>
          )}
          {inScope.length > 1 && (
            <div className="scroll-snap-x -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible">
              {inScope.map((t) => (
                <button
                  key={t.territoryId}
                  type="button"
                  aria-pressed={t.territoryId === selectedId}
                  onClick={() => setSelectedId(t.territoryId)}
                  className={cn(
                    "snap-item min-h-11 shrink-0 rounded-xl border px-3 text-sm font-medium",
                    t.territoryId === selectedId ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted",
                  )}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <div className="mt-auto flex flex-col gap-2 border-t pt-3 text-xs text-muted-foreground">
            {lockedCount > 0 && (
              <p className="flex items-center gap-1.5">
                <Lock className="size-3.5 shrink-0" aria-hidden />
                {lockedCount} {lockedCount === 1 ? "territory is" : "territories are"} outside your scope and show no data.
              </p>
            )}
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {LEGEND.map((l) => (
                <li key={l.key} className="flex items-center gap-1.5">
                  <span className={cn("size-2.5 rounded-sm", l.cls)} aria-hidden /> {l.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
