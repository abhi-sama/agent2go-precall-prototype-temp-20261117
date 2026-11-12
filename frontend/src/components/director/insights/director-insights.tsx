"use client"

import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { FilterBar } from "@/components/filters/filter-bar"
import { useSharedFilters } from "@/components/filters/filter-context"
import { ScopeLabel } from "@/components/shell/scope-label"
import { buttonVariants } from "@/components/ui/button"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { DateRange } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { presetRange } from "@/lib/dates"
import { useSession } from "@/lib/session/session-provider"
import { cn } from "@/lib/utils"
import { DrilldownPanel } from "./drilldown-panel"
import { EmergingPanel } from "./emerging-panel"
import { ExceptionsPanel } from "./exceptions-panel"
import { HeatmapPanel } from "./heatmap-panel"
import { QuestionPanel } from "./question-panel"
import { CitationHost } from "./shared"
import { SummariesPanel } from "./summaries-panel"

const DEFAULT_PRESET = "30d" as const

/**
 * The Director's insight workspace: AI territory summaries, topic heatmap and theme cards, emerging topics, question
 * analytics, drill-down and exceptions. One date range drives every panel. Every number is computed by the BE under
 * row-level security; this screen only lays it out.
 */
export function DirectorInsights() {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const { filters, setFilters } = useSharedFilters()
  const defaultRange = React.useMemo(() => presetRange(DEFAULT_PRESET), [])
  const range: DateRange = { from: filters.from ?? defaultRange.from, to: filters.to ?? defaultRange.to }
  const me = useQuery("me", userId, (ctx) => adapter.me(ctx), ready)
  // Panels share the date range and the facet filters; the window travels separately.
  const facetFilters = React.useMemo(() => {
    const { from: _from, to: _to, ...rest } = filters
    void _from
    void _to
    return rest
  }, [filters])

  return (
    <CitationHost>
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-3">
          <div>
            <Link href="/director" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-1")}><ArrowLeft aria-hidden /> My region</Link>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Insights</h1>
            <p className="mt-1 max-w-2xl text-muted-foreground">Themes, emerging topics, question-level answers and data exceptions across the territories you are approved to see.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ScopeLabel label={me.status === "success" ? me.data.scopeLabel : undefined} loading={me.status !== "success"} />
          </div>
          <FilterBar range={range} defaultRange={defaultRange} onRangeChange={(r) => setFilters((current) => ({ ...current, ...r }))} onReset={() => setFilters((current) => ({ ...current, ...defaultRange }))} />
        </header>

        <SummariesPanel range={range} />
        <HeatmapPanel range={range} filters={facetFilters} />
        <EmergingPanel range={range} filters={facetFilters} />
        <QuestionPanel range={range} filters={facetFilters} />
        <DrilldownPanel range={range} />
        <ExceptionsPanel range={range} />
      </div>
    </CitationHost>
  )
}
