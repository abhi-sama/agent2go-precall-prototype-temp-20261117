import { cn } from "@/lib/utils"
import { OTHER_COLOR, seriesColor, type SeriesSlot } from "./palette"

export interface LegendItem {
  label: string
  /** A categorical slot, or "other" for the folded remainder. */
  series: SeriesSlot | "other"
}

/**
 * Legend for two or more series (a single series is named by its title instead). Swatches are
 * 10px squares and the text stays in ink; identity never rests on colour alone because the label
 * is always beside the swatch. Wraps on narrow screens.
 */
export function Legend({ items, className, "aria-label": ariaLabel = "Legend" }: { items: LegendItem[]; className?: string; "aria-label"?: string }) {
  if (items.length < 2) return null
  return (
    <ul aria-label={ariaLabel} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: item.series === "other" ? OTHER_COLOR : seriesColor(item.series) }} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  )
}

/** Light-to-dark ramp key for sequential encodings (heatmaps, maps). Min and max are always printed. */
export function SequentialLegend({ min, max, label, className }: { min: string; max: string; label: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)} role="img" aria-label={`${label}: ${min} to ${max}`}>
      <span>{min}</span>
      <span
        aria-hidden
        className="h-2 w-28 rounded-full"
        style={{ background: "linear-gradient(to right, color-mix(in oklab, var(--chart-1) 12%, var(--card)), color-mix(in oklab, var(--chart-1) 62%, var(--card)))" }}
      />
      <span>{max}</span>
      <span className="sr-only">{label}</span>
    </div>
  )
}
