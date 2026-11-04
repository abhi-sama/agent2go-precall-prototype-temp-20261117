"use client"

import { ChevronDown, Link2, ShieldCheck } from "lucide-react"
import * as React from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { CATEGORY_LABEL, EVAL_CATEGORIES, REASON_TEXT, RUN_FAILURE_TEXT, type EvalCategory, type EvalResult, type EvalRun, type EvalRunSummary } from "@/lib/data/evals"
import { cn } from "@/lib/utils"
import { BAR, CHAIN_DEPTH_BAR, pct, seconds, turnLabel, when } from "./format"
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

/** Follow-up conversations: how many stayed correct, and the deepest one. */
function ChainTile({ run }: { run: EvalRunSummary }) {
  const asked = run.chainCount ?? 0
  const depth = run.chainDepth ?? 0
  const correct = run.chainsCorrect ?? 0
  const met = asked > 0 && depth >= CHAIN_DEPTH_BAR && correct === asked
  return (
    <div data-testid="score-chains" data-value={asked ? depth : ""} className="min-w-0 rounded-2xl border bg-card p-4 shadow-card">
      <p className="text-sm font-semibold text-muted-foreground">Follow-up depth</p>
      <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">{asked ? depth : "—"}</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn("h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none", met ? "bg-success" : "bg-warning")} style={{ width: `${asked ? Math.round((correct / asked) * 100) : 0}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {asked === 0 ? "Not asked in this suite" : `${correct} of ${asked} conversations stayed correct · deepest ${depth} turns · the bar is ${CHAIN_DEPTH_BAR}+`}
      </p>
    </div>
  )
}

export function RunScores({ run }: { run: EvalRunSummary }) {
  return (
    <div data-testid="run-scores" className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <ScoreTile id="faithfulness" label="Faithfulness" value={run.faithfulness} bar={BAR.faithfulness} hint="figures and quotes match the data" />
        <ScoreTile id="citations" label="Citation correctness" value={run.citationCorrectness} bar={BAR.citationCorrectness} hint="cited records are readable" />
        <ScoreTile id="exact" label="Exact counts" value={run.exactCountRate} bar={BAR.exactCountRate} hint="counts and shares equal the SQL" />
        <LeakTile count={run.leakCount} probes={run.probeCount} />
      </div>
      <div data-testid="run-scores-more" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <ScoreTile id="direction" label="Trends and comparisons" value={run.directionRate} bar={BAR.directionRate} hint="direction or leader agrees with SQL" />
        <ScoreTile id="visual" label="Chart numbers" value={run.visualMatchRate} bar={BAR.visualMatchRate} hint="every plotted number equals SQL" />
        <ScoreTile id="rows" label="Show rows" value={run.rowMatchRate} bar={BAR.rowMatchRate} hint="each table lists exactly the rows its figure counted" />
        <ScoreTile id="theme" label="Theme coverage" value={run.themeCoverage} bar={BAR.themeCoverage} hint="answers cover the theme asked" />
        <ChainTile run={run} />
      </div>
    </div>
  )
}

/** One compact tile per question type, so exact counts, percentages, trends, themes, conversations and leaks are read separately. */
export function CategoryStrip({ run, onPick }: { run: EvalRunSummary; onPick: (category: EvalCategory) => void }) {
  if (run.categories.length === 0) return null
  return (
    <section data-testid="category-strip" aria-label="By question type" className="flex flex-col gap-2">
      <h4 className="font-semibold">By question type</h4>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {EVAL_CATEGORIES.map((c) => run.categories.find((x) => x.category === c)).filter((x): x is NonNullable<typeof x> => !!x).map((c) => {
          const clean = c.passed === c.total
          return (
            <li key={c.category} className="min-w-0">
              <button
                type="button"
                data-testid={`category-${c.category}`}
                data-passed={c.passed}
                data-total={c.total}
                onClick={() => onPick(c.category)}
                aria-label={`${CATEGORY_LABEL[c.category]}: ${c.passed} of ${c.total} passed. Jump to these questions.`}
                className={cn(
                  "flex min-h-14 w-full min-w-0 flex-col gap-1.5 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none",
                  !clean && "border-destructive/40",
                )}
              >
                <span className="truncate text-xs font-semibold text-muted-foreground">{CATEGORY_LABEL[c.category]}</span>
                <span className="flex items-baseline gap-1.5 tabular-nums">
                  <span className="text-xl font-semibold">{c.passed}/{c.total}</span>
                  <span className="text-xs text-muted-foreground">{pct(c.rate)} · {clean ? "all pass" : `${c.total - c.passed} fail`}</span>
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className={cn("block h-full rounded-full", clean ? "bg-success" : "bg-warning")} style={{ width: `${Math.round(c.rate * 100)}%` }} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
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

const CHECKS: { key: "direction" | "visual" | "visualMatch" | "rowsMatch" | "coverage" | "uncertainty"; label: string }[] = [
  { key: "direction", label: "Direction" },
  { key: "visualMatch", label: "Charts match" },
  { key: "rowsMatch", label: "Rows match" },
  { key: "coverage", label: "Theme" },
]

/**
 * One scored question. A failing question starts open, because the point of the panel is to see what went wrong:
 * the question, the answer it should have given, what the agent said, and why that was judged wrong.
 */
export function ResultRow({ result, all, onConversation }: { result: EvalResult; all?: readonly EvalResult[]; onConversation?: (chainId: string) => void }) {
  const [open, setOpen] = React.useState(result.verdict === "FAIL")
  const id = React.useId()
  const turn = all ? turnLabel(result, all) : result.turn ? `Turn ${result.turn}` : null
  return (
    <li data-testid={`result-${result.questionId}`} data-verdict={result.verdict} data-leaked={result.leaked} className="scroll-mt-4 rounded-2xl border bg-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-14 w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="flex min-w-0 flex-1 basis-56 flex-col">
          <span className="font-medium">{turn ? <span className="mr-2 tabular-nums text-muted-foreground">{result.turn}.</span> : null}{result.title}</span>
          <span className="text-xs text-muted-foreground">{CATEGORY_LABEL[result.category]}{turn ? ` · ${turn}` : ""}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {result.kind !== "LEAK_PROBE" && <Metric label="Faithful" value={result.faithfulness} />}
          {result.citations !== null && <Metric label="Citations" value={result.citations} />}
          {result.exactness !== null && <Metric label="Exact" value={result.exactness} />}
          {CHECKS.filter((c) => result[c.key] !== null).map((c) => (
            <Metric key={c.key} label={c.label} value={result[c.key]} />
          ))}
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
          {result.expectedText ? (
            <p data-testid="expected-text">
              The correct answer: <strong className="tabular-nums">{result.expectedText}</strong>
            </p>
          ) : result.expected !== null ? (
            <p>
              The database says <strong className="tabular-nums">{result.expected.toLocaleString("en-US")}</strong>.
            </p>
          ) : null}
          <div className="rounded-xl border border-dashed bg-muted/40 p-3">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">What the agent answered</p>
            <p data-testid="answer-excerpt" className="mt-1 whitespace-pre-wrap break-words">{result.answerExcerpt || "No answer was returned."}</p>
          </div>
          {result.visualNotes.length > 0 && (
            <ul data-testid="visual-notes" className="flex flex-col gap-1 text-xs text-muted-foreground">
              {result.visualNotes.map((n) => (
                <li key={n}>Chart check: <span className="text-foreground">{n}</span></li>
              ))}
            </ul>
          )}
          {result.unverifiedSample.length > 0 && (
            <p data-testid="unverified-sample" className="text-xs text-muted-foreground">
              Figures no tool returned: <span className="font-semibold tabular-nums text-foreground">{result.unverifiedSample.join(", ")}</span>
            </p>
          )}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-5">
            <div><dt>Figures claimed</dt><dd className="tabular-nums text-foreground">{result.numbersClaimed ?? 0} ({result.numbersUnverified ?? 0} unmatched)</dd></div>
            <div><dt>Quotes found</dt><dd className="tabular-nums text-foreground">{result.quotesFound ?? 0} of {result.quotesChecked ?? 0}</dd></div>
            <div><dt>Records readable</dt><dd className="tabular-nums text-foreground">{result.citationsReadable ?? 0} of {result.citationsCited ?? 0}</dd></div>
            <div><dt>Charts and figures</dt><dd className="tabular-nums text-foreground">{result.visualsDrawn ?? 0} charts, {result.factsShown ?? 0} key figures</dd></div>
            <div><dt>Took</dt><dd className="tabular-nums text-foreground">{seconds(result.durationMs)}</dd></div>
          </dl>
          {result.chainId && onConversation && (
            <button
              type="button"
              data-testid={`conversation-${result.questionId}`}
              onClick={() => onConversation(result.chainId!)}
              className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <Link2 className="size-4" aria-hidden />
              Show the whole conversation
            </button>
          )}
        </div>
      )}
    </li>
  )
}

/** A follow-up conversation: its turns in order, collapsed when every turn passed and open when any failed. */
function ChainCard({ chainId, turns, all, open, onToggle, onConversation }: { chainId: string; turns: EvalResult[]; all: readonly EvalResult[]; open: boolean; onToggle: () => void; onConversation: (chainId: string) => void }) {
  const id = React.useId()
  const failed = turns.filter((t) => t.verdict === "FAIL").length
  return (
    <li id={`chain-${chainId}`} data-testid={`chain-${chainId}`} data-open={open} data-failed={failed} className="scroll-mt-4 rounded-2xl border bg-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex min-h-14 w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="flex min-w-0 flex-1 basis-56 flex-col">
          <span className="font-medium">Conversation <span className="font-mono text-sm">{chainId}</span></span>
          <span className="text-xs text-muted-foreground tabular-nums">{turns.length} turns · {failed === 0 ? "every turn stayed correct" : `${failed} of ${turns.length} turns failed`}</span>
        </span>
        <VerdictBadge verdict={failed === 0 ? "PASS" : "FAIL"} />
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ol id={id} data-testid={`chain-turns-${chainId}`} className="flex flex-col gap-2 border-t p-3">
          {turns.map((t) => (
            <ResultRow key={t.questionId} result={t} all={all} onConversation={onConversation} />
          ))}
        </ol>
      )}
    </li>
  )
}

/** Single questions grouped by type, then each follow-up conversation as one collapsible card. */
export function ResultGroups({ run, focus }: { run: EvalRun; focus: { category: EvalCategory; nonce: number } | null }) {
  const [openChains, setOpenChains] = React.useState<Set<string>>(() => new Set(run.results.filter((r) => r.chainId && r.verdict === "FAIL").map((r) => r.chainId!)))
  const chains = [...new Set(run.results.map((r) => r.chainId).filter((c): c is string => !!c))]
  const scrollTo = React.useCallback((elementId: string) => {
    const el = document.getElementById(elementId)
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    el?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
  }, [])
  const showConversation = (chainId: string) => {
    setOpenChains((prev) => new Set(prev).add(chainId))
    requestAnimationFrame(() => scrollTo(`chain-${chainId}`))
  }
  React.useEffect(() => {
    if (focus) scrollTo(`group-${focus.category}`)
  }, [focus, scrollTo])

  return (
    <div data-testid="results" className="flex flex-col gap-6">
      {EVAL_CATEGORIES.map((category) => {
        if (category === "FOLLOW_UP_CHAIN") {
          if (chains.length === 0) return null
          return (
            <section key={category} id={`group-${category}`} data-testid={`group-${category}`} aria-label={CATEGORY_LABEL[category]} className="scroll-mt-4 flex flex-col gap-2">
              <h4 className="font-semibold">
                {CATEGORY_LABEL[category]} <span className="text-sm font-normal text-muted-foreground">{chains.length} conversations, {run.results.filter((r) => r.chainId).length} turns</span>
              </h4>
              <ul className="flex flex-col gap-2">
                {chains.map((chainId) => (
                  <ChainCard
                    key={chainId}
                    chainId={chainId}
                    turns={run.results.filter((r) => r.chainId === chainId).sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0))}
                    all={run.results}
                    open={openChains.has(chainId)}
                    onToggle={() => setOpenChains((prev) => { const next = new Set(prev); if (next.has(chainId)) next.delete(chainId); else next.add(chainId); return next })}
                    onConversation={showConversation}
                  />
                ))}
              </ul>
            </section>
          )
        }
        const rows = run.results.filter((r) => r.category === category && !r.chainId)
        if (rows.length === 0) return null
        const passed = rows.filter((r) => r.verdict === "PASS").length
        return (
          <section key={category} id={`group-${category}`} data-testid={`group-${category}`} aria-label={CATEGORY_LABEL[category]} className="scroll-mt-4 flex flex-col gap-2">
            <h4 className="font-semibold">
              {CATEGORY_LABEL[category]} <span className="text-sm font-normal text-muted-foreground tabular-nums">{passed} of {rows.length} passed</span>
            </h4>
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <ResultRow key={r.questionId} result={r} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
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
  const [focus, setFocus] = React.useState<{ category: EvalCategory; nonce: number } | null>(null)
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
      <CategoryStrip run={run} onPick={(category) => setFocus({ category, nonce: (focus?.nonce ?? 0) + 1 })} />
      <HumanRatingsStrip run={run} />
      <ResultGroups run={run} focus={focus} />
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
