"use client"

import { MessageSquareText, Search } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { EmptyState, ErrorState } from "@/components/state/states"
import { buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { chatLink } from "@/lib/chat/context"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { QuestionAnalytics, QuestionDetail, QuestionOption } from "@/lib/data/director-insights"
import type { DateRange, InsightFilters } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { useSession } from "@/lib/session/session-provider"
import { cn } from "@/lib/utils"
import { InsightSection, num, PanelLoading, PanelMeta, pctText } from "./shared"

const TYPE_LABEL: Record<string, string> = {
  open_text: "Free text",
  single_choice: "Single choice",
  multi_select: "Select all",
  yes_no: "Yes / no",
  likert_5: "Likert 1-5",
  rating_0_10: "Rating 0-10",
  numeric: "Number",
  date: "Date",
  ranking: "Ranking",
}
const typeLabel = (t: string | null) => (t ? (TYPE_LABEL[t] ?? t) : "Unknown type")

/**
 * Question-level analytics: pick one question, read its answers as bars. Counts are distinct responses to that one
 * question (never mixed with another), distinct HCPs are counted apart, and a follow-up is shown next to its parent.
 */
export function QuestionPanel({ range, filters }: { range: DateRange; filters: InsightFilters }) {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const [questionId, setQuestionId] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")
  const [type, setType] = React.useState("")
  const query = useQuery("questionAnalytics", `${userId}:${range.from}:${range.to}:${JSON.stringify(filters)}:${questionId ?? ""}`, (ctx) => adapter.questionAnalytics(ctx, { range, filters, questionId }), ready)
  const [kept, setKept] = React.useState<{ userId: string; data: QuestionAnalytics } | null>(null)
  if (query.status === "success" && kept?.data !== query.data) setKept({ userId, data: query.data })
  const data = query.status === "success" ? query.data : kept?.userId === userId ? kept.data : null

  const options = React.useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (data?.options ?? []).filter((o) => (!type || o.questionType === type) && (!needle || o.questionId.toLowerCase().includes(needle) || o.questionText.toLowerCase().includes(needle)))
  }, [data, search, type])
  const types = React.useMemo(() => [...new Set((data?.options ?? []).map((o) => o.questionType).filter((t): t is string => Boolean(t)))].sort(), [data])

  return (
    <InsightSection
      id="questions"
      title="Question analytics"
      note="Pick a question to see how HCPs answered it. Bars count distinct responses to that question only."
      meta={data && <PanelMeta from={data.from} to={data.to} dataThrough={data.dataThrough}><span>{num(data.options.length)} questions answered</span></PanelMeta>}
    >
      {query.status === "error" && !data ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : !data ? (
        <PanelLoading testId="questions-loading" height="h-96" />
      ) : data.options.length === 0 ? (
        <EmptyState title="No answered questions in this period">No HCP responses were recorded for your territories between these dates.</EmptyState>
      ) : (
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]" aria-busy={query.status === "loading"}>
          <div data-testid="question-selector" className="flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="question-search" className="text-xs">Find a question</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input id="question-search" data-testid="question-search" className="h-11 pl-9" value={search} placeholder="Text or id, e.g. Q-0013" onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="question-type" className="text-xs">Answer type</Label>
              <select id="question-type" data-testid="question-type" value={type} onChange={(e) => setType(e.target.value)} className="h-11 rounded-lg border border-input bg-background px-3 text-sm">
                <option value="">All types</option>
                {types.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
              </select>
            </div>
            <ul role="listbox" aria-label="Questions" className="flex max-h-96 flex-col gap-1.5 overflow-y-auto pr-1">
              {options.length === 0 && <li className="p-3 text-sm text-muted-foreground">No question matches.</li>}
              {options.map((o) => (
                <li key={o.questionId} role="presentation">
                  <OptionButton option={o} on={o.questionId === (data.selected?.questionId ?? null)} onPick={() => setQuestionId(o.questionId)} />
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            {data.selected ? <Detail q={data.selected} range={range} /> : <EmptyState title="That question has no responses here">Pick another question from the list.</EmptyState>}
          </div>
        </div>
      )}
    </InsightSection>
  )
}

function OptionButton({ option, on, onPick }: { option: QuestionOption; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={on}
      data-testid="question-option"
      data-question-id={option.questionId}
      onClick={onPick}
      className={cn("flex min-h-12 w-full flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors", on ? "border-primary bg-primary/10" : "bg-background hover:bg-muted")}
    >
      <span className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground"><span className="font-mono">{option.questionId}</span><span>{typeLabel(option.questionType)} · {num(option.responses)}</span></span>
      <span className="line-clamp-2">{option.questionText}</span>
    </button>
  )
}

function Detail({ q, range }: { q: QuestionDetail; range: DateRange }) {
  const maxCount = Math.max(1, ...q.bars.map((b) => b.responses))
  return (
    <article data-testid="question-detail" data-question-id={q.questionId} className="flex min-w-0 flex-col gap-5 rounded-2xl border bg-card p-4 sm:p-5">
      <header className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground"><span className="font-mono">{q.questionId}</span> · {typeLabel(q.questionType)}{q.molecule ? ` · ${q.molecule}` : ""}</p>
        <h3 className="text-lg font-semibold leading-snug">{q.questionText}</h3>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Responses</dt><dd data-testid="question-responses" className="text-2xl font-semibold tabular-nums">{num(q.responses)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Distinct HCPs</dt><dd data-testid="question-hcps" className="text-2xl font-semibold tabular-nums">{num(q.distinctHcps)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Denominator</dt><dd data-testid="question-denominator" className="text-2xl font-semibold tabular-nums">{num(q.denominator)}</dd></div>
        </dl>
      </header>

      {q.parent && <ParentBlock parent={q.parent} />}

      <section aria-label="Response bars" data-testid="response-bars" className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold">How HCPs answered</h4>
        <ul className="flex flex-col gap-2">
          {q.bars.map((b) => (
            <li key={b.label} data-testid="response-bar" data-label={b.label} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
              <span className="min-w-0 break-words">{b.label}</span>
              <span className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span className="block h-full w-full origin-left rounded-full bg-primary transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none" style={{ transform: `scaleX(${b.responses / maxCount})` }} />
              </span>
              <span className="text-right tabular-nums"><strong>{num(b.responses)}</strong> <span className="text-muted-foreground">· {pctText(b.percentage)} · {num(b.distinctHcps)} HCPs</span></span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Percentages are of the {num(q.denominator)} distinct responses to this question. {q.barNote}</p>
        {q.numericSummary && (
          <p data-testid="numeric-summary" className="text-sm text-muted-foreground">Lowest {q.numericSummary.min} · median {q.numericSummary.median} · highest {q.numericSummary.max} (from {num(q.numericSummary.answered)} answers)</p>
        )}
      </section>

      {q.territories.length > 0 && (
        <section aria-label="By territory" className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">By territory</h4>
          <ul data-testid="question-territories" className="flex flex-wrap gap-2">
            {q.territories.map((t) => (
              <li key={t.territoryId} className="rounded-lg border bg-background px-3 py-1.5 text-sm tabular-nums"><span className="font-medium">{t.territoryId}</span> <span className="text-muted-foreground">{num(t.responses)} · {num(t.distinctHcps)} HCPs</span></li>
            ))}
          </ul>
        </section>
      )}

      {q.followUps.length > 0 && (
        <section aria-label="Follow-up questions" data-testid="follow-ups" className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">Follow-up questions</h4>
          <ul className="flex flex-col gap-1.5 text-sm">
            {q.followUps.map((f) => <li key={f.questionId}><span className="font-mono text-xs">{f.questionId}</span> {f.questionText} <span className="text-muted-foreground">· {num(f.responses)} responses</span></li>)}
          </ul>
        </section>
      )}

      <div>
        <Link href={chatLink({ view: "director-insights", questionId: q.questionId, from: range.from, to: range.to })} data-testid="ask-agent-question" className={cn(buttonVariants({ variant: "outline" }))}>
          <MessageSquareText aria-hidden /> Ask the agent about this question
        </Link>
      </div>
    </article>
  )
}

function ParentBlock({ parent }: { parent: NonNullable<QuestionDetail["parent"]> }) {
  return (
    <section data-testid="parent-context" data-in-catalog={parent.inCatalog} aria-label="Parent question" className={cn("rounded-xl border p-3 text-sm", parent.inCatalog ? "border-fact/30 bg-fact-soft" : "border-dashed border-warning/60 bg-warning/10")}>
      <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Parent question</h4>
      <p className="mt-1"><span className="font-mono text-xs">{parent.questionId}</span> {parent.questionText ?? <em>Not in the catalog</em>}</p>
      {parent.answerBreakdown.length > 0 && (
        <p className="mt-2 text-muted-foreground">Parent answers in the same interactions: {parent.answerBreakdown.map((a) => `${a.answer} (${num(a.responses)})`).join(", ")}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{parent.note}</p>
    </section>
  )
}
