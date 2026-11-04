"use client"

import { ChevronLeft, ChevronRight, Flag as FlagIcon } from "lucide-react"
import * as React from "react"
import { DataThroughBadge } from "@/components/landing/data-through-badge"
import { ErrorState } from "@/components/state/states"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import type { ActivityMetric, ActivityTrends, EvidenceRecord, Flag } from "@/lib/data/types"
import { formatDay, formatInstant, formatMonth } from "@/lib/dates"
import { cn } from "@/lib/utils"
import { channelLabel } from "./format"
import { FlagForm, type FlagPreset } from "./flag-form"

export type DrawerState =
  | { view: "evidence"; metric: ActivityMetric; month: string; channel: string | null }
  | { view: "flag"; preset?: FlagPreset }

const METRIC_LABEL: Record<ActivityMetric, string> = { CALLS: "Distinct calls", HCPS: "Distinct engaged HCPs" }

/**
 * Evidence behind a chart point, and the flag form. One drawer with two views so the user never
 * stacks modals on an iPad. The evidence view shows what the number is made of and keeps the two
 * dates apart: the interaction date is when the exchange happened, the load date is when the record
 * reached this system.
 */
export function EvidenceDrawer({
  state,
  onStateChange,
  onClose,
  trends,
  onFlagged,
}: {
  state: DrawerState | null
  onStateChange: (next: DrawerState) => void
  onClose: () => void
  trends: ActivityTrends
  onFlagged: (flag: Flag) => void
}) {
  return (
    <Sheet open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent data-testid="evidence-drawer" className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-2xl">
        {state?.view === "evidence" && <EvidenceView state={state} onStateChange={onStateChange} trends={trends} />}
        {state?.view === "flag" && (
          <>
            <SheetHeader className="p-5 pr-14">
              <SheetTitle className="text-xl font-semibold">Flag an issue</SheetTitle>
              <SheetDescription>
                Report an incorrect summary, identifier or territory assignment. You can follow its review status afterwards.
              </SheetDescription>
            </SheetHeader>
            <div className="px-5 pb-6">
              <FlagForm preset={state.preset} onFlagged={onFlagged} onDone={onClose} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function EvidenceView({
  state,
  onStateChange,
  trends,
}: {
  state: Extract<DrawerState, { view: "evidence" }>
  onStateChange: (next: DrawerState) => void
  trends: ActivityTrends
}) {
  const adapter = useDataAdapter()
  const { metric, month, channel } = state
  const evidence = useQuery("activityEvidence", `${metric}:${month}:${channel ?? "all"}`, (ctx) =>
    adapter.activityEvidence(ctx, { metric, month, channel, limit: 50 }),
  )
  const months = trends.months.map((m) => m.month)
  const index = months.indexOf(month)
  const go = (delta: number) => {
    const next = months[index + delta]
    if (next) onStateChange({ ...state, month: next })
  }
  const flagRecord = (r: EvidenceRecord) =>
    onStateChange({
      view: "flag",
      preset: {
        targetType: r.kind === "CALL" ? "CALL" : "HCP",
        targetId: r.recordId,
        label: r.hcpName ?? undefined,
      },
    })

  return (
    <>
      <SheetHeader className="gap-3 p-5 pr-14">
        <SheetTitle className="text-xl font-semibold">Evidence · {METRIC_LABEL[metric]}</SheetTitle>
        <SheetDescription>
          The records counted in {formatMonth(month)}
          {channel ? ` under ${channelLabel(channel)}` : ""}. Calls are counted once however many product rows they have.
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous month" disabled={index <= 0} onClick={() => go(-1)}>
            <ChevronLeft aria-hidden />
          </Button>
          <span data-testid="evidence-month" className="min-w-28 text-center text-base font-semibold">
            {formatMonth(month)}
          </span>
          <Button variant="outline" size="icon" aria-label="Next month" disabled={index < 0 || index >= months.length - 1} onClick={() => go(1)}>
            <ChevronRight aria-hidden />
          </Button>
          <div className="ml-auto flex gap-1 rounded-xl border bg-muted/40 p-1" role="group" aria-label="Metric">
            {(["CALLS", "HCPS"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={metric === m}
                onClick={() => onStateChange({ ...state, metric: m, channel: m === "HCPS" ? null : channel })}
                className={cn("min-h-10 rounded-lg px-3 text-sm font-medium", metric === m ? "bg-background shadow-sm" : "text-muted-foreground")}
              >
                {m === "CALLS" ? "Calls" : "HCPs"}
              </button>
            ))}
          </div>
          {metric === "CALLS" && trends.channels.length > 1 && (
            <select
              aria-label="Channel"
              data-testid="evidence-channel"
              value={channel ?? ""}
              onChange={(e) => onStateChange({ ...state, channel: e.target.value || null })}
              className="h-11 rounded-lg border bg-background px-3 text-sm"
            >
              <option value="">All channels</option>
              {trends.channels.map((c) => (
                <option key={c} value={c}>
                  {channelLabel(c)}
                </option>
              ))}
            </select>
          )}
        </div>
      </SheetHeader>

      <div className="flex flex-col gap-4 px-5 pb-6">
        {evidence.status === "loading" && (
          <div data-testid="evidence-loading" aria-busy="true" className="flex flex-col gap-2">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
          </div>
        )}
        {evidence.status === "error" && <ErrorState error={evidence.error} onRetry={evidence.refetch} />}
        {evidence.status === "success" && (
          <>
            <section
              data-testid="evidence-freshness"
              aria-label="Freshness"
              className="grid gap-3 rounded-2xl border border-fact/25 border-l-[5px] border-l-fact bg-fact-soft p-4 sm:grid-cols-2"
            >
              <div>
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Interaction date</p>
                <p data-testid="evidence-latest-interaction" className="mt-1 text-sm">
                  Latest exchange in this set:{" "}
                  <strong>{evidence.data.latestInteractionDate ? formatDay(evidence.data.latestInteractionDate, true) : "none"}</strong>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">When the exchange took place.</p>
              </div>
              <div>
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Load date</p>
                <p data-testid="evidence-latest-load" className="mt-1 text-sm">
                  Latest record loaded:{" "}
                  <strong>{evidence.data.latestLoadedAt ? formatInstant(evidence.data.latestLoadedAt) : "unknown"}</strong>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">When the record reached this system. It is usually after the interaction.</p>
              </div>
              <div className="sm:col-span-2">
                <DataThroughBadge dataThrough={evidence.data.dataThrough} />
              </div>
            </section>

            <p data-testid="evidence-count" className="text-sm text-muted-foreground">
              {evidence.data.truncated
                ? `Showing the latest ${evidence.data.records.length} of ${evidence.data.total.toLocaleString("en-US")} ${metric === "CALLS" ? "distinct calls" : "distinct HCPs"}.`
                : `${evidence.data.total.toLocaleString("en-US")} ${metric === "CALLS" ? "distinct calls" : "distinct HCPs"}.`}
            </p>

            {evidence.data.records.length === 0 ? (
              <p data-testid="evidence-empty" className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                No records for this month. That means none were recorded in your scope, not that access is missing.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border">
                <table data-testid="evidence-table" className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="bg-muted/50 text-xs tracking-wide text-muted-foreground uppercase">
                    <tr>
                      <th scope="col" className="px-3 py-2.5 font-semibold">{metric === "CALLS" ? "Call" : "HCP"}</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">{metric === "CALLS" ? "HCP" : "Calls"}</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Interaction date</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Loaded</th>
                      <th scope="col" className="px-3 py-2.5"><span className="sr-only">Flag</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {evidence.data.records.map((r) => (
                      <tr key={`${r.kind}:${r.recordId}`} data-testid="evidence-row">
                        <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{r.recordId}</td>
                        <td className="px-3 py-2.5">
                          {metric === "CALLS" ? (
                            <>
                              <span className="font-mono text-xs whitespace-nowrap">{r.hcpId}</span>
                              {r.hcpName && <span className="block text-xs text-muted-foreground">{r.hcpName}</span>}
                            </>
                          ) : (
                            <>
                              {r.callCount}
                              {r.hcpName && <span className="block text-xs text-muted-foreground">{r.hcpName}</span>}
                            </>
                          )}
                        </td>
                        <td data-testid="evidence-interaction-date" className="px-3 py-2.5 whitespace-nowrap">
                          {formatDay(r.interactionDate, true)}
                        </td>
                        <td data-testid="evidence-loaded" className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                          {r.loadedAt ? formatInstant(r.loadedAt) : "Unknown"}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Button variant="ghost" size="sm" onClick={() => flagRecord(r)} aria-label={`Flag ${r.recordId}`} data-testid="evidence-flag">
                            <FlagIcon aria-hidden /> Flag
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
