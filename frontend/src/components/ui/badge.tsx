import { Badge as AstryxBadge } from "@astryxdesign/core/Badge"
import type * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Compatibility adapter: the shadcn-era `<Badge>` API rendered by the Astryx Badge, so badges follow the active theme.
 * New code uses `Badge` from `@astryxdesign/core/Badge` with its own `variant` and `label` (see docs/astryx-migration.md).
 * Mapping: destructive -> error, every other variant -> neutral (the themed info fill is under 4.5:1 for body text in
 * some themes, and the legacy default badge carried no meaning of its own).
 */
export type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "ghost" | "link"
type AstryxBadgeVariant = "neutral" | "error"

const VARIANT: Record<BadgeVariant, AstryxBadgeVariant> = {
  default: "neutral",
  secondary: "neutral",
  destructive: "error",
  outline: "neutral",
  ghost: "neutral",
  link: "neutral",
}

export interface BadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> {
  variant?: BadgeVariant | null
  ref?: React.Ref<HTMLSpanElement>
}

function Badge({ variant, children, className, ...rest }: BadgeProps) {
  return (
    <AstryxBadge
      {...rest}
      variant={VARIANT[variant ?? "default"]}
      // Icons inside a legacy badge keep the small badge size.
      className={cn("[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3", className)}
      label={children}
    />
  )
}

export { Badge }
