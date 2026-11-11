"use client"

import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { EmptyState } from "@astryxdesign/core/EmptyState"
import { Heading } from "@astryxdesign/core/Heading"
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Tab, TabList } from "@astryxdesign/core/TabList"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { Play, ShieldCheck } from "lucide-react"
import * as React from "react"
import { AdminPageHeader } from "@/components/admin/page-header"
import { ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import { CATEGORY_LABEL, EVAL_CATEGORIES, EVAL_PERSONAS, type EvalPersona, type EvalRun, type EvalRunSummary, type EvalSource } from "@/lib/data/evals"
import { toDataError } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { newCorrelationId } from "@/lib/log/logger"
import { useSession } from "@/lib/session/session-provider"
import { ComparePicker, DiffView, RunHistory } from "./history-compare"
import { PERSONA_LABEL, isFinished } from "./format"
import { RatingsPanel } from "./ratings-panel"
import { RunBody, RunHeader, RunSkeleton } from "./run-view"

const TABS = [
  { value: "run", label: "Results" },
  { value: "history", label: "History" },
  { value: "compare", label: "Compare runs" },
  { value: "ratings", label: "Human ratings" },
] as const
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
    <section data-testid="suite-card" aria-label="Golden suite">
      <Card padding={5}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <Heading level={2} weight="semibold">Golden suite for {PERSONA_LABEL[persona]}</Heading>
            {suite ? (
              <div className="mt-1 max-w-2xl">
                <Text type="supporting" as="p" display="block">
                  {suite.questions.length} questions: {byType.map(({ c, n }) => `${n} ${c === "FOLLOW_UP_CHAIN" ? `follow-up turns in ${chains} conversations` : CATEGORY_LABEL[c].toLowerCase()}`).join(", ")}. Asked as {suite.subjectLabel}, so every answer is read against exactly what that person may see.
                </Text>
              </div>
            ) : suites.status === "error" ? (
              <Text color="accent" as="p" display="block">The suite could not be loaded.</Text>
            ) : (
              <div className="mt-2"><Skeleton width={384} height={16} /></div>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button data-testid="run-suite" variant="primary" size="lg" icon={<Play aria-hidden />} label={running ? "Running…" : "Run suite"} isDisabled={disabled || !suite} onClick={() => onRun("AGENT")} />
            <Button
              data-testid="run-self-test"
              variant="secondary"
              size="lg"
              icon={<ShieldCheck aria-hidden />}
              label="Detector self-test"
              isDisabled={disabled || !suite}
              onClick={() => onRun("LEAKY_CANARY")}
              tooltip="Asks the leak probes of a deliberately leaky stand-in to prove the detector fails a run that retrieves out-of-scope data"
            />
          </div>
        </div>
      </Card>
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
  const [startError, setStartError] = React.useState<string | null>(null)

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
    setStartError(null)
    try {
      const run = await adapter.startEvalRun({ correlationId: newCorrelationId() }, { persona, source })
      setChosen(run.runId)
      setTab("run")
      runs.refetch()
    } catch (err) {
      const error = toDataError(err)
      setStartError(error.code === "BAD_REQUEST" ? "A run for this persona is already in progress" : "The evaluation could not be started")
    } finally {
      setBusy(false)
    }
  }

  // The progress strip and the verdict badge already say how a run ended; only the history list needs refreshing.
  const onSettled = () => runs.refetch()

  return (
    <div className="flex flex-col gap-6 pb-8" data-testid="eval-panel">
      <AdminPageHeader
        title="AI evaluation"
        scopeLabel={user.scopeLabel}
        description="Run each persona's golden questions against the real agent. Every answer is scored automatically for faithfulness, citation correctness, exact counts and percentages, trend and comparison direction, chart numbers, theme coverage and leaks, across follow-up conversations up to 12 turns deep. Any leak of out-of-scope data fails the run."
      />

      <div data-testid="persona-picker">
        <SegmentedControl label="Persona to evaluate" value={persona} onChange={(value) => choosePersona(value as EvalPersona)}>
          {EVAL_PERSONAS.map((p) => (
            <SegmentedControlItem key={p} value={p} label={PERSONA_LABEL[p]} data-testid={`persona-${p}`} />
          ))}
        </SegmentedControl>
      </div>

      <SuiteCard persona={persona} busy={busy} running={running} onRun={start} />

      {startError && <Banner status="error" title={startError} isDismissable onDismiss={() => setStartError(null)} dismissLabel="Dismiss" />}

      <VStack gap={4}>
        <TabList role="tablist" aria-label="Evaluation views" value={tab} onChange={setTab} hasDivider>
          {TABS.map((t) => (
            <Tab key={t.value} value={t.value} label={t.label} panelId={`eval-panel-${t.value}`} />
          ))}
        </TabList>

        <div role="tabpanel" id={`eval-panel-${tab}`} aria-label={TABS.find((t) => t.value === tab)?.label} tabIndex={0} className="flex flex-col gap-5 focus-visible:outline-none">
          {tab === "run" &&
            (runs.status === "loading" ? (
              <RunSkeleton />
            ) : runs.status === "error" ? (
              <ErrorState error={runs.error} onRetry={runs.refetch} />
            ) : shown ? (
              <RunSection key={shown} runId={shown} onSettled={onSettled} />
            ) : (
              <div data-testid="no-runs">
                <EmptyState title="No runs yet" description={`The ${PERSONA_LABEL[persona]} suite has not been run yet. Choose Run suite to ask the agent the golden questions.`} />
              </div>
            ))}

          {tab === "history" &&
            (runs.status === "success" ? (
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
            ))}

          {tab === "compare" &&
            (done.length < 2 ? (
              <div data-testid="compare-empty">
                <EmptyState title="Nothing to compare yet" description={`Two finished runs of the ${PERSONA_LABEL[persona]} suite are needed to compare. Run it again to see what changed.`} />
              </div>
            ) : (
              <>
                <ComparePicker runs={list} base={base} head={head} onChange={(b, h) => setPair({ base: b, head: h })} />
                {!canCompare ? (
                  <div role="note">
                    <Banner status="info" collapsible={false} title="Choose two different runs." />
                  </div>
                ) : diff.status === "success" ? (
                  <DiffView diff={diff.data} />
                ) : diff.status === "error" ? (
                  <ErrorState error={diff.error} onRetry={diff.refetch} />
                ) : (
                  <RunSkeleton />
                )}
              </>
            ))}

          {tab === "ratings" &&
            (ratings.status === "success" ? (
              <RatingsPanel ratings={ratings.data} personaLabel={PERSONA_LABEL[persona]} />
            ) : ratings.status === "error" ? (
              <ErrorState error={ratings.error} onRetry={ratings.refetch} />
            ) : (
              <RunSkeleton />
            ))}
        </div>
      </VStack>
    </div>
  )
}
