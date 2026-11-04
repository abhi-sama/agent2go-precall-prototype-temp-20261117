import type { FlagStatus } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { FLAG_STATUS_META } from "./format"

export function FlagStatusBadge({ status, className }: { status: FlagStatus; className?: string }) {
  const meta = FLAG_STATUS_META[status]
  const Icon = meta.icon
  return (
    <span
      data-testid="flag-status"
      data-status={status}
      title={meta.hint}
      className={cn("inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold", meta.className, className)}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {meta.label}
    </span>
  )
}
