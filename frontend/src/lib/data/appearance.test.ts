import { beforeEach, describe, expect, it } from "vitest"
import { createGraphQLAdapter } from "./graphql-adapter"
import { createMockAdapter } from "./mock-adapter"
import { resetMockAppearance } from "./mock-appearance"
import { MY_APPEARANCE_QUERY, SET_APPEARANCE_MUTATION } from "./operations"
import { DataError } from "./types"

const ctx = { correlationId: "test" }
const NOW = () => new Date("2026-11-04T12:00:00Z")
const make = (userId: string) => createMockAdapter({ getUserId: () => userId, latencyMs: 0, now: NOW })

describe("saved appearance (mock of the FE DynamoDB item)", () => {
  beforeEach(resetMockAppearance)

  it("is null until the person chooses, so persona defaults apply", async () => {
    await expect(make("u-msl-ne-01").myAppearance(ctx)).resolves.toBeNull()
  })

  it("round-trips a choice and stamps it", async () => {
    const adapter = make("u-dir-ne")
    const saved = await adapter.setAppearance(ctx, { style: "warm", mode: "black", density: "compact" })
    expect(saved).toEqual({ style: "warm", mode: "black", density: "compact", updatedAt: "2026-11-04T12:00:00.000Z" })
    await expect(adapter.myAppearance(ctx)).resolves.toEqual(saved)
  })

  it("is private to each person", async () => {
    await make("u-dir-ne").setAppearance(ctx, { style: "warm", mode: "black", density: "compact" })
    await expect(make("u-msl-ne-01").myAppearance(ctx)).resolves.toBeNull()
    await expect(make("u-exec-all").myAppearance(ctx)).resolves.toBeNull()
  })

  it("keeps the latest save", async () => {
    const adapter = make("u-msl-ne-01")
    await adapter.setAppearance(ctx, { style: "clinical", mode: "light", density: "auto" })
    await adapter.setAppearance(ctx, { style: "auto", mode: "device", density: "auto" })
    await expect(adapter.myAppearance(ctx)).resolves.toMatchObject({ style: "auto", mode: "device" })
  })

  it("refuses values the API would refuse and keeps the old choice", async () => {
    const adapter = make("u-msl-ne-01")
    await adapter.setAppearance(ctx, { style: "warm", mode: "charcoal", density: "auto" })
    await expect(adapter.setAppearance(ctx, { style: "neon", mode: "light", density: "auto" } as never)).rejects.toBeInstanceOf(DataError)
    await expect(adapter.setAppearance(ctx, { style: "warm", mode: "dark", density: "auto" } as never)).rejects.toBeInstanceOf(DataError)
    await expect(adapter.myAppearance(ctx)).resolves.toMatchObject({ mode: "charcoal" })
  })
})

describe("saved appearance over AppSync", () => {
  it("sends only the three choices, never a user id", async () => {
    const seen: unknown[] = []
    const saved = { style: "warm", mode: "light", density: "auto", updatedAt: "2026-11-04T12:00:00Z" }
    const adapter = createGraphQLAdapter(async (req) => {
      seen.push(req)
      return { data: (req.query === MY_APPEARANCE_QUERY ? { myAppearance: null } : { setAppearance: saved }) as never }
    })
    await expect(adapter.myAppearance(ctx)).resolves.toBeNull()
    await expect(adapter.setAppearance(ctx, { style: "warm", mode: "light", density: "auto" })).resolves.toEqual(saved)
    expect(seen[1]).toMatchObject({ query: SET_APPEARANCE_MUTATION, variables: { input: { style: "warm", mode: "light", density: "auto" } } })
  })
})
