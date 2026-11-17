/**
 * The computed side of one answer in Ask the agent, carried through CopilotKit as AG-UI activity messages
 * (docs/adr/0018).
 *
 * The agent streams its computed content (source facts, citations, charts, row sets, suggestions, the number check)
 * as `CUSTOM` events (ADR 0007, 0009, 0015). CopilotKit keeps messages, not custom events, so the client agent folds
 * a run's evidence events into two `ACTIVITY_SNAPSHOT` messages of type `a2g-answer`:
 *  - the **head**, created when the first evidence arrives, so it sits after the tool calls and before the answer text;
 *  - the **tail**, created when the run ends, so it sits after the text and carries the outcome.
 * Both hold the raw evidence events, not a parsed copy: every render folds them through the same hardened parsers in
 * `lib/chat/events.ts`, so a stored or restored conversation is checked exactly like a live one.
 */

import { z } from "zod"
import { applyEvent, newTurn, type AssistantTurn } from "@/lib/chat/events"
import type { ChatContext } from "@/lib/data/director-insights"

export const ANSWER_ACTIVITY = "a2g-answer"

export type AnswerPart = "head" | "tail"
export type AnswerStatus = "running" | "done" | "error"

/** Evidence events the client keeps. Anything else the agent sends is dropped before CopilotKit sees it. */
export const EVIDENCE_EVENTS: ReadonlySet<string> = new Set([
  "model_mode",
  "source_facts",
  "citations",
  "visual",
  "row_sets",
  "rows_unavailable",
  "sample_limitations",
  "suggestions",
  "number_check",
  "conversation_saved",
])

/** Evidence the head shows (beside the charts); a run with none of it has no head. */
export const HEAD_EVENTS: ReadonlySet<string> = new Set(["source_facts", "citations", "visual", "row_sets", "rows_unavailable", "sample_limitations"])

export type EvidenceEvent = Record<string, unknown> & { type: string }

export interface AnswerActivity {
  v: 1
  runId: string
  part: AnswerPart
  /** The question this answers: the user message that started the run. */
  userMessageId: string
  /** The screen context sent with the question (the chips), shown under it. */
  context?: ChatContext
  status: AnswerStatus
  /** Fixed, user-safe text when the run did not finish. Never an exception message. */
  error: string | null
  /** The run's evidence events in arrival order (`CUSTOM` evidence and `TOOL_CALL_END`). */
  events: EvidenceEvent[]
}

const optionalString = z.string().max(64).optional()

/** The renderer's schema: CopilotKit drops an activity whose content does not match it. */
export const answerActivitySchema = z.object({
  v: z.literal(1),
  runId: z.string().min(1).max(80),
  part: z.enum(["head", "tail"]),
  userMessageId: z.string().max(80),
  context: z
    .object({ view: optionalString, territoryId: optionalString, questionId: optionalString, from: optionalString, to: optionalString })
    .optional(),
  status: z.enum(["running", "done", "error"]),
  error: z.string().max(300).nullable(),
  events: z.array(z.object({ type: z.string() }).passthrough()).max(400),
}) satisfies z.ZodType<AnswerActivity>

/** Message ids the client agent gives a run's messages, so a message can be traced to its run. */
export const ids = {
  text: (runId: string, n: number) => `${runId}~text~${n}`,
  tools: (runId: string) => `${runId}~tools`,
  toolResult: (runId: string, toolCallId: string) => `${runId}~tool~${toolCallId}`,
  head: (runId: string) => `${runId}~answer-head`,
  tail: (runId: string) => `${runId}~answer-tail`,
  surface: (runId: string, surfaceId: string) => `${runId}~surface~${surfaceId}`,
}

/** The run a message belongs to, for messages the client agent named; `null` for user messages and foreign ids. */
export function runIdOf(messageId: string): string | null {
  const at = messageId.indexOf("~")
  return at > 0 ? messageId.slice(0, at) : null
}

/** Fold an answer's evidence events into the turn model the evidence components draw. */
export function evidenceOf(activity: Pick<AnswerActivity, "runId" | "events" | "status" | "error">): AssistantTurn {
  const turn = activity.events.reduce<AssistantTurn>((acc, event) => applyEvent(acc, event), newTurn(activity.runId))
  return { ...turn, status: activity.status, error: activity.error }
}

export function isAnswerActivity(value: unknown): value is AnswerActivity {
  return answerActivitySchema.safeParse(value).success
}
