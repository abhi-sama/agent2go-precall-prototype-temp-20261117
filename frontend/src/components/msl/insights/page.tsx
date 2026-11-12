"use client"

import * as React from "react"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Drawer, DrawerHeader } from "@astryxdesign/core/Drawer"
import { HStack } from "@astryxdesign/core/HStack"
import { Layout, LayoutContent } from "@astryxdesign/core/Layout"
import { Selector } from "@astryxdesign/core/Selector"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Table, proportional } from "@astryxdesign/core/Table"
import { Heading, Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { DataThroughBadge } from "@/components/landing/data-through-badge"
import { PageFrame } from "@/components/layout/page-frame"
import { ScopeLabel } from "@/components/shell/scope-label"
import { EmptyState, ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { InsightFilters, MslInsightResponse } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { formatDay } from "@/lib/dates"
import { useSession } from "@/lib/session/session-provider"

type InsightRow = MslInsightResponse & Record<string, unknown>

const EMPTY_OPTION = { value: "", label: "All" }

/**
 * A list-detail workspace for source-recorded Insight responses. It intentionally contains no
 * aggregate-only shortcuts: every row and filter option arrives through the MSL's RLS-scoped path.
 */
export function MslInsightsWorkspace() {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const [filters, setFilters] = React.useState<InsightFilters>({})
  const [selected, setSelected] = React.useState<MslInsightResponse | null>(null)
  const filterKey = `${filters.theme ?? ""}|${filters.hcpId ?? ""}|${filters.molecule ?? ""}`
  const result = useQuery("mslInsightResponses", `${userId}:${filterKey}`, (ctx) => adapter.mslInsightResponses(ctx, filters), ready)

  const setFilter = (key: "theme" | "hcpId" | "molecule") => (value: string | null) => {
    setSelected(null)
    setFilters((current) => ({ ...current, [key]: value || undefined }))
  }

  return (
    <PageFrame>
      <VStack gap={6} data-testid="msl-insights">
        <VStack as="header" gap={3}>
          <VStack gap={1}>
            <Heading level={1}>Insights</Heading>
            <Text type="supporting" as="p">Your recorded Insight responses in your effective territory scope. Themes are derived from recorded perspectives; they do not replace the response.</Text>
          </VStack>
          <HStack gap={2} wrap="wrap" vAlign="center">
            <ScopeLabel label={result.status === "success" ? result.data.scopeLabel : undefined} loading={result.status === "loading"} />
            {result.status === "success" && <DataThroughBadge dataThrough={result.data.dataThrough} />}
          </HStack>
        </VStack>

        {result.status === "loading" && <LoadingWorkspace />}
        {result.status === "error" && <ErrorState error={result.error} onRetry={result.refetch} />}
        {result.status === "success" && (
          <VStack gap={6}>
            <Card padding={4}>
              <VStack gap={3}>
                <Heading level={2}>Filter recorded responses</Heading>
                <HStack as="section" aria-label="Insight response filters" gap={3} wrap="wrap">
                  <Selector data-testid="insight-theme-filter" label="Theme" options={[EMPTY_OPTION, ...result.data.options.themes]} value={filters.theme ?? ""} onChange={setFilter("theme")} hasClear presentation="adaptive" />
                  <Selector data-testid="insight-hcp-filter" label="HCP" options={[EMPTY_OPTION, ...result.data.options.hcps]} value={filters.hcpId ?? ""} onChange={setFilter("hcpId")} hasClear presentation="adaptive" />
                  <Selector data-testid="insight-molecule-filter" label="Molecule" options={[EMPTY_OPTION, ...result.data.options.molecules]} value={filters.molecule ?? ""} onChange={setFilter("molecule")} hasClear presentation="adaptive" />
                </HStack>
              </VStack>
            </Card>

            {result.data.responses.length === 0 ? (
              <EmptyState title="No recorded responses match these filters">No Insight responses were recorded in your effective territory scope for this filter set.</EmptyState>
            ) : (
              <VStack as="section" gap={3} aria-labelledby="insight-response-list-heading">
                <VStack gap={1}>
                  <Heading id="insight-response-list-heading" level={2}>Recorded responses</Heading>
                  <Text type="supporting" as="p" data-testid="insight-response-count">Showing the latest {result.data.responses.length} source-recorded responses. Select a row to review its response and Interaction.</Text>
                </VStack>
                <Table<InsightRow>
                  data={result.data.responses as InsightRow[]}
                  idKey="responseId"
                  density="compact"
                  dividers="rows"
                  hasHover
                  textOverflow="truncate"
                  rowCount={result.data.responses.length}
                  rowIndexStart={1}
                  data-testid="insight-response-table"
                  columns={[
                    { key: "theme", header: "Theme", width: proportional(1, { minWidth: 150 }), renderCell: (row) => <Text as="span" type="supporting">{row.theme}</Text> },
                    { key: "hcpId", header: "HCP", width: proportional(1, { minWidth: 110 }), renderCell: (row) => <Text as="span" type="code">{row.hcpId}</Text> },
                    { key: "molecule", header: "Molecule", width: proportional(1, { minWidth: 130 }), renderCell: (row) => <Text as="span">{row.molecule ?? "Not recorded"}</Text> },
                    { key: "interactionDate", header: "Interaction date", width: proportional(1, { minWidth: 130 }), renderCell: (row) => <Text as="span" hasTabularNumbers>{formatDay(row.interactionDate, true)}</Text> },
                    { key: "response", header: "Response", width: proportional(2, { minWidth: 260 }), renderCell: (row) => <Button data-testid="insight-response-open" label={`Open response ${row.sourceRecordId}`} variant="ghost" onClick={() => setSelected(row)}>Open response</Button> },
                  ]}
                />
              </VStack>
            )}
          </VStack>
        )}
      </VStack>

      <ResponseDrawer response={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </PageFrame>
  )
}

function LoadingWorkspace() {
  return (
    <VStack gap={6} aria-busy="true" data-testid="msl-insights-loading">
      <Skeleton height={152} radius={3} />
      <Skeleton height={360} radius={3} />
    </VStack>
  )
}

function ResponseDrawer({ response, onOpenChange }: { response: MslInsightResponse | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Drawer isOpen={response !== null} onOpenChange={onOpenChange} label="Recorded Insight response" width={480}>
      <Layout
        header={<DrawerHeader title="Recorded response" subtitle={response ? `Interaction date ${formatDay(response.interactionDate, true)}` : undefined} onOpenChange={onOpenChange} hasDivider />}
        content={
          <LayoutContent padding={4}>
            {response && (
              <VStack gap={5} data-testid="insight-response-drawer">
                <VStack gap={1}>
                  <Heading level={2}>Response</Heading>
                  <Text as="p">{response.responseText || "No response was recorded."}</Text>
                </VStack>
                <VStack gap={1}>
                  <Text type="label" as="p">Question</Text>
                  <Text as="p">{response.question}</Text>
                </VStack>
                <VStack gap={1}>
                  <Text type="label" as="p">Interaction</Text>
                  <Text as="p">{response.interactionId}</Text>
                  <Text type="supporting" as="p">Interaction date: {formatDay(response.interactionDate, true)}</Text>
                </VStack>
                <VStack gap={1}>
                  <Text type="label" as="p">Source record</Text>
                  <Text type="code" as="p">{response.sourceRecordId}</Text>
                </VStack>
              </VStack>
            )}
          </LayoutContent>
        }
      />
    </Drawer>
  )
}
