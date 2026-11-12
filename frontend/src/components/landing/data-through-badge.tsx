import { Badge } from "@astryxdesign/core/Badge"
import { Icon } from "@astryxdesign/core/Icon"
import { Hourglass } from "lucide-react"
import { formatDay } from "@/lib/dates"
import type { IsoDateTime } from "@/lib/data/types"

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
  const icon = !dataThrough ? Hourglass : stale ? "warning" : "success"
  const label = !dataThrough
    ? "No data load yet"
    : `Data through ${formatDay(dataThrough.slice(0, 10), true)}`
  return (
    <Badge
      data-testid="data-through"
      data-stale={stale}
      className={className}
      variant={!dataThrough ? "neutral" : stale ? "warning" : "success"}
      icon={<Icon icon={icon} size="sm" />}
      label={
        <>
          {label}
          {stale && dataThrough && <span className="text-xs font-semibold uppercase"> · Stale</span>}
        </>
      }
    />
  )
}
