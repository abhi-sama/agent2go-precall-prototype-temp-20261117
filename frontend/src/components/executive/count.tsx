import { EyeOff } from "lucide-react"
import type { SuppressedCount } from "@/lib/data/types"
import { cn } from "@/lib/utils"

export const num = (n: number) => n.toLocaleString("en-US")

/** `0.9167` is never passed here: the BE sends percentages on a 0 to 100 scale. */
export const percent = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${Math.round(value)}%`)

/**
 * A count the BE may have withheld. A withheld count is a labelled placeholder, never a zero and never an
 * estimate: the reader is told why the number is not there (small group), so they do not read it as "no activity".
 */
export function CountValue({ count, minCell, className, testId }: { count: SuppressedCount; minCell: number; className?: string; testId?: string }) {
  if (count.suppressed || count.value === null) {
    return (
      <span
        data-testid={testId}
        data-suppressed="true"
        title={`Fewer than ${minCell}, or hidden so a smaller group cannot be worked out. Withheld to protect small groups.`}
        className={cn("inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[0.8em] font-medium text-muted-foreground", className)}
      >
        <EyeOff className="size-3.5 shrink-0" aria-hidden />
        <span>Withheld</span>
        <span className="sr-only"> (small group, fewer than {minCell})</span>
      </span>
    )
  }
  return (
    <span data-testid={testId} data-value={count.value} className={cn("tabular-nums", className)}>
      {num(count.value)}
    </span>
  )
}
