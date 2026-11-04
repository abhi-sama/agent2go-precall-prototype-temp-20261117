/**
 * Administrator hierarchy governance (ticket 15): the territory graph and its validation, the
 * effective-dated access timeline with transfers and temporary coverage, and the separate catalog
 * and response access matrices. Types and GraphQL documents mirror `amplify/data/schema.graphql`.
 */
import { DataError, type IsoDateTime, type RequestContext } from "./types"

export type HierarchySeverity = "ERROR" | "WARNING"
export type FindingCode = "CYCLE" | "ORPHAN_TERRITORY" | "MISSING_LINK" | "OVERLAP" | "UNCOVERED_TERRITORY"

export interface HierarchyHolder {
  userId: string
  displayName: string
  assignmentType: string
  viaTerritoryId: string
}
export interface HierarchyNode {
  territoryId: string
  name: string
  kind: "REGION" | "TERRITORY"
  parentIds: string[]
  childIds: string[]
  depth: number | null
  directHolders: HierarchyHolder[]
  inheritedHolders: HierarchyHolder[]
  findingCodes: FindingCode[]
}
export interface HierarchyEdge {
  childId: string
  parentId: string
  source: "scope_relationship" | "source_feed" | "both"
  effectiveFrom: IsoDateTime | null
}
export interface HierarchyFinding {
  code: FindingCode
  severity: HierarchySeverity
  territoryIds: string[]
  message: string
}
export interface HierarchyValidation {
  generatedAt: IsoDateTime
  nodes: HierarchyNode[]
  edges: HierarchyEdge[]
  findings: HierarchyFinding[]
  errorCount: number
  warningCount: number
}

export type AssignmentStatus = "SCHEDULED" | "ACTIVE" | "EXPIRED"
export interface AccessTimelineEntry {
  assignmentId: string
  userId: string
  displayName: string
  territoryId: string
  assignmentType: string
  effectiveFrom: IsoDateTime
  effectiveTo: IsoDateTime | null
  approvedBy: string | null
  requestId: string | null
  status: AssignmentStatus
  secondsRemaining: number | null
  unresolvedTerritory: boolean
}
export type ScopeChangeKind = "TRANSFER" | "TEMPORARY_COVERAGE"
export type ScopeChangeStatus = "PENDING" | "APPROVED" | "REJECTED"
export interface ScopeChangeRequest {
  requestId: string
  kind: ScopeChangeKind
  userId: string
  displayName: string
  fromTerritoryId: string | null
  toTerritoryId: string
  effectiveFrom: IsoDateTime
  effectiveTo: IsoDateTime | null
  reason: string
  status: ScopeChangeStatus
  requestedBy: string
  requestedAt: IsoDateTime
  decidedBy: string | null
  decidedAt: IsoDateTime | null
  decisionNote: string | null
}
export interface AccessOverlap {
  kind: "SAME_USER_DUPLICATE" | "SHARED_PRIMARY"
  userId: string | null
  territoryId: string
  assignmentIds: string[]
  message: string
}
export interface AccessTimeline {
  generatedAt: IsoDateTime
  entries: AccessTimelineEntry[]
  requests: ScopeChangeRequest[]
  overlaps: AccessOverlap[]
}
export interface ScopeChangeInput {
  kind: ScopeChangeKind
  userId: string
  fromTerritoryId?: string
  toTerritoryId: string
  effectiveFrom: IsoDateTime
  effectiveTo?: IsoDateTime
  reason: string
}
export interface ScopeChangeDecisionInput {
  requestId: string
  decision: "APPROVE" | "REJECT"
  note?: string
}

export type ResponseAccessLevel = "NONE" | "AGGREGATE_ONLY" | "RECORDS"
export interface CatalogVisibilityRow {
  roleId: string
  roleName: string
  catalogVisible: boolean
}
export interface ResponseAccessRow {
  roleId: string
  roleName: string
  level: ResponseAccessLevel
}
export interface AdminVisibility {
  catalogMatrix: CatalogVisibilityRow[]
  responseMatrix: ResponseAccessRow[]
}

/** The governance slice of the data adapter. */
export interface GovernanceAdapter {
  adminHierarchy(ctx: RequestContext): Promise<HierarchyValidation>
  adminAccessTimeline(ctx: RequestContext, userId?: string): Promise<AccessTimeline>
  requestScopeChange(ctx: RequestContext, input: ScopeChangeInput): Promise<ScopeChangeRequest>
  decideScopeChange(ctx: RequestContext, input: ScopeChangeDecisionInput): Promise<ScopeChangeRequest>
  adminVisibility(ctx: RequestContext): Promise<AdminVisibility>
  setCatalogVisibility(ctx: RequestContext, input: { roleId: string; visible: boolean }): Promise<CatalogVisibilityRow>
  setResponseAccess(ctx: RequestContext, input: { roleId: string; level: ResponseAccessLevel }): Promise<ResponseAccessRow>
}

const HOLDER = "userId displayName assignmentType viaTerritoryId"
const REQUEST_FIELDS =
  "requestId kind userId displayName fromTerritoryId toTerritoryId effectiveFrom effectiveTo reason status requestedBy requestedAt decidedBy decidedAt decisionNote"

export const ADMIN_HIERARCHY_QUERY = /* GraphQL */ `
  query AdminHierarchy {
    adminHierarchy {
      generatedAt errorCount warningCount
      findings { code severity territoryIds message }
      edges { childId parentId source effectiveFrom }
      nodes {
        territoryId name kind parentIds childIds depth findingCodes
        directHolders { ${HOLDER} }
        inheritedHolders { ${HOLDER} }
      }
    }
  }
`
export const ADMIN_ACCESS_TIMELINE_QUERY = /* GraphQL */ `
  query AdminAccessTimeline($userId: ID) {
    adminAccessTimeline(userId: $userId) {
      generatedAt
      entries { assignmentId userId displayName territoryId assignmentType effectiveFrom effectiveTo approvedBy requestId status secondsRemaining unresolvedTerritory }
      requests { ${REQUEST_FIELDS} }
      overlaps { kind userId territoryId assignmentIds message }
    }
  }
`
export const REQUEST_SCOPE_CHANGE_MUTATION = /* GraphQL */ `
  mutation RequestScopeChange($input: ScopeChangeInput!) { requestScopeChange(input: $input) { ${REQUEST_FIELDS} } }
`
export const DECIDE_SCOPE_CHANGE_MUTATION = /* GraphQL */ `
  mutation DecideScopeChange($input: ScopeChangeDecisionInput!) { decideScopeChange(input: $input) { ${REQUEST_FIELDS} } }
`
export const ADMIN_VISIBILITY_QUERY = /* GraphQL */ `
  query AdminVisibility { adminVisibility { catalogMatrix { roleId roleName catalogVisible } responseMatrix { roleId roleName level } } }
`
export const SET_CATALOG_VISIBILITY_MUTATION = /* GraphQL */ `
  mutation SetCatalogVisibility($input: CatalogVisibilityInput!) { setCatalogVisibility(input: $input) { roleId roleName catalogVisible } }
`
export const SET_RESPONSE_ACCESS_MUTATION = /* GraphQL */ `
  mutation SetResponseAccess($input: ResponseAccessInput!) { setResponseAccess(input: $input) { roleId roleName level } }
`

type Call = <T>(query: string, variables: Record<string, unknown> | undefined, ctx: RequestContext) => Promise<T>

export function createGraphQLGovernance(call: Call): GovernanceAdapter {
  return {
    async adminHierarchy(ctx) {
      return (await call<{ adminHierarchy: HierarchyValidation }>(ADMIN_HIERARCHY_QUERY, undefined, ctx)).adminHierarchy
    },
    async adminAccessTimeline(ctx, userId) {
      return (await call<{ adminAccessTimeline: AccessTimeline }>(ADMIN_ACCESS_TIMELINE_QUERY, userId ? { userId } : undefined, ctx)).adminAccessTimeline
    },
    async requestScopeChange(ctx, input) {
      return (await call<{ requestScopeChange: ScopeChangeRequest }>(REQUEST_SCOPE_CHANGE_MUTATION, { input }, ctx)).requestScopeChange
    },
    async decideScopeChange(ctx, input) {
      return (await call<{ decideScopeChange: ScopeChangeRequest }>(DECIDE_SCOPE_CHANGE_MUTATION, { input }, ctx)).decideScopeChange
    },
    async adminVisibility(ctx) {
      return (await call<{ adminVisibility: AdminVisibility }>(ADMIN_VISIBILITY_QUERY, undefined, ctx)).adminVisibility
    },
    async setCatalogVisibility(ctx, input) {
      return (await call<{ setCatalogVisibility: CatalogVisibilityRow }>(SET_CATALOG_VISIBILITY_MUTATION, { input }, ctx)).setCatalogVisibility
    },
    async setResponseAccess(ctx, input) {
      return (await call<{ setResponseAccess: ResponseAccessRow }>(SET_RESPONSE_ACCESS_MUTATION, { input }, ctx)).setResponseAccess
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Mock (fixtures) implementation, mirroring the rules the backend enforces.
// ---------------------------------------------------------------------------------------------

export interface MockGovernanceOptions {
  /** Resolves the signed-in mock user; the mock refuses everyone but an administrator. */
  getUser: () => { userId: string; persona: string }
  /** Waits and applies the shared scenario (latency, forced errors). */
  gate: (ctx: RequestContext, operation: string) => Promise<unknown>
  now: () => Date
}

const holder = (userId: string, displayName: string, assignmentType: string, via: string): HierarchyHolder => ({ userId, displayName, assignmentType, viaTerritoryId: via })

function mockHierarchy(): HierarchyValidation {
  const dir = (via: string) => holder("u-dir-ne", "Dana Whitfield", "primary", via)
  const territory = (id: string, parents: string[], msl: string | null): HierarchyNode => ({
    territoryId: id,
    name: `${id} Oncology`,
    kind: "TERRITORY",
    parentIds: parents,
    childIds: [],
    depth: 1,
    directHolders: msl ? [holder(msl, msl, "primary", id)] : [],
    inheritedHolders: [dir("REGION-NE")],
    findingCodes: parents.length > 1 ? ["OVERLAP"] : [],
  })
  const nodes: HierarchyNode[] = [
    { territoryId: "NATIONAL-01", name: "NATIONAL-01", kind: "REGION", parentIds: [], childIds: ["NE-01"], depth: 0, directHolders: [], inheritedHolders: [], findingCodes: [] },
    { territoryId: "REGION-NE", name: "REGION-NE", kind: "REGION", parentIds: [], childIds: ["NE-01", "NE-02"], depth: 0, directHolders: [dir("REGION-NE")], inheritedHolders: [], findingCodes: [] },
    territory("NE-01", ["NATIONAL-01", "REGION-NE"], "u-msl-ne-01"),
    territory("NE-02", ["REGION-NE"], "u-msl-ne-02"),
    { territoryId: "CYC-A", name: "CYC-A", kind: "REGION", parentIds: ["CYC-B"], childIds: ["CYC-B"], depth: null, directHolders: [], inheritedHolders: [], findingCodes: ["CYCLE"] },
    { territoryId: "CYC-B", name: "CYC-B", kind: "REGION", parentIds: ["CYC-A"], childIds: ["CYC-A"], depth: null, directHolders: [], inheritedHolders: [], findingCodes: ["CYCLE"] },
    { territoryId: "UNRESOLVED-01", name: "UNRESOLVED-01", kind: "TERRITORY", parentIds: [], childIds: [], depth: null, directHolders: [holder("u-admin-sec", "Sofia Alvarez", "administrative", "UNRESOLVED-01")], inheritedHolders: [], findingCodes: ["ORPHAN_TERRITORY"] },
  ]
  const findings: HierarchyFinding[] = [
    { code: "CYCLE", severity: "ERROR", territoryIds: ["CYC-A", "CYC-B"], message: "Cycle: CYC-A → CYC-B → CYC-A" },
    { code: "ORPHAN_TERRITORY", severity: "ERROR", territoryIds: ["UNRESOLVED-01"], message: "UNRESOLVED-01 is in use but has no parent or child link in the hierarchy. It is assigned to 1 user; they inherit nothing from it." },
    { code: "OVERLAP", severity: "WARNING", territoryIds: ["NE-01", "NATIONAL-01", "REGION-NE"], message: "NE-01 has 2 parents (NATIONAL-01, REGION-NE); access flows down from each." },
  ]
  return {
    generatedAt: new Date().toISOString(),
    nodes,
    edges: nodes.flatMap((n) => n.parentIds.map((p) => ({ childId: n.territoryId, parentId: p, source: "both" as const, effectiveFrom: "2024-01-01T00:00:00Z" }))),
    findings,
    errorCount: 2,
    warningCount: 1,
  }
}

export function createMockGovernance(options: MockGovernanceOptions): GovernanceAdapter {
  const hierarchy = mockHierarchy()
  const requireAdmin = (ctx: RequestContext) => {
    if (options.getUser().persona !== "admin") throw new DataError("FORBIDDEN", "You do not have access to this data.", ctx.correlationId)
  }
  const day = 86_400_000
  const iso = (offset: number) => new Date(options.now().getTime() + offset).toISOString()
  const entries: AccessTimelineEntry[] = [
    { assignmentId: "1", userId: "u-msl-ne-01", displayName: "u-msl-ne-01", territoryId: "NE-01", assignmentType: "primary", effectiveFrom: iso(-400 * day), effectiveTo: null, approvedBy: "u-admin-sec", requestId: null, status: "ACTIVE", secondsRemaining: null, unresolvedTerritory: false },
    { assignmentId: "2", userId: "u-msl-ne-01", displayName: "u-msl-ne-01", territoryId: "NE-02", assignmentType: "temporary", effectiveFrom: iso(-10 * day), effectiveTo: iso(-1 * day), approvedBy: "u-admin-sec", requestId: "1", status: "EXPIRED", secondsRemaining: null, unresolvedTerritory: false },
  ]
  const requests: ScopeChangeRequest[] = [
    { requestId: "1", kind: "TEMPORARY_COVERAGE", userId: "u-msl-ne-01", displayName: "u-msl-ne-01", fromTerritoryId: null, toTerritoryId: "NE-02", effectiveFrom: iso(-10 * day), effectiveTo: iso(-1 * day), reason: "Cover parental leave", status: "APPROVED", requestedBy: "u-admin-sec", requestedAt: iso(-11 * day), decidedBy: "u-admin-ops", decidedAt: iso(-10.5 * day), decisionNote: "Confirmed with the director" },
    { requestId: "2", kind: "TRANSFER", userId: "u-msl-ne-02", displayName: "u-msl-ne-02", fromTerritoryId: "NE-02", toTerritoryId: "NE-01", effectiveFrom: iso(7 * day), effectiveTo: null, reason: "Territory realignment", status: "PENDING", requestedBy: "u-admin-ops", requestedAt: iso(-1 * day), decidedBy: null, decidedAt: null, decisionNote: null },
  ]
  const catalog: CatalogVisibilityRow[] = [
    { roleId: "msl", roleName: "MSL field role", catalogVisible: true },
    { roleId: "director", roleName: "Director role", catalogVisible: true },
    { roleId: "executive", roleName: "Executive aggregate-only role", catalogVisible: false },
    { roleId: "administrator", roleName: "Data security administrator", catalogVisible: true },
  ]
  const responses: ResponseAccessRow[] = [
    { roleId: "msl", roleName: "MSL field role", level: "RECORDS" },
    { roleId: "director", roleName: "Director role", level: "RECORDS" },
    { roleId: "executive", roleName: "Executive aggregate-only role", level: "AGGREGATE_ONLY" },
    { roleId: "administrator", roleName: "Data security administrator", level: "RECORDS" },
  ]

  return {
    async adminHierarchy(ctx) {
      await options.gate(ctx, "adminHierarchy")
      requireAdmin(ctx)
      return structuredClone(hierarchy)
    },
    async adminAccessTimeline(ctx, userId) {
      await options.gate(ctx, "adminAccessTimeline")
      requireAdmin(ctx)
      return structuredClone({
        generatedAt: options.now().toISOString(),
        entries: entries.filter((e) => !userId || e.userId === userId),
        requests: requests.filter((r) => !userId || r.userId === userId),
        overlaps: [],
      })
    },
    async requestScopeChange(ctx, input) {
      await options.gate(ctx, "requestScopeChange")
      requireAdmin(ctx)
      if (input.kind === "TEMPORARY_COVERAGE" && !input.effectiveTo) throw new DataError("BAD_REQUEST", "Temporary coverage needs an end date.", ctx.correlationId)
      if (input.kind === "TRANSFER" && !input.fromTerritoryId) throw new DataError("BAD_REQUEST", "A transfer needs the territory the user leaves.", ctx.correlationId)
      const row: ScopeChangeRequest = {
        requestId: String(requests.length + 1), kind: input.kind, userId: input.userId, displayName: input.userId,
        fromTerritoryId: input.fromTerritoryId ?? null, toTerritoryId: input.toTerritoryId, effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null, reason: input.reason, status: "PENDING", requestedBy: options.getUser().userId,
        requestedAt: options.now().toISOString(), decidedBy: null, decidedAt: null, decisionNote: null,
      }
      requests.unshift(row)
      return structuredClone(row)
    },
    async decideScopeChange(ctx, input) {
      await options.gate(ctx, "decideScopeChange")
      requireAdmin(ctx)
      const row = requests.find((r) => r.requestId === input.requestId)
      if (!row) throw new DataError("NOT_FOUND", "No such request.", ctx.correlationId)
      if (row.status !== "PENDING") throw new DataError("BAD_REQUEST", "Already decided.", ctx.correlationId)
      if (row.requestedBy === options.getUser().userId) throw new DataError("FORBIDDEN", "You cannot decide your own request.", ctx.correlationId)
      row.status = input.decision === "APPROVE" ? "APPROVED" : "REJECTED"
      row.decidedBy = options.getUser().userId
      row.decidedAt = options.now().toISOString()
      row.decisionNote = input.note ?? null
      if (input.decision === "APPROVE") {
        entries.unshift({ assignmentId: String(entries.length + 1), userId: row.userId, displayName: row.displayName, territoryId: row.toTerritoryId, assignmentType: row.kind === "TRANSFER" ? "primary" : "temporary", effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, approvedBy: row.decidedBy, requestId: row.requestId, status: new Date(row.effectiveFrom) > options.now() ? "SCHEDULED" : "ACTIVE", secondsRemaining: null, unresolvedTerritory: false })
      }
      return structuredClone(row)
    },
    async adminVisibility(ctx) {
      await options.gate(ctx, "adminVisibility")
      requireAdmin(ctx)
      return structuredClone({ catalogMatrix: catalog, responseMatrix: responses })
    },
    async setCatalogVisibility(ctx, input) {
      await options.gate(ctx, "setCatalogVisibility")
      requireAdmin(ctx)
      const row = catalog.find((r) => r.roleId === input.roleId)
      if (!row) throw new DataError("BAD_REQUEST", "Unknown role.", ctx.correlationId)
      row.catalogVisible = input.visible
      return { ...row }
    },
    async setResponseAccess(ctx, input) {
      await options.gate(ctx, "setResponseAccess")
      requireAdmin(ctx)
      const row = responses.find((r) => r.roleId === input.roleId)
      if (!row) throw new DataError("BAD_REQUEST", "Unknown role.", ctx.correlationId)
      row.level = input.level
      return { ...row }
    },
  }
}
