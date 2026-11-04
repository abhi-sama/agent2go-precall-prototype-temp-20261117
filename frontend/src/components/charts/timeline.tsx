import { AlertTriangle, CheckCircle2, CircleDot, XCircle } from "lucide-react"
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

const ICON = { ok: CheckCircle2, warning: AlertTriangle, critical: XCircle, info: CircleDot } as const
const TONE = { ok: "text-success", warning: "text-warning", critical: "text-destructive", info: "text-muted-foreground" } as const

/**
 * Events in time order. Status carries an icon and a word as well as colour (status colours are
 * reserved and never reused as a series hue). `layout="row"` lays events side by side from `sm` up.
 */
export function Timeline({ events, layout = "list", className }: { events: TimelineEvent[]; layout?: "list" | "row"; className?: string }) {
  return (
    <ol className={cn("grid gap-3", layout === "row" && "sm:grid-cols-3", className)}>
      {events.map((e) => {
        const Icon = ICON[e.status]
        return (
          <li key={e.id} className="rounded-xl bg-muted/55 p-3">
            <p className="text-sm font-medium">{e.label}</p>
            <p className="mt-1 text-xs tabular-nums text-muted-foreground">{e.at}</p>
            <p className={cn("mt-2 inline-flex items-center gap-1.5 text-xs font-semibold", TONE[e.status])}>
              <Icon className="size-3.5" aria-hidden />
              {e.statusLabel}
            </p>
            {e.detail && <div className="mt-1 text-xs text-muted-foreground">{e.detail}</div>}
          </li>
        )
      })}
    </ol>
  )
}
