import { describe, expect, it } from "vitest"
import { allocate, EMERGING_THRESHOLDS, emergingRuleText, emergingStatus } from "./insight-rules"

describe("emerging-topic rule (mirror of app.emerging_status)", () => {
  // currentN, priorN, currentTotal, priorTotal -> status. Each row is one branch of the database function.
  const table: [string, number, number, number, number, string][] = [
    ["a thin latest period cannot say anything", 12, 2, 29, 400, "INSUFFICIENT_SAMPLE"],
    ["a thin earlier period cannot say anything", 12, 2, 400, 29, "INSUFFICIENT_SAMPLE"],
    ["exactly the minimum sample is enough", 10, 0, 30, 30, "EMERGING"],
    ["grows enough in share and is new", 20, 0, 400, 400, "EMERGING"],
    ["tripled share", 72, 21, 711, 701, "EMERGING"],
    ["fewer than the minimum topic responses now", 9, 0, 400, 400, "STABLE"],
    ["share rose by under 2 points", 40, 32, 400, 400, "STABLE"],
    ["rose 2+ points but under 1.5x the earlier share", 60, 50, 400, 400, "STABLE"],
    ["share fell by half and 2+ points", 10, 40, 400, 400, "DECLINING"],
    ["fell, but the earlier topic was too small", 2, 9, 400, 400, "STABLE"],
    ["the same share in a bigger period is not a trend", 100, 50, 800, 400, "STABLE"],
  ]
  it.each(table)("%s", (_name, cur, pri, curTotal, priTotal, expected) => {
    expect(emergingStatus(cur, pri, curTotal, priTotal)).toBe(expected)
  })

  it("states the same thresholds and rule sentence the database returns", () => {
    expect(EMERGING_THRESHOLDS).toEqual({ minWindowResponses: 30, minTopicResponses: 10, minRelativeIncrease: 0.5, minSharePoints: 2 })
    expect(emergingRuleText()).toBe(
      "A topic is flagged EMERGING when both periods hold at least 30 free-text responses, the topic has at least 10 responses in the latest period, " +
        "its share of responses rose by at least 2 percentage points, and that share is at least 1.5 times the earlier share (or it had none before). DECLINING is the mirror image.",
    )
  })
})

describe("allocate", () => {
  it("splits a total into whole numbers that add up exactly", () => {
    for (const total of [0, 1, 7, 100, 361]) {
      const parts = allocate(total, [3, 1, 4, 1, 5, 9])
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
      expect(parts.every((n) => Number.isInteger(n) && n >= 0)).toBe(true)
    }
  })
  it("returns zeros for nothing to split", () => {
    expect(allocate(5, [0, 0])).toEqual([0, 0])
    expect(allocate(-1, [1, 2])).toEqual([0, 0])
  })
})
