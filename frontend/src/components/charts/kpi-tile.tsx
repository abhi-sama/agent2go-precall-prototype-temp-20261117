"use client"

import type { LucideIcon } from "lucide-react"
import { usePathname } from "next/navigation"
import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { Icon } from "@astryxdesign/core/Icon"
import { Stack } from "@astryxdesign/core/Stack"
import { Text } from "@astryxdesign/core/Text"
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
export function KpiTile({ id, label, value, definition, caption, icon: Glyph, series = 1, index = 0, className }: KpiTileProps) {
  // Once per screen per page load: the same tile id on another screen is a different figure.
  const screen = usePathname()
  const shown = useCountUp(value, undefined, `kpi:${screen}:${id}`)
  const enter = useEnter(`kpi-${id}`, index)
  const color = seriesColor(series)
  return (
    <Card
      data-testid={`kpi-${id}`}
      style={enter.style}
      padding={4}
      elevation="low"
      className={cn("group relative snap-item overflow-hidden transition-shadow duration-(--a2g-duration-fast) ease-(--ease-out) hover:shadow-lift", enter.className, className)}
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} />
      <Stack direction="horizontal" hAlign="between" vAlign="start" gap={3}>
        <Heading level={3} color="secondary" className="min-w-0">{label}</Heading>
        <span
          className="grid size-10 shrink-0 place-items-center rounded-xl"
          style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, var(--card))`, color: `color-mix(in oklab, ${color} 70%, var(--foreground))` }}
        >
          <Icon icon={Glyph} size="md" />
        </span>
      </Stack>
      <Text
        data-testid={`kpi-${id}-value`}
        data-value={value}
        type="display-1"
        weight="semibold"
        hasTabularNumbers
        display="block"
        className="mt-3"
        aria-label={`${label}: ${value.toLocaleString("en-US")}`}
      >
        {shown.toLocaleString("en-US")}
      </Text>
      <Text as="p" type="supporting" display="block" className="mt-3">{definition}</Text>
      {caption && <Text as="p" type="supporting" weight="medium" display="block" className="mt-1">{caption}</Text>}
    </Card>
  )
}
