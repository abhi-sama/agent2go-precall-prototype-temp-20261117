"use client"

import * as React from "react"
import { tokenMs } from "@/lib/motion"

/**
 * Opens and closes a block to its real height without measuring it: the `.expand` primitive animates
 * `grid-template-rows` from 0fr to 1fr with a fade (200ms, `--ease-out`). The content mounts when it opens and
 * unmounts once the close has finished, so closed rows cost nothing and the exit mirrors the entrance. Under
 * reduced motion only the fade runs. Retargets cleanly if toggled again mid-way.
 */
export function Expand({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(open)
  if (open && !mounted) setMounted(true)
  React.useEffect(() => {
    if (open || !mounted) return
    const timer = setTimeout(() => setMounted(false), tokenMs("--duration-base", 200))
    return () => clearTimeout(timer)
  }, [open, mounted])
  if (!mounted) return null
  return (
    <div className="expand" data-open={open}>
      <div>{children}</div>
    </div>
  )
}
