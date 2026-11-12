import { Icon } from "@astryxdesign/core/Icon"
import { Text } from "@astryxdesign/core/Text"
import type * as React from "react"
import { cn } from "@/lib/utils"

export type TimelineStatus = "ok" | "warning" | "critical" | "info"

export interface TimelineEvent {
  id: string
  label: string
  /** Pre-formatted time, shown in tabular figures. */
  at: string
  status: TimelineStatus
  /** Status word shown beside the icon, so state is never colour alone. */
  statusLabel: string
  detail?: React.ReactNode
}

const ICON = { ok: "success", warning: "warning", critical: "error", info: "info" } as const
const TONE = { ok: "text-success", warning: "text-warning", critical: "text-destructive", info: "text-muted-foreground" } as const

/**
 * Events in time order. Status carries an icon and a word as well as colour (status colours are
 * reserved and never reused as a series hue). `layout="row"` lays events side by side from `sm` up.
 */
export function Timeline({ events, layout = "list", className }: { events: TimelineEvent[]; layout?: "list" | "row"; className?: string }) {
  return (
    <ol className={cn("grid gap-3", layout === "row" && "sm:grid-cols-3", className)}>
      {events.map((e) => {
        return (
          <li key={e.id} className="rounded-xl bg-muted/55 p-3">
            <Text as="p" weight="medium" display="block">{e.label}</Text>
            <Text as="p" type="supporting" hasTabularNumbers display="block" className="mt-1">{e.at}</Text>
            <Text as="p" type="supporting" weight="semibold" color="inherit" className={cn("mt-2 inline-flex items-center gap-1.5", TONE[e.status])}>
              <Icon icon={ICON[e.status]} size="sm" />
              {e.statusLabel}
            </Text>
            {e.detail && <div className="mt-1 text-xs text-muted-foreground">{e.detail}</div>}
          </li>
        )
      })}
    </ol>
  )
}
