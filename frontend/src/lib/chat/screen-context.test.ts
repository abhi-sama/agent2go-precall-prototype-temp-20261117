import { describe, expect, it } from "vitest"
import { describeContext, screenContextFor, viewOf } from "./screen-context"

describe("viewOf", () => {
  it("turns a route into the BE's view slug", () => {
    expect(viewOf("/director/insights")).toBe("director-insights")
    expect(viewOf("/msl")).toBe("msl")
    expect(viewOf("/")).toBe("home")
    expect(viewOf("/Weird Path/ü")).toMatch(/^[a-z0-9-]{1,40}$/)
    expect(viewOf(`/${"a".repeat(80)}`)).toHaveLength(40)
  })
})

describe("screenContextFor", () => {
  const filters = { from: "2026-10-05", to: "2026-11-04", territoryId: "NE-01", questionId: "Q-0001", molecule: "osimertinib" }

  it("sends the route and the filters on a screen that shows filters, with a chip for each", () => {
    const { context, chips } = screenContextFor("/director/insights", filters)
    expect(context).toEqual({ view: "director-insights", from: "2026-10-05", to: "2026-11-04", territoryId: "NE-01", questionId: "Q-0001" })
    expect(chips.map((c) => c.kind)).toEqual(["screen", "range", "territory", "question"])
    expect(chips[0].label).toBe("Director insights")
    expect(chips[1].label).toBe("Oct 5 – Nov 4, 2026")
  })

  it("never sends a facet the agent contract does not carry", () => {
    const { context } = screenContextFor("/msl", filters)
    expect(JSON.stringify(context)).not.toContain("osimertinib")
  })

  it("sends only the route from a screen that does not show filters", () => {
    const { context, chips } = screenContextFor("/msl/briefs", filters)
    expect(context).toEqual({ view: "msl-briefs" })
    expect(chips).toEqual([{ kind: "screen", label: "Pre-call brief" }])
  })

  it("drops a malformed or reversed filter instead of failing the request", () => {
    const { context } = screenContextFor("/msl", { from: "2026-11-04", to: "2026-10-05", territoryId: "NE 01; drop", questionId: "" })
    expect(context).toEqual({ view: "msl" })
  })

  it("describes an unknown route from its path", () => {
    expect(screenContextFor("/reports/quarterly", {}).chips[0].label).toBe("Quarterly")
  })
})

describe("describeContext", () => {
  it("says where a question was asked from", () => {
    expect(describeContext({ view: "director-insights", territoryId: "NE-01", from: "2026-10-05", to: "2026-11-04" })).toBe(
      "Director insights · NE-01 · Oct 5 – Nov 4, 2026",
    )
    expect(describeContext(undefined)).toBeNull()
    expect(describeContext({})).toBeNull()
  })
})
