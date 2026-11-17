import type { DataAdapter } from "./adapter"
import { createGraphQLDirectorInsights } from "./director-insights"
import { createGraphQLEvals } from "./evals"
import { createGraphQLExecutiveThemes } from "./executive-themes"
import { createGraphQLExecutiveTrends } from "./executive-trends"
import { createGraphQLGovernance } from "./governance"
import {
  ACTIVITY_EVIDENCE_QUERY,
  ACTIVITY_TRENDS_QUERY,
  ACCESS_AUDIT_QUERY,
  ADMIN_ACCESS_OVERVIEW_QUERY,
  APPROVE_IDENTITY_MAPPING_MUTATION,
  ADMIN_DATA_QUALITY_QUERY,
  ADMIN_INGESTION_RUNS_QUERY,
  AUTHORIZATION_VERIFICATION_GRID_QUERY,
  CREATE_SCOPE_ASSIGNMENT_MUTATION,
  GENERATE_BRIEF_MUTATION,
  EXPORT_BRIEF_MUTATION,
  MY_BRIEFS_QUERY,
  PRE_CALL_BRIEF_QUERY,
  SAVE_BRIEF_EDITS_MUTATION,
  DIRECTOR_OVERVIEW_QUERY,
  TERRITORY_COMPARISON_QUERY,
  EXECUTIVE_DRILLDOWN_QUERY,
  EXECUTIVE_OVERVIEW_QUERY,
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
  MSL_INSIGHT_RESPONSES_QUERY,
  SAVED_VIEWS_QUERY,
  SAVE_VIEW_MUTATION,
  MY_APPEARANCE_QUERY,
  SET_APPEARANCE_MUTATION,
  SEMANTIC_INSIGHT_SEARCH_QUERY,
  POST_CALL_DRAFTS_QUERY,
  CREATE_POST_CALL_DRAFT_MUTATION,
  CONFIRM_POST_CALL_DRAFT_MUTATION,
  MY_FOLLOW_UP_TASKS_QUERY,
  CONFIRM_FOLLOW_UP_TASKS_MUTATION,
  TOPIC_ALERT_RULES_QUERY,
  CREATE_TOPIC_ALERT_RULE_MUTATION,
  TOPIC_ALERTS_QUERY,
  START_CHAT_RUN_MUTATION,
  RESUME_CHAT_RUN_MUTATION,
  CHAT_ANSWER_ROWS_QUERY,
  EXPORT_CHAT_ROWS_MUTATION,
} from "./operations"
import {
  DataError,
  type ActivityEvidence,
  type ActivityTrends,
  type ChatEventPage,
  type ChatRowsExport,
  type ChatRowsPage,
  type BriefSummary,
  type BriefExport,
  type ChatRun,
  type ChatThreadSummary,
  type SavedChatTurn,
  type PreCallBrief,
  type AccessAuditEvent,
  type AccessAuditFilter,
  type AdminAccessOverview,
  type AdminDataQuality,
  type AdminIngestionRuns,
  type AuthorizationVerificationGrid,
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
  type MslInsightResponses,
  type InsightFilters,
  type SavedView,
  type SemanticInsightResult,
  type PostCallDraft,
  type FollowUpTask,
  type ConfirmFollowUpTaskInput,
  type TopicAlertRule,
  type TopicAlert,
  type ExecutiveDrilldown,
  type ExecutiveOverview,
  SavedAppearance,
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
    ...createGraphQLEvals((query, variables, ctx) => run(transport, query, variables, ctx)),
    ...createGraphQLDirectorInsights((query, variables, ctx) => run(transport, query, variables, ctx)),
    ...createGraphQLExecutiveThemes((query, variables, ctx) => run(transport, query, variables, ctx)),
    ...createGraphQLExecutiveTrends((query, variables, ctx) => run(transport, query, variables, ctx)),
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
    async generateBrief(ctx, input) {
      // Optional fields are omitted, not null: floci's GraphQL executor rejects explicit nulls.
      const variables = { hcpId: input.hcpId, objective: input.objective, ...(input.regeneratesBriefId ? { regeneratesBriefId: input.regeneratesBriefId } : {}) }
      return (await run<{ generateBrief: PreCallBrief }>(transport, GENERATE_BRIEF_MUTATION, variables, ctx)).generateBrief
    },
    async preCallBrief(ctx, briefId) {
      return (await run<{ preCallBrief: PreCallBrief }>(transport, PRE_CALL_BRIEF_QUERY, { briefId }, ctx)).preCallBrief
    },
    async myBriefs(ctx) {
      return (await run<{ myBriefs: BriefSummary[] }>(transport, MY_BRIEFS_QUERY, undefined, ctx)).myBriefs
    },
    async saveBriefEdits(ctx, input) {
      const clean = (items?: { itemId?: string | null; text: string; detail?: string | null }[]) =>
        items?.map((i) => ({ ...(i.itemId ? { itemId: i.itemId } : {}), text: i.text, ...(i.detail ? { detail: i.detail } : {}) }))
      const payload = { briefId: input.briefId, ...(input.objective !== undefined ? { objective: input.objective } : {}), ...(input.prompts ? { prompts: clean(input.prompts) } : {}), ...(input.agenda ? { agenda: clean(input.agenda) } : {}) }
      return (await run<{ saveBriefEdits: PreCallBrief }>(transport, SAVE_BRIEF_EDITS_MUTATION, { input: payload }, ctx)).saveBriefEdits
    },
    async exportBrief(ctx, briefId) {
      return (await run<{ exportBrief: BriefExport }>(transport, EXPORT_BRIEF_MUTATION, { briefId }, ctx)).exportBrief
    },
    async executiveOverview(ctx, input) {
      const data = await run<{ executiveOverview: ExecutiveOverview }>(
        transport,
        EXECUTIVE_OVERVIEW_QUERY,
        { from: input?.from ?? null, to: input?.to ?? null, rankBy: input?.rankBy ?? null },
        ctx,
      )
      return data.executiveOverview
    },
    async executiveDrilldown(ctx, input) {
      const data = await run<{ executiveDrilldown: ExecutiveDrilldown }>(
        transport,
        EXECUTIVE_DRILLDOWN_QUERY,
        { scopeId: input.scopeId, kind: input.kind, month: input.month, limit: input.limit ?? null },
        ctx,
      )
      return data.executiveDrilldown
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
    async startChatRun(ctx, input): Promise<ChatRun> {
      // The dashboard context is optional and omitted (never null) when absent: floci's executor rejects explicit nulls.
      const { context, action, page, ...rest } = input
      const variables = {
        ...rest,
        ...(context && Object.keys(context).length ? { context } : {}),
        ...(page && Object.keys(page).length ? { page } : {}),
        // AWSJSON travels as JSON text.
        ...(action ? { action: { ...action, context: JSON.stringify(action.context) } } : {}),
      }
      return (await run<{ startChatRun: ChatRun }>(transport, START_CHAT_RUN_MUTATION, variables, ctx)).startChatRun
    },
    async myChatThreads(ctx, limit = 30): Promise<ChatThreadSummary[]> {
      return (await run<{ myChatThreads: ChatThreadSummary[] }>(transport, `query MyChatThreads($limit: Int) { myChatThreads(limit: $limit) { threadId title startedAt updatedAt turnCount } }`, { limit }, ctx)).myChatThreads
    },
    async myChatThread(ctx, threadId): Promise<SavedChatTurn[]> {
      return (await run<{ myChatThread: SavedChatTurn[] }>(transport, `query MyChatThread($threadId: ID!) { myChatThread(threadId: $threadId) { threadId runId userMessage assistantText generatedAt payload } }`, { threadId }, ctx)).myChatThread
    },
    async resumeChatRun(ctx, input): Promise<ChatRun> {
      const { values, ...rest } = input
      const variables = { ...rest, ...(values ? { values: JSON.stringify(values) } : {}) }
      return (await run<{ resumeChatRun: ChatRun }>(transport, RESUME_CHAT_RUN_MUTATION, variables, ctx)).resumeChatRun
    },
    async chatEvents(ctx, runId, after): Promise<ChatEventPage> { return (await run<{ chatEvents: ChatEventPage }>(transport, `query ChatEvents($runId: ID!, $after: Int) { chatEvents(runId: $runId, after: $after) { done status events { seq data } } }`, { runId, after }, ctx)).chatEvents },
    async chatCitation(ctx, dataset, recordId, auditExport = false): Promise<SourceRecord> { return (await run<{ chatCitation: SourceRecord }>(transport, `query ChatCitation($dataset: String!, $recordId: ID!, $auditExport: Boolean) { chatCitation(dataset: $dataset, recordId: $recordId, auditExport: $auditExport) { dataset recordId title dataThrough fields { label value } } }`, { dataset, recordId, auditExport }, ctx)).chatCitation },
    async chatAnswerRows(ctx, query): Promise<ChatRowsPage> {
      return (await run<{ chatAnswerRows: ChatRowsPage }>(transport, CHAT_ANSWER_ROWS_QUERY, { ...query }, ctx)).chatAnswerRows
    },
    async exportChatRows(ctx, input): Promise<ChatRowsExport> {
      return (await run<{ exportChatRows: ChatRowsExport }>(transport, EXPORT_CHAT_ROWS_MUTATION, { ...input }, ctx)).exportChatRows
    },
    async searchHcps(ctx, query, limit) { return (await run<{ searchHcps: HcpSearchResult[] }>(transport, SEARCH_HCPS_QUERY, { query, limit: limit ?? null }, ctx)).searchHcps },
    async hcpProfile(ctx, hcpId) { return (await run<{ hcpProfile: HcpProfile }>(transport, HCP_PROFILE_QUERY, { hcpId }, ctx)).hcpProfile },
    async hcpTimeline(ctx, hcpId) { return (await run<{ hcpTimeline: HcpTimeline }>(transport, HCP_TIMELINE_QUERY, { hcpId }, ctx)).hcpTimeline },
    async insightDiscovery(ctx, filters?: InsightFilters) {
      const data = await run<{ insightDiscovery: InsightDiscovery }>(transport, INSIGHT_DISCOVERY_QUERY, { filters }, ctx)
      return data.insightDiscovery
    },
    async mslInsightResponses(ctx, filters?: InsightFilters) {
      return (await run<{ mslInsightResponses: MslInsightResponses }>(transport, MSL_INSIGHT_RESPONSES_QUERY, { filters }, ctx)).mslInsightResponses
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
    async myAppearance(ctx) {
      return (await run<{ myAppearance: SavedAppearance | null }>(transport, MY_APPEARANCE_QUERY, undefined, ctx)).myAppearance
    },
    async setAppearance(ctx, input) {
      return (await run<{ setAppearance: SavedAppearance }>(transport, SET_APPEARANCE_MUTATION, { input }, ctx)).setAppearance
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
    async adminIngestionRuns(ctx) {
      const data = await run<{ adminIngestionRuns: AdminIngestionRuns }>(transport, ADMIN_INGESTION_RUNS_QUERY, undefined, ctx)
      return data.adminIngestionRuns
    },
    async authorizationVerificationGrid(ctx) {
      const data = await run<{ authorizationVerificationGrid: AuthorizationVerificationGrid }>(transport, AUTHORIZATION_VERIFICATION_GRID_QUERY, undefined, ctx)
      return data.authorizationVerificationGrid
    },
  }
}
