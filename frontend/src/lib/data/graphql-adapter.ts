import type { DataAdapter } from "./adapter"
import { createGraphQLGovernance } from "./governance"
import {
  ACTIVITY_EVIDENCE_QUERY,
  ACTIVITY_TRENDS_QUERY,
  ACCESS_AUDIT_QUERY,
  ADMIN_ACCESS_OVERVIEW_QUERY,
  APPROVE_IDENTITY_MAPPING_MUTATION,
  ADMIN_DATA_QUALITY_QUERY,
  CREATE_SCOPE_ASSIGNMENT_MUTATION,
  DIRECTOR_OVERVIEW_QUERY,
  TERRITORY_COMPARISON_QUERY,
  FLAG_ISSUE_MUTATION,
  GEO_ACTIVITY_QUERY,
  LANDING_KPIS_QUERY,
  ME_QUERY,
  MY_FLAGS_QUERY,
  SET_ROLE_PERMISSIONS_MUTATION,
  HCP_PROFILE_QUERY,
  HCP_TIMELINE_QUERY,
  SEARCH_HCPS_QUERY,
  INSIGHT_DISCOVERY_QUERY,
  SAVED_VIEWS_QUERY,
  SAVE_VIEW_MUTATION,
  SEMANTIC_INSIGHT_SEARCH_QUERY,
  POST_CALL_DRAFTS_QUERY,
  CREATE_POST_CALL_DRAFT_MUTATION,
  CONFIRM_POST_CALL_DRAFT_MUTATION,
  MY_FOLLOW_UP_TASKS_QUERY,
  CONFIRM_FOLLOW_UP_TASKS_MUTATION,
  TOPIC_ALERT_RULES_QUERY,
  CREATE_TOPIC_ALERT_RULE_MUTATION,
  TOPIC_ALERTS_QUERY,
} from "./operations"
import {
  DataError,
  type ActivityEvidence,
  type ActivityTrends,
  type ChatEventPage,
  type ChatRun,
  type AccessAuditEvent,
  type AccessAuditFilter,
  type AdminAccessOverview,
  type AdminDataQuality,
  type DateRange,
  type DirectorOverview,
  type TerritoryComparison,
  type IdentityMatch,
  type Flag,
  type GeoActivity,
  type HcpProfile,
  type HcpSearchResult,
  type HcpTimeline,
  type LandingKpis,
  type Me,
  type RequestContext,
  type RolePermissionMatrix,
  type ScopeAssignment,
  type ScopeAssignmentInput,
  type SourceRecord,
  type InsightDiscovery,
  type InsightFilters,
  type SavedView,
  type SemanticInsightResult,
  type PostCallDraft,
  type FollowUpTask,
  type ConfirmFollowUpTaskInput,
  type TopicAlertRule,
  type TopicAlert,
} from "./types"

export interface GraphQLResponse<T> {
  data?: T | null
  errors?: ReadonlyArray<{ message?: string; errorType?: string; extensions?: { code?: string } }>
}

/**
 * The wiring worker supplies this (for example a thin wrapper over Amplify's `client.graphql`
 * that attaches the Cognito token). It must send `ctx.correlationId` as a request header.
 */
export type GraphQLTransport = <T>(
  request: { query: string; variables?: Record<string, unknown> },
  ctx: RequestContext,
) => Promise<GraphQLResponse<T>>

function classify(errors: NonNullable<GraphQLResponse<unknown>["errors"]>, correlationId: string) {
  const text = errors.map((e) => `${e.errorType ?? ""} ${e.extensions?.code ?? ""}`).join(" ").toLowerCase()
  if (text.includes("unauthorized") || text.includes("unauthenticated")) {
    return new DataError("UNAUTHENTICATED", "Your session has expired. Sign in again.", correlationId)
  }
  if (text.includes("forbidden") || text.includes("access")) {
    return new DataError("FORBIDDEN", "You do not have access to this data.", correlationId)
  }
  if (text.includes("badrequest") || text.includes("bad_request")) {
    return new DataError("BAD_REQUEST", "That request was not accepted.", correlationId)
  }
  if (text.includes("no_scope") || text.includes("noscope")) {
    return new DataError("NO_SCOPE", "No territory is assigned to your account.", correlationId)
  }
  if (text.includes("timeout")) return new DataError("TIMEOUT", "The request took too long.", correlationId)
  // Never surface the raw server message: it may carry data. The correlation id is enough to trace it.
  return new DataError("UNAVAILABLE", "The data service is unavailable.", correlationId)
}

async function run<T>(
  transport: GraphQLTransport,
  query: string,
  variables: Record<string, unknown> | undefined,
  ctx: RequestContext,
): Promise<T> {
  let res: GraphQLResponse<T>
  try {
    res = await transport<T>({ query, variables }, ctx)
  } catch {
    throw new DataError("UNAVAILABLE", "The data service is unavailable.", ctx.correlationId)
  }
  if (res.errors?.length) throw classify(res.errors, ctx.correlationId)
  if (!res.data) throw new DataError("UNAVAILABLE", "The data service returned no data.", ctx.correlationId)
  return res.data
}

/** Real adapter against the contract schema. Transport is injected so this file has no AWS imports. */
export function createGraphQLAdapter(transport: GraphQLTransport): DataAdapter {
  return {
    kind: "appsync",
    ...createGraphQLGovernance((query, variables, ctx) => run(transport, query, variables, ctx)),
    async me(ctx) {
      const data = await run<{ me: Me }>(transport, ME_QUERY, undefined, ctx)
      return data.me
    },
    async landingKpis(ctx, range?: Partial<DateRange>, filters?: InsightFilters) {
      const data = await run<{ landingKpis: LandingKpis }>(
        transport,
        LANDING_KPIS_QUERY,
        { from: range?.from ?? null, to: range?.to ?? null, ...(filters ? { filters } : {}) },
        ctx,
      )
      return data.landingKpis
    },
    async geoActivity(ctx, range?: Partial<DateRange>, filters?: InsightFilters) {
      const data = await run<{ geoActivity: GeoActivity }>(
        transport,
        GEO_ACTIVITY_QUERY,
        { from: range?.from ?? null, to: range?.to ?? null, ...(filters ? { filters } : {}) },
        ctx,
      )
      return data.geoActivity
    },
    async activityTrends(ctx, months) {
      const data = await run<{ activityTrends: ActivityTrends }>(transport, ACTIVITY_TRENDS_QUERY, { months: months ?? null }, ctx)
      return data.activityTrends
    },
    async activityEvidence(ctx, query) {
      const data = await run<{ activityEvidence: ActivityEvidence }>(
        transport,
        ACTIVITY_EVIDENCE_QUERY,
        { metric: query.metric, month: query.month, channel: query.channel ?? null, limit: query.limit ?? null },
        ctx,
      )
      return data.activityEvidence
    },
    async directorOverview(ctx, range?: Partial<DateRange>) {
      const data = await run<{ directorOverview: DirectorOverview }>(
        transport,
        DIRECTOR_OVERVIEW_QUERY,
        { from: range?.from ?? null, to: range?.to ?? null },
        ctx,
      )
      return data.directorOverview
    },
    async territoryComparison(ctx, territoryIds, range?: Partial<DateRange>) {
      const data = await run<{ territoryComparison: TerritoryComparison }>(
        transport,
        TERRITORY_COMPARISON_QUERY,
        { territoryIds, from: range?.from ?? null, to: range?.to ?? null },
        ctx,
      )
      return data.territoryComparison
    },
    async myFlags(ctx) {
      const data = await run<{ myFlags: Flag[] }>(transport, MY_FLAGS_QUERY, undefined, ctx)
      return data.myFlags
    },
    async flagIssue(ctx, input) {
      const data = await run<{ flagIssue: Flag }>(
        transport,
        FLAG_ISSUE_MUTATION,
        // Optional fields are omitted, not null: floci's GraphQL executor rejects explicit nulls.
        { input: { kind: input.kind, targetType: input.targetType, targetId: input.targetId, ...(input.note ? { note: input.note } : {}) } },
        ctx,
      )
      return data.flagIssue
    },
    async adminAccessOverview(ctx) {
      const data = await run<{ adminAccessOverview: AdminAccessOverview }>(transport, ADMIN_ACCESS_OVERVIEW_QUERY, undefined, ctx)
      return data.adminAccessOverview
    },
    async accessAudit(ctx, filter?: AccessAuditFilter) {
      const data = await run<{ accessAudit: AccessAuditEvent[] }>(transport, ACCESS_AUDIT_QUERY, { filter }, ctx)
      return data.accessAudit
    },
    async createScopeAssignment(ctx, input: ScopeAssignmentInput) {
      const data = await run<{ createScopeAssignment: ScopeAssignment }>(transport, CREATE_SCOPE_ASSIGNMENT_MUTATION, { input }, ctx)
      return data.createScopeAssignment
    },
    async setRolePermissions(ctx, input: { roleId: string; permissionCodes: string[] }) {
      const data = await run<{ setRolePermissions: RolePermissionMatrix }>(transport, SET_ROLE_PERMISSIONS_MUTATION, { input }, ctx)
      return data.setRolePermissions
    },
    async approveIdentityMapping(ctx, input: { userId: string; rosterSourceRowId: string }) {
      const data = await run<{ approveIdentityMapping: IdentityMatch }>(transport, APPROVE_IDENTITY_MAPPING_MUTATION, { input }, ctx)
      return data.approveIdentityMapping
    },
    async startChatRun(ctx, input): Promise<ChatRun> { return (await run<{ startChatRun: ChatRun }>(transport, `mutation StartChatRun($threadId: ID!, $runId: ID!, $message: String!, $history: [ChatMessageInput!]) { startChatRun(threadId: $threadId, runId: $runId, message: $message, history: $history) { runId status } }`, input, ctx)).startChatRun },
    async chatEvents(ctx, runId, after): Promise<ChatEventPage> { return (await run<{ chatEvents: ChatEventPage }>(transport, `query ChatEvents($runId: ID!, $after: Int) { chatEvents(runId: $runId, after: $after) { done status events { seq data } } }`, { runId, after }, ctx)).chatEvents },
    async chatCitation(ctx, dataset, recordId): Promise<SourceRecord> { return (await run<{ chatCitation: SourceRecord }>(transport, `query ChatCitation($dataset: String!, $recordId: ID!) { chatCitation(dataset: $dataset, recordId: $recordId) { dataset recordId title dataThrough fields { label value } } }`, { dataset, recordId }, ctx)).chatCitation },
    async searchHcps(ctx, query, limit) { return (await run<{ searchHcps: HcpSearchResult[] }>(transport, SEARCH_HCPS_QUERY, { query, limit: limit ?? null }, ctx)).searchHcps },
    async hcpProfile(ctx, hcpId) { return (await run<{ hcpProfile: HcpProfile }>(transport, HCP_PROFILE_QUERY, { hcpId }, ctx)).hcpProfile },
    async hcpTimeline(ctx, hcpId) { return (await run<{ hcpTimeline: HcpTimeline }>(transport, HCP_TIMELINE_QUERY, { hcpId }, ctx)).hcpTimeline },
    async insightDiscovery(ctx, filters?: InsightFilters) {
      const data = await run<{ insightDiscovery: InsightDiscovery }>(transport, INSIGHT_DISCOVERY_QUERY, { filters }, ctx)
      return data.insightDiscovery
    },
    async semanticInsightSearch(ctx, query, limit) {
      return (await run<{ semanticInsightSearch: SemanticInsightResult[] }>(transport, SEMANTIC_INSIGHT_SEARCH_QUERY, { query, limit: limit ?? null }, ctx)).semanticInsightSearch
    },
    async savedViews(ctx) {
      const data = await run<{ savedViews: SavedView[] }>(transport, SAVED_VIEWS_QUERY, undefined, ctx)
      return data.savedViews
    },
    async saveView(ctx, input) {
      const data = await run<{ saveView: SavedView }>(transport, SAVE_VIEW_MUTATION, { input }, ctx)
      return data.saveView
    },
    async createPostCallDraft(ctx, input) {
      return (await run<{ createPostCallDraft: PostCallDraft }>(transport, CREATE_POST_CALL_DRAFT_MUTATION, { input }, ctx)).createPostCallDraft
    },
    async confirmPostCallDraft(ctx, draftId) {
      return (await run<{ confirmPostCallDraft: PostCallDraft }>(transport, CONFIRM_POST_CALL_DRAFT_MUTATION, { draftId }, ctx)).confirmPostCallDraft
    },
    async postCallDrafts(ctx) {
      return (await run<{ postCallDrafts: PostCallDraft[] }>(transport, POST_CALL_DRAFTS_QUERY, undefined, ctx)).postCallDrafts
    },
    async confirmFollowUpTasks(ctx, input: ConfirmFollowUpTaskInput[]) {
      return (await run<{ confirmFollowUpTasks: FollowUpTask[] }>(transport, CONFIRM_FOLLOW_UP_TASKS_MUTATION, { input }, ctx)).confirmFollowUpTasks
    },
    async myFollowUpTasks(ctx) {
      return (await run<{ myFollowUpTasks: FollowUpTask[] }>(transport, MY_FOLLOW_UP_TASKS_QUERY, undefined, ctx)).myFollowUpTasks
    },
    async createTopicAlertRule(ctx, input) {
      return (await run<{ createTopicAlertRule: TopicAlertRule }>(transport, CREATE_TOPIC_ALERT_RULE_MUTATION, { input }, ctx)).createTopicAlertRule
    },
    async topicAlertRules(ctx) {
      return (await run<{ topicAlertRules: TopicAlertRule[] }>(transport, TOPIC_ALERT_RULES_QUERY, undefined, ctx)).topicAlertRules
    },
    async topicAlerts(ctx) {
      return (await run<{ topicAlerts: TopicAlert[] }>(transport, TOPIC_ALERTS_QUERY, undefined, ctx)).topicAlerts
    },
    async adminDataQuality(ctx) {
      const data = await run<{ adminDataQuality: AdminDataQuality }>(transport, ADMIN_DATA_QUALITY_QUERY, undefined, ctx)
      return data.adminDataQuality
    },
  }
}
