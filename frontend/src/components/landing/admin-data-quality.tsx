"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  DatabaseZap,
  GitFork,
  Link2,
  RefreshCw,
} from "lucide-react";
import { Timeline } from "@/components/charts/timeline";
import { ScopeLabel } from "@/components/shell/scope-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BlockSkeleton, ErrorState } from "@/components/state/states";
import { useDataAdapter } from "@/lib/data/data-provider";
import type {
  AdminDataQuality,
  DataQualityIssue,
  IngestionRun,
  QualityRecord,
} from "@/lib/data/types";
import { useQuery } from "@/lib/data/use-query";
import { useSession } from "@/lib/session/session-provider";

const statusTone: Record<string, string> = {
  completed: "border-success/35 bg-success/10 text-success",
  stale: "border-warning/45 bg-warning/10 text-warning",
  failed: "border-destructive/35 bg-destructive/10 text-destructive",
  running: "border-ink/35 bg-ink/10 text-ink",
};
const StatusBadge = ({ status }: { status: string }) => (
  <Badge variant="outline" className={statusTone[status] ?? ""}>
    {status}
  </Badge>
);
const formatWhen = (value: string | null) =>
  value
    ? `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(value))} UTC`
    : "In progress";
const recordTarget = (record: QualityRecord) =>
  `quality-record-${record.recordId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

function IngestionPanel({ runs }: { runs: IngestionRun[] }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseZap className="size-4 text-accent-text" aria-hidden />
          Pipeline status
        </CardTitle>
        <CardDescription>
          Stale means a completed load is more than 30 days old.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="border-y bg-muted/60 text-xs font-semibold text-muted-foreground uppercase">
            <tr>
              <th className="px-3 py-2.5">Source</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Finished</th>
              <th className="px-3 py-2.5 text-right">Rows</th>
              <th className="px-3 py-2.5">Detail</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.runId} className="border-b last:border-0">
                <td className="px-3 py-3 font-medium">{run.sourceName}</td>
                <td className="px-3 py-3">
                  <StatusBadge status={run.status} />
                </td>
                <td className="px-3 py-3 tabular-nums text-muted-foreground">
                  {formatWhen(run.completedAt)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {run.recordsLoaded.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {run.errorSummary ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function LoadTimeline({ runs }: { runs: IngestionRun[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Load timeline</CardTitle>
        <CardDescription>
          Most recent observed load for each supplied source.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}

function IssueList({ issues }: { issues: DataQualityIssue[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Validation findings</CardTitle>
        <CardDescription>
          Links take you to the source record keys below; no clinical text is
          exposed here.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {issues.map((issue) => (
          <article
            key={issue.issueId}
            className="grid gap-2 rounded-xl bg-muted/55 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-start"
          >
            <CircleAlert
              className={
                issue.severity === "high"
                  ? "mt-0.5 size-5 text-destructive"
                  : "mt-0.5 size-5 text-warning"
              }
              aria-hidden
            />
            <div>
              <h3 className="font-medium">
                {issue.title}{" "}
                <span className="tabular-nums text-muted-foreground">
                  ({issue.affectedCount})
                </span>
              </h3>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                {issue.summary}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {issue.records.map((record) => (
                <a
                  key={record.recordId}
                  href={`#${recordTarget(record)}`}
                  className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-accent-text hover:bg-accent focus-visible:outline-none"
                >
                  <Link2 className="size-4" aria-hidden />
                  View record
                </a>
              ))}
            </div>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}

function DependencyGraph({
  graph,
}: {
  graph: AdminDataQuality["questionGraph"];
}) {
  const states = [
    ["Missing parents", graph.missingParentCount, "text-destructive"],
    ["Duplicate keys", graph.duplicateKeyCount, "text-warning"],
    ["Cycles", graph.cycleCount, "text-destructive"],
  ] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitFork className="size-4 text-accent-text" aria-hidden />
          Question dependency graph
        </CardTitle>
        <CardDescription>
          Only validation exceptions are drawn; a clean state is shown as zero.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-3 gap-2">
          {states.map(([label, count, tone]) => (
            <div key={label} className="rounded-xl bg-muted/55 p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>
                {count}
              </p>
            </div>
          ))}
        </div>
        <div data-testid="question-dependency-graph" className="grid gap-2">
          {graph.nodes.length ? (
            graph.nodes.map((node) => (
              <div
                key={`${node.questionId}-${node.state}`}
                className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm"
              >
                <span className="rounded-lg bg-destructive/10 px-3 py-2 font-medium text-destructive">
                  {node.questionId}
                </span>
                <span className="text-muted-foreground" aria-label="depends on">
                  →
                </span>
                <span className="rounded-lg border border-dashed border-destructive/45 px-3 py-2 text-destructive">
                  {node.parentQuestionId ?? "No parent"}
                </span>
              </div>
            ))
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-success/10 p-3 text-sm text-success">
              <CheckCircle2 className="size-4" aria-hidden />
              No invalid dependencies found.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RecordIndex({ issues }: { issues: DataQualityIssue[] }) {
  const records = Array.from(
    new Map(
      issues
        .flatMap((issue) => issue.records)
        .map((record) => [record.recordId, record]),
    ).values(),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Offending records</CardTitle>
        <CardDescription>
          Stable source identifiers for investigation and correction.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {records.map((record) => (
          <div
            key={record.recordId}
            id={recordTarget(record)}
            className="scroll-mt-24 rounded-xl bg-muted/55 px-3 py-3 text-sm"
          >
            <p className="font-medium">{record.label}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {record.sourceTable} · {record.sourceRecordId}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Administrator-only ingestion and deterministic data-quality workspace. */
export function AdminDataQuality() {
  const { user } = useSession();
  const adapter = useDataAdapter();
  const query = useQuery("adminDataQuality", "admin-data-quality", (ctx) => {
    if (!adapter.adminDataQuality)
      throw new Error("Admin data quality is unavailable in this adapter.");
    return adapter.adminDataQuality(ctx);
  });
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Data quality
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Monitor ingestion health and validate identity, source grain, and
          question dependencies.
        </p>
        <div>
          <ScopeLabel label={user.scopeLabel} />
        </div>
      </header>
      {query.status === "loading" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <BlockSkeleton className="h-80" />
          <BlockSkeleton className="h-80" />
        </div>
      ) : query.status === "error" ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : (
        <QualityWorkspace data={query.data} onRefresh={query.refetch} />
      )}
    </div>
  );
}

function QualityWorkspace({
  data,
  onRefresh,
}: {
  data: AdminDataQuality;
  onRefresh: () => void;
}) {
  const hasLoadIssue = data.ingestionRuns.some(
    (run) => run.status === "failed" || run.status === "stale",
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/55 p-4">
        <div className="flex items-center gap-3">
          <AlertTriangle
            className={
              hasLoadIssue ? "size-5 text-warning" : "size-5 text-success"
            }
            aria-hidden
          />
          <p className="text-sm font-medium">
            {hasLoadIssue
              ? "Pipeline attention required"
              : "All monitored loads are current"}
          </p>
        </div>
        <Button variant="outline" onClick={onRefresh}>
          <RefreshCw aria-hidden />
          Refresh checks
        </Button>
      </div>
      <div className="grid gap-4">
        <IngestionPanel runs={data.ingestionRuns} />
        <LoadTimeline runs={data.ingestionRuns} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Identity reconciliation</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">
              {data.identities.matched}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              matched identities
            </p>
            <p className="mt-4 text-sm font-medium text-warning">
              {data.identities.unmatched} unmatched
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Duplicate keys</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums text-destructive">
              {data.duplicateKeyCount}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              duplicate response-key groups
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Record grain</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">
              {data.recordGrain.callProductRows.toLocaleString()}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              call-product rows ·{" "}
              {data.recordGrain.distinctCalls.toLocaleString()} distinct calls
            </p>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <IssueList issues={data.issues} />
        <DependencyGraph graph={data.questionGraph} />
      </div>
      <RecordIndex issues={data.issues} />
    </>
  );
}
