"use client"

import type { LucideIcon } from "lucide-react"
import { usePathname } from "next/navigation"
import { useCountUp } from "@/hooks/use-count-up"
import { useEnter } from "@/hooks/use-enter"
import { cn } from "@/lib/utils"
import { seriesColor, type SeriesSlot } from "./palette"

export interface KpiTileProps {
  id: string
  label: string
  value: number
  /** One visible line saying exactly what is counted (no hover needed on touch screens). */
  definition: string
  caption?: string
  icon: LucideIcon
  /** The chart slot this measure wears everywhere else (a trend of the same measure uses the same colour). */
  series?: SeriesSlot
  /** Position among sibling tiles, for the staggered entrance (50ms apart). */
  index?: number
  className?: string
}

/**
 * Headline figure. The number and label are ink; colour only marks which measure this is, through a
 * thin top rule and the icon tile. The tile springs in and the number counts up, both once per page
 * load (so a filter change never replays them; the figures just update), and both are instant or a plain
 * fade under reduced motion. Tabular figures keep the number from jittering.
 */
export function KpiTile({ id, label, value, definition, caption, icon: Icon, series = 1, index = 0, className }: KpiTileProps) {
  // Once per screen per page load: the same tile id on another screen is a different figure.
  const screen = usePathname()
  const shown = useCountUp(value, undefined, `kpi:${screen}:${id}`)
  const enter = useEnter(`kpi-${id}`, index)
  const color = seriesColor(series)
  return (
    <article
      data-testid={`kpi-${id}`}
      style={enter.style}
      className={cn("group relative snap-item overflow-hidden rounded-2xl border bg-card p-5 shadow-card transition-shadow duration-(--duration-base) ease-(--ease-out) hover:shadow-lift", enter.className, className)}
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} />
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-muted-foreground">{label}</p>
        <span
          className="grid size-10 shrink-0 place-items-center rounded-xl"
          style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, var(--card))`, color: `color-mix(in oklab, ${color} 70%, var(--foreground))` }}
        >
          <Icon className="size-5" aria-hidden />
        </span>
      </div>
      <p
        data-testid={`kpi-${id}-value`}
        data-value={value}
        className="mt-3 text-5xl font-semibold tracking-tight tabular-nums"
        aria-label={`${label}: ${value.toLocaleString("en-US")}`}
      >
        {shown.toLocaleString("en-US")}
      </p>
      <p className="mt-3 text-sm text-muted-foreground">{definition}</p>
      {caption && <p className="mt-1 text-xs font-medium text-muted-foreground">{caption}</p>}
    </article>
  )
}
