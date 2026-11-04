"use client"

import * as React from "react"

/** Keys already shown since this page was loaded. Module scope, so it survives a screen remounting (a filter change, a route change). */
const seen = new Set<string>()

/**
 * True the first time a keyed element appears since the page loaded, false on every later appearance. Landing
 * entrances (staggered cards, counters) use it so they play once and never replay when a filter swaps skeletons
 * for data: people are reading those figures to decide, and a replay delays them.
 */
export function useFirstView(key: string): boolean {
  const [first] = React.useState(() => !seen.has(key))
  React.useEffect(() => {
    seen.add(key)
  }, [key])
  return first
}

/** Test seam: forget what has been shown. */
export function resetFirstViews() {
  seen.clear()
}
