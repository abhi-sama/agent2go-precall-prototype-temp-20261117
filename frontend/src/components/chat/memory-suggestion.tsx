"use client"

/**
 * A preference the agent noticed and offers to remember (docs/adr/0023), shown under the answer as a Suggestion with
 * Remember and Dismiss. Remember saves through the same BE call as a preference the person asked for (the BE guard
 * decides again); Dismiss records the suggestion so it is not offered again. Nothing is saved until a click. The text
 * was checked by the guard before it got here (`lib/chat/events.ts`), and is shown exactly as it would be saved.
 */

import { Button } from "@astryxdesign/core/Button"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import * as React from "react"
import { Suggestion } from "@/components/provenance/provenance"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { MemorySuggestionItem } from "@/lib/chat/events"
import { newCorrelationId } from "@/lib/log/logger"

type Decision = "remembered" | "dismissed"

/** What was decided this visit, so a card that remounts (the panel closed and opened again) does not offer it twice. */
const decided = new Map<string, Decision>()

const DONE: Record<Decision, string> = {
  remembered: "Remembered. You can review or delete it under What the agent remembers.",
  dismissed: "Dismissed. I will not suggest that again.",
}

export function MemorySuggestionCard({ runId, suggestion }: { runId: string; suggestion: MemorySuggestionItem }) {
  const adapter = useDataAdapter()
  const key = `${runId}:${suggestion.text.toLowerCase()}`
  const [decision, setDecision] = React.useState<Decision | undefined>(() => decided.get(key))
  const [busy, setBusy] = React.useState<Decision | null>(null)
  const [failed, setFailed] = React.useState<string | null>(null)
  const resultRef = React.useRef<HTMLParagraphElement>(null)

  // The clicked button leaves with the choice, taking focus with it: the result takes focus, so it is also read out.
  React.useEffect(() => {
    if (decision && busy === null && document.activeElement === document.body) resultRef.current?.focus({ preventScroll: true })
  }, [decision, busy])

  const choose = async (next: Decision) => {
    setBusy(next)
    setFailed(null)
    try {
      const ctx = { correlationId: newCorrelationId() }
      if (next === "remembered") await adapter.saveAgentMemory(ctx, { text: suggestion.text, category: suggestion.category })
      else await adapter.dismissAgentMemorySuggestion(ctx, suggestion.text)
      decided.set(key, next)
      setDecision(next)
    } catch {
      setFailed(next === "remembered" ? "That could not be remembered. Try again." : "That could not be dismissed. Try again.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <Suggestion
      title="Remember this?"
      data-testid="memory-suggestion"
      data-state={decision ?? "open"}
      aria-label="Suggested preference to remember"
      actions={
        decision ? undefined : (
          <>
            <Button variant="primary" size="sm" label="Remember" data-testid="memory-suggestion-remember" className="pointer-coarse:min-h-11" isDisabled={busy !== null} onClick={() => void choose("remembered")} />
            <Button variant="secondary" size="sm" label="Dismiss" data-testid="memory-suggestion-dismiss" className="pointer-coarse:min-h-11" isDisabled={busy !== null} onClick={() => void choose("dismissed")} />
          </>
        )
      }
    >
      <VStack gap={1} align="start">
        <Text as="p" type="supporting" data-testid="memory-suggestion-reason">{suggestion.reason}</Text>
        <Text as="p" weight="medium" data-testid="memory-suggestion-text" style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
          Remember: &ldquo;{suggestion.text}&rdquo;
        </Text>
        <Text as="p" type="supporting">It is only about how you like to work, never your data. Nothing is saved unless you choose Remember.</Text>
        {decision && (
          <p ref={resultRef} tabIndex={-1} data-testid="memory-suggestion-result" className="text-sm font-medium outline-none">
            {DONE[decision]}
          </p>
        )}
        {failed && <p role="alert" data-testid="memory-suggestion-error" className="text-sm text-destructive">{failed}</p>}
      </VStack>
    </Suggestion>
  )
}
