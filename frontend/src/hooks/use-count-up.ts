"use client"

import * as React from "react"
import { useReducedMotion } from "./use-reduced-motion"

/**
 * Counts a figure up once, when it first appears. Later changes (a new filter or date range) snap to
 * the new value: people are reading it to decide, and a figure that keeps moving gets in the way.
 * Shows the target immediately under reduced motion.
 */
export function useCountUp(target: number, durationMs = 400): number {
  const reduced = useReducedMotion()
  const [value, setValue] = React.useState(0)
  const fromRef = React.useRef(0)
  const hasCounted = React.useRef(false)

  React.useEffect(() => {
    if (reduced) return
    if (hasCounted.current) {
      fromRef.current = target
      setValue(target)
      return
    }
    const from = fromRef.current
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      const next = Math.round(from + (target - from) * eased)
      fromRef.current = next
      setValue(next)
      if (t < 1) raf = requestAnimationFrame(tick)
      else if (target > 0) hasCounted.current = true
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs, reduced])

  return reduced ? target : value
}
