"use client"

import { Button } from "@astryxdesign/core/Button"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { ArrowLeft } from "lucide-react"
import NextLink from "next/link"
import * as React from "react"
import { FilterBar } from "@/components/filters/filter-bar"
import { useSharedFilters } from "@/components/filters/filter-context"
import { ScopeLabel } from "@/components/shell/scope-label"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { DateRange } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { presetRange } from "@/lib/dates"
import { useSession } from "@/lib/session/session-provider"
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
      <VStack gap={10}>
        <VStack as="header" gap={3}>
          <VStack gap={1} align="start">
            <Button href="/director" as={NextLink} variant="ghost" size="sm" label="My region" icon={<Icon icon={ArrowLeft} />} />
            <Heading level={1}>Insights</Heading>
            <Text type="supporting" as="p" className="max-w-2xl">Themes, emerging topics, question-level answers and data exceptions across the territories you are approved to see.</Text>
          </VStack>
          <HStack gap={2} align="center" wrap="wrap">
            <ScopeLabel label={me.status === "success" ? me.data.scopeLabel : undefined} loading={me.status !== "success"} />
          </HStack>
          <FilterBar range={range} defaultRange={defaultRange} onRangeChange={(r) => setFilters((current) => ({ ...current, ...r }))} onReset={() => setFilters((current) => ({ ...current, ...defaultRange }))} />
        </VStack>

        <SummariesPanel range={range} />
        <HeatmapPanel range={range} filters={facetFilters} />
        <EmergingPanel range={range} filters={facetFilters} />
        <QuestionPanel range={range} filters={facetFilters} />
        <DrilldownPanel range={range} />
        <ExceptionsPanel range={range} />
      </VStack>
    </CitationHost>
  )
}
