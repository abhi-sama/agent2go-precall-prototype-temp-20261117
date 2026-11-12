"use client"

import { Check, ThumbsDown, ThumbsUp } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { Button } from "@astryxdesign/core/Button"
import { HStack } from "@astryxdesign/core/HStack"
import { TextArea } from "@astryxdesign/core/TextArea"
import { VStack } from "@astryxdesign/core/VStack"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { AnswerRating } from "@/lib/data/evals"
import { newCorrelationId } from "@/lib/log/logger"

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
    <VStack data-testid="answer-feedback" aria-label="Rate this answer" gap={2}>
      <HStack vAlign="center" gap={2} wrap="wrap">
        <p id={`feedback-${runId}`} className="text-sm text-muted-foreground">Was this answer helpful?</p>
        <HStack role="group" aria-labelledby={`feedback-${runId}`} gap={2}>
          {(
            [
              ["UP", ThumbsUp, "Helpful"],
              ["DOWN", ThumbsDown, "Not helpful"],
            ] as const
          ).map(([value, Icon, label]) => (
            <Button
              key={value}
              label={label}
              data-testid={`rate-${value.toLowerCase()}`}
              aria-pressed={rating === value}
              isDisabled={saving}
              onClick={() => choose(value)}
              variant={rating === value ? "primary" : "secondary"}
              icon={<Icon aria-hidden />}
              isIconOnly
            />
          ))}
        </HStack>
        {saved && (
          <span data-testid="rating-saved" role="status" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-4 text-success" aria-hidden />
            Saved, thank you
          </span>
        )}
      </HStack>
      {rating && (
        <form
          className="min-w-0"
          onSubmit={(e) => {
            e.preventDefault()
            if (!saving) void send(rating, note)
          }}
        >
          <HStack gap={2} wrap="wrap" vAlign="end">
            <TextArea
              label="Add a note (optional). Do not include patient or HCP details."
              value={note}
              rows={2}
              onChange={(value) => setNote(value.slice(0, MAX_NOTE))}
              data-testid="rating-note-input"
              width="100%"
            />
            <Button type="submit" label="Save note" variant="secondary" isDisabled={saving || note.trim() === ""} data-testid="rating-note-save" />
          </HStack>
        </form>
      )}
    </VStack>
  )
}
