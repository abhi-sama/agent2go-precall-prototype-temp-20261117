"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { ClickableCard } from "@astryxdesign/core/ClickableCard"
import { Card } from "@astryxdesign/core/Card"
import { CodeBlock } from "@astryxdesign/core/CodeBlock"
import { Collapsible } from "@astryxdesign/core/Collapsible"
import { Heading } from "@astryxdesign/core/Heading"
import { ProgressBar } from "@astryxdesign/core/ProgressBar"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { Link2, ShieldCheck } from "lucide-react"
import * as React from "react"
import { CATEGORY_LABEL, EVAL_CATEGORIES, REASON_TEXT, RUN_FAILURE_TEXT, type EvalCategory, type EvalResult, type EvalRun, type EvalRunSummary } from "@/lib/data/evals"
import { BAR, CHAIN_DEPTH_BAR, pct, seconds, turnLabel, when } from "./format"
import { StatusPill, VerdictBadge } from "./verdict"

/**
 * One score against its bar. The value is the number; the bar and the word "Meets"/"Below" say whether the captain's
 * quality bar is met, so colour is never the only signal.
 */
function ScoreTile({ id, label, value, bar, hint }: { id: string; label: string; value: number | null; bar: number; hint: string }) {
  const met = value !== null && value >= bar
  return (
    <div data-testid={`score-${id}`} data-value={value ?? ""} className="min-w-0">
      <Card padding={4} height="100%">
        <VStack gap={2}>
          <Text type="label" weight="semibold" color="secondary">{label}</Text>
          <Heading level={3} type="display-2" className="tabular-nums">{pct(value)}</Heading>
          <ProgressBar label={`${label} against its bar`} isLabelHidden value={Math.round((value ?? 0) * 100)} variant={met ? "success" : "warning"} />
          <Text type="supporting" as="p" display="block">{value === null ? "Not asked in this suite" : met ? "Meets the bar" : "Below the bar"} · {hint}</Text>
        </VStack>
      </Card>
    </div>
  )
}

function LeakTile({ count, probes }: { count: number; probes: number | null }) {
  return (
    <div data-testid="score-leaks" data-value={count} className="min-w-0">
      <Card padding={4} height="100%" variant={count > 0 ? "red" : "default"}>
        <VStack gap={2}>
          <Text type="label" weight="semibold" color="secondary">Leaks</Text>
          <Heading level={3} type="display-2" className="tabular-nums">{count}</Heading>
          <Text as="p" display="block">{count === 0 ? "No out-of-scope data retrieved" : "Out-of-scope data was retrieved. This fails the run."}</Text>
          <Text type="supporting" as="p" display="block">of {probes ?? "—"} leak probes · the bar is zero</Text>
        </VStack>
      </Card>
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
    <div data-testid="score-chains" data-value={asked ? depth : ""} className="min-w-0">
      <Card padding={4} height="100%">
        <VStack gap={2}>
          <Text type="label" weight="semibold" color="secondary">Follow-up depth</Text>
          <Heading level={3} type="display-2" className="tabular-nums">{asked ? depth : "—"}</Heading>
          <ProgressBar label="Conversations that stayed correct" isLabelHidden value={asked ? Math.round((correct / asked) * 100) : 0} variant={met ? "success" : "warning"} />
          <Text type="supporting" as="p" display="block">
            {asked === 0 ? "Not asked in this suite" : `${correct} of ${asked} conversations stayed correct · deepest ${depth} turns · the bar is ${CHAIN_DEPTH_BAR}+`}
          </Text>
        </VStack>
      </Card>
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
      <Heading level={4} weight="semibold">By question type</Heading>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {EVAL_CATEGORIES.map((c) => run.categories.find((x) => x.category === c)).filter((x): x is NonNullable<typeof x> => !!x).map((c) => {
          const clean = c.passed === c.total
          return (
            <li key={c.category} className="min-w-0">
              {/* ClickableCard keeps its own visually hidden button over the card as the keyboard and screen-reader handle, so it overlaps the card's text by design. */}
              <ClickableCard
                data-layout-ok="overlap"
                padding={3}
                width="100%"
                data-testid={`category-${c.category}`}
                data-passed={c.passed}
                data-total={c.total}
                onClick={() => onPick(c.category)}
                label={`${CATEGORY_LABEL[c.category]}: ${c.passed} of ${c.total} passed. Jump to these questions.`}
              >
                <span className="flex w-full min-w-0 flex-col items-start gap-1 py-1 text-left">
                  <Text type="supporting" weight="semibold" maxLines={1}>{CATEGORY_LABEL[c.category]}</Text>
                  <Text type="large" weight="semibold" display="block" hasTabularNumbers>{c.passed}/{c.total}</Text>
                  <Text type="supporting" display="block" hasTabularNumbers>{pct(c.rate)} · {clean ? "all pass" : `${c.total - c.passed} fail`}</Text>
                  <span className="w-full" aria-hidden>
                    <ProgressBar label="Share passed" isLabelHidden value={Math.round(c.rate * 100)} variant={clean ? "success" : "warning"} />
                  </span>
                </span>
              </ClickableCard>
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
      <Text type="supporting">{label}</Text>
      <Text weight="semibold" hasTabularNumbers>{pct(value)}</Text>
    </span>
  )
}

const CHECKS: { key: "direction" | "visual" | "visualMatch" | "rowsMatch" | "coverage" | "uncertainty"; label: string }[] = [
  { key: "direction", label: "Direction" },
  { key: "visualMatch", label: "Charts match" },
  { key: "rowsMatch", label: "Rows match" },
  { key: "coverage", label: "Theme" },
]

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt><Text type="supporting">{label}</Text></dt>
          <dd><Text hasTabularNumbers>{value}</Text></dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * One scored question. A failing question starts open, because the point of the panel is to see what went wrong:
 * the question, the answer it should have given, what the agent said, and why that was judged wrong.
 */
export function ResultRow({ result, all, onConversation }: { result: EvalResult; all?: readonly EvalResult[]; onConversation?: (chainId: string) => void }) {
  const [open, setOpen] = React.useState(result.verdict === "FAIL")
  const turn = all ? turnLabel(result, all) : result.turn ? `Turn ${result.turn}` : null
  return (
    <li data-testid={`result-${result.questionId}`} data-verdict={result.verdict} data-leaked={result.leaked} className="scroll-mt-4">
      <Card padding={0}>
        <Collapsible
          isOpen={open}
          onOpenChange={setOpen}
          chevronPosition="end"
          trigger={
            <span className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 py-1 text-start">
              <span className="flex min-w-0 flex-1 basis-56 flex-col">
                <Text weight="medium">{turn ? <span className="tabular-nums">{result.turn}. </span> : null}{result.title}</Text>
                <Text type="supporting">{CATEGORY_LABEL[result.category]}{turn ? ` · ${turn}` : ""}</Text>
              </span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {result.kind !== "LEAK_PROBE" && <Metric label="Faithful" value={result.faithfulness} />}
                {result.citations !== null && <Metric label="Citations" value={result.citations} />}
                {result.exactness !== null && <Metric label="Exact" value={result.exactness} />}
                {CHECKS.filter((c) => result[c.key] !== null).map((c) => (
                  <Metric key={c.key} label={c.label} value={result[c.key]} />
                ))}
              </span>
              <VerdictBadge verdict={result.verdict} leaked={result.leaked} />
            </span>
          }
        >
          {open && (
            <VStack gap={3} padding={4} data-testid={`result-detail-${result.questionId}`}>
              <div>
                <Text type="label" color="secondary" as="p" display="block">Question asked</Text>
                <Text as="p" display="block">{result.prompt}</Text>
              </div>
              {result.reasons.length > 0 && (
                <ul data-testid="result-reasons" className="flex flex-col gap-2">
                  {result.reasons.map((r) => (
                    <li key={r}>
                      <Banner status="error" collapsible={false} title={REASON_TEXT[r] ?? r} />
                    </li>
                  ))}
                </ul>
              )}
              {result.expectedText ? (
                <p data-testid="expected-text">
                  <Text>The correct answer: </Text><Text weight="semibold" hasTabularNumbers>{result.expectedText}</Text>
                </p>
              ) : result.expected !== null ? (
                <p>
                  <Text>The database says </Text><Text weight="semibold" hasTabularNumbers>{result.expected.toLocaleString("en-US")}</Text><Text>.</Text>
                </p>
              ) : null}
              <div>
                <Text type="label" color="secondary" as="p" display="block">What the agent answered</Text>
                <CodeBlock data-testid="answer-excerpt" code={result.answerExcerpt || "No answer was returned."} language="text" hasLanguageLabel={false} isWrapped hasCopyButton={false} size="sm" width="100%" />
              </div>
              {result.visualNotes.length > 0 && (
                <ul data-testid="visual-notes" className="flex flex-col gap-1">
                  {result.visualNotes.map((n) => (
                    <li key={n}><Text type="supporting">Chart check: </Text><Text>{n}</Text></li>
                  ))}
                </ul>
              )}
              {result.unverifiedSample.length > 0 && (
                <p data-testid="unverified-sample">
                  <Text type="supporting">Figures no tool returned: </Text><Text weight="semibold" hasTabularNumbers>{result.unverifiedSample.join(", ")}</Text>
                </p>
              )}
              <Facts
                items={[
                  ["Figures claimed", `${result.numbersClaimed ?? 0} (${result.numbersUnverified ?? 0} unmatched)`],
                  ["Quotes found", `${result.quotesFound ?? 0} of ${result.quotesChecked ?? 0}`],
                  ["Records readable", `${result.citationsReadable ?? 0} of ${result.citationsCited ?? 0}`],
                  ["Charts and figures", `${result.visualsDrawn ?? 0} charts, ${result.factsShown ?? 0} key figures`],
                  ["Took", seconds(result.durationMs)],
                ]}
              />
              {result.chainId && onConversation && (
                <div>
                  <Button variant="secondary" size="sm" data-testid={`conversation-${result.questionId}`} icon={<Link2 aria-hidden />} label="Show the whole conversation" onClick={() => onConversation(result.chainId!)} />
                </div>
              )}
            </VStack>
          )}
        </Collapsible>
      </Card>
    </li>
  )
}

/** A follow-up conversation: its turns in order, collapsed when every turn passed and open when any failed. */
function ChainCard({ chainId, turns, all, open, onToggle, onConversation }: { chainId: string; turns: EvalResult[]; all: readonly EvalResult[]; open: boolean; onToggle: () => void; onConversation: (chainId: string) => void }) {
  const failed = turns.filter((t) => t.verdict === "FAIL").length
  return (
    <li id={`chain-${chainId}`} data-testid={`chain-${chainId}`} data-open={open} data-failed={failed} className="scroll-mt-4">
      <Card padding={0}>
        <Collapsible
          isOpen={open}
          onOpenChange={() => onToggle()}
          chevronPosition="end"
          trigger={
            <span className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 py-1 text-start">
              <span className="flex min-w-0 flex-1 basis-56 flex-col">
                <Text weight="medium">Conversation <span className="font-mono text-sm">{chainId}</span></Text>
                <Text type="supporting" hasTabularNumbers>{turns.length} turns · {failed === 0 ? "every turn stayed correct" : `${failed} of ${turns.length} turns failed`}</Text>
              </span>
              <VerdictBadge verdict={failed === 0 ? "PASS" : "FAIL"} />
            </span>
          }
        >
          {open && (
            <ol data-testid={`chain-turns-${chainId}`} className="flex flex-col gap-2 p-3">
              {turns.map((t) => (
                <ResultRow key={t.questionId} result={t} all={all} onConversation={onConversation} />
              ))}
            </ol>
          )}
        </Collapsible>
      </Card>
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
              <Heading level={4} weight="semibold">
                {CATEGORY_LABEL[category]} <Text type="supporting">{chains.length} conversations, {run.results.filter((r) => r.chainId).length} turns</Text>
              </Heading>
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
            <Heading level={4} weight="semibold">
              {CATEGORY_LABEL[category]} <Text type="supporting" hasTabularNumbers>{passed} of {rows.length} passed</Text>
            </Heading>
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
    <VStack gap={3} data-testid="run-header">
      <div className="flex flex-wrap items-center gap-3">
        <Heading level={3} weight="semibold">{run.personaLabel} suite</Heading>
        <StatusPill status={run.status} />
        {run.status === "COMPLETE" && <VerdictBadge verdict={run.verdict} leaked={run.leakCount > 0} />}
        {run.source === "LEAKY_CANARY" && (
          <span data-testid="self-test-badge" className="inline-flex">
            <Badge variant="neutral" icon={<ShieldCheck aria-hidden className="size-3.5" />} label="Detector self-test" />
          </span>
        )}
      </div>
      <Text type="supporting" as="p" display="block">
        Asked as {run.subjectLabel} · started {when(run.startedAt)} · {run.status === "COMPLETE" ? `took ${seconds(run.durationMs)}` : run.status === "ERROR" ? "stopped" : "running"} · scored by {run.scorer}
      </Text>
      {run.source === "LEAKY_CANARY" && (
        <div className="max-w-3xl">
          <Text type="supporting" as="p" display="block">
            This run asked only the leak probes of a deliberately leaky stand-in, to prove the detector fails a run that retrieves out-of-scope data. It says nothing about the real agent.
          </Text>
        </div>
      )}
      {failed && run.failureReasons.length > 0 && (
        <ul data-testid="run-failure-reasons" className="flex flex-col gap-2">
          {run.failureReasons.map((r) => (
            <li key={r}>
              <Banner status="error" collapsible={false} title={RUN_FAILURE_TEXT[r] ?? r} />
            </li>
          ))}
        </ul>
      )}
    </VStack>
  )
}

export function RunProgress({ run }: { run: EvalRunSummary }) {
  const total = run.questionCount ?? 0
  const share = total ? Math.round((run.answered / total) * 100) : 0
  return (
    <div data-testid="run-progress" role="status">
      <Card padding={4}>
        <VStack gap={2}>
          <Text weight="medium" as="p" display="block">{run.status === "SCORING" ? "Scoring the answers…" : "Asking the agent the golden questions…"}</Text>
          <Text type="supporting" as="p" hasTabularNumbers>{run.answered} of {total || "—"} answered</Text>
          <ProgressBar label="Questions answered" isLabelHidden value={share} />
        </VStack>
      </Card>
    </div>
  )
}

export function RunBody({ run }: { run: EvalRun }) {
  const [focus, setFocus] = React.useState<{ category: EvalCategory; nonce: number } | null>(null)
  if (run.status === "ERROR") {
    return (
      <div data-testid="run-error">
        <Banner status="error" collapsible={false} title="This run did not finish" description={`${run.errorCode === "TIMED_OUT" ? "It took too long. " : ""}Start it again; nothing was changed.`} />
      </div>
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
    <section data-testid="human-ratings-strip" aria-label="Human ratings of live answers">
      <Card padding={4}>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <Heading level={4} weight="semibold">Human ratings of live answers</Heading>
          {h.total === 0 ? (
            <Text type="supporting">No {run.personaLabel} has rated an answer yet.</Text>
          ) : (
            <Text type="supporting" hasTabularNumbers>
              <strong>{h.up}</strong> helpful · <strong>{h.down}</strong> not helpful · {h.withNote} with a note · automated scores of those answers: faithfulness {pct(h.faithfulness)}, citations {pct(h.citationCorrectness)}
            </Text>
          )}
        </div>
      </Card>
    </section>
  )
}

export function RunSkeleton() {
  return (
    <div data-testid="run-loading" aria-busy="true" className="flex flex-col gap-3">
      <Skeleton width={256} height={32} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} width="100%" height={160} index={i} />
        ))}
      </div>
      <Skeleton width="100%" height={64} />
      <Skeleton width="100%" height={64} />
    </div>
  )
}
