import { checkPreference, cleanMemoryText, MEMORY_CATEGORIES, MEMORY_MAX_ITEMS } from "./memory-guard"
import { DataError, type AgentMemoryInput, type AgentMemoryItem, type RequestContext } from "./types"

/**
 * Stand-in for the per-user memory items in FE DynamoDB (docs/adr/0022): private to the user, oldest first, one item per
 * distinct text, at most `MEMORY_MAX_ITEMS`. Like the real store, a browser keeps them in localStorage so a reload keeps
 * them; under test and during server render it is an in-memory map. The guard is the BE's, mirrored.
 */
const STORE_KEY = "a2g.mock.agentMemory"
const memory = new Map<string, AgentMemoryItem[]>()
let counter = 0

function readAll(): Record<string, AgentMemoryItem[]> {
  if (typeof window === "undefined") return Object.fromEntries(memory)
  try {
    return JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, AgentMemoryItem[]>
  } catch {
    return Object.fromEntries(memory)
  }
}

function writeOne(userId: string, items: AgentMemoryItem[]) {
  memory.set(userId, items)
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...readAll(), [userId]: items }))
  } catch {
    /* private mode: the in-memory copy still holds for this visit */
  }
}

export function resetMockAgentMemory() {
  memory.clear()
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(STORE_KEY)
  } catch {
    /* nothing to clear */
  }
}

interface Deps {
  getUserId: () => string
  gate: (ctx: RequestContext, operation: string) => Promise<unknown>
  now: () => Date
}

export function createMockAgentMemory({ getUserId, gate, now }: Deps) {
  const mine = () => readAll()[getUserId()] ?? []
  return {
    async myAgentMemory(ctx: RequestContext): Promise<AgentMemoryItem[]> {
      await gate(ctx, "myAgentMemory")
      return structuredClone(mine())
    },
    async saveAgentMemory(ctx: RequestContext, input: AgentMemoryInput): Promise<AgentMemoryItem> {
      await gate(ctx, "saveAgentMemory")
      const text = cleanMemoryText(String(input.text ?? ""))
      if (!MEMORY_CATEGORIES.includes(input.category) || checkPreference(text) !== null) {
        throw new DataError("BAD_REQUEST", "That cannot be remembered. The agent remembers how you like to work, not records or figures.", ctx.correlationId)
      }
      const items = mine()
      const existing = items.find((item) => item.text.toLowerCase() === text.toLowerCase())
      if (existing) return structuredClone(existing)
      if (items.length >= MEMORY_MAX_ITEMS) throw new DataError("BAD_REQUEST", "The agent remembers at most 30 things. Delete one first.", ctx.correlationId)
      const saved: AgentMemoryItem = { memoryId: `${now().toISOString().replace(/\D/g, "").slice(0, 14)}-${(++counter).toString(16).padStart(8, "0")}`, text, category: input.category, createdAt: now().toISOString() }
      writeOne(getUserId(), [...items, saved])
      return structuredClone(saved)
    },
    async deleteAgentMemory(ctx: RequestContext, memoryId: string): Promise<void> {
      await gate(ctx, "deleteAgentMemory")
      const items = mine()
      if (!items.some((item) => item.memoryId === memoryId)) throw new DataError("NOT_FOUND", "That item is not available.", ctx.correlationId)
      writeOne(getUserId(), items.filter((item) => item.memoryId !== memoryId))
    },
    async clearAgentMemory(ctx: RequestContext): Promise<number> {
      await gate(ctx, "clearAgentMemory")
      const removed = mine().length
      writeOne(getUserId(), [])
      return removed
    },
  }
}
