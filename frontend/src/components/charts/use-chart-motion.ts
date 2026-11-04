"use client"

import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { CHART_ANIMATION_MS } from "./palette"

/** Spread onto a Recharts mark: short ease-out draw-in, none under reduced motion. */
export function useChartMotion() {
  const reduced = useReducedMotion()
  return { isAnimationActive: !reduced, animationDuration: CHART_ANIMATION_MS, animationEasing: "ease-out" } as const
}
