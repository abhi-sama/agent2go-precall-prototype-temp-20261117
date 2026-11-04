"use client"

import { ThumbsDown, ThumbsUp } from "lucide-react"
import type { EvalRatings } from "@/lib/data/evals"
import { cn } from "@/lib/utils"
import { pct, when } from "./format"

/** Thumbs and notes from live answers. Each sits beside the automated scores of the very same answer. */
export function RatingsPanel({ ratings, personaLabel }: { ratings: EvalRatings; personaLabel: string }) {
  const s = ratings.summary
  return (
    <div data-testid="ratings-panel" className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        What {personaLabel} users thought of real answers, with the automated faithfulness and citation scores of those same answers beside each thumb. A thumbs-down on a high-scoring answer is the kind of thing automation misses.
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Helpful", String(s.up)],
          ["Not helpful", String(s.down)],
          ["Automated faithfulness", pct(s.faithfulness)],
          ["Automated citations", pct(s.citationCorrectness)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-2xl border bg-card p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {ratings.items.length === 0 ? (
        <p data-testid="ratings-empty" className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No {personaLabel} has rated an answer yet. Thumbs appear under every answer in chat.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ratings.items.map((item) => {
            const up = item.rating === "UP"
            const Icon = up ? ThumbsUp : ThumbsDown
            return (
              <li key={item.ratingId} data-testid="rating-item" data-rating={item.rating} className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-2xl border bg-card p-4">
                <span className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold", up ? "border-success/40 bg-success/10" : "border-destructive/40 bg-destructive/10")}>
                  <Icon className={cn("size-4", up ? "text-success" : "text-destructive")} aria-hidden />
                  {up ? "Helpful" : "Not helpful"}
                </span>
                <div className="min-w-0 flex-1 basis-60">
                  {item.note ? <p data-testid="rating-note" className="break-words">{item.note}</p> : <p className="text-muted-foreground">No note.</p>}
                  <p className="mt-1 text-xs text-muted-foreground">Rated {when(item.ratedAt)} · answer {item.chatRunId.slice(0, 12)}</p>
                </div>
                <p data-testid="rating-scores" className="text-sm tabular-nums">
                  <span className="text-xs text-muted-foreground">Automated: </span>
                  faithful <strong>{pct(item.faithfulness)}</strong> · citations <strong>{item.citationCorrectness === null ? "none cited" : pct(item.citationCorrectness)}</strong>
                  {item.numbersUnverified > 0 && <span> · {item.numbersUnverified} unmatched figure{item.numbersUnverified === 1 ? "" : "s"}</span>}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
