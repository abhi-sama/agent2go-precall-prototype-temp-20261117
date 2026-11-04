import type { ChatTurn } from "./use-chat"

/**
 * The conversation survives close, reopen and reload: it is kept in sessionStorage, per person, so it ends with
 * the tab and is never shared between two people on one browser. Every access is guarded; a private window or
 * a full quota only means the conversation lasts until the next reload.
 */
export interface StoredChat {
  v: 1
  threadId: string
  turns: ChatTurn[]
}

export const MAX_STORED_TURNS = 30
const key = (userId: string) => `a2g.chat.v1.${userId}`

const INTERRUPTED = "This answer was interrupted when the page reloaded. Ask again."

/** A run cannot continue after a reload, so a stored running turn is shown as interrupted rather than spinning. */
export function settle(turns: ChatTurn[]): ChatTurn[] {
  return turns.map((t) =>
    t.answer.status === "running" ? { ...t, answer: { ...t.answer, status: "error" as const, error: INTERRUPTED } } : t,
  )
}

export function loadChat(userId: string, storage: Pick<Storage, "getItem"> | null = safeStorage()): StoredChat | null {
  try {
    const raw = storage?.getItem(key(userId))
    if (!raw) return null
    const data = JSON.parse(raw) as Partial<StoredChat>
    if (data.v !== 1 || typeof data.threadId !== "string" || !Array.isArray(data.turns)) return null
    const turns = data.turns.filter(
      (t): t is ChatTurn => !!t && typeof t.id === "string" && typeof t.question === "string" && !!t.answer && typeof t.answer.status === "string",
    )
    return { v: 1, threadId: data.threadId, turns: settle(turns) }
  } catch {
    return null
  }
}

export function saveChat(userId: string, chat: { threadId: string; turns: ChatTurn[] }, storage: Pick<Storage, "setItem" | "removeItem"> | null = safeStorage()): void {
  if (!storage) return
  try {
    if (!chat.turns.length) {
      storage.removeItem(key(userId))
      return
    }
    // Drop the oldest turns first if the browser's quota is hit; keep what the person is looking at.
    let turns = chat.turns.slice(-MAX_STORED_TURNS)
    for (;;) {
      try {
        storage.setItem(key(userId), JSON.stringify({ v: 1, threadId: chat.threadId, turns } satisfies StoredChat))
        return
      } catch (err) {
        if (turns.length <= 1) throw err
        turns = turns.slice(Math.ceil(turns.length / 2))
      }
    }
  } catch {
    /* storage unavailable or full: the conversation lasts until the next reload */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}
