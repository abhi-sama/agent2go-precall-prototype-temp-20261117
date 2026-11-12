"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { List, ListItem } from "@astryxdesign/core/List"
import { Table, proportional } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { CircleAlert, DatabaseZap, GitFork, Link2, RefreshCw } from "lucide-react"
import { SectionCard } from "@/components/admin/section-card"
import { DashboardGrid, DashboardGridItem } from "@/components/layout/dashboard-grid"
import { Timeline } from "@/components/charts/timeline"
import { ScopeLabel } from "@/components/shell/scope-label"
import { BlockSkeleton, ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { AdminDataQuality, DataQualityIssue, IngestionRun, QualityRecord } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { useSession } from "@/lib/session/session-provider"

const STATUS_VARIANT = { completed: "success", stale: "warning", failed: "error", running: "info" } as const
const statusVariant = (status: string) => STATUS_VARIANT[status as keyof typeof STATUS_VARIANT] ?? "neutral"
const formatWhen = (value: string | null) =>
  value
    ? `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(value))} UTC`
    : "In progress"
const recordTarget = (record: QualityRecord) => `quality-record-${record.recordId.replace(/[^a-zA-Z0-9_-]/g, "-")}`

type RunRow = Record<string, unknown> & IngestionRun

function IngestionPanel({ runs, onRefresh }: { runs: IngestionRun[]; onRefresh: () => void }) {
  return (
    <SectionCard
      flush
      title="Pipeline status"
      icon={DatabaseZap}
      description="Stale means a completed load is more than 30 days old."
      end={<Button variant="secondary" icon={<Icon icon={RefreshCw} />} label="Refresh checks" onClick={onRefresh} />}
    >
      <Table<RunRow>
        data={runs.map((run) => ({ ...run }))}
        idKey="runId"
        hasHover
        columns={[
          { key: "sourceName", header: "Source", width: proportional(1.5, { minWidth: 160 }), renderCell: (run) => <Text weight="medium">{run.sourceName}</Text> },
          { key: "status", header: "Status", width: proportional(1, { minWidth: 110 }), renderCell: (run) => <Badge variant={statusVariant(run.status)} label={run.status} /> },
          { key: "completedAt", header: "Finished", width: proportional(1.5, { minWidth: 160 }), renderCell: (run) => <Text hasTabularNumbers color="secondary">{formatWhen(run.completedAt)}</Text> },
          { key: "recordsLoaded", header: "Rows", align: "end", width: proportional(1, { minWidth: 90 }), renderCell: (run) => <Text hasTabularNumbers>{run.recordsLoaded.toLocaleString()}</Text> },
          { key: "errorSummary", header: "Detail", width: proportional(2, { minWidth: 200 }), renderCell: (run) => <Text color="secondary">{run.errorSummary ?? "—"}</Text> },
        ]}
      />
    </SectionCard>
  )
}

function LoadTimeline({ runs }: { runs: IngestionRun[] }) {
  return (
    <SectionCard title="Load timeline" description="Most recent observed load for each supplied source.">
      <Timeline
        layout="row"
        events={runs.map((run) => ({
          id: run.runId,
          label: run.sourceName,
          at: formatWhen(run.completedAt),
          status: run.status === "failed" ? "critical" : run.status === "stale" ? "warning" : "ok",
          statusLabel: run.status === "failed" ? "Failed" : run.status === "stale" ? "Stale" : "Completed",
        }))}
      />
    </SectionCard>
  )
}

function IssueList({ issues }: { issues: DataQualityIssue[] }) {
  return (
    <SectionCard title="Validation findings" description="Links take you to the source record keys below; no clinical text is exposed here.">
      <List hasDividers edge="flush">
        {issues.map((issue) => (
          <ListItem
            key={issue.issueId}
            align="start"
            startContent={<Icon icon={CircleAlert} size="md" color={issue.severity === "high" ? "error" : "warning"} />}
            label={
              <Text weight="medium">
                {issue.title} <Text color="secondary" hasTabularNumbers>({issue.affectedCount})</Text>
              </Text>
            }
            description={
              <VStack gap={2}>
                <Text color="secondary">{issue.summary}</Text>
                <HStack gap={2} wrap="wrap">
                  {issue.records.map((record) => (
                    <Button key={record.recordId} variant="ghost" className="min-h-11" href={`#${recordTarget(record)}`} icon={<Icon icon={Link2} />} label="View record" />
                  ))}
                </HStack>
              </VStack>
            }
          />
        ))}
      </List>
    </SectionCard>
  )
}

type NodeRow = Record<string, unknown> & AdminDataQuality["questionGraph"]["nodes"][number]

function DependencyGraph({ graph }: { graph: AdminDataQuality["questionGraph"] }) {
  const states = [
    ["Missing parents", graph.missingParentCount],
    ["Duplicate keys", graph.duplicateKeyCount],
    ["Cycles", graph.cycleCount],
  ] as const
  return (
    <SectionCard title="Question dependency graph" icon={GitFork} description="Only validation exceptions are drawn; a clean state is shown as zero.">
      <div className="grid grid-cols-3 gap-3">
        {states.map(([label, count]) => (
          <Card key={label} padding={3}>
            <VStack gap={1}>
              <Text type="supporting">{label}</Text>
              <Text size="2xl" weight="semibold" hasTabularNumbers color={count ? "primary" : "secondary"}>{count}</Text>
            </VStack>
          </Card>
        ))}
      </div>
      <div data-testid="question-dependency-graph">
        {graph.nodes.length ? (
          <Card padding={0}>
            <Table<NodeRow>
              data={graph.nodes.map((node) => ({ ...node, key: `${node.questionId}-${node.state}` }))}
              idKey="key"
              columns={[
                { key: "questionId", header: "Question", width: proportional(1, { minWidth: 120 }), renderCell: (node) => <Text type="code" className="break-all">{node.questionId}</Text> },
                { key: "state", header: "Depends on", width: proportional(1, { minWidth: 140 }), renderCell: (node) => <Text type="code" className="break-all">{node.parentQuestionId ?? "No parent"}</Text> },
                { key: "problem", header: "Problem", width: proportional(1, { minWidth: 120 }), renderCell: (node) => <Badge variant="error" label={node.state} /> },
              ]}
            />
          </Card>
        ) : (
          <Banner status="success" title="No invalid dependencies found." collapsible={false} />
        )}
      </div>
    </SectionCard>
  )
}

function RecordIndex({ issues }: { issues: DataQualityIssue[] }) {
  const records = Array.from(new Map(issues.flatMap((issue) => issue.records).map((record) => [record.recordId, record])).values())
  return (
    <SectionCard title="Offending records" description="Stable source identifiers for investigation and correction.">
      <List hasDividers edge="flush">
        {records.map((record) => (
          <ListItem
            key={record.recordId}
            id={recordTarget(record)}
            className="scroll-mt-24"
            label={<Text weight="medium">{record.label}</Text>}
            description={<Text type="code" className="break-all">{record.sourceTable} · {record.sourceRecordId}</Text>}
          />
        ))}
      </List>
    </SectionCard>
  )
}

/** Administrator-only ingestion and deterministic data-quality workspace. */
export function AdminDataQuality() {
  const { user } = useSession()
  const adapter = useDataAdapter()
  const query = useQuery("adminDataQuality", "admin-data-quality", (ctx) => {
    if (!adapter.adminDataQuality) throw new Error("Admin data quality is unavailable in this adapter.")
    return adapter.adminDataQuality(ctx)
  })
  return (
    <div className="flex flex-col gap-6">
      <VStack as="header" gap={3}>
        <Heading level={2} type="display-3">Data quality</Heading>
        <div className="max-w-2xl"><Text type="large" color="secondary" as="p">Monitor ingestion health and validate identity, source grain, and question dependencies.</Text></div>
        <div><ScopeLabel label={user.scopeLabel} /></div>
      </VStack>
      {query.status === "loading" ? (
        <DashboardGrid>
          <DashboardGridItem area="half"><BlockSkeleton className="h-80" /></DashboardGridItem>
          <DashboardGridItem area="half"><BlockSkeleton className="h-80" /></DashboardGridItem>
        </DashboardGrid>
      ) : query.status === "error" ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : (
        <QualityWorkspace data={query.data} onRefresh={query.refetch} />
      )}
    </div>
  )
}

function Stat({ title, value, caption, tone }: { title: string; value: string; caption: string; tone?: "primary" | "accent" }) {
  return (
    <Card padding={4}>
      <VStack gap={1}>
        <Heading level={3}>{title}</Heading>
        <Text size="3xl" weight="semibold" hasTabularNumbers color={tone}>{value}</Text>
        <Text type="supporting" as="p">{caption}</Text>
      </VStack>
    </Card>
  )
}

function QualityWorkspace({ data, onRefresh }: { data: AdminDataQuality; onRefresh: () => void }) {
  const hasLoadIssue = data.ingestionRuns.some((run) => run.status === "failed" || run.status === "stale")
  return (
    <>
      <Banner
        status={hasLoadIssue ? "warning" : "success"}
        title={hasLoadIssue ? "Pipeline attention required" : "All monitored loads are current"}
        collapsible={false}
      />
      <DashboardGrid>
        <DashboardGridItem area="focus"><IngestionPanel runs={data.ingestionRuns} onRefresh={onRefresh} /></DashboardGridItem>
        <DashboardGridItem area="detail"><LoadTimeline runs={data.ingestionRuns} /></DashboardGridItem>
      </DashboardGrid>
      <DashboardGrid>
        <DashboardGridItem area="third"><Stat title="Identity reconciliation" value={data.identities.matched.toLocaleString()} caption={`matched identities · ${data.identities.unmatched} unmatched`} /></DashboardGridItem>
        <DashboardGridItem area="third"><Stat title="Duplicate keys" value={data.duplicateKeyCount.toLocaleString()} caption="duplicate response-key groups" /></DashboardGridItem>
        <DashboardGridItem area="third"><Stat title="Record grain" value={data.recordGrain.callProductRows.toLocaleString()} caption={`call-product rows · ${data.recordGrain.distinctCalls.toLocaleString()} distinct calls`} /></DashboardGridItem>
      </DashboardGrid>
      <DashboardGrid>
        <DashboardGridItem area="focus"><IssueList issues={data.issues} /></DashboardGridItem>
        <DashboardGridItem area="detail"><DependencyGraph graph={data.questionGraph} /></DashboardGridItem>
      </DashboardGrid>
      <RecordIndex issues={data.issues} />
    </>
  )
}
