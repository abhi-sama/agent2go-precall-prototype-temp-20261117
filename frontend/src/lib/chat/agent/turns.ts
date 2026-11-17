/**
 * A CopilotKit thread as the turns the person sees: one question and everything the agent sent for it.
 * Used by the client agent (chat history for the next question), the chat view (one row per turn) and the session
 * store (an answer cut off by a reload is marked interrupted).
 */

import type { Message } from "@ag-ui/core"
import type { ChatMessageInput } from "@/lib/data/types"
import { ANSWER_ACTIVITY, ids, isAnswerActivity, runIdOf, type AnswerActivity } from "./answer"

export const HISTORY_TURNS = 3
export const INTERRUPTED = "This answer was interrupted when the page reloaded. Ask again."

export interface Turn {
  /** The question's message id (or the first message's id for anything before the first question). */
  key: string
  question: string
  questionId: string | null
  messages: Message[]
  runId: string | null
  head: AnswerActivity | null
  tail: AnswerActivity | null
  /** The answer text, as the agent streamed it. */
  text: string
}

/** The plain text of a message: a string, or the text parts of a multimodal one. */
export function textOf(message: Message): string {
  const content = (message as { content?: unknown }).content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part) => (part && typeof part === "object" && (part as { type?: unknown }).type === "text" ? String((part as { text?: unknown }).text ?? "") : ""))
    .join("")
}

function answerOf(message: Message): AnswerActivity | null {
  if (message.role !== "activity") return null
  const activity = message as Message & { activityType?: string; content?: unknown }
  return activity.activityType === ANSWER_ACTIVITY && isAnswerActivity(activity.content) ? activity.content : null
}

export function turnsOf(messages: readonly Message[]): Turn[] {
  const turns: Turn[] = []
  let current: Turn | null = null
  for (const message of messages) {
    if (message.role === "user" || !current) {
      current = {
        key: message.id,
        question: message.role === "user" ? textOf(message) : "",
        questionId: message.role === "user" ? message.id : null,
        messages: [],
        runId: null,
        head: null,
        tail: null,
        text: "",
      }
      turns.push(current)
    }
    current.messages.push(message)
    const answer = answerOf(message)
    if (answer?.part === "head") current.head = answer
    if (answer?.part === "tail") current.tail = answer
    current.runId ??= answer?.runId ?? (message.role === "user" ? null : runIdOf(message.id))
    if (message.role === "assistant") current.text += textOf(message)
  }
  return turns
}

/** Prior turns as chat history for the agent: only answers that finished, the newest few, text only. */
export function historyOf(messages: readonly Message[], max = HISTORY_TURNS): ChatMessageInput[] {
  return turnsOf(messages)
    .filter((turn) => turn.questionId && turn.tail?.status === "done" && turn.text.trim())
    .slice(-max)
    .flatMap((turn) => [
      { role: "user" as const, content: turn.question },
      { role: "assistant" as const, content: turn.text },
    ])
}

/**
 * A run cannot continue after a reload. Any question whose answer never ended gets a tail saying it was interrupted,
 * so it shows as stopped rather than spinning, and is left out of the history sent with the next question.
 */
export function settle(messages: readonly Message[]): Message[] {
  const out: Message[] = []
  for (const turn of turnsOf(messages)) {
    out.push(...turn.messages)
    if (!turn.questionId || turn.tail) continue
    const runId = turn.runId ?? `interrupted-${turn.questionId}`.slice(0, 80)
    const content: AnswerActivity = {
      v: 1,
      runId,
      part: "tail",
      userMessageId: turn.questionId,
      ...(turn.head?.context ? { context: turn.head.context } : {}),
      status: "error",
      error: INTERRUPTED,
      events: turn.head?.events ?? [],
    }
    out.push({ id: ids.tail(runId), role: "activity", activityType: ANSWER_ACTIVITY, content } as Message)
  }
  return out
}
