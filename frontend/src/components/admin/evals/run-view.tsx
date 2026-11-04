"use client"

import { ChevronDown, ShieldCheck } from "lucide-react"
import * as React from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { REASON_TEXT, RUN_FAILURE_TEXT, type EvalResult, type EvalRun, type EvalRunSummary } from "@/lib/data/evals"
import { cn } from "@/lib/utils"
import { BAR, KIND_LABEL, pct, seconds, when } from "./format"
import { StatusPill, VerdictBadge } from "./verdict"

/**
 * One score against its bar. The value is the number; the bar and the word "Meets"/"Below" say whether the captain's
 * quality bar is met, so colour is never the only signal.
 */
function ScoreTile({ id, label, value, bar, hint }: { id: string; label: string; value: number | null; bar: number; hint: string }) {
  const met = value !== null && value >= bar
  return (
    <div data-testid={`score-${id}`} data-value={value ?? ""} className="min-w-0 rounded-2xl border bg-card p-4 shadow-card">
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">{pct(value)}</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none", met ? "bg-success" : "bg-warning")} style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {value === null ? "Not asked in this suite" : met ? "Meets the bar" : "Below the bar"} · {hint}
      </p>
    </div>
  )
}

function LeakTile({ count, probes }: { count: number; probes: number | null }) {
  return (
    <div data-testid="score-leaks" data-value={count} className={cn("min-w-0 rounded-2xl border bg-card p-4 shadow-card", count > 0 && "border-destructive/50")}>
      <p className="text-sm font-semibold text-muted-foreground">Leaks</p>
      <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">{count}</p>
      <p className="mt-3 text-sm text-muted-foreground">{count === 0 ? "No out-of-scope data retrieved" : "Out-of-scope data was retrieved. This fails the run."}</p>
      <p className="mt-2 text-xs text-muted-foreground">of {probes ?? "—"} leak probes · the bar is zero</p>
    </div>
  )
}

export function RunScores({ run }: { run: EvalRunSummary }) {
  return (
    <div data-testid="run-scores" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <ScoreTile id="faithfulness" label="Faithfulness" value={run.faithfulness} bar={BAR.faithfulness} hint="figures and quotes match the data" />
      <ScoreTile id="citations" label="Citation correctness" value={run.citationCorrectness} bar={BAR.citationCorrectness} hint="cited records are readable" />
      <ScoreTile id="exact" label="Exact counts" value={run.exactCountRate} bar={BAR.exactCountRate} hint="equal to the SQL count" />
      <LeakTile count={run.leakCount} probes={run.probeCount} />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{pct(value)}</span>
    </span>
  )
}

export function ResultRow({ result }: { result: EvalResult }) {
  const [open, setOpen] = React.useState(false)
  const id = React.useId()
  return (
    <li data-testid={`result-${result.questionId}`} data-verdict={result.verdict} data-leaked={result.leaked} className="rounded-2xl border bg-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-14 w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="flex min-w-0 flex-1 basis-56 flex-col">
          <span className="font-medium">{result.title}</span>
          <span className="text-xs text-muted-foreground">{KIND_LABEL[result.kind]}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {result.kind !== "LEAK_PROBE" && <Metric label="Faithful" value={result.faithfulness} />}
          {result.citations !== null && <Metric label="Citations" value={result.citations} />}
          {result.exactness !== null && <Metric label="Exact" value={result.exactness} />}
        </span>
        <VerdictBadge verdict={result.verdict} leaked={result.leaked} />
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div id={id} data-testid={`result-detail-${result.questionId}`} className="flex flex-col gap-3 border-t px-4 py-3 text-sm">
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Question asked</p>
            <p className="mt-1">{result.prompt}</p>
          </div>
          {result.reasons.length > 0 && (
            <ul data-testid="result-reasons" className="flex flex-col gap-1">
              {result.reasons.map((r) => (
                <li key={r} className="flex items-start gap-2 text-destructive">
                  <span aria-hidden>•</span>
                  <span className="text-foreground">{REASON_TEXT[r] ?? r}</span>
                </li>
              ))}
            </ul>
          )}
          {result.expected !== null && (
            <p>
              The database says <strong className="tabular-nums">{result.expected.toLocaleString("en-US")}</strong>.
            </p>
          )}
          <div className="rounded-xl border border-dashed bg-muted/40 p-3">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">What the agent answered</p>
            <p data-testid="answer-excerpt" className="mt-1 whitespace-pre-wrap break-words">{result.answerExcerpt || "No answer was returned."}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
            <div><dt>Figures claimed</dt><dd className="tabular-nums text-foreground">{result.numbersClaimed ?? 0} ({result.numbersUnverified ?? 0} unmatched)</dd></div>
            <div><dt>Quotes found</dt><dd className="tabular-nums text-foreground">{result.quotesFound ?? 0} of {result.quotesChecked ?? 0}</dd></div>
            <div><dt>Records readable</dt><dd className="tabular-nums text-foreground">{result.citationsReadable ?? 0} of {result.citationsCited ?? 0}</dd></div>
            <div><dt>Took</dt><dd className="tabular-nums text-foreground">{seconds(result.durationMs)}</dd></div>
          </dl>
        </div>
      )}
    </li>
  )
}

export function RunHeader({ run }: { run: EvalRunSummary }) {
  const failed = run.verdict === "FAIL"
  return (
    <div data-testid="run-header" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xl font-semibold tracking-tight">{run.personaLabel} suite</h3>
        <StatusPill status={run.status} />
        {run.status === "COMPLETE" && <VerdictBadge verdict={run.verdict} leaked={run.leakCount > 0} />}
        {run.source === "LEAKY_CANARY" && (
          <span data-testid="self-test-badge" className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-dashed px-2.5 text-xs font-semibold">
            <ShieldCheck className="size-3.5" aria-hidden />
            Detector self-test
          </span>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Asked as {run.subjectLabel} · started {when(run.startedAt)} · {run.status === "COMPLETE" ? `took ${seconds(run.durationMs)}` : run.status === "ERROR" ? "stopped" : "running"} · scored by {run.scorer}
      </p>
      {run.source === "LEAKY_CANARY" && (
        <p className="max-w-3xl text-sm text-muted-foreground">
          This run asked only the leak probes of a deliberately leaky stand-in, to prove the detector fails a run that retrieves out-of-scope data. It says nothing about the real agent.
        </p>
      )}
      {failed && run.failureReasons.length > 0 && (
        <ul data-testid="run-failure-reasons" className="flex flex-wrap gap-2">
          {run.failureReasons.map((r) => (
            <li key={r} className="inline-flex min-h-8 items-center rounded-full border border-destructive/40 bg-destructive/10 px-3 text-sm">{RUN_FAILURE_TEXT[r] ?? r}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function RunProgress({ run }: { run: EvalRunSummary }) {
  const total = run.questionCount ?? 0
  const share = total ? Math.round((run.answered / total) * 100) : 0
  return (
    <div data-testid="run-progress" role="status" className="rounded-2xl border bg-muted/40 p-4">
      <p className="font-medium">{run.status === "SCORING" ? "Scoring the answers…" : "Asking the agent the golden questions…"}</p>
      <p className="mt-1 text-sm text-muted-foreground tabular-nums">{run.answered} of {total || "—"} answered</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${share}%` }} />
      </div>
    </div>
  )
}

export function RunBody({ run }: { run: EvalRun }) {
  if (run.status === "ERROR") {
    return (
      <p data-testid="run-error" role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
        This run did not finish{run.errorCode === "TIMED_OUT" ? " in time" : ""}. Start it again; nothing was changed.
      </p>
    )
  }
  if (run.status !== "COMPLETE") return <RunProgress run={run} />
  return (
    <div className="flex flex-col gap-5">
      <RunScores run={run} />
      <HumanRatingsStrip run={run} />
      <ul data-testid="results" className="flex flex-col gap-2">
        {run.results.map((r) => (
          <ResultRow key={r.questionId} result={r} />
        ))}
      </ul>
    </div>
  )
}

/** People's thumbs on this persona's live answers, beside the automated scores above. */
export function HumanRatingsStrip({ run }: { run: EvalRun }) {
  const h = run.humanRatings
  return (
    <section data-testid="human-ratings-strip" aria-label="Human ratings of live answers" className="rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h4 className="font-semibold">Human ratings of live answers</h4>
        {h.total === 0 ? (
          <p className="text-sm text-muted-foreground">No {run.personaLabel} has rated an answer yet.</p>
        ) : (
          <p className="text-sm text-muted-foreground tabular-nums">
            <strong className="text-foreground">{h.up}</strong> helpful · <strong className="text-foreground">{h.down}</strong> not helpful · {h.withNote} with a note ·
            automated scores of those answers: faithfulness {pct(h.faithfulness)}, citations {pct(h.citationCorrectness)}
          </p>
        )}
      </div>
    </section>
  )
}

export function RunSkeleton() {
  return (
    <div data-testid="run-loading" aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-16 rounded-2xl" />
      <Skeleton className="h-16 rounded-2xl" />
    </div>
  )
}
