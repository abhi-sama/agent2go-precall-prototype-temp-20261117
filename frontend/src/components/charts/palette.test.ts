import { describe, expect, it } from "vitest"
import { assignSeries, OTHER_COLOR, sequentialFill } from "./palette"

describe("chart palette", () => {
  it("assigns slots in order and never cycles", () => {
    const keys = ["a", "b", "c", "d", "e", "f", "g", "h"]
    const { colors, folded } = assignSeries(keys)
    expect(colors.a).toBe("var(--chart-1)")
    expect(colors.f).toBe("var(--chart-6)")
    expect(colors.g).toBe(OTHER_COLOR)
    expect(colors.h).toBe(OTHER_COLOR)
    expect(folded).toEqual(["g", "h"])
  })

  it("keeps a series colour stable when another series is added after it", () => {
    expect(assignSeries(["x", "y"]).colors.y).toBe(assignSeries(["x", "y", "z"]).colors.y)
  })

  it("steps the sequential tint with the value and clamps", () => {
    expect(sequentialFill(0, 10)).toContain("12%")
    expect(sequentialFill(10, 10)).toContain("50%")
    expect(sequentialFill(99, 10)).toContain("50%")
    expect(sequentialFill(5, 0)).toContain("12%")
  })
})
