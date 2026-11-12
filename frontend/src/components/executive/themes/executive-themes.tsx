"use client"

import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Heading } from "@astryxdesign/core/Heading"
import { Icon } from "@astryxdesign/core/Icon"
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl"
import { Selector } from "@astryxdesign/core/Selector"
import { Text } from "@astryxdesign/core/Text"
import { CitationHost, InsightSection, PanelLoading, PanelMeta } from "@/components/director/insights/shared"
import { FilterBar } from "@/components/filters/filter-bar"
import { useSharedFilters } from "@/components/filters/filter-context"
import { ScopeLabel } from "@/components/shell/scope-label"
import { EmptyState, ErrorState } from "@/components/state/states"
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
      <Banner data-testid="access-banner" data-level="RECORD_DRILLDOWN" status="success" title="Record-level access" description="You hold record-level permission, so nothing is withheld and cards cite the responses themselves." />
    )
  }
  return (
    <Banner data-testid="access-banner" data-level="AGGREGATE_ONLY" status="info" title="Aggregate-only access" description={<span data-testid="disclosure-text">
        Aggregate-only view for {themes.scopeLabel}. {themes.disclosure.text} Cards cite the set of responses behind each figure, not individual responses.
      </span>} />
  )
}

function FacetTabs({ facet, onChange }: { facet: ExecutiveThemeFacet; onChange: (facet: ExecutiveThemeFacet) => void }) {
  return (
    <SegmentedControl data-testid="facet-tabs" label="Group themes by" value={facet} onChange={(value) => onChange(value as ExecutiveThemeFacet)} layout="fill">
      {EXECUTIVE_THEME_FACETS.map((f) => <SegmentedControlItem key={f} value={f} label={FACET_LABEL[f]} data-testid={`facet-${f}`} />)}
    </SegmentedControl>
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
            <Button as={Link} href="/executive" label="Overview" icon={<Icon icon={ArrowLeft} />} variant="ghost" size="sm" />
            <Heading level={1} type="display-2" textWrap="balance">Themes &amp; summaries</Heading>
            <Text as="p" type="supporting" display="block" className="mt-1 max-w-2xl">What recorded responses mention across your regions, which topics are rising in more than one, and a source-linked summary you can save and export.</Text>
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
            <PanelLoading testId="themes-loading" height={288} />
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
              <Selector data-testid="matrix-facet-value" label={FACET_LABEL[facet]} value={facetValue ?? ""} onChange={setPicked} options={values.map((value) => ({ value, label: value }))} presentation="adaptive" />
            ) : undefined
          }
        >
          {matrix.status === "error" ? (
            <ErrorState error={matrix.error} onRetry={matrix.refetch} />
          ) : matrix.status !== "success" ? (
            <PanelLoading testId="matrix-loading" height={384} />
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
