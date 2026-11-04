import { describe, expect, it } from "vitest"
import { newTurn } from "./events"
import { loadChat, saveChat, settle } from "./persistence"
import type { ChatTurn } from "./use-chat"

class MemoryStorage {
  data = new Map<string, string>()
  limit = Infinity
  getItem(k: string) { return this.data.get(k) ?? null }
  setItem(k: string, v: string) {
    if (v.length > this.limit) throw new Error("QuotaExceededError")
    this.data.set(k, v)
  }
  removeItem(k: string) { this.data.delete(k) }
}

const turn = (id: string, status: "running" | "done" = "done", text = "answer"): ChatTurn => ({
  id,
  question: `q-${id}`,
  answer: { ...newTurn(id), status, text },
})

describe("chat persistence", () => {
  it("round-trips a conversation, per person", () => {
    const s = new MemoryStorage()
    saveChat("u1", { threadId: "t1", turns: [turn("a"), turn("b")] }, s)
    expect(loadChat("u1", s)?.turns.map((t) => t.id)).toEqual(["a", "b"])
    expect(loadChat("u1", s)?.threadId).toBe("t1")
    expect(loadChat("u2", s)).toBeNull()
  })

  it("shows a run that was streaming at reload as interrupted, not spinning", () => {
    const [t] = settle([turn("a", "running", "partial")])
    expect(t.answer.status).toBe("error")
    expect(t.answer.error).toContain("interrupted")
    expect(t.answer.text).toBe("partial")
  })

  it("removes the entry when the conversation is empty", () => {
    const s = new MemoryStorage()
    saveChat("u1", { threadId: "t", turns: [turn("a")] }, s)
    saveChat("u1", { threadId: "t", turns: [] }, s)
    expect(loadChat("u1", s)).toBeNull()
  })

  it("ignores corrupt or foreign data", () => {
    const s = new MemoryStorage()
    s.setItem("a2g.chat.v1.u1", "{not json")
    expect(loadChat("u1", s)).toBeNull()
    s.setItem("a2g.chat.v1.u1", JSON.stringify({ v: 2, threadId: "t", turns: [] }))
    expect(loadChat("u1", s)).toBeNull()
    s.setItem("a2g.chat.v1.u1", JSON.stringify({ v: 1, threadId: "t", turns: [{ nope: true }, turn("ok")] }))
    expect(loadChat("u1", s)?.turns.map((t) => t.id)).toEqual(["ok"])
  })

  it("drops the oldest turns when the quota is hit, and never throws", () => {
    const s = new MemoryStorage()
    const turns = Array.from({ length: 8 }, (_, i) => turn(String(i)))
    s.limit = JSON.stringify({ v: 1, threadId: "t", turns: turns.slice(-3) }).length + 50
    expect(() => saveChat("u1", { threadId: "t", turns }, s)).not.toThrow()
    const kept = loadChat("u1", s)!.turns.map((t) => t.id)
    expect(kept.at(-1)).toBe("7")
    expect(kept.length).toBeLessThan(8)
    s.limit = 1
    expect(() => saveChat("u1", { threadId: "t", turns }, s)).not.toThrow()
    expect(() => saveChat("u1", { threadId: "t", turns }, null)).not.toThrow()
  })
})
