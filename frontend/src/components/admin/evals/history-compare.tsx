"use client"

import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react"
import * as React from "react"
import { LineChart } from "@/components/charts/viz/line-chart"
import { Button } from "@/components/ui/button"
import type { EvalMetricDelta, EvalQuestionDiff, EvalRunDiff, EvalRunSummary } from "@/lib/data/evals"
import { cn } from "@/lib/utils"
import { isFinished, pct, when } from "./format"
import { ResultRow } from "./run-view"
import { ChangeBadge, StatusPill, VerdictBadge } from "./verdict"

const SELECT =
  "min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"

export function RunHistory({ runs, onOpen }: { runs: EvalRunSummary[]; onOpen: (runId: string) => void }) {
  const finished = runs.filter((r) => r.status === "COMPLETE" && r.source === "AGENT" && r.questionCount).slice().reverse()
  const points = finished.map((r) => ({ key: r.runId, label: when(r.startedAt), value: Math.round(((r.passedCount ?? 0) / (r.questionCount ?? 1)) * 100) }))
  if (runs.length === 0) {
    return (
      <p data-testid="history-empty" className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        No runs yet for this persona. Run the suite to start a history.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-5">
      {points.length >= 2 && (
        <section aria-label="Questions passed over time" className="rounded-2xl border bg-card p-4">
          <h4 className="font-semibold">Questions passed, run by run</h4>
          <p className="mb-2 text-sm text-muted-foreground">Share of golden questions that passed in each run of the real agent, oldest to newest.</p>
          <LineChart points={points} unit="% of questions passed" testId="history-trend" height={200} />
        </section>
      )}
      <ul data-testid="run-history" className="flex flex-col gap-2">
        {runs.map((run) => (
          <li key={run.runId} data-testid={`history-${run.runId}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border bg-card px-4 py-3">
            <div className="flex min-w-0 flex-1 basis-48 flex-col">
              <span className="font-medium">{when(run.startedAt)}</span>
              <span className="text-xs text-muted-foreground">{run.source === "LEAKY_CANARY" ? "Detector self-test" : "Real agent"}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums">
              {isFinished(run) && run.status === "COMPLETE" ? (
                <>
                  <span>Faithful <strong>{pct(run.faithfulness)}</strong></span>
                  <span>Citations <strong>{pct(run.citationCorrectness)}</strong></span>
                  <span>Exact <strong>{pct(run.exactCountRate)}</strong></span>
                  {run.directionRate !== null && <span>Direction <strong>{pct(run.directionRate)}</strong></span>}
                  {run.chainDepth ? <span>Depth <strong>{run.chainDepth}</strong></span> : null}
                  <span>Leaks <strong>{run.leakCount}</strong></span>
                </>
              ) : null}
            </div>
            {run.status === "COMPLETE" ? <VerdictBadge verdict={run.verdict} leaked={run.leakCount > 0} /> : <StatusPill status={run.status} />}
            <Button variant="outline" size="sm" data-testid={`open-${run.runId}`} onClick={() => onOpen(run.runId)} aria-label={`View results of the run started ${when(run.startedAt)}`}>
              View
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Delta({ metric }: { metric: EvalMetricDelta }) {
  const isCount = metric.metric === "leakCount" || metric.metric === "passedCount"
  const fmt = (v: number | null) => (v === null ? "—" : isCount ? String(v) : pct(v))
  const lowerIsBetter = metric.metric === "leakCount"
  const d = metric.delta
  const better = d === null || d === 0 ? null : lowerIsBetter ? d < 0 : d > 0
  const Icon = d === null || d === 0 ? ArrowRight : d > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <tr data-testid={`metric-${metric.metric}`} className="border-t">
      <th scope="row" className="py-3 pr-3 text-left font-medium">{metric.label}</th>
      <td className="py-3 pr-3 tabular-nums">{fmt(metric.base)}</td>
      <td className="py-3 pr-3 tabular-nums">{fmt(metric.head)}</td>
      <td className="py-3">
        <span className={cn("inline-flex min-h-7 items-center gap-1 rounded-full px-2 text-xs font-semibold tabular-nums", better === true && "bg-success/10", better === false && "bg-destructive/10", better === null && "bg-muted text-muted-foreground")}>
          <Icon className="size-3.5" aria-hidden />
          {d === null || d === 0 ? "No change" : `${better ? "Better" : "Worse"} · ${isCount ? Math.abs(d) : `${Math.round(Math.abs(d) * 100)} pts`}`}
        </span>
      </td>
    </tr>
  )
}

function DiffRow({ item }: { item: EvalQuestionDiff }) {
  const [open, setOpen] = React.useState(false)
  const id = React.useId()
  return (
    <li data-testid={`diff-${item.questionId}`} data-change={item.change} className="rounded-2xl border bg-card">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="flex min-h-14 w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        <span className="min-w-0 flex-1 basis-56 font-medium">{item.title}</span>
        <span className="flex items-center gap-2 text-sm">
          {item.base ? <VerdictBadge verdict={item.base.verdict} leaked={item.base.leaked} /> : <span className="text-muted-foreground">Not asked</span>}
          <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
          {item.head ? <VerdictBadge verdict={item.head.verdict} leaked={item.head.leaked} /> : <span className="text-muted-foreground">Not asked</span>}
        </span>
        <ChangeBadge change={item.change} />
      </button>
      {open && (
        <div id={id} className="grid gap-3 border-t p-4 md:grid-cols-2">
          {[
            ["Earlier run", item.base],
            ["Later run", item.head],
          ].map(([label, result]) => (
            <div key={label as string} className="min-w-0">
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label as string}</p>
              {result ? <ul><ResultRow result={result as NonNullable<EvalQuestionDiff["base"]>} /></ul> : <p className="text-sm text-muted-foreground">This question was not in that run.</p>}
            </div>
          ))}
        </div>
      )}
    </li>
  )
}

export function DiffView({ diff }: { diff: EvalRunDiff }) {
  const c = diff.counts
  return (
    <div data-testid="diff-view" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-xl font-semibold tracking-tight">{diff.head.personaLabel} suite, earlier run to later run</h3>
        <ChangeBadge change={diff.verdictChange} />
      </div>
      <p className="text-sm text-muted-foreground">
        {when(diff.base.startedAt)} {diff.base.verdict === "PASS" ? "passed" : "failed"} · {when(diff.head.startedAt)} {diff.head.verdict === "PASS" ? "passed" : "failed"}
      </p>
      {diff.suiteChanged && (
        <p data-testid="suite-changed" role="note" className="rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm">
          The two runs did not ask the same questions, so only the questions in both are compared one for one.
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl border bg-card px-4">
        <table className="w-full min-w-[26rem] text-sm">
          <caption className="sr-only">Scores in the earlier and later run</caption>
          <thead>
            <tr className="text-left text-xs tracking-wide text-muted-foreground uppercase">
              <th scope="col" className="py-3 pr-3 font-semibold">Score</th>
              <th scope="col" className="py-3 pr-3 font-semibold">Earlier</th>
              <th scope="col" className="py-3 pr-3 font-semibold">Later</th>
              <th scope="col" className="py-3 font-semibold">Change</th>
            </tr>
          </thead>
          <tbody>
            {diff.metrics.map((m) => (
              <Delta key={m.metric} metric={m} />
            ))}
          </tbody>
        </table>
      </div>
      <p data-testid="diff-counts" className="flex flex-wrap gap-2 text-sm">
        {[
          ["Improved", c.improved],
          ["Regressed", c.regressed],
          ["Unchanged", c.unchanged],
          ["New", c.added],
          ["Dropped", c.removed],
        ].map(([label, n]) => (
          <span key={label as string} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border bg-card px-3">
            {label as string} <strong className="tabular-nums">{n as number}</strong>
          </span>
        ))}
      </p>
      <ul className="flex flex-col gap-2">
        {diff.questions.map((item) => (
          <DiffRow key={item.questionId} item={item} />
        ))}
      </ul>
    </div>
  )
}

export function ComparePicker({ runs, base, head, onChange }: { runs: EvalRunSummary[]; base: string; head: string; onChange: (base: string, head: string) => void }) {
  const done = runs.filter((r) => r.status === "COMPLETE")
  const label = (r: EvalRunSummary) => `${when(r.startedAt)} · ${r.source === "LEAKY_CANARY" ? "self-test" : "real agent"} · ${r.verdict === "PASS" ? "pass" : "fail"}`
  return (
    <div data-testid="compare-picker" className="grid gap-3 sm:grid-cols-2">
      <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
        Earlier run
        <select data-testid="compare-base" className={SELECT} value={base} onChange={(e) => onChange(e.target.value, head)}>
          {done.map((r) => (
            <option key={r.runId} value={r.runId}>{label(r)}</option>
          ))}
        </select>
      </label>
      <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
        Later run
        <select data-testid="compare-head" className={SELECT} value={head} onChange={(e) => onChange(base, e.target.value)}>
          {done.map((r) => (
            <option key={r.runId} value={r.runId}>{label(r)}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
