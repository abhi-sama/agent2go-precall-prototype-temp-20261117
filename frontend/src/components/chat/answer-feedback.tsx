"use client"

import { Button } from "@astryxdesign/core/Button"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Text } from "@astryxdesign/core/Text"
import { TextArea } from "@astryxdesign/core/TextArea"
import { ToggleButton } from "@astryxdesign/core/ToggleButton"
import { VStack } from "@astryxdesign/core/VStack"
import { ThumbsDown, ThumbsUp } from "lucide-react"
import * as React from "react"
import { useAppToast } from "@/components/state/use-app-toast"
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
  const toast = useAppToast()
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
    <VStack as="section" data-testid="answer-feedback" aria-label="Rate this answer" gap={2}>
      <HStack gap={2} align="center" wrap="wrap">
        <Text as="p" type="supporting" id={`feedback-${runId}`}>Was this answer helpful?</Text>
        <HStack role="group" aria-labelledby={`feedback-${runId}`} gap={2}>
          {(
            [
              ["UP", ThumbsUp, "Helpful"],
              ["DOWN", ThumbsDown, "Not helpful"],
            ] as const
          ).map(([value, glyph, label]) => (
            <ToggleButton
              key={value}
              data-testid={`rate-${value.toLowerCase()}`}
              isIconOnly
              label={label}
              icon={<Icon icon={glyph} />}
              isPressed={rating === value}
              isDisabled={saving}
              onPressedChange={() => choose(value)}
            />
          ))}
        </HStack>
        {saved && (
          <HStack as="span" data-testid="rating-saved" role="status" gap={1} align="center">
            <Icon icon="check" size="sm" color="success" />
            <Text type="supporting">Saved, thank you</Text>
          </HStack>
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
          <HStack gap={2} wrap="wrap" align="end">
            <TextArea data-layout-ok="overlap"
              data-testid="rating-note-input"
              label="Add a note (optional). Do not include patient or HCP details."
              value={note}
              rows={2}
              width="100%"
              onChange={(value) => setNote(value.slice(0, MAX_NOTE))}
            />
            <Button type="submit" variant="secondary" isDisabled={saving || note.trim() === ""} data-testid="rating-note-save" label="Save note" />
          </HStack>
        </form>
      )}
    </VStack>
  )
}
