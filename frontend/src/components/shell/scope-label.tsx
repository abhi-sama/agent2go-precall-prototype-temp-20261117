import { ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Always-visible statement of what the viewer is allowed to see. The text comes from the server
 * (`scopeLabel`); the UI never derives or widens it.
 */
export function ScopeLabel({
  label,
  className,
  loading,
}: {
  label?: string
  className?: string
  loading?: boolean
}) {
  return (
    <span
      data-testid="scope-label"
      className={cn(
        "inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border border-ink/25 bg-fact-soft px-3.5 text-sm font-medium text-fact",
        className,
      )}
    >
      <ShieldCheck className="size-4 shrink-0" aria-hidden />
      <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Scope</span>
      <span className="truncate" aria-live="polite">
        {loading || !label ? "Checking access…" : label}
      </span>
    </span>
  )
}
