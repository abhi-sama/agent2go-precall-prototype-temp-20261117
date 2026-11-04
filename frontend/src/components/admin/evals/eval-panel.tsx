"use client"

import { FlaskConical, Play, ShieldCheck } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { ScopeLabel } from "@/components/shell/scope-label"
import { ErrorState } from "@/components/state/states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDataAdapter } from "@/lib/data/data-provider"
import { CATEGORY_LABEL, EVAL_CATEGORIES, EVAL_PERSONAS, type EvalPersona, type EvalRun, type EvalRunSummary, type EvalSource } from "@/lib/data/evals"
import { toDataError } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { newCorrelationId } from "@/lib/log/logger"
import { useSession } from "@/lib/session/session-provider"
import { cn } from "@/lib/utils"
import { ComparePicker, DiffView, RunHistory } from "./history-compare"
import { PERSONA_LABEL, isFinished } from "./format"
import { RatingsPanel } from "./ratings-panel"
import { RunBody, RunHeader, RunSkeleton } from "./run-view"

const TRIGGER = "min-h-11 px-3"
const POLL_MS = 2500

/** Reads one run and keeps reading it while it is in progress. The last answer stays on screen between reads. */
function RunSection({ runId, onSettled }: { runId: string; onSettled: () => void }) {
  const adapter = useDataAdapter()
  const query = useQuery("evalRun", runId, (ctx) => adapter.evalRun(ctx, runId))
  // Keep the last read on screen while the next one is in flight, so polling never flashes a skeleton.
  const [kept, setKept] = React.useState<EvalRun | null>(null)
  if (query.status === "success" && kept !== query.data) setKept(query.data)
  const run = kept?.runId === runId ? kept : null
  const active = run !== null && !isFinished(run)

  const { refetch } = query
  React.useEffect(() => {
    if (!active) return
    const timer = setInterval(refetch, POLL_MS)
    return () => clearInterval(timer)
  }, [active, refetch])

  const wasActive = React.useRef(false)
  const settle = React.useEffectEvent(onSettled)
  React.useEffect(() => {
    if (run && active) wasActive.current = true
    if (run && !active && wasActive.current) {
      wasActive.current = false
      settle()
    }
  }, [run, active])

  if (!run && query.status === "error") return <ErrorState error={query.error} onRetry={query.refetch} />
  if (!run) return <RunSkeleton />
  return (
    <section data-testid="run-section" data-run-id={run.runId} aria-live="polite" className="flex flex-col gap-5">
      <RunHeader run={run} />
      <RunBody run={run} />
    </section>
  )
}

function SuiteCard({
  persona,
  busy,
  running,
  onRun,
}: {
  persona: EvalPersona
  busy: boolean
  running: boolean
  onRun: (source: EvalSource) => void
}) {
  const adapter = useDataAdapter()
  const suites = useQuery("evalSuites", "suites", (ctx) => adapter.evalSuites(ctx))
  const suite = suites.status === "success" ? suites.data.find((s) => s.persona === persona) : undefined
  const chains = new Set(suite?.questions.map((q) => q.chainId).filter(Boolean)).size
  const byType = EVAL_CATEGORIES.map((c) => ({ c, n: suite?.questions.filter((q) => q.category === c).length ?? 0 })).filter((x) => x.n > 0)
  const disabled = busy || running
  return (
    <section data-testid="suite-card" aria-label="Golden suite" className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight">Golden suite for {PERSONA_LABEL[persona]}</h2>
        {suite ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {suite.questions.length} questions: {byType.map(({ c, n }) => `${n} ${c === "FOLLOW_UP_CHAIN" ? `follow-up turns in ${chains} conversations` : CATEGORY_LABEL[c].toLowerCase()}`).join(", ")}. Asked as {suite.subjectLabel}, so every answer is read against exactly what that person may see.
          </p>
        ) : suites.status === "error" ? (
          <p className="mt-1 text-sm text-destructive">The suite could not be loaded.</p>
        ) : (
          <Skeleton className="mt-2 h-4 w-96 max-w-full" />
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button data-testid="run-suite" size="lg" className="min-h-11 gap-2" disabled={disabled || !suite} onClick={() => onRun("AGENT")}>
          <Play className="size-4" aria-hidden />
          {running ? "Running…" : "Run suite"}
        </Button>
        <Button
          data-testid="run-self-test"
          variant="outline"
          size="lg"
          className="min-h-11 gap-2"
          disabled={disabled || !suite}
          onClick={() => onRun("LEAKY_CANARY")}
          title="Asks the leak probes of a deliberately leaky stand-in to prove the detector fails a run that retrieves out-of-scope data"
        >
          <ShieldCheck className="size-4" aria-hidden />
          Detector self-test
        </Button>
      </div>
    </section>
  )
}

export function EvalPanel() {
  const { user } = useSession()
  const adapter = useDataAdapter()
  const [persona, setPersona] = React.useState<EvalPersona>("msl")
  const [tab, setTab] = React.useState("run")
  const [chosen, setChosen] = React.useState<string | null>(null)
  const [pair, setPair] = React.useState<{ base: string; head: string } | null>(null)
  const [busy, setBusy] = React.useState(false)

  const runs = useQuery("evalRuns", `runs:${persona}`, (ctx) => adapter.evalRuns(ctx, persona, 30))
  const list: EvalRunSummary[] = runs.status === "success" ? runs.data : []
  const latest = list[0]?.runId ?? null
  const shown = chosen && list.some((r) => r.runId === chosen) ? chosen : latest
  const running = list.some((r) => !isFinished(r))
  const done = list.filter((r) => r.status === "COMPLETE")

  // Default comparison: the two newest finished runs, oldest first.
  const base = pair?.base ?? done[1]?.runId ?? ""
  const head = pair?.head ?? done[0]?.runId ?? ""
  const canCompare = base !== "" && head !== "" && base !== head
  const diff = useQuery("evalRunDiff", `${base}:${head}`, (ctx) => adapter.evalRunDiff(ctx, base, head), canCompare && tab === "compare")
  const ratings = useQuery("evalRatings", `ratings:${persona}`, (ctx) => adapter.evalRatings(ctx, persona, 50), tab === "ratings")

  const choosePersona = (next: EvalPersona) => {
    setPersona(next)
    setChosen(null)
    setPair(null)
  }

  const start = async (source: EvalSource) => {
    setBusy(true)
    try {
      const run = await adapter.startEvalRun({ correlationId: newCorrelationId() }, { persona, source })
      setChosen(run.runId)
      setTab("run")
      runs.refetch()
    } catch (err) {
      const error = toDataError(err)
      toast.error(error.code === "BAD_REQUEST" ? "A run for this persona is already in progress" : "The evaluation could not be started")
    } finally {
      setBusy(false)
    }
  }

  // The progress strip and the verdict badge already say how a run ended; only the history list needs refreshing.
  const onSettled = () => runs.refetch()

  return (
    <div className="flex flex-col gap-6 pb-8" data-testid="eval-panel">
      <header className="flex flex-col gap-3 border-b pb-6">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-accent text-accent-text">
            <FlaskConical className="size-6" aria-hidden />
          </span>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">AI evaluation</h1>
        </div>
        <p className="max-w-3xl text-muted-foreground">
          Run each persona&apos;s golden questions against the real agent. Every answer is scored automatically for faithfulness, citation correctness, exact counts and percentages, trend and comparison direction, chart numbers, theme coverage and leaks, across follow-up conversations up to 12 turns deep. Any leak of out-of-scope data fails the run.
        </p>
        <div>
          <ScopeLabel label={user.scopeLabel} />
        </div>
      </header>

      <div role="radiogroup" aria-label="Persona to evaluate" data-testid="persona-picker" className="flex flex-wrap gap-2">
        {EVAL_PERSONAS.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={persona === p}
            data-testid={`persona-${p}`}
            onClick={() => choosePersona(p)}
            className={cn(
              "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              persona === p ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
            )}
          >
            {PERSONA_LABEL[p]}
          </button>
        ))}
      </div>

      <SuiteCard persona={persona} busy={busy} running={running} onRun={start} />

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="h-auto! w-full flex-wrap gap-1 sm:w-fit">
          <TabsTrigger value="run" className={TRIGGER}>Results</TabsTrigger>
          <TabsTrigger value="history" className={TRIGGER}>History</TabsTrigger>
          <TabsTrigger value="compare" className={TRIGGER}>Compare runs</TabsTrigger>
          <TabsTrigger value="ratings" className={TRIGGER}>Human ratings</TabsTrigger>
        </TabsList>

        <TabsContent value="run" className="pt-4">
          {runs.status === "loading" ? (
            <RunSkeleton />
          ) : runs.status === "error" ? (
            <ErrorState error={runs.error} onRetry={runs.refetch} />
          ) : shown ? (
            <RunSection key={shown} runId={shown} onSettled={onSettled} />
          ) : (
            <p data-testid="no-runs" className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">
              The {PERSONA_LABEL[persona]} suite has not been run yet. Choose Run suite to ask the agent the golden questions.
            </p>
          )}
        </TabsContent>

        <TabsContent value="history" className="pt-4">
          {runs.status === "success" ? (
            <RunHistory
              runs={list}
              onOpen={(id) => {
                setChosen(id)
                setTab("run")
              }}
            />
          ) : runs.status === "error" ? (
            <ErrorState error={runs.error} onRetry={runs.refetch} />
          ) : (
            <RunSkeleton />
          )}
        </TabsContent>

        <TabsContent value="compare" className="flex flex-col gap-5 pt-4">
          {done.length < 2 ? (
            <p data-testid="compare-empty" className="rounded-2xl border border-dashed p-8 text-center text-muted-foreground">
              Two finished runs of the {PERSONA_LABEL[persona]} suite are needed to compare. Run it again to see what changed.
            </p>
          ) : (
            <>
              <ComparePicker runs={list} base={base} head={head} onChange={(b, h) => setPair({ base: b, head: h })} />
              {!canCompare ? (
                <p role="note" className="rounded-xl border bg-muted/40 p-3 text-sm">Choose two different runs.</p>
              ) : diff.status === "success" ? (
                <DiffView diff={diff.data} />
              ) : diff.status === "error" ? (
                <ErrorState error={diff.error} onRetry={diff.refetch} />
              ) : (
                <RunSkeleton />
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="ratings" className="pt-4">
          {ratings.status === "success" ? (
            <RatingsPanel ratings={ratings.data} personaLabel={PERSONA_LABEL[persona]} />
          ) : ratings.status === "error" ? (
            <ErrorState error={ratings.error} onRetry={ratings.refetch} />
          ) : (
            <RunSkeleton />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
