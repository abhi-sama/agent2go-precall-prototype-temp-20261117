import { cn } from "@/lib/utils"
import { sequentialFill, seriesColor, type SeriesSlot } from "./palette"

export interface DistributionRow {
  label: string
  count: number
  /** 0 to 100, of the stated denominator. */
  percent: number
}

/**
 * Ranked horizontal bars for one question's answers. One series means one hue (nominal answers are
 * not coloured by value), a 8px bar with a rounded data end anchored at zero, and the exact count and
 * percent printed beside the label so no hover is needed. Pass `ordinal` for ordered answers (Likert,
 * 0-10): the bars then step through one hue from light to dark in answer order.
 */
export function DistributionBars({
  rows,
  denominator,
  series = 1,
  ordinal = false,
  className,
}: {
  rows: DistributionRow[]
  denominator: number
  series?: SeriesSlot
  ordinal?: boolean
  className?: string
}) {
  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      {rows.map((row, i) => (
        <li key={row.label} className="grid gap-1.5">
          <div className="flex justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-muted-foreground">{row.label}</span>
            <span className="shrink-0 font-medium tabular-nums">{row.count} · {row.percent.toFixed(1)}%</span>
          </div>
          <div
            role="meter"
            aria-label={row.label}
            aria-valuemin={0}
            aria-valuemax={denominator}
            aria-valuenow={row.count}
            aria-valuetext={`${row.count} of ${denominator}`}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-r-full motion-safe:animate-[bar-grow_450ms_var(--ease-out)_both]"
              style={{
                width: `${Math.max(0, Math.min(100, row.percent))}%`,
                backgroundColor: ordinal ? sequentialFill(i + 1, rows.length, series) : seriesColor(series),
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
