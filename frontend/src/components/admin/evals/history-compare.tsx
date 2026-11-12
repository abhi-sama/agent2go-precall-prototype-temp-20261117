"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Collapsible } from "@astryxdesign/core/Collapsible"
import { EmptyState } from "@astryxdesign/core/EmptyState"
import { Grid } from "@astryxdesign/core/Grid"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Selector } from "@astryxdesign/core/Selector"
import { Table, proportional } from "@astryxdesign/core/Table"
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
      <VStack data-testid="history-empty">
        <EmptyState isCompact title="No runs yet" description="No runs yet for this persona. Run the suite to start a history." />
      </VStack>
    )
  }
  const rows: HistoryRow[] = runs.map((run) => ({ id: run.runId, run }))
  return (
    <VStack gap={5}>
      {points.length >= 2 && (
        <VStack as="section" aria-label="Questions passed over time">
          <Card padding={4}>
            <Heading level={4} weight="semibold">Questions passed, run by run</Heading>
            <Text type="supporting" as="p" display="block">Share of golden questions that passed in each run of the real agent, oldest to newest.</Text>
            <VStack paddingBlockStart={2}>
              <LineChart points={points} unit="% of questions passed" testId="history-trend" height={200} />
            </VStack>
          </Card>
        </VStack>
      )}
      <VStack data-testid="run-history">
        <Table<HistoryRow>
          data={rows}
          idKey="id"
          hasHover
          columns={[
            {
              key: "started",
              header: "Run",
              renderCell: ({ run }) => (
                <VStack as="span" data-testid={`history-${run.runId}`}>
                  <Text weight="medium">{when(run.startedAt)}</Text>
                  <Text type="supporting">{run.source === "LEAKY_CANARY" ? "Detector self-test" : "Real agent"}</Text>
                </VStack>
              ),
            },
            { key: "faithful", header: "Faithful", align: "end", renderCell: ({ run }) => (run.status === "COMPLETE" ? <Text hasTabularNumbers>{pct(run.faithfulness)}</Text> : "") },
            { key: "citations", header: "Citations", align: "end", renderCell: ({ run }) => (run.status === "COMPLETE" ? <Text hasTabularNumbers>{pct(run.citationCorrectness)}</Text> : "") },
            { key: "exact", header: "Exact", align: "end", renderCell: ({ run }) => (run.status === "COMPLETE" ? <Text hasTabularNumbers>{pct(run.exactCountRate)}</Text> : "") },
            { key: "direction", header: "Direction", align: "end", renderCell: ({ run }) => (run.status === "COMPLETE" && run.directionRate !== null ? <Text hasTabularNumbers>{pct(run.directionRate)}</Text> : "") },
            { key: "depth", header: "Depth", align: "end", renderCell: ({ run }) => (run.status === "COMPLETE" && run.chainDepth ? <Text hasTabularNumbers>{run.chainDepth}</Text> : "") },
            { key: "leaks", header: "Leaks", align: "end", renderCell: ({ run }) => (isFinished(run) && run.status === "COMPLETE" ? <Text hasTabularNumbers>{run.leakCount}</Text> : "") },
            { key: "verdict", header: "Verdict", width: proportional(1, { minWidth: 128 }), renderCell: ({ run }) => (run.status === "COMPLETE" ? <VerdictBadge verdict={run.verdict} leaked={run.leakCount > 0} /> : <StatusPill status={run.status} />) },
            {
              key: "open",
              header: "Open",
              renderCell: ({ run }) => (
                <Button variant="secondary" size="sm" label="View" data-testid={`open-${run.runId}`} onClick={() => onOpen(run.runId)} aria-label={`View results of the run started ${when(run.startedAt)}`} />
              ),
            },
          ]}
        />
      </VStack>
    </VStack>
  )
}

function deltaOf(metric: EvalMetricDelta) {
  const isCount = metric.metric === "leakCount" || metric.metric === "passedCount"
  const fmt = (v: number | null) => (v === null ? "—" : isCount ? String(v) : pct(v))
  const lowerIsBetter = metric.metric === "leakCount"
  const d = metric.delta
  const better = d === null || d === 0 ? null : lowerIsBetter ? d < 0 : d > 0
  const Glyph = d === null || d === 0 ? ArrowRight : d > 0 ? ArrowUpRight : ArrowDownRight
  const text = d === null || d === 0 ? "No change" : `${better ? "Better" : "Worse"} · ${isCount ? Math.abs(d) : `${Math.round(Math.abs(d) * 100)} pts`}`
  return { fmt, better, Glyph, text }
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
            <HStack as="span" gap={3} wrap="wrap" align="center" paddingBlock={1} width="100%" className="text-start">
              <Text weight="medium" className="min-w-0 flex-1 basis-56">{item.title}</Text>
              <HStack as="span" gap={2} align="center">
                {item.base ? <VerdictBadge verdict={item.base.verdict} leaked={item.base.leaked} /> : <Text color="secondary">Not asked</Text>}
                <Icon icon={ArrowRight} size="sm" color="secondary" />
                {item.head ? <VerdictBadge verdict={item.head.verdict} leaked={item.head.leaked} /> : <Text color="secondary">Not asked</Text>}
              </HStack>
              <ChangeBadge change={item.change} />
            </HStack>
          }
        >
          {open && (
            <VStack padding={4}>
              <Grid columns={{ minWidth: 320, max: 2 }} gap={3}>
                {[
                  ["Earlier run", item.base],
                  ["Later run", item.head],
                ].map(([label, result]) => (
                  <VStack key={label as string} className="min-w-0">
                    <Text type="label" color="secondary" as="p" display="block">{label as string}</Text>
                    {result ? <VStack as="ul"><ResultRow result={result as NonNullable<EvalQuestionDiff["base"]>} /></VStack> : <Text color="secondary" as="p" display="block">This question was not in that run.</Text>}
                  </VStack>
                ))}
              </Grid>
            </VStack>
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
      <HStack gap={3} wrap="wrap" align="center">
        <Heading level={3} weight="semibold">{diff.head.personaLabel} suite, earlier run to later run</Heading>
        <ChangeBadge change={diff.verdictChange} />
      </HStack>
      <Text type="supporting" as="p" display="block">
        {when(diff.base.startedAt)} {diff.base.verdict === "PASS" ? "passed" : "failed"} · {when(diff.head.startedAt)} {diff.head.verdict === "PASS" ? "passed" : "failed"}
      </Text>
      {diff.suiteChanged && (
        <VStack data-testid="suite-changed" role="note">
          <Banner status="warning" collapsible={false} title="The two runs did not ask the same questions, so only the questions in both are compared one for one." />
        </VStack>
      )}
      <Table<MetricRow>
        data={metrics}
        idKey="id"
        columns={[
          { key: "score", header: "Score", renderCell: ({ metric }) => <Text weight="medium" data-testid={`metric-${metric.metric}`}>{metric.label}</Text> },
          { key: "base", header: "Earlier", renderCell: ({ metric }) => <Text hasTabularNumbers>{deltaOf(metric).fmt(metric.base)}</Text> },
          { key: "head", header: "Later", renderCell: ({ metric }) => <Text hasTabularNumbers>{deltaOf(metric).fmt(metric.head)}</Text> },
          {
            key: "change",
            header: "Change",
            renderCell: ({ metric }) => {
              const { better, Glyph, text } = deltaOf(metric)
              return <Badge variant={better === true ? "success" : better === false ? "error" : "neutral"} icon={<Icon icon={Glyph} size="xsm" />} label={text} />
            },
          },
        ]}
      />
      <HStack gap={2} wrap="wrap" data-testid="diff-counts">
        {[
          ["Improved", c.improved],
          ["Regressed", c.regressed],
          ["Unchanged", c.unchanged],
          ["New", c.added],
          ["Dropped", c.removed],
        ].map(([label, n]) => (
          <Badge key={label as string} variant="neutral" label={`${label as string} ${n as number}`} />
        ))}
      </HStack>
      <VStack as="ul" gap={2}>
        {diff.questions.map((item) => (
          <DiffRow key={item.questionId} item={item} />
        ))}
      </VStack>
    </VStack>
  )
}

export function ComparePicker({ runs, base, head, onChange }: { runs: EvalRunSummary[]; base: string; head: string; onChange: (base: string, head: string) => void }) {
  const done = runs.filter((r) => r.status === "COMPLETE")
  const label = (r: EvalRunSummary) => `${when(r.startedAt)} · ${r.source === "LEAKY_CANARY" ? "self-test" : "real agent"} · ${r.verdict === "PASS" ? "pass" : "fail"}`
  const options = done.map((r) => ({ value: r.runId, label: label(r) }))
  return (
    <Grid columns={{ minWidth: 240, max: 2 }} gap={3} data-testid="compare-picker">
      <Selector label="Earlier run" data-testid="compare-base" options={options} value={base} onChange={(value) => onChange(value, head)} width="100%" />
      <Selector label="Later run" data-testid="compare-head" options={options} value={head} onChange={(value) => onChange(base, value)} width="100%" />
    </Grid>
  )
}
