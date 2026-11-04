"use client"

import * as React from "react"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { cn } from "@/lib/utils"

/**
 * Light 3D parallax for a landing or empty-state scene (expressive tier, ticket #56).
 *
 * Only decorative layers move: the stage tilts a couple of degrees toward the pointer and each layer drifts by its
 * own depth. The content passed as `children` never moves, so nothing anyone reads or taps shifts under them.
 * It runs for a fine pointer only (mouse, trackpad, pen), not on touch, and not at all under reduced motion.
 * Movement is written straight to each layer's `transform` from one rAF per frame, never through a CSS variable on
 * the parent, so it costs one style write per layer and no layout. Leaving springs the layers back.
 */
export function ParallaxScene({
  as: Tag = "div",
  layers,
  children,
  className,
  stageClassName,
  ...rest
}: Omit<React.HTMLAttributes<HTMLElement>, "children"> & {
  as?: "div" | "header" | "section"

  /** Decorative `ParallaxLayer`s, painted behind `children`. */
  layers: React.ReactNode
  children: React.ReactNode
  className?: string
  stageClassName?: string
}) {
  const reduced = useReducedMotion()
  const root = React.useRef<HTMLDivElement>(null)
  const stage = React.useRef<HTMLDivElement>(null)
  const frame = React.useRef(0)
  const enabled = React.useRef(false)

  React.useEffect(() => {
    enabled.current = !reduced && window.matchMedia("(hover: hover) and (pointer: fine)").matches
  }, [reduced])

  const settle = React.useCallback(() => {
    cancelAnimationFrame(frame.current)
    const el = stage.current
    if (!el) return
    el.dataset.active = "false"
    el.style.transform = ""
    for (const layer of el.querySelectorAll<HTMLElement>("[data-depth]")) {
      layer.dataset.active = "false"
      layer.style.transform = ""
    }
  }, [])

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled.current || event.pointerType === "touch") return
    const box = root.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return
    const nx = Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width) * 2 - 1))
    const ny = Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height) * 2 - 1))
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const el = stage.current
      if (!el) return
      // Tilt and drift read their size from the motion tokens, so a style can retune the depth without code.
      el.dataset.active = "true"
      el.style.transform = `perspective(var(--parallax-perspective)) rotateX(calc(${-ny} * var(--parallax-tilt))) rotateY(calc(${nx} * var(--parallax-tilt)))`
      for (const layer of el.querySelectorAll<HTMLElement>("[data-depth]")) {
        const depth = Number(layer.dataset.depth)
        layer.dataset.active = "true"
        layer.style.transform = `translate3d(calc(${nx * depth} * var(--parallax-depth)), calc(${ny * depth} * var(--parallax-depth)), 0)`
      }
    })
  }

  React.useEffect(() => () => cancelAnimationFrame(frame.current), [])

  return (
    <Tag ref={root as React.Ref<HTMLDivElement>} className={cn("relative isolate", className)} {...rest} onPointerMove={onPointerMove} onPointerLeave={settle} onPointerCancel={settle}>
      {/* The layers deliberately bleed past their own box and are clipped by the stage. */}
      <div ref={stage} aria-hidden data-layout-ok="clip overlap" data-testid="parallax-stage" className={cn("parallax-layer pointer-events-none absolute inset-0 -z-10 overflow-hidden", stageClassName)}>
        {layers}
      </div>
      {children}
    </Tag>
  )
}

/** One decorative layer. `depth` is how far it drifts (about -1.5 to 1.5; negative drifts the other way). */
export function ParallaxLayer({ depth, className, style }: { depth: number; className?: string; style?: React.CSSProperties }) {
  return <div data-depth={depth} className={cn("parallax-layer absolute", className)} style={style} />
}

/**
 * The standard backdrop: a soft accent glow far back, a dotted field in the middle, two tinted orbs in front.
 * Colours are tokens (`--primary`, `--teal`, `--foreground`), so both styles and all three modes retint it.
 */
export function SceneLayers({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <ParallaxLayer
        depth={0.4}
        className="-inset-6"
        style={{ background: "radial-gradient(40rem 14rem at 80% 0%, color-mix(in oklch, var(--primary) 13%, transparent), transparent 65%), radial-gradient(28rem 12rem at 0% 20%, color-mix(in oklch, var(--teal) 9%, transparent), transparent 65%)" }}
      />
      <ParallaxLayer
        depth={0.8}
        className="-inset-4 surface-dots opacity-60 [mask-image:radial-gradient(60%_80%_at_75%_30%,black,transparent)]"
      />
      <ParallaxLayer
        depth={1.4}
        className={cn("rounded-full", compact ? "-top-4 right-6 size-14" : "-top-6 right-10 size-24")}
        style={{ background: "radial-gradient(circle at 30% 30%, color-mix(in oklch, var(--primary) 26%, transparent), color-mix(in oklch, var(--primary) 6%, transparent) 70%)" }}
      />
      <ParallaxLayer
        depth={-1}
        className={cn("rounded-full", compact ? "bottom-0 right-24 size-8" : "bottom-1 right-36 size-12")}
        style={{ background: "radial-gradient(circle at 30% 30%, color-mix(in oklch, var(--teal) 24%, transparent), color-mix(in oklch, var(--teal) 5%, transparent) 70%)" }}
      />
    </>
  )
}
