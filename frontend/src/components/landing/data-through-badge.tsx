import { CircleAlert, CircleCheck, Hourglass } from "lucide-react"
import { formatDay } from "@/lib/dates"
import type { IsoDateTime } from "@/lib/data/types"
import { cn } from "@/lib/utils"

/** Loads older than this are flagged stale (deterministic rule, not AI judgement). */
export const STALE_AFTER_HOURS = 48

export function isStale(dataThrough: IsoDateTime | null, now: Date = new Date()): boolean {
  if (!dataThrough) return true
  return (now.getTime() - new Date(dataThrough).getTime()) / 3_600_000 > STALE_AFTER_HOURS
}

export function DataThroughBadge({
  dataThrough,
  now,
  className,
}: {
  dataThrough: IsoDateTime | null
  now?: Date
  className?: string
}) {
  const stale = isStale(dataThrough, now)
  const Icon = !dataThrough ? Hourglass : stale ? CircleAlert : CircleCheck
  const label = !dataThrough
    ? "No data load yet"
    : `Data through ${formatDay(dataThrough.slice(0, 10), true)}`
  return (
    <span
      data-testid="data-through"
      data-stale={stale}
      className={cn(
        "inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium",
        stale ? "border-warning/50 bg-warning/12 text-foreground" : "border-success/40 bg-success/10 text-foreground",
        className,
      )}
    >
      <Icon className={cn("size-4 shrink-0", stale ? "text-warning" : "text-success")} aria-hidden />
      {label}
      {stale && dataThrough && <span className="text-xs font-semibold uppercase">· Stale</span>}
    </span>
  )
}
