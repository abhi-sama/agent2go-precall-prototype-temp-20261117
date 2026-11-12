"use client"

import * as React from "react"
import { tokenMs } from "@/lib/motion"

/**
 * Astryx `Drawer` always renders its `<dialog>` (hidden while closed) and keeps the children it is given. Chat panels
 * hold a whole conversation, a record query or a chart, so they are only mounted while open and for the length of the
 * slide-out afterwards (`--duration-medium`, 410ms in the bundled themes), so the panel never empties while it leaves.
 */
export function useKeepMounted(open: boolean): boolean {
  const [kept, setKept] = React.useState(open)
  if (open && !kept) setKept(true)
  React.useEffect(() => {
    if (open || !kept) return
    const timer = setTimeout(() => setKept(false), tokenMs("--duration-medium", 410) + 90)
    return () => clearTimeout(timer)
  }, [open, kept])
  return open || kept
}
