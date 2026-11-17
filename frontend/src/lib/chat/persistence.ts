import type { Message } from "@ag-ui/core"
import { A2UI_ACTIVITY_TYPE } from "./a2ui/protocol"
import { ANSWER_ACTIVITY, ids, type AnswerActivity } from "./agent/answer"
import { settle, turnsOf } from "./agent/turns"
import type { SavedChatTurn } from "@/lib/data"

/**
 * The conversation survives close, reopen and reload: CopilotKit's message list for the thread is kept in
 * sessionStorage, per person, so it ends with the tab and is never shared between two people on one browser. Every
 * access is guarded; a private window or a full quota only means the conversation lasts until the next reload.
 *
 * Messages are checked on the way back in: only the roles and activity types this chat produces survive, and an
 * answer cut off by the reload is marked interrupted (`settle`). Evidence inside a stored answer is parsed again by
 * the same code as a live one whenever it is drawn (`lib/chat/agent/answer.ts`).
 */
export interface StoredChat {
  v: 2
  threadId: string
  messages: Message[]
}

export const MAX_STORED_TURNS = 30
const key = (userId: string) => `a2g.chat.v2.${userId}`
/** The turn-based format this replaced (before CopilotKit). It is not migrated: it ends with the tab anyway. */
const legacyKey = (userId: string) => `a2g.chat.v1.${userId}`

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const isText = (v: unknown) => typeof v === "string" && v.length <= 100_000

function isToolCall(v: unknown): boolean {
  return isObject(v) && typeof v.id === "string" && v.type === "function" && isObject(v.function) && typeof v.function.name === "string" && typeof v.function.arguments === "string"
}

/** A message this chat could have produced, or `false`. */
export function isStoredMessage(v: unknown): v is Message {
  if (!isObject(v) || typeof v.id !== "string" || !v.id || v.id.length > 200) return false
  switch (v.role) {
    case "user":
      return isText(v.content)
    case "assistant":
      return (v.content === undefined || isText(v.content)) && (v.toolCalls === undefined || (Array.isArray(v.toolCalls) && v.toolCalls.every(isToolCall)))
    case "tool":
      return typeof v.toolCallId === "string" && isText(v.content)
    case "activity":
      return (v.activityType === ANSWER_ACTIVITY || v.activityType === A2UI_ACTIVITY_TYPE) && isObject(v.content)
    default:
      return false
  }
}

export function loadChat(userId: string, storage: Pick<Storage, "getItem"> | null = safeStorage()): StoredChat | null {
  try {
    const raw = storage?.getItem(key(userId))
    if (!raw) return null
    const data = JSON.parse(raw) as Partial<StoredChat>
    if (data.v !== 2 || typeof data.threadId !== "string" || !data.threadId || !Array.isArray(data.messages)) return null
    return { v: 2, threadId: data.threadId, messages: settle(data.messages.filter(isStoredMessage)) }
  } catch {
    return null
  }
}

/** The newest `turns` turns of the thread, whole (a question is never split from its answer). */
function lastTurns(messages: readonly Message[], turns: number): Message[] {
  return turnsOf(messages).slice(-turns).flatMap((turn) => turn.messages)
}

export function saveChat(userId: string, chat: { threadId: string; messages: readonly Message[] }, storage: Pick<Storage, "setItem" | "removeItem"> | null = safeStorage()): void {
  if (!storage) return
  try {
    storage.removeItem(legacyKey(userId))
    if (!chat.messages.length) {
      storage.removeItem(key(userId))
      return
    }
    // Drop the oldest turns first if the browser's quota is hit; keep what the person is looking at.
    let turns = MAX_STORED_TURNS
    for (;;) {
      try {
        storage.setItem(key(userId), JSON.stringify({ v: 2, threadId: chat.threadId, messages: lastTurns(chat.messages, turns) } satisfies StoredChat))
        return
      } catch (err) {
        if (turns <= 1) throw err
        turns = Math.ceil(turns / 2) === turns ? turns - 1 : Math.ceil(turns / 2)
      }
    }
  } catch {
    /* storage unavailable or full: the conversation lasts until the next reload */
  }
}

export function clearChat(userId: string, storage: Pick<Storage, "removeItem"> | null = safeStorage()): void {
  try {
    storage?.removeItem(key(userId))
    storage?.removeItem(legacyKey(userId))
  } catch {
    /* storage unavailable */
  }
}

type HistoryPayload = {
  facts?: unknown[]
  citations?: unknown[]
  visuals?: unknown[]
  surfaces?: unknown[]
  suggestions?: unknown[]
  dataThrough?: unknown
  modelMode?: unknown
  unverifiedNumbers?: unknown[]
  sampleLimitations?: unknown[]
}

const object = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])

/**
 * Rebuild CopilotKit messages from agent-owned DynamoDB turns. The payload is treated exactly like a restored browser
 * session: it becomes evidence activities, and every renderer validates it again before drawing anything.
 */
export function messagesFromHistory(turns: readonly SavedChatTurn[]): Message[] {
  const ordered = [...turns].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
  const messages: Message[] = []
  for (const turn of ordered) {
    let payload: HistoryPayload = {}
    try {
      payload = (object(JSON.parse(turn.payload)) ?? {}) as HistoryPayload
    } catch {
      continue
    }
    if (!turn.threadId || !turn.runId || !turn.userMessage || typeof turn.assistantText !== "string") continue
    const events: AnswerActivity["events"] = []
    if (Array.isArray(payload.facts)) events.push({ type: "CUSTOM", name: "source_facts", value: { facts: payload.facts, ...(typeof payload.dataThrough === "string" ? { data_through: payload.dataThrough } : {}) } })
    if (Array.isArray(payload.citations)) events.push({ type: "CUSTOM", name: "citations", value: payload.citations })
    for (const visual of payload.visuals ?? []) {
      const visualObject = object(visual)
      if (visualObject) events.push({ type: "CUSTOM", name: "visual", value: { ...visualObject, phase: "ready" } })
    }
    if (typeof payload.modelMode === "string") events.push({ type: "CUSTOM", name: "model_mode", value: { mode: payload.modelMode } })
    events.push({ type: "CUSTOM", name: "number_check", value: { status: strings(payload.unverifiedNumbers).length ? "unverified" : "verified", count: strings(payload.unverifiedNumbers).length, checked: payload.modelMode !== "stub" } })
    if (Array.isArray(payload.sampleLimitations)) events.push({ type: "CUSTOM", name: "sample_limitations", value: strings(payload.sampleLimitations) })
    if (Array.isArray(payload.suggestions)) events.push({ type: "CUSTOM", name: "suggestions", value: strings(payload.suggestions) })
    events.push({ type: "CUSTOM", name: "conversation_saved", value: { saved: true } })
    const questionId = `history~${turn.runId}~question`
    messages.push({ id: questionId, role: "user", content: turn.userMessage } as Message)
    messages.push({ id: ids.text(turn.runId, 0), role: "assistant", content: turn.assistantText } as Message)
    if (Array.isArray(payload.surfaces)) {
      for (const [index, operations] of payload.surfaces.entries()) {
        if (!Array.isArray(operations)) continue
        messages.push({ id: `history~${turn.runId}~surface~${index}`, role: "activity", activityType: A2UI_ACTIVITY_TYPE, content: { a2ui_operations: operations } } as Message)
      }
    }
    messages.push({ id: ids.tail(turn.runId), role: "activity", activityType: ANSWER_ACTIVITY, content: { v: 1, runId: turn.runId, part: "tail", userMessageId: questionId, status: "done", error: null, events } } as Message)
  }
  return messages
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}
