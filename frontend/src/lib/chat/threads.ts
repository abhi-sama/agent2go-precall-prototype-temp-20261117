import type { Message } from "@ag-ui/core"
import type { ChatThreadSummary, DataAdapter } from "@/lib/data"
import { newCorrelationId } from "@/lib/log/logger"
import { messagesFromHistory } from "./persistence"

/**
 * The conversation list in Ask the agent: earlier conversations, newest activity first, each with a title (its first
 * question) and a date. The BE groups the saved turns by thread (`myChatThreads`); this is the browser's last check of
 * what it sends, so a malformed row never becomes a button.
 */

const isTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value))

/** Only well-formed rows, one per thread, most recently active first. */
export function listThreads(threads: readonly ChatThreadSummary[]): ChatThreadSummary[] {
  const byId = new Map<string, ChatThreadSummary>()
  for (const thread of threads) {
    if (!thread || typeof thread.threadId !== "string" || !thread.threadId || !isTime(thread.updatedAt) || !isTime(thread.startedAt)) continue
    const known = byId.get(thread.threadId)
    if (!known || Date.parse(thread.updatedAt) > Date.parse(known.updatedAt)) byId.set(thread.threadId, thread)
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

export const UNTITLED = "Conversation"

/** The row's title: the first question, never empty. */
export const threadTitle = (thread: Pick<ChatThreadSummary, "title">): string => thread.title.trim() || UNTITLED

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

/**
 * When the conversation last moved, in the reader's own time zone: a time today, "Yesterday", a weekday within the
 * last week, otherwise the date (with the year only when it is not this year).
 */
export function threadDate(updatedAt: string, now: Date = new Date(), locale?: string): string {
  const at = new Date(updatedAt)
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000)
  if (days <= 0) return at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
  if (days === 1) return "Yesterday"
  if (days < 7) return at.toLocaleDateString(locale, { weekday: "long" })
  return at.toLocaleDateString(locale, { day: "numeric", month: "short", ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) })
}

export const turnCountLabel = (count: number) => `${count} ${count === 1 ? "question" : "questions"}`

/**
 * An earlier conversation as the messages CopilotKit draws: the saved turns, oldest first, rebuilt exactly like a
 * conversation restored after a reload (answers, citations, charts and A2UI surfaces, each checked again before it is
 * drawn). They are ordinary thread messages, so the next question sends the last few turns as context like any other.
 * Turns of another thread are never mixed in, whatever the adapter returned.
 */
export async function loadThreadMessages(adapter: Pick<DataAdapter, "myChatThread">, threadId: string): Promise<Message[]> {
  const turns = await adapter.myChatThread({ correlationId: newCorrelationId() }, threadId)
  return messagesFromHistory(turns.filter((turn) => turn.threadId === threadId))
}
