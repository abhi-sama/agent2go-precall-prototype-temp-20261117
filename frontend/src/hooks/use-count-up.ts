"use client"

import * as React from "react"
import { useFirstView } from "./use-first-view"
import { useReducedMotion } from "./use-reduced-motion"

/**
 * Counts a figure up once, when it first appears. Later changes (a new filter or date range) and later
 * appearances (the card remounting after a skeleton) snap to the value: people are reading it to decide, and a
 * figure that keeps moving gets in the way. Pass `key` to share the once-only memory across remounts of the same
 * figure. Shows the target immediately under reduced motion.
 */
export function useCountUp(target: number, durationMs = 400, key?: string): number {
  const reduced = useReducedMotion()
  const firstView = useFirstView(`count:${key ?? "anonymous"}`)
  const animate = !reduced && (key === undefined || firstView)
  const [value, setValue] = React.useState(0)
  const fromRef = React.useRef(0)
  const hasCounted = React.useRef(false)

  React.useEffect(() => {
    if (!animate) return
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
  }, [target, durationMs, animate])

  return animate ? value : target
}
