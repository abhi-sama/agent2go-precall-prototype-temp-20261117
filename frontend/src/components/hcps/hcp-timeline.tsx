"use client"

import { CalendarDays, ChevronDown, MessageSquareText, PhoneCall, Tag } from "lucide-react"
import * as React from "react"
import { ErrorState } from "@/components/state/states"
import { Badge } from "@/components/ui/badge"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import type { HcpResponse } from "@/lib/data/types"

function Chips({ values }: { values: string[] }) {
  return values.length ? <span className="flex flex-wrap gap-1.5">{values.map((value) => <Badge key={value} variant="outline">{value}</Badge>)}</span> : <span className="text-sm text-muted-foreground">Not recorded</span>
}

function ResponseCard({ response, children, level }: { response: HcpResponse; children?: React.ReactNode; level: number }) {
  const [expanded, setExpanded] = React.useState(false)
  const hasChildren = React.Children.count(children) > 0
  const contentId = `response-content-${response.responseId}`
  return (
    <div
      data-testid={`response-${response.responseId}`}
      data-depth={level}
      className="min-w-0 rounded-xl border bg-background"
    >
      <button
        type="button"
        data-testid={`response-toggle-${response.responseId}`}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((open) => !open)}
        className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <MessageSquareText className="size-4 shrink-0 text-fact" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{response.question || "Question not recorded"}</span>
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {expanded && <div id={contentId} className="border-t px-4 py-4">
        <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0"><dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Recorded answer</dt><dd className="mt-1 whitespace-pre-wrap leading-6">{response.answer || "No answer recorded"}</dd></div>
          <div className="min-w-0 space-y-3 sm:border-l sm:pl-4"><div><dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Interaction date</dt><dd className="mt-1 tabular-nums">{response.interactionDate}</dd></div><div><dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Source record</dt><dd data-testid={`response-source-${response.responseId}`} className="mt-1 break-words font-medium">{response.sourceRecordId}</dd></div></div>
        </dl>
        {hasChildren ? <div className="mt-4 border-t pt-4"><p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Follow-up answers</p>{children}</div> : null}
      </div>}
    </div>
  )
}

function ResponseTree({ response, byParent, level = 0 }: { response: HcpResponse; byParent: Map<string, HcpResponse[]>; level?: number }) {
  const children = byParent.get(response.responseId) ?? []
  const indented = level > 0 && level <= 3
  return (
    <div
      className={indented ? "mt-3 min-w-0 border-l border-fact/30 pl-3 sm:pl-4" : level > 0 ? "mt-3 min-w-0" : "min-w-0"}
    >
      <ResponseCard response={response} level={level}>
        {children.map((child) => <ResponseTree key={child.responseId} response={child} byParent={byParent} level={level + 1} />)}
      </ResponseCard>
    </div>
  )
}

/** Source-only HCP history. Parent links are already constrained by the API to one insight interaction. */
export function HcpTimeline({ hcpId }: { hcpId: string }) {
  const adapter = useDataAdapter()
  const timeline = useQuery("hcpTimeline", hcpId, (ctx) => adapter.hcpTimeline(ctx, hcpId), true)
  if (timeline.status === "loading") return <div data-testid="hcp-timeline-loading" aria-busy="true" className="mt-6 h-72 animate-pulse rounded-xl bg-muted/55" />
  if (timeline.status === "error") return <div className="mt-6"><ErrorState error={timeline.error} onRetry={timeline.refetch} /></div>

  const byParent = new Map<string, HcpResponse[]>()
  for (const response of timeline.data.responses) {
    if (response.parentResponseId) byParent.set(response.parentResponseId, [...(byParent.get(response.parentResponseId) ?? []), response])
  }
  const roots = timeline.data.responses.filter((response) => !response.parentResponseId)

  return (
    <section data-testid="hcp-timeline" aria-labelledby="hcp-history-heading" className="mt-7 border-t pt-7">
      <div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-fact-soft text-fact"><CalendarDays className="size-5" aria-hidden /></span><div><h2 id="hcp-history-heading" className="text-xl font-semibold tracking-tight">Interaction history</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Source-recorded calls and perspectives for this HCP. Answers are never inferred or combined.</p></div></div>

      <div className="mt-6 grid min-w-0 gap-7 2xl:grid-cols-[minmax(0,.9fr)_minmax(22rem,1.1fr)]">
        <div className="min-w-0"><h3 className="font-semibold">Previous calls</h3><ol data-testid="hcp-call-timeline" className="mt-4 space-y-4 border-l pl-5">
          {timeline.data.interactions.map((interaction) => <li key={interaction.callId} data-testid={`call-${interaction.callId}`} className="relative"><span className="absolute -left-[1.9rem] top-1.5 grid size-7 place-items-center rounded-full bg-accent text-accent-foreground"><PhoneCall className="size-3.5" aria-hidden /></span><div className="min-w-0 rounded-xl bg-muted/45 p-4"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><p className="font-semibold tabular-nums">{interaction.interactionDate}</p><p className="break-all text-xs text-muted-foreground">Source: {interaction.sourceRecordId}</p></div><dl className="mt-4 grid gap-3 text-sm"><div><dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Channel · type · status</dt><dd className="mt-1 flex flex-wrap gap-1.5"><Chips values={[...interaction.channels, ...interaction.types, ...interaction.statuses]} /></dd></div><div><dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Products</dt><dd className="mt-1"><Chips values={interaction.products} /></dd></div><div><dt className="flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"><Tag className="size-3" aria-hidden />Topics</dt><dd className="mt-1"><Chips values={interaction.topics} /></dd></div></dl></div></li>)}
          {!timeline.data.interactions.length ? <li className="text-sm text-muted-foreground">No prior calls are recorded in the authorized source data.</li> : null}
        </ol></div>
        <div className="min-w-0"><h3 className="font-semibold">Recorded perspectives</h3><div data-testid="hcp-response-cards" className="mt-4 space-y-3">
          {roots.map((response) => <ResponseTree key={response.responseId} response={response} byParent={byParent} />)}
          {!roots.length ? <p className="text-sm text-muted-foreground">No recorded responses are available for this HCP.</p> : null}
        </div></div>
      </div>

      {timeline.data.perspectives.length ? <div data-testid="hcp-perspective-history" className="mt-7 rounded-xl bg-fact-soft p-5"><h3 className="font-semibold">Recorded over time</h3><p className="mt-1 text-sm text-muted-foreground">Only answers to the same catalog question are shown together.</p><div className="mt-4 space-y-4">{timeline.data.perspectives.map((perspective) => <div key={perspective.questionId}><p className="font-medium">{perspective.question || "Question not recorded"}</p><ul className="mt-2 space-y-2">{perspective.answers.map((answer) => <li key={answer.responseId} className="grid gap-1 text-sm sm:grid-cols-[7rem_1fr]"><span className="tabular-nums text-muted-foreground">{answer.interactionDate}</span><span>{answer.answer || "No answer recorded"}</span></li>)}</ul></div>)}</div></div> : null}
    </section>
  )
}
