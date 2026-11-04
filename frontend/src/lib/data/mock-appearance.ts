import { DataError, type AppearanceChoice, type RequestContext, type SavedAppearance } from "./types"

/**
 * Stand-in for the per-user appearance item in FE DynamoDB. Choices are private to the user and the latest save
 * wins, like the real table. In a browser the mock keeps them in localStorage so a reload keeps the choice, as the
 * real store does; under test and during server render it is an in-memory map.
 */
const STORE_KEY = "a2g.mock.appearance"

const VALID: Record<keyof AppearanceChoice, readonly string[]> = {
  style: ["auto", "warm", "clinical"],
  mode: ["device", "light", "charcoal", "black"],
  density: ["auto", "comfortable", "compact"],
}

const memory = new Map<string, SavedAppearance>()

function readAll(): Record<string, SavedAppearance> {
  if (typeof window === "undefined") return Object.fromEntries(memory)
  try {
    return JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, SavedAppearance>
  } catch {
    return Object.fromEntries(memory)
  }
}

function writeOne(userId: string, value: SavedAppearance) {
  memory.set(userId, value)
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...readAll(), [userId]: value }))
  } catch {
    /* private mode: the in-memory copy still holds for this visit */
  }
}

export function resetMockAppearance() {
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

export function createMockAppearance({ getUserId, gate, now }: Deps) {
  return {
    async myAppearance(ctx: RequestContext): Promise<SavedAppearance | null> {
      await gate(ctx, "myAppearance")
      return readAll()[getUserId()] ?? null
    },
    async setAppearance(ctx: RequestContext, input: AppearanceChoice): Promise<SavedAppearance> {
      await gate(ctx, "setAppearance")
      for (const key of Object.keys(VALID) as (keyof AppearanceChoice)[]) {
        if (!VALID[key].includes(input[key])) throw new DataError("BAD_REQUEST", "That appearance choice is not available.", ctx.correlationId)
      }
      const saved: SavedAppearance = { style: input.style, mode: input.mode, density: input.density, updatedAt: now().toISOString() }
      writeOne(getUserId(), saved)
      return saved
    },
  }
}
