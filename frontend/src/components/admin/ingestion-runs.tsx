"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Button } from "@astryxdesign/core/Button"
import { HStack } from "@astryxdesign/core/HStack"
import { Table, proportional } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { DatabaseZap, RefreshCw } from "lucide-react"
import { AdminPageHeader } from "@/components/admin/page-header"
import { SectionCard } from "@/components/admin/section-card"
import { BlockSkeleton, ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { IngestionRun, IngestionSource } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { useSession } from "@/lib/session/session-provider"

type RunRow = Record<string, unknown> & IngestionRun

const STATUS_VARIANT = { failed: "error", running: "info", stale: "warning" } as const

function formatWhen(value: string | null) {
  if (!value) return "Not available"
  return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(value))} UTC`
}

function duration(run: IngestionRun) {
  if (!run.completedAt) return "In progress"
  const elapsed = Math.max(0, new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())
  const minutes = Math.round(elapsed / 60_000)
  return `${minutes} min`
}

function Status({ value }: { value: string }) {
  const variant = STATUS_VARIANT[value as keyof typeof STATUS_VARIANT]
  return variant ? <Badge variant={variant} label={value} /> : <Text>{value}</Text>
}

function SourceRuns({ source }: { source: IngestionSource }) {
  return (
    <SectionCard
      flush
      title={source.sourceName}
      icon={DatabaseZap}
      description="Operational metadata only; no source records are displayed."
    >
      <VStack gap={4} padding={4}>
        <HStack gap={5} wrap="wrap">
          <VStack gap={0.5}>
            <Text type="supporting">Load date</Text>
            <Text hasTabularNumbers>{formatWhen(source.loadDate)}</Text>
          </VStack>
          <VStack gap={0.5}>
            <Text type="supporting">Data through</Text>
            <Text hasTabularNumbers>{formatWhen(source.dataThrough)}</Text>
          </VStack>
        </HStack>
      </VStack>
      <Table<RunRow>
        data={source.ingestionRuns.map((run) => ({ ...run }))}
        idKey="runId"
        density="compact"
        hasHover
        emptyState={<Text color="secondary">No ingestion runs have been recorded for this source dataset.</Text>}
        columns={[
          { key: "status", header: "Status", width: proportional(1, { minWidth: 112 }), renderCell: (run) => <Status value={run.status} /> },
          { key: "startedAt", header: "Start", width: proportional(1.5, { minWidth: 168 }), renderCell: (run) => <Text hasTabularNumbers color="secondary">{formatWhen(run.startedAt)}</Text> },
          { key: "completedAt", header: "End", width: proportional(1.5, { minWidth: 168 }), renderCell: (run) => <Text hasTabularNumbers color="secondary">{run.completedAt ? formatWhen(run.completedAt) : "In progress"}</Text> },
          { key: "duration", header: "Duration", width: proportional(0.8, { minWidth: 96 }), renderCell: (run) => <Text hasTabularNumbers>{duration(run)}</Text> },
          { key: "recordsLoaded", header: "Rows", align: "end", width: proportional(0.8, { minWidth: 88 }), renderCell: (run) => <Text hasTabularNumbers>{run.recordsLoaded.toLocaleString()}</Text> },
          { key: "errorSummary", header: "Detail", width: proportional(1.6, { minWidth: 180 }), renderCell: (run) => <Text color="secondary">{run.errorSummary ?? "—"}</Text> },
        ]}
      />
    </SectionCard>
  )
}

/** Administrator-only source-dataset operational monitoring. */
export function IngestionRuns() {
  const { user } = useSession()
  const adapter = useDataAdapter()
  const query = useQuery("adminIngestionRuns", "admin-ingestion-runs", (ctx) => adapter.adminIngestionRuns(ctx))
  return (
    <VStack gap={6} data-testid="admin-ingestion-runs">
      <AdminPageHeader
        title="Ingestion runs"
        description="Review the latest and recent ingestion runs for each source dataset, including operational status, timing, and row count."
        scopeLabel={user.scopeLabel}
      />
      {query.status === "loading" ? <BlockSkeleton className="h-96" /> : null}
      {query.status === "error" ? <ErrorState error={query.error} onRetry={query.refetch} /> : null}
      {query.status === "success" ? (
        <VStack gap={6}>
          <HStack justify="end">
            <Button variant="secondary" icon={<RefreshCw aria-hidden />} label="Refresh ingestion runs" onClick={query.refetch} />
          </HStack>
          {query.data.sources.map((source) => <SourceRuns key={source.sourceId} source={source} />)}
        </VStack>
      ) : null}
    </VStack>
  )
}
