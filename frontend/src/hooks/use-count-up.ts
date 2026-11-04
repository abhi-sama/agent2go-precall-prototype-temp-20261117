"use client"

import * as React from "react"
import { useReducedMotion } from "./use-reduced-motion"

/** Eases a number toward `target`; shows the target immediately under reduced motion. */
export function useCountUp(target: number, durationMs = 700): number {
  const reduced = useReducedMotion()
  const [value, setValue] = React.useState(0)
  const fromRef = React.useRef(0)

  React.useEffect(() => {
    if (reduced) return
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
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs, reduced])

  return reduced ? target : value
}
