import { Icon } from "@astryxdesign/core/Icon"
import { Text } from "@astryxdesign/core/Text"
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
      <Icon icon={ShieldCheck} size="sm" className="shrink-0" />
      <Text type="supporting" weight="semibold" className="tracking-wide uppercase">Scope</Text>
      <Text className="truncate" aria-live="polite">
        {loading || !label ? "Checking access…" : label}
      </Text>
    </span>
  )
}
