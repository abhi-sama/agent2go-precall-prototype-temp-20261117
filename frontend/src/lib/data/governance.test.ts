import { describe, expect, it } from "vitest"
import { createMockGovernance } from "./governance"
import { DataError } from "./types"

const ctx = { correlationId: "test" }
const make = (userId = "u-admin-sec", persona = "admin") =>
  createMockGovernance({ getUser: () => ({ userId, persona }), gate: async () => undefined, now: () => new Date("2026-11-04T12:00:00Z") })

describe("mock governance", () => {
  it("flags the cycle and the orphan as errors, and the two-parent territory as a warning", async () => {
    const graph = await make().adminHierarchy(ctx)
    expect(graph.findings.map((f) => [f.code, f.severity])).toEqual([["CYCLE", "ERROR"], ["ORPHAN_TERRITORY", "ERROR"], ["OVERLAP", "WARNING"]])
    expect(graph.errorCount).toBe(2)
  })

  it("is administrator-only", async () => {
    await expect(make("u-msl-ne-01", "msl").adminHierarchy(ctx)).rejects.toMatchObject({ code: "FORBIDDEN" })
    await expect(make("u-msl-ne-01", "msl").setCatalogVisibility(ctx, { roleId: "msl", visible: false })).rejects.toBeInstanceOf(DataError)
  })

  it("temporary coverage needs an end date and a transfer needs its origin", async () => {
    const gov = make()
    const base = { userId: "u-msl-ne-01", toTerritoryId: "NE-02", effectiveFrom: "2026-11-05T00:00:00Z", reason: "x" }
    await expect(gov.requestScopeChange(ctx, { ...base, kind: "TEMPORARY_COVERAGE" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
    await expect(gov.requestScopeChange(ctx, { ...base, kind: "TRANSFER" })).rejects.toMatchObject({ code: "BAD_REQUEST" })
  })

  it("never lets the requester decide their own request", async () => {
    const gov = make("u-admin-sec")
    const own = await gov.requestScopeChange(ctx, { kind: "TEMPORARY_COVERAGE", userId: "u-msl-ne-01", toTerritoryId: "NE-02", effectiveFrom: "2026-11-05T00:00:00Z", effectiveTo: "2026-11-09T00:00:00Z", reason: "cover" })
    await expect(gov.decideScopeChange(ctx, { requestId: own.requestId, decision: "APPROVE" })).rejects.toMatchObject({ code: "FORBIDDEN" })
    // Another administrator's pending request can be approved, which writes a scheduled assignment.
    const approved = await gov.decideScopeChange(ctx, { requestId: "2", decision: "APPROVE", note: "ok" })
    expect(approved).toMatchObject({ status: "APPROVED", decidedBy: "u-admin-sec" })
    const timeline = await gov.adminAccessTimeline(ctx)
    expect(timeline.entries.find((e) => e.requestId === "2")).toMatchObject({ status: "SCHEDULED", assignmentType: "primary" })
  })

  it("changing catalog visibility leaves response access untouched", async () => {
    const gov = make()
    await gov.setCatalogVisibility(ctx, { roleId: "executive", visible: true })
    const { catalogMatrix, responseMatrix } = await gov.adminVisibility(ctx)
    expect(catalogMatrix.find((r) => r.roleId === "executive")?.catalogVisible).toBe(true)
    expect(responseMatrix.find((r) => r.roleId === "executive")?.level).toBe("AGGREGATE_ONLY")
  })
})
