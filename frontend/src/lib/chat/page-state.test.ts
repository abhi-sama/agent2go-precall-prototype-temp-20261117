import { describe, expect, it } from "vitest"
import {
  applyProposal,
  describeProposal,
  MAX_FIGURES,
  MAX_STEPS,
  pageInputOf,
  sanitizeFigures,
  sanitizePageFilters,
  sanitizePageState,
  sanitizeProgress,
  sanitizeProposal,
  settleProgress,
  sharedStateOf,
} from "./page-state"

const TODAY = "2026-11-16"

describe("page filters and state", () => {
  it("keeps only well-formed filter values and a whole, ordered range", () => {
    expect(sanitizePageFilters({ from: "2026-10-01", to: "2026-10-31", territoryId: "NE-01", molecule: "Osimertinib", questionId: "Q-001", hcpId: "H-1", junk: 1 })).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      territoryId: "NE-01",
      molecule: "Osimertinib",
      questionId: "Q-001",
    })
    expect(sanitizePageFilters({ from: "2026-10-31", to: "2026-10-01" })).toEqual({})
    expect(sanitizePageFilters({ from: "2026-13-01", to: "2026-14-01" })).toEqual({})
    expect(sanitizePageFilters({ territoryId: "NE 01; drop", molecule: "<script>", theme: "" })).toEqual({})
    expect(sanitizePageFilters(null)).toEqual({})
    expect(sanitizePageFilters([])).toEqual({})
  })

  it("never carries a record-level HCP filter", () => {
    expect(sanitizePageFilters({ hcpId: "HCP-0001" })).toEqual({})
  })

  it("checks the page state and drops a bad label", () => {
    expect(sanitizePageState({ label: "My territory", filters: { territoryId: "NE-01" } })).toEqual({ label: "My territory", filters: { territoryId: "NE-01" } })
    expect(sanitizePageState({ label: "bad\u0000", filters: {} })).toEqual({ filters: {} })
    expect(sanitizePageState("x")).toBeUndefined()
  })

  it("builds the request's page, or nothing when there is nothing to say", () => {
    expect(pageInputOf(undefined, [])).toBeUndefined()
    expect(pageInputOf({ label: "My region", filters: {} }, [{ id: "kpi-calls", label: "Distinct calls", value: "132" }])).toEqual({
      label: "My region",
      figures: [{ id: "kpi-calls", label: "Distinct calls", value: "132" }],
    })
  })
})

describe("figures", () => {
  it("accepts printed figures, drops malformed and duplicate ones, and caps the list", () => {
    const good = { id: "kpi-calls", label: "Distinct calls", value: "1,070", definition: "Each call counted once." }
    expect(sanitizeFigures([good, good, { id: "bad id", label: "x", value: "1" }, { id: "no-value", label: "x" }, "x"])).toEqual([good])
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, label: "L", value: String(i) }))
    expect(sanitizeFigures(many)).toHaveLength(MAX_FIGURES)
    expect(sanitizeFigures({})).toEqual([])
  })

  it("rejects control characters and over-long text", () => {
    expect(sanitizeFigures([{ id: "a", label: "Line\nbreak", value: "1" }])).toEqual([])
    expect(sanitizeFigures([{ id: "a", label: "x".repeat(81), value: "1" }])).toEqual([])
    expect(sanitizeFigures([{ id: "a", label: "x", value: "9".repeat(41) }])).toEqual([])
  })
})

describe("progress", () => {
  it("accepts closed statuses and plain labels, and caps the steps", () => {
    const steps = Array.from({ length: 30 }, (_, i) => ({ id: `tool:${i}`, label: "Counting your activity", status: "done" }))
    expect(sanitizeProgress({ status: "running", steps })?.steps).toHaveLength(MAX_STEPS)
    expect(sanitizeProgress({ status: "weird", steps: [] })).toBeNull()
    expect(sanitizeProgress({ status: "done" })).toBeNull()
    expect(sanitizeProgress({ status: "done", steps: [{ id: "a/b", label: "x", status: "done" }] })?.steps).toEqual([])
  })

  it("settles whatever is still running when the run ends", () => {
    const progress = { status: "running" as const, steps: [{ id: "a", label: "A", status: "done" as const }, { id: "b", label: "B", status: "running" as const }] }
    expect(settleProgress(progress, "done")).toEqual({ status: "done", steps: [{ id: "a", label: "A", status: "done" }, { id: "b", label: "B", status: "done" }] })
    expect(settleProgress(progress, "error").steps[1].status).toBe("error")
    expect(settleProgress(null, "done")).toEqual({ status: "done", steps: [] })
  })
})

describe("proposals", () => {
  const base = { id: "run-1-proposal", status: "proposed", reason: "Set the page to territory NE-01." }

  it("accepts a preset, a range or a territory, and rejects the malformed", () => {
    expect(sanitizeProposal({ ...base, filters: { preset: "90d", territoryId: "NE-01" } })).not.toBeNull()
    expect(sanitizeProposal({ ...base, filters: { from: "2026-01-01", to: "2026-03-31" } })).not.toBeNull()
    expect(sanitizeProposal({ ...base, filters: { preset: "90d", from: "2026-01-01", to: "2026-03-31" } })).toBeNull()
    expect(sanitizeProposal({ ...base, filters: { from: "2026-01-01" } })).toBeNull()
    expect(sanitizeProposal({ ...base, filters: { from: "2026-03-31", to: "2026-01-01" } })).toBeNull()
    expect(sanitizeProposal({ ...base, filters: { from: "2000-01-01", to: "2026-01-01" } })).toBeNull()
    expect(sanitizeProposal({ ...base, filters: {} })).toBeNull()
    expect(sanitizeProposal({ ...base, filters: { preset: "forever" } })).toBeNull()
    expect(sanitizeProposal({ ...base, filters: { territoryId: "../../x" } })).toBeNull()
    expect(sanitizeProposal({ ...base, filters: { territoryId: "NE-01", hcpId: "H-1" } })?.filters).toEqual({ territoryId: "NE-01" })
  })

  it("accepts a reset with nothing else", () => {
    expect(sanitizeProposal({ ...base, filters: {}, reset: true })).toMatchObject({ reset: true })
  })

  it("applies a proposal on top of the current filters, and a reset first", () => {
    const current = { from: "2026-01-01", to: "2026-02-01", territoryId: "NE-01", questionId: "Q-001", molecule: "x" }
    const range = applyProposal({ ...base, status: "proposed", filters: { preset: "7d" } }, current, TODAY)
    expect(range).toMatchObject({ from: "2026-11-10", to: "2026-11-16", territoryId: "NE-01", questionId: "Q-001", molecule: "x" })
    const reset = applyProposal({ ...base, status: "proposed", filters: { territoryId: "SE-03" }, reset: true }, current, TODAY)
    expect(reset).toEqual({ from: "2026-10-18", to: "2026-11-16", territoryId: "SE-03" })
  })

  it("describes it in one plain line", () => {
    expect(describeProposal({ ...base, status: "proposed", filters: { preset: "30d", territoryId: "NE-01" } }, TODAY)).toBe("Oct 18 – Nov 16, 2026 · Territory NE-01")
    expect(describeProposal({ ...base, status: "proposed", filters: {}, reset: true }, TODAY)).toBe("Default filters")
  })
})

describe("sharedStateOf", () => {
  it("reads checked parts of the state and tolerates anything else", () => {
    expect(sharedStateOf(undefined)).toEqual({})
    expect(sharedStateOf({ page: { filters: { territoryId: "NE-01" } }, progress: { status: "done", steps: [] }, proposal: { nope: 1 } })).toEqual({
      page: { filters: { territoryId: "NE-01" } },
      progress: { status: "done", steps: [] },
      proposal: null,
    })
  })
})
