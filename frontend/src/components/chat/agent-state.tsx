"use client"

/**
 * The agent's side of the shared state, drawn in the thread (docs/adr/0019):
 *  - `TurnProgress`: the steps the agent reports while it works, and the same steps folded away once it has finished;
 *  - `ProposalCard`: a change to the page's filters the agent suggests. Nothing changes until the person applies it.
 * Both read checked state (`lib/chat/page-state.ts`): plain labels from a closed list, never data.
 */

import { Check, CircleAlert, LoaderCircle, SlidersHorizontal } from "lucide-react"
import * as React from "react"
import { describeProposal, type AgentProgress, type PageProposal, type ProgressStep } from "@/lib/chat/page-state"
import { cn } from "@/lib/utils"

function StepIcon({ status }: { status: ProgressStep["status"] }) {
  if (status === "done") return <Check aria-hidden className="size-3.5 shrink-0" />
  if (status === "error") return <CircleAlert aria-hidden className="size-3.5 shrink-0 text-destructive" />
  return <LoaderCircle aria-hidden className="size-3.5 shrink-0 motion-safe:animate-spin" />
}

const STATUS_WORDS: Record<ProgressStep["status"], string> = { running: "in progress", done: "done", error: "stopped" }

function StepList({ steps }: { steps: ProgressStep[] }) {
  return (
    <ol className="flex min-w-0 flex-col gap-1">
      {steps.map((step) => (
        <li key={step.id} data-testid="progress-step" data-status={step.status} className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <StepIcon status={step.status} />
          <span className="truncate">{step.label}</span>
          <span className="sr-only">{STATUS_WORDS[step.status]}</span>
        </li>
      ))}
    </ol>
  )
}

/**
 * While the answer is being written: the live steps, with the one in progress announced politely. Afterwards: the finished
 * steps in a closed disclosure, so the thread stays about the answer.
 */
export function TurnProgress({ running, live, finished }: { running: boolean; live: AgentProgress | null; finished: ProgressStep[] | undefined }) {
  if (running) {
    const steps = live?.steps ?? []
    // One polite announcement of the step in progress, not the whole list again at every change: the list is for the eyes.
    const current = [...steps].reverse().find((step) => step.status === "running")
    return (
      <div data-testid="agent-progress" data-state="running" aria-label="What the agent is doing" role="group" className="rounded-xl border border-border bg-background px-3 py-2">
        <p role="status" className="sr-only">
          {current?.label ?? ""}
        </p>
        {steps.length > 0 ? <StepList steps={steps} /> : <p className="text-xs text-muted-foreground">Starting…</p>}
      </div>
    )
  }
  if (!finished?.length) return null
  return (
    <details data-testid="agent-progress" data-state="done" className="group rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer list-none font-medium text-foreground marker:hidden pointer-coarse:py-2">
        How this was worked out <span className="font-normal text-muted-foreground">· {finished.length} {finished.length === 1 ? "step" : "steps"}</span>
      </summary>
      <div className="mt-2">
        <StepList steps={finished} />
      </div>
    </details>
  )
}

/** The agent's suggestion for the page's filters, with the choice to apply it. */
export function ProposalCard({ proposal, onApply, onDismiss }: { proposal: PageProposal; onApply: (proposal: PageProposal) => void; onDismiss: (proposal: PageProposal) => void }) {
  const titleId = React.useId()
  const summary = describeProposal(proposal)
  const pending = proposal.status === "proposed"
  return (
    <section
      data-testid="page-proposal"
      data-status={proposal.status}
      aria-labelledby={titleId}
      className={cn("flex min-w-0 flex-col gap-2 rounded-xl border px-3 py-2.5", pending ? "border-border bg-muted" : "border-border bg-background")}
    >
      <h3 id={titleId} className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
        <SlidersHorizontal aria-hidden className="size-4 shrink-0" />
        {proposal.status === "applied" ? "Applied to the page" : proposal.status === "dismissed" ? "Page change not applied" : "Suggested page filters"}
      </h3>
      <p data-testid="page-proposal-summary" className="min-w-0 break-words text-sm text-foreground">
        {summary}
      </p>
      {pending && (
        <>
          <p className="text-xs text-muted-foreground">Nothing changes until you apply it. The page still shows only what your access allows.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="proposal-apply"
              onClick={() => onApply(proposal)}
              className="min-h-9 rounded-full border border-border bg-foreground px-3.5 text-sm font-medium text-background hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
            >
              Apply to the page
            </button>
            <button
              type="button"
              data-testid="proposal-dismiss"
              onClick={() => onDismiss(proposal)}
              className="min-h-9 rounded-full border border-border bg-background px-3.5 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
            >
              Not now
            </button>
          </div>
        </>
      )}
    </section>
  )
}
