import { describe, expect, it } from "vitest"
import { describeContext, pageOfContext, pageWithout, screenContextFor, viewOf } from "./screen-context"

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
    expect(chips.map((c) => c.kind)).toEqual(["screen", "range", "territory", "product", "question"])
    expect(chips[0].label).toBe("Director insights")
    expect(chips[3].label).toBe("Product osimertinib")
    expect(chips[1].label).toBe("Oct 5 – Nov 4, 2026")
  })

  it("shows a product filter without widening the agent contract", () => {
    const { context, chips } = screenContextFor("/msl", filters)
    expect(JSON.stringify(context)).not.toContain("osimertinib")
    expect(chips).toContainEqual({ kind: "product", label: "Product osimertinib" })
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

describe("the page state (docs/adr/0019)", () => {
  const filters = { from: "2026-10-05", to: "2026-11-04", territoryId: "NE-01", questionId: "Q-0001", molecule: "osimertinib", landscape: "NSCLC", theme: "access", hcpId: "HCP-0001" }

  it("names the page and carries every filter the chips stand for, never the record-level HCP", () => {
    const { page, chips } = screenContextFor("/director/insights", filters)
    expect(page).toEqual({
      label: "Director insights",
      filters: { from: "2026-10-05", to: "2026-11-04", territoryId: "NE-01", questionId: "Q-0001", molecule: "osimertinib", landscape: "NSCLC", theme: "access" },
    })
    expect(chips.map((c) => c.kind)).toEqual(["screen", "range", "territory", "product", "question", "landscape", "theme"])
  })

  it("carries no filters from a screen that does not show them", () => {
    expect(screenContextFor("/msl/briefs", filters).page).toEqual({ label: "Pre-call brief", filters: {} })
  })

  it("leaves out the filters whose chips were removed, and the label when the screen chip was", () => {
    const { page } = screenContextFor("/msl", filters)
    expect(pageWithout(new Set(["territory", "product"]), page).filters).toEqual({ from: "2026-10-05", to: "2026-11-04", questionId: "Q-0001", landscape: "NSCLC", theme: "access" })
    expect(pageWithout(new Set(["range"]), page).filters).not.toHaveProperty("from")
    expect(pageWithout(new Set(["range"]), page).filters).not.toHaveProperty("to")
    expect(pageWithout(new Set(["screen"]), page).label).toBeUndefined()
  })

  it("takes the page state of a chat opened from a link from the link's screen context", () => {
    expect(pageOfContext({ view: "director-insights", territoryId: "NE-01", questionId: "Q-1", from: "2026-10-01", to: "2026-10-31" }, "Ask the agent")).toEqual({
      label: "Ask the agent",
      filters: { from: "2026-10-01", to: "2026-10-31", territoryId: "NE-01", questionId: "Q-1" },
    })
    expect(pageOfContext(undefined, "Ask the agent")).toEqual({ label: "Ask the agent", filters: {} })
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
