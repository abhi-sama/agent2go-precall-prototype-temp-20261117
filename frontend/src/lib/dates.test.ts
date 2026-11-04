import { describe, expect, it } from "vitest"
import { addDays, daysInRange, formatRange, isIsoDate, matchPreset, presetRange, weekdaysInRange } from "./dates"

describe("dates", () => {
  it("validates ISO dates strictly", () => {
    expect(isIsoDate("2026-11-03")).toBe(true)
    expect(isIsoDate("2026-02-30")).toBe(false)
    expect(isIsoDate("11/03/2026")).toBe(false)
  })
  it("counts inclusive days and weekdays", () => {
    expect(daysInRange({ from: "2026-11-02", to: "2026-11-08" })).toBe(7)
    expect(weekdaysInRange({ from: "2026-11-02", to: "2026-11-08" })).toBe(5) // Mon..Sun
    expect(weekdaysInRange({ from: "2026-11-07", to: "2026-11-08" })).toBe(0) // Sat, Sun
  })
  it("builds presets ending today", () => {
    expect(presetRange("30d", "2026-11-03")).toEqual({ from: "2026-10-05", to: "2026-11-03" })
    expect(presetRange("qtd", "2026-11-03")).toEqual({ from: "2026-10-01", to: "2026-11-03" })
    expect(presetRange("ytd", "2026-11-03").from).toBe("2026-01-01")
    expect(matchPreset({ from: "2026-10-28", to: "2026-11-03" }, "2026-11-03")).toBe("7d")
    expect(matchPreset({ from: "2026-10-29", to: "2026-11-03" }, "2026-11-03")).toBeNull()
  })
  it("adds days across month ends and formats ranges", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01")
    expect(formatRange({ from: "2026-10-05", to: "2026-11-03" })).toBe("Oct 5 – Nov 3, 2026")
  })
})
