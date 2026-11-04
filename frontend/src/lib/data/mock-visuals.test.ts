import { describe, expect, it } from "vitest"
import { apportion, inferMockVisual, mockVisual } from "./mock-visuals"

const common = { from: "2026-08-06", to: "2026-11-03", total: 137, scope: "NE-01", dataThrough: "2026-11-03T00:00:00Z", metric: "calls" as const }

describe("mock visuals", () => {
  it("apportions a total exactly", () => {
    for (const total of [0, 1, 7, 137, 1001]) {
      expect(apportion(total, [0.31, 0.27, 0.24, 0.18]).reduce((a, b) => a + b, 0)).toBe(total)
    }
  })

  it("every series adds up to the key figure", () => {
    for (const type of ["line", "timeline", "bar"] as const) {
      const v = mockVisual({ type, by: "month" }, common, "v1") as { points: { value: number }[] }
      expect(v.points.reduce((a, p) => a + p.value, 0)).toBe(137)
    }
    const heat = mockVisual({ type: "heatmap", by: "product" }, common, "v1") as { rows: { values: number[] }[] }
    expect(heat.rows.flatMap((r) => r.values).reduce((a, b) => a + b, 0)).toBe(137)
  })

  it("only quantitative comparisons ask for a visual", () => {
    expect(inferMockVisual("How many calls did I have in the last 90 days?")).toBeNull()
    expect(inferMockVisual("What have HCPs recorded about osimertinib?")).toBeNull()
    expect(inferMockVisual("Show my calls by month")?.type).toBe("line")
    expect(inferMockVisual("Compare my calls by product")?.type).toBe("bar")
    expect(inferMockVisual("Heatmap of calls by product")?.type).toBe("heatmap")
  })
})
