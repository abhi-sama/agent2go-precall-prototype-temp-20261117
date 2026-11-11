"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Collapsible } from "@astryxdesign/core/Collapsible"
import { EmptyState } from "@astryxdesign/core/EmptyState"
import { Heading } from "@astryxdesign/core/Heading"
import { Selector } from "@astryxdesign/core/Selector"
import { Table } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react"
import * as React from "react"
import { LineChart } from "@/components/charts/viz/line-chart"
import type { EvalMetricDelta, EvalQuestionDiff, EvalRunDiff, EvalRunSummary } from "@/lib/data/evals"
import { isFinished, pct, when } from "./format"
import { ResultRow } from "./run-view"
import { ChangeBadge, StatusPill, VerdictBadge } from "./verdict"

type HistoryRow = { id: string; run: EvalRunSummary }
type MetricRow = { id: string; metric: EvalMetricDelta }

export function RunHistory({ runs, onOpen }: { runs: EvalRunSummary[]; onOpen: (runId: string) => void }) {
  const finished = runs.filter((r) => r.status === "COMPLETE" && r.source === "AGENT" && r.questionCount).slice().reverse()
  const points = finished.map((r) => ({ key: r.runId, label: when(r.startedAt), value: Math.round(((r.passedCount ?? 0) / (r.questionCount ?? 1)) * 100) }))
  if (runs.length === 0) {
    return (
      <div data-testid="history-empty">
        <EmptyState isCompact title="No runs yet" description="No runs yet for this persona. Run the suite to start a history." />
      </div>
    )
  }
  const rows: HistoryRow[] = runs.map((run) => ({ id: run.runId, run }))
  return (
    <VStack gap={5}>
      {points.length >= 2 && (
        <section aria-label="Questions passed over time">
          <Card padding={4}>
            <Heading level={4} weight="semibold">Questions passed, run by run</Heading>
            <Text type="supporting" as="p" display="block">Share of golden questions that passed in each run of the real agent, oldest to newest.</Text>
            <div className="mt-2">
              <LineChart points={points} unit="% of questions passed" testId="history-trend" height={200} />
            </div>
          </Card>
        </section>
      )}
      <div data-testid="run-history">
        <Table<HistoryRow>
          data={rows}
          idKey="id"
          hasHover
          columns={[
            {
              key: "started",
              header: "Run",
              renderCell: ({ run }) => (
                <span data-testid={`history-${run.runId}`} className="flex flex-col">
                  <Text weight="medium">{when(run.startedAt)}</Text>
                  <Text type="supporting">{run.source === "LEAKY_CANARY" ? "Detector self-test" : "Real agent"}</Text>
                </span>
              ),
            },
            { key: "faithful", header: "Faithful", align: "end", renderCell: ({ run }) => (run.status === "COMPLETE" ? <Text hasTabularNumbers>{pct(run.faithfulness)}</Text> : "") },
            { key: "citations", header: "Citations", align: "end", renderCell: ({ run }) => (run.status === "COMPLETE" ? <Text hasTabularNumbers>{pct(run.citationCorrectness)}</Text> : "") },
            { key: "exact", header: "Exact", align: "end", renderCell: ({ run }) => (run.status === "COMPLETE" ? <Text hasTabularNumbers>{pct(run.exactCountRate)}</Text> : "") },
            { key: "direction", header: "Direction", align: "end", renderCell: ({ run }) => (run.status === "COMPLETE" && run.directionRate !== null ? <Text hasTabularNumbers>{pct(run.directionRate)}</Text> : "") },
            { key: "depth", header: "Depth", align: "end", renderCell: ({ run }) => (run.status === "COMPLETE" && run.chainDepth ? <Text hasTabularNumbers>{run.chainDepth}</Text> : "") },
            { key: "leaks", header: "Leaks", align: "end", renderCell: ({ run }) => (isFinished(run) && run.status === "COMPLETE" ? <Text hasTabularNumbers>{run.leakCount}</Text> : "") },
            { key: "verdict", header: "Verdict", renderCell: ({ run }) => (run.status === "COMPLETE" ? <VerdictBadge verdict={run.verdict} leaked={run.leakCount > 0} /> : <StatusPill status={run.status} />) },
            {
              key: "open",
              header: "Open",
              renderCell: ({ run }) => (
                <Button variant="secondary" size="sm" label="View" data-testid={`open-${run.runId}`} onClick={() => onOpen(run.runId)} aria-label={`View results of the run started ${when(run.startedAt)}`} />
              ),
            },
          ]}
        />
      </div>
    </VStack>
  )
}

function deltaOf(metric: EvalMetricDelta) {
  const isCount = metric.metric === "leakCount" || metric.metric === "passedCount"
  const fmt = (v: number | null) => (v === null ? "—" : isCount ? String(v) : pct(v))
  const lowerIsBetter = metric.metric === "leakCount"
  const d = metric.delta
  const better = d === null || d === 0 ? null : lowerIsBetter ? d < 0 : d > 0
  const Icon = d === null || d === 0 ? ArrowRight : d > 0 ? ArrowUpRight : ArrowDownRight
  const text = d === null || d === 0 ? "No change" : `${better ? "Better" : "Worse"} · ${isCount ? Math.abs(d) : `${Math.round(Math.abs(d) * 100)} pts`}`
  return { fmt, better, Icon, text }
}

function DiffRow({ item }: { item: EvalQuestionDiff }) {
  const [open, setOpen] = React.useState(false)
  return (
    <li data-testid={`diff-${item.questionId}`} data-change={item.change}>
      <Card padding={0}>
        <Collapsible
          isOpen={open}
          onOpenChange={setOpen}
          chevronPosition="end"
          trigger={
            <span className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 py-1 text-start">
              <span className="min-w-0 flex-1 basis-56"><Text weight="medium">{item.title}</Text></span>
              <span className="flex items-center gap-2">
                {item.base ? <VerdictBadge verdict={item.base.verdict} leaked={item.base.leaked} /> : <Text color="secondary">Not asked</Text>}
                <ArrowRight className="size-4 text-(--color-text-secondary)" aria-hidden />
                {item.head ? <VerdictBadge verdict={item.head.verdict} leaked={item.head.leaked} /> : <Text color="secondary">Not asked</Text>}
              </span>
              <ChangeBadge change={item.change} />
            </span>
          }
        >
          {open && (
            <div className="grid gap-3 p-4 md:grid-cols-2">
              {[
                ["Earlier run", item.base],
                ["Later run", item.head],
              ].map(([label, result]) => (
                <div key={label as string} className="min-w-0">
                  <Text type="label" color="secondary" as="p" display="block">{label as string}</Text>
                  {result ? <ul><ResultRow result={result as NonNullable<EvalQuestionDiff["base"]>} /></ul> : <Text color="secondary" as="p" display="block">This question was not in that run.</Text>}
                </div>
              ))}
            </div>
          )}
        </Collapsible>
      </Card>
    </li>
  )
}

export function DiffView({ diff }: { diff: EvalRunDiff }) {
  const c = diff.counts
  const metrics: MetricRow[] = diff.metrics.map((metric) => ({ id: metric.metric, metric }))
  return (
    <VStack gap={5} data-testid="diff-view">
      <div className="flex flex-wrap items-center gap-3">
        <Heading level={3} weight="semibold">{diff.head.personaLabel} suite, earlier run to later run</Heading>
        <ChangeBadge change={diff.verdictChange} />
      </div>
      <Text type="supporting" as="p" display="block">
        {when(diff.base.startedAt)} {diff.base.verdict === "PASS" ? "passed" : "failed"} · {when(diff.head.startedAt)} {diff.head.verdict === "PASS" ? "passed" : "failed"}
      </Text>
      {diff.suiteChanged && (
        <div data-testid="suite-changed" role="note">
          <Banner status="warning" collapsible={false} title="The two runs did not ask the same questions, so only the questions in both are compared one for one." />
        </div>
      )}
      <Table<MetricRow>
        data={metrics}
        idKey="id"
        columns={[
          { key: "score", header: "Score", renderCell: ({ metric }) => <span data-testid={`metric-${metric.metric}`}><Text weight="medium">{metric.label}</Text></span> },
          { key: "base", header: "Earlier", renderCell: ({ metric }) => <Text hasTabularNumbers>{deltaOf(metric).fmt(metric.base)}</Text> },
          { key: "head", header: "Later", renderCell: ({ metric }) => <Text hasTabularNumbers>{deltaOf(metric).fmt(metric.head)}</Text> },
          {
            key: "change",
            header: "Change",
            renderCell: ({ metric }) => {
              const { better, Icon, text } = deltaOf(metric)
              return <Badge variant={better === true ? "success" : better === false ? "error" : "neutral"} icon={<Icon aria-hidden className="size-3.5" />} label={text} />
            },
          },
        ]}
      />
      <p data-testid="diff-counts" className="flex flex-wrap gap-2">
        {[
          ["Improved", c.improved],
          ["Regressed", c.regressed],
          ["Unchanged", c.unchanged],
          ["New", c.added],
          ["Dropped", c.removed],
        ].map(([label, n]) => (
          <Badge key={label as string} variant="neutral" label={`${label as string} ${n as number}`} />
        ))}
      </p>
      <ul className="flex flex-col gap-2">
        {diff.questions.map((item) => (
          <DiffRow key={item.questionId} item={item} />
        ))}
      </ul>
    </VStack>
  )
}

export function ComparePicker({ runs, base, head, onChange }: { runs: EvalRunSummary[]; base: string; head: string; onChange: (base: string, head: string) => void }) {
  const done = runs.filter((r) => r.status === "COMPLETE")
  const label = (r: EvalRunSummary) => `${when(r.startedAt)} · ${r.source === "LEAKY_CANARY" ? "self-test" : "real agent"} · ${r.verdict === "PASS" ? "pass" : "fail"}`
  const options = done.map((r) => ({ value: r.runId, label: label(r) }))
  return (
    <div data-testid="compare-picker" className="grid gap-3 sm:grid-cols-2">
      <Selector label="Earlier run" data-testid="compare-base" options={options} value={base} onChange={(value) => onChange(value, head)} width="100%" />
      <Selector label="Later run" data-testid="compare-head" options={options} value={head} onChange={(value) => onChange(base, value)} width="100%" />
    </div>
  )
}
