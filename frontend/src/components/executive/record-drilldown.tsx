"use client"

import * as React from "react"
import { DataThroughBadge } from "@/components/landing/data-through-badge"
import { ErrorState } from "@/components/state/states"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { ExecutiveDrilldownKind, ExecutiveMonth } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { formatDay, formatInstant, formatMonth } from "@/lib/dates"
import { cn } from "@/lib/utils"
import { num } from "./count"

export interface DrillTarget {
  scopeId: string
  label: string
}

/**
 * The supporting records behind one region or territory and month. It exists only for an Executive who holds
 * explicit record-level permission; the BE refuses everyone else, so a denied attempt shows the refusal.
 */
export function RecordDrilldown({ target, months, onClose }: { target: DrillTarget | null; months: ExecutiveMonth[]; onClose: () => void }) {
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent data-testid="drilldown-drawer" className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-2xl">
        {target && <DrillView key={target.scopeId} target={target} months={months} />}
      </SheetContent>
    </Sheet>
  )
}

function DrillView({ target, months }: { target: DrillTarget; months: ExecutiveMonth[] }) {
  const adapter = useDataAdapter()
  const complete = months.filter((m) => !m.isPartial)
  const [month, setMonth] = React.useState((complete[complete.length - 1] ?? months[months.length - 1])?.month ?? "")
  const [kind, setKind] = React.useState<ExecutiveDrilldownKind>("CALLS")
  const result = useQuery("executiveDrilldown", `${target.scopeId}:${month}:${kind}`, (ctx) => adapter.executiveDrilldown(ctx, { scopeId: target.scopeId, kind, month, limit: 50 }), month !== "")

  return (
    <>
      <SheetHeader className="gap-3 p-5 pr-14">
        <SheetTitle className="text-xl font-semibold">Records · {target.label}</SheetTitle>
        <SheetDescription>The calls or responses counted for this month. Opened because your account holds record-level permission.</SheetDescription>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Month" data-testid="drill-month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-11 rounded-lg border bg-background px-3 text-sm">
            {months.map((m) => (
              <option key={m.month} value={m.month}>{formatMonth(m.month)}{m.isPartial ? " (partial)" : ""}</option>
            ))}
          </select>
          <div role="group" aria-label="Record type" className="flex gap-1 rounded-xl border bg-muted/40 p-1">
            {(["CALLS", "RESPONSES"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn("min-h-11 rounded-lg px-3 text-sm font-medium", kind === k ? "bg-background shadow-sm" : "text-muted-foreground")}>
                {k === "CALLS" ? "Calls" : "Responses"}
              </button>
            ))}
          </div>
        </div>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-5 pb-6">
        {result.status === "loading" && (
          <div data-testid="drill-loading" aria-busy="true" className="flex flex-col gap-2">
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
          </div>
        )}
        {result.status === "error" && <ErrorState error={result.error} onRetry={result.refetch} />}
        {result.status === "success" && (
          <div key={`${month}:${kind}`} className="drill-in flex flex-col gap-4">
            <DataThroughBadge dataThrough={result.data.dataThrough} />
            <p data-testid="drill-count" className="text-sm text-muted-foreground">
              {result.data.truncated ? `Showing ${result.data.records.length} of ${num(result.data.total)}` : num(result.data.total)} {kind === "CALLS" ? "distinct calls" : "responses"} in {formatMonth(result.data.month)}.
            </p>
            {result.data.records.length === 0 ? (
              <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">No records for this month in this scope.</p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border">
                <table data-testid="drill-table" className="w-full min-w-[36rem] text-left text-sm">
                  <thead className="bg-muted/50 text-xs tracking-wide text-muted-foreground uppercase">
                    <tr>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Record</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Territory</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">{kind === "CALLS" ? "Channel" : "Response"}</th>
                      <th scope="col" className="px-3 py-2.5 font-semibold">Interaction · loaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.records.map((r) => (
                      <tr key={r.recordId} data-testid="drill-row" className="border-t align-top">
                        <th scope="row" className="px-3 py-2 font-medium"><span className="block break-all">{r.recordId}</span><span className="block text-xs font-normal text-muted-foreground">{r.hcpName ?? r.hcpId}</span></th>
                        <td className="px-3 py-2">{r.territoryId}</td>
                        <td className="px-3 py-2">{kind === "CALLS" ? r.detail : r.responseText ?? r.detail}</td>
                        <td className="px-3 py-2 text-xs"><span className="block">{r.interactionDate ? formatDay(r.interactionDate, true) : "—"}</span><span className="block text-muted-foreground">{r.loadedAt ? formatInstant(r.loadedAt) : "—"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
