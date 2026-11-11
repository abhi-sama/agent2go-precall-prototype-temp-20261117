import { Skeleton as AstryxSkeleton } from "@astryxdesign/core/Skeleton"
import type * as React from "react"

/**
 * Compatibility adapter over the Astryx Skeleton (theme-aware pulse, reduced-motion safe). Size it with className
 * utilities as before; they win over the Skeleton's default 100% box. New code uses `Skeleton` from
 * `@astryxdesign/core/Skeleton` with `width` / `height` (see docs/astryx-migration.md).
 */
function Skeleton({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <AstryxSkeleton {...rest} className={className} />
}

export { Skeleton }
