"use client"

import { MessagesSquare, Stethoscope, Users } from "lucide-react"
import * as React from "react"
import { FilterBar } from "@/components/filters/filter-bar"
import { DataThroughBadge } from "@/components/landing/data-through-badge"
import { KpiCard } from "@/components/landing/kpi-card"
import { ScopeLabel } from "@/components/shell/scope-label"
import { EmptyState, ErrorState, KpiSkeleton } from "@/components/state/states"
import { TerritoryVisual } from "@/components/three/territory-visual"
import { Button } from "@/components/ui/button"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import type { DateRange } from "@/lib/data/types"
import { formatRange, presetRange } from "@/lib/dates"
import { useSession } from "@/lib/session/session-provider"

const DEFAULT_PRESET = "30d" as const

/** Heading, scope, freshness, filters, KPI cards and (optionally) the territory map for one persona. */
export function LandingSection({ title, description, showMap = true }: { title: string; description: string; showMap?: boolean }) {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const defaultRange = React.useMemo(() => presetRange(DEFAULT_PRESET), [])
  const [range, setRange] = React.useState<DateRange>(defaultRange)

  const key = `${userId}:${range.from}:${range.to}`
  const kpis = useQuery("landingKpis", key, (ctx) => adapter.landingKpis(ctx, range), ready)
  const hasMap = showMap && typeof adapter.territoryActivity === "function"
  const territories = useQuery(
    "territoryActivity",
    key,
    (ctx) => adapter.territoryActivity!(ctx, range),
    ready && hasMap,
  )

  const loading = kpis.status === "loading"
  const allZero = kpis.status === "success" && kpis.data.distinctCalls === 0 && kpis.data.distinctEngagedHcps === 0 && kpis.data.responseCount === 0
  const scopeLabel = kpis.status === "success" ? kpis.data.scopeLabel : kpis.status === "error" && kpis.error.code === "FORBIDDEN" ? "No access" : undefined

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-1 max-w-2xl text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScopeLabel label={scopeLabel} loading={loading || kpis.status === "error"} />
          {kpis.status === "success" && <DataThroughBadge dataThrough={kpis.data.dataThrough} />}
          <span className="text-sm text-muted-foreground" data-testid="range-label">
            {formatRange(range)}
          </span>
        </div>
      </header>

      <FilterBar range={range} onRangeChange={setRange} defaultRange={defaultRange} disabled={loading} />

      {kpis.status === "error" ? (
        <ErrorState error={kpis.error} onRetry={kpis.refetch} />
      ) : allZero ? (
        <EmptyState
          actions={
            <Button variant="outline" onClick={() => setRange(presetRange("90d"))}>
              Show 90 days
            </Button>
          }
        />
      ) : (
        <div
          data-testid="kpi-grid"
          className="scroll-snap-x -mx-4 grid auto-cols-[minmax(15rem,82%)] grid-flow-col gap-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-3 sm:overflow-visible sm:px-0"
        >
          {kpis.status === "success" ? (
            <>
              <KpiCard
                id="calls"
                label="Distinct calls"
                value={kpis.data.distinctCalls}
                definition="Each call counted once, however many rows it has."
                icon={Stethoscope}
                tone="orange"
              />
              <KpiCard
                id="hcps"
                label="Distinct engaged HCPs"
                value={kpis.data.distinctEngagedHcps}
                definition="Healthcare professionals reached at least once."
                caption={kpis.data.distinctEngagedHcps > 0 ? `${(kpis.data.distinctCalls / kpis.data.distinctEngagedHcps).toFixed(1)} calls per HCP` : undefined}
                icon={Users}
                tone="ink"
              />
              <KpiCard
                id="responses"
                label="Responses"
                value={kpis.data.responseCount}
                definition="Insight responses captured from those calls."
                caption={kpis.data.distinctCalls > 0 ? `${(kpis.data.responseCount / kpis.data.distinctCalls).toFixed(1)} per call` : undefined}
                icon={MessagesSquare}
                tone="teal"
              />
            </>
          ) : (
            <>
              <KpiSkeleton />
              <KpiSkeleton />
              <KpiSkeleton />
            </>
          )}
        </div>
      )}

      {hasMap && (
        territories.status === "success" ? (
          <TerritoryVisual items={territories.data} />
        ) : territories.status === "error" ? (
          <ErrorState error={territories.error} onRetry={territories.refetch} />
        ) : (
          <div data-testid="territory-loading" aria-busy="true" className="h-[22rem] animate-pulse rounded-2xl border bg-muted/60" />
        )
      )}
    </div>
  )
}
