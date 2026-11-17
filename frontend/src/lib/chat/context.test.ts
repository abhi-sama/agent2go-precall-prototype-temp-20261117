import { describe, expect, it } from "vitest"
import { chatLink, parseChatContext, startersFor } from "./context"

const parse = (q: string) => parseChatContext(new URLSearchParams(q))

describe("parseChatContext", () => {
  it("reads a well-formed screen context", () => {
    expect(parse("view=director-insights&territory=T01-02&question=Q-0013&from=2026-08-06&to=2026-11-03")).toEqual({
      view: "director-insights",
      territoryId: "T01-02",
      questionId: "Q-0013",
      from: "2026-08-06",
      to: "2026-11-03",
    })
  })
  it("drops malformed values and never reads an intent from a link", () => {
    expect(parse("territory=T01-02;DROP&intent=TERRITORY_SUMMARY&view=Bad%20View")).toBeUndefined()
    expect(parse("territory=T01-02&intent=TERRITORY_SUMMARY")).toEqual({ territoryId: "T01-02" })
  })
  it("needs both dates, in order", () => {
    expect(parse("from=2026-08-06")).toBeUndefined()
    expect(parse("from=2026-11-03&to=2026-08-06")).toBeUndefined()
  })
  it("round-trips through chatLink", () => {
    const ctx = { view: "director-insights", territoryId: "T01-02", from: "2026-08-06", to: "2026-11-03" }
    expect(parse(chatLink(ctx).split("?")[1])).toEqual(ctx)
    expect(chatLink({})).toBe("/chat")
  })
})

describe("startersFor", () => {
  const defaults = ["a", "b"]
  it("falls back to the defaults without a context", () => expect(startersFor(undefined, defaults)).toEqual(defaults))
  it("suggests questions that fit the territory and question in view", () => {
    expect(startersFor({ territoryId: "T01-02", questionId: "Q-0013" }, defaults)[0]).toContain("Q-0013")
    expect(startersFor({ territoryId: "T01-02" }, defaults).join(" ")).toContain("T01-02")
  })
})

describe("sanitizeChatContext", () => {
  it("keeps only well-formed values and never an intent", async () => {
    const { sanitizeChatContext } = await import("./context")
    expect(sanitizeChatContext({ view: "msl", territoryId: "NE-01", intent: "TERRITORY_SUMMARY", from: "2026-01-01", to: "2026-02-01" })).toEqual({ view: "msl", territoryId: "NE-01", from: "2026-01-01", to: "2026-02-01" })
    expect(sanitizeChatContext({ territoryId: "x;DROP", view: 3 })).toBeUndefined()
    expect(sanitizeChatContext("msl")).toBeUndefined()
    expect(sanitizeChatContext(null)).toBeUndefined()
  })
})
