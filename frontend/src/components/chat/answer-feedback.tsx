"use client"

import { Check, ThumbsDown, ThumbsUp } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { AnswerRating } from "@/lib/data/evals"
import { newCorrelationId } from "@/lib/log/logger"
import { cn } from "@/lib/utils"

const MAX_NOTE = 500

/**
 * Thumbs and an optional note on one finished answer. They go to the evaluation panel, where an administrator sees
 * them beside the automated scores of the same answer. The note is the person's own words: never shown in a toast,
 * never logged. Rating again replaces the earlier rating.
 */
export function AnswerFeedback({ runId }: { runId: string }) {
  const adapter = useDataAdapter()
  const [rating, setRating] = React.useState<AnswerRating | null>(null)
  const [note, setNote] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)

  const send = async (next: AnswerRating, text: string) => {
    setSaving(true)
    try {
      await adapter.rateAnswer({ correlationId: newCorrelationId() }, { runId, rating: next, note: text.trim() || undefined })
      setSaved(true)
    } catch {
      setSaved(false)
      toast.error("Your rating could not be saved")
    } finally {
      setSaving(false)
    }
  }

  const choose = (next: AnswerRating) => {
    if (saving) return
    setRating(next)
    setSaved(false)
    void send(next, note)
  }

  return (
    <section data-testid="answer-feedback" aria-label="Rate this answer" className="flex flex-col gap-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <p id={`feedback-${runId}`} className="text-sm text-muted-foreground">Was this answer helpful?</p>
        <div role="group" aria-labelledby={`feedback-${runId}`} className="flex gap-2">
          {(
            [
              ["UP", ThumbsUp, "Helpful"],
              ["DOWN", ThumbsDown, "Not helpful"],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              type="button"
              data-testid={`rate-${value.toLowerCase()}`}
              aria-pressed={rating === value}
              aria-label={label}
              disabled={saving}
              onClick={() => choose(value)}
              className={cn(
                "inline-flex size-11 items-center justify-center rounded-xl border transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60 motion-reduce:transition-none",
                rating === value ? "border-primary bg-primary/12 text-foreground" : "bg-card hover:bg-muted",
              )}
            >
              <Icon className="size-5" aria-hidden />
            </button>
          ))}
        </div>
        {saved && (
          <span data-testid="rating-saved" role="status" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-4 text-success" aria-hidden />
            Saved, thank you
          </span>
        )}
      </div>
      {rating && (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            if (!saving) void send(rating, note)
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Add a note (optional). Do not include patient or HCP details.</span>
            <textarea
              data-testid="rating-note-input"
              value={note}
              maxLength={MAX_NOTE}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-11 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            />
          </label>
          <Button type="submit" variant="outline" className="min-h-11" disabled={saving || note.trim() === ""} data-testid="rating-note-save">
            Save note
          </Button>
        </form>
      )}
    </section>
  )
}
