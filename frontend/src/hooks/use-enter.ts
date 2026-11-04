"use client"

import { usePathname } from "next/navigation"
import type * as React from "react"
import { useFirstView } from "./use-first-view"

/**
 * The staggered spring entrance for a landing card, played once per screen per page load. Spread the result on the
 * element: `<article {...useEnter("kpi-calls", 0)}>`. Siblings pass their position so they arrive 50ms apart. After
 * the first view it returns nothing, so a filter change never replays it; under reduced motion the stylesheet turns
 * the spring into a plain fade.
 */
export function useEnter(id: string, index = 0): { className?: string; style?: React.CSSProperties } {
  const screen = usePathname()
  const first = useFirstView(`enter:${screen}:${id}`)
  return first ? { className: "spring-in", style: { "--i": index } as React.CSSProperties } : {}
}
