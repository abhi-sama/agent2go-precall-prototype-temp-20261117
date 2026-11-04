"use client"

import { ArrowLeft, EyeOff, ShieldCheck } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { CitationHost, InsightSection, PanelLoading, PanelMeta } from "@/components/director/insights/shared"
import { FilterBar } from "@/components/filters/filter-bar"
import { useSharedFilters } from "@/components/filters/filter-context"
import { ScopeLabel } from "@/components/shell/scope-label"
import { EmptyState, ErrorState } from "@/components/state/states"
import { buttonVariants } from "@/components/ui/button"
import { useDataAdapter } from "@/lib/data/data-provider"
import { EXECUTIVE_THEME_FACETS, FACET_LABEL, type ExecutiveThemeFacet, type ExecutiveThemes } from "@/lib/data/executive-themes"
import type { DateRange } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { presetRange } from "@/lib/dates"
import { useSession } from "@/lib/session/session-provider"
import { cn } from "@/lib/utils"
import { LeadershipSummaries } from "./leadership-summaries"
import { OrgAnalysis } from "./org-analysis"
import { ThemeCards } from "./theme-cards"
import { TopicMatrix } from "./topic-matrix"

const DEFAULT_PRESET = "30d" as const

function AccessBanner({ themes }: { themes: ExecutiveThemes }) {
  if (themes.accessLevel === "RECORD_DRILLDOWN") {
    return (
      <p data-testid="access-banner" data-level="RECORD_DRILLDOWN" className="flex items-start gap-2 rounded-2xl border border-fact/30 bg-fact-soft px-4 py-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>You hold record-level permission, so nothing is withheld and cards cite the responses themselves.</span>
      </p>
    )
  }
  return (
    <p data-testid="access-banner" data-level="AGGREGATE_ONLY" className="flex items-start gap-2 rounded-2xl border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span data-testid="disclosure-text">
        Aggregate-only view for {themes.scopeLabel}. {themes.disclosure.text} Cards cite the set of responses behind each figure, not individual responses.
      </span>
    </p>
  )
}

function FacetTabs({ facet, onChange }: { facet: ExecutiveThemeFacet; onChange: (facet: ExecutiveThemeFacet) => void }) {
  return (
    <div role="group" aria-label="Group themes by" data-testid="facet-tabs" className="flex flex-wrap gap-1 rounded-xl border bg-muted/40 p-1">
      {EXECUTIVE_THEME_FACETS.map((f) => (
        <button key={f} type="button" data-testid={`facet-${f}`} aria-pressed={facet === f} onClick={() => onChange(f)} className={cn("min-h-11 rounded-lg px-3.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", facet === f ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {FACET_LABEL[f]}
        </button>
      ))}
    </div>
  )
}

/**
 * The Executive's themes workspace: portfolio, molecule, disease-area and study theme cards, the topic-by-region
 * matrix, source-linked leadership summaries, and scoped natural-language analysis. Aggregate-only: every count comes
 * from the BE with small groups withheld; this screen only lays it out. One date range drives every panel.
 */
export function ExecutiveThemesWorkspace() {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const { filters, setFilters } = useSharedFilters()
  const defaultRange = React.useMemo(() => presetRange(DEFAULT_PRESET), [])
  const range: DateRange = { from: filters.from ?? defaultRange.from, to: filters.to ?? defaultRange.to }
  const me = useQuery("me", userId, (ctx) => adapter.me(ctx), ready)
  const [facet, setFacet] = React.useState<ExecutiveThemeFacet>("PORTFOLIO")
  const [picked, setPicked] = React.useState<string | null>(null)

  const themes = useQuery("executiveThemes", `${userId}:${range.from}:${range.to}:${facet}`, (ctx) => adapter.executiveThemes(ctx, range, facet), ready)
  // Keep the last result on screen while a new facet or range loads, but never across people.
  const [kept, setKept] = React.useState<{ userId: string; data: ExecutiveThemes } | null>(null)
  if (themes.status === "success" && kept?.data !== themes.data) setKept({ userId, data: themes.data })
  const themeData = kept?.userId === userId ? kept.data : null

  const values = themeData && themeData.facet === facet ? themeData.groups.map((g) => g.facetValue) : []
  const facetValue = facet === "PORTFOLIO" ? null : values.includes(picked ?? "") ? picked : (values[0] ?? null)
  const matrixReady = ready && (facet === "PORTFOLIO" || facetValue !== null)
  const matrix = useQuery("executiveTopicMatrix", `${userId}:${range.from}:${range.to}:${facet}:${facetValue}`, (ctx) => adapter.executiveTopicMatrix(ctx, range, facet, facetValue), matrixReady)
  const busy = themes.status === "loading"
  const noResponses = themeData !== null && themeData.groups.every((g) => g.freeTextResponses.value === 0)

  return (
    <CitationHost>
      <div data-testid="executive-themes" className="flex flex-col gap-10">
        <header className="flex flex-col gap-3">
          <div>
            <Link href="/executive" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 mb-1")}><ArrowLeft aria-hidden /> Overview</Link>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Themes &amp; summaries</h1>
            <p className="mt-1 max-w-2xl text-muted-foreground">What recorded responses mention across your regions, which topics are rising in more than one, and a source-linked summary you can save and export.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ScopeLabel label={me.status === "success" ? me.data.scopeLabel : undefined} loading={me.status !== "success"} />
          </div>
          <FilterBar range={range} defaultRange={defaultRange} onRangeChange={(r) => setFilters((current) => ({ ...current, ...r }))} onReset={() => setFilters((current) => ({ ...current, ...defaultRange }))} />
          {themeData && <AccessBanner themes={themeData} />}
        </header>

        <InsightSection
          id="theme-cards"
          title="Theme cards"
          note="The most recorded themes in free-text responses, with the trend against the period before. Themes are keyword groupings of free text, derived rather than source facts."
          meta={
            <div className="flex flex-wrap items-center gap-3">
              <FacetTabs facet={facet} onChange={(f) => { setFacet(f); setPicked(null) }} />
              {themeData && <PanelMeta from={themeData.from} to={themeData.to} dataThrough={themeData.dataThrough}><span>Compared with {themeData.priorFrom} to {themeData.priorTo}</span></PanelMeta>}
            </div>
          }
        >
          {themes.status === "error" && !themeData ? (
            <ErrorState error={themes.error} onRetry={themes.refetch} />
          ) : !themeData ? (
            <PanelLoading testId="themes-loading" height="h-72" />
          ) : noResponses ? (
            <EmptyState title="No free-text responses in this period" actions={<span />}>No open-text responses were recorded in your regions between these dates. Try a longer range.</EmptyState>
          ) : (
            <div aria-busy={busy} className={cn("transition-opacity", busy && "opacity-60")}><ThemeCards data={themeData} /></div>
          )}
        </InsightSection>

        <InsightSection
          id="topic-matrix"
          title="Topics by region"
          note="Which topics moved, and where. A topic rising in two or more regions at once is marked. Trends are judged on share of free text against the approved thresholds, and describe what was recorded, never why."
          meta={
            facet !== "PORTFOLIO" && values.length > 0 ? (
              <label className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {FACET_LABEL[facet]}
                <select data-testid="matrix-facet-value" value={facetValue ?? ""} onChange={(e) => setPicked(e.target.value)} className="h-11 rounded-lg border bg-background px-3 text-sm capitalize text-foreground">
                  {values.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            ) : undefined
          }
        >
          {matrix.status === "error" ? (
            <ErrorState error={matrix.error} onRetry={matrix.refetch} />
          ) : matrix.status !== "success" ? (
            <PanelLoading testId="matrix-loading" height="h-96" />
          ) : (
            <TopicMatrix data={matrix.data} />
          )}
        </InsightSection>

        <InsightSection
          id="leadership-summaries"
          title="Leadership summaries"
          note="A summary of the period for your scope, written by AI from the figures above, with every statement linked to its source. Save it, reopen it, and export it; access is re-checked each time."
        >
          <LeadershipSummaries range={range} />
        </InsightSection>

        <InsightSection
          id="org-analysis"
          title="Ask about your regions"
          note="Natural-language questions over your explicit scope. Answers cite the response sets behind each figure and state their sample limitations."
        >
          <OrgAnalysis range={range} aggregateOnly={themeData?.accessLevel !== "RECORD_DRILLDOWN"} />
        </InsightSection>
      </div>
    </CitationHost>
  )
}
