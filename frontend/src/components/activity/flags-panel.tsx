"use client"

import { Flag as FlagIcon, Plus } from "lucide-react"
import { ErrorState } from "@/components/state/states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { DataError, Flag } from "@/lib/data/types"
import { formatDay } from "@/lib/dates"
import { FLAG_KIND_LABEL, FLAG_TARGET_LABEL } from "./format"
import { FlagStatusBadge } from "./flag-status-badge"

type FlagsState = { status: "loading" } | { status: "error"; error: DataError } | { status: "success"; data: Flag[] }

/** The user's own flags with their review status. Flags are private to the person who raised them. */
export function FlagsPanel({ flags, onRetry, onNew }: { flags: FlagsState; onRetry: () => void; onNew: () => void }) {
  return (
    <section data-testid="flags-panel" aria-labelledby="flags-heading" className="rounded-2xl border bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="flags-heading" className="text-lg font-semibold tracking-tight">
            My flags
          </h2>
          <p className="text-sm text-muted-foreground">Issues you reported, with where each one stands in review.</p>
        </div>
        <Button variant="outline" onClick={onNew} data-testid="flag-open">
          <Plus aria-hidden /> Flag an issue
        </Button>
      </div>

      <div className="mt-4">
        {flags.status === "loading" && <Skeleton aria-busy="true" className="h-16 rounded-xl" />}
        {flags.status === "error" && <ErrorState error={flags.error} onRetry={onRetry} />}
        {flags.status === "success" &&
          (flags.data.length === 0 ? (
            <p data-testid="flags-empty" className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              <FlagIcon className="size-4 shrink-0" aria-hidden /> You have not flagged anything. Spot something wrong in a chart&apos;s records? Flag it from there.
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {flags.data.map((f) => (
                <li key={f.flagId} data-testid="flag-item" className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{FLAG_KIND_LABEL[f.kind]}</p>
                    <p className="text-sm text-muted-foreground">
                      {FLAG_TARGET_LABEL[f.targetType]} <span className="font-mono text-xs">{f.targetId}</span>
                    </p>
                    {f.note && <p className="mt-1 max-w-prose text-sm break-words">{f.note}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Raised {formatDay(f.createdAt.slice(0, 10), true)}
                      {f.updatedAt !== f.createdAt && ` · updated ${formatDay(f.updatedAt.slice(0, 10), true)}`}
                    </p>
                  </div>
                  <FlagStatusBadge status={f.status} />
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  )
}
