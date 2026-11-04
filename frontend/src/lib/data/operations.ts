/** GraphQL documents shared by the real AppSync adapter. */

export const ME_QUERY = /* GraphQL */ `query Me { me { userId fullName email persona scopeLabel } }`

export const LANDING_KPIS_QUERY = /* GraphQL */ `
  query LandingKpis($from: AWSDate, $to: AWSDate, $filters: InsightFiltersInput) {
    landingKpis(from: $from, to: $to, filters: $filters) { distinctCalls distinctEngagedHcps responseCount from to dataThrough scopeLabel }
  }
`

export const SEARCH_HCPS_QUERY = `query SearchHcps($query:String!,$limit:Int){ searchHcps(query:$query,limit:$limit){ hcpId name{value state} institution{value state} territory{value state} } }`
export const HCP_PROFILE_QUERY = `query HcpProfile($hcpId:ID!){ hcpProfile(hcpId:$hcpId){ hcpId name{value state} specialty{value state} discipline{value state} type{value state} institution{value state} credentials{value state} territory{value state} } }`
export const HCP_TIMELINE_QUERY = `query HcpTimeline($hcpId:ID!){ hcpTimeline(hcpId:$hcpId){ hcpId interactions{callId interactionDate channels types statuses products topics sourceRecordId} responses{responseId interactionId parentResponseId questionId question answer interactionDate sourceRecordId} perspectives{questionId question answers{responseId interactionId parentResponseId questionId question answer interactionDate sourceRecordId}} } }`
export const CHAT_ANSWER_ROWS_QUERY = /* GraphQL */ `
  query ChatAnswerRows($runId: ID!, $rowSetId: ID!, $sortBy: String, $sortDir: ChatRowSortDir, $offset: Int, $limit: Int) {
    chatAnswerRows(runId: $runId, rowSetId: $rowSetId, sortBy: $sortBy, sortDir: $sortDir, offset: $offset, limit: $limit) {
      rowSetId kind label scope period definition total answerCount offset limit sortBy sortDir canExport dataThrough
      columns { key label type }
      rows { id cells }
    }
  }
`
export const EXPORT_CHAT_ROWS_MUTATION = /* GraphQL */ `
  mutation ExportChatRows($runId: ID!, $rowSetId: ID!, $sortBy: String, $sortDir: ChatRowSortDir) {
    exportChatRows(runId: $runId, rowSetId: $rowSetId, sortBy: $sortBy, sortDir: $sortDir) {
      rowSetId fileName mimeType content rowCount total truncated exportedAt
    }
  }
`
export const START_CHAT_RUN_MUTATION = `mutation StartChatRun($threadId: ID!, $runId: ID!, $message: String!, $history: [ChatMessageInput!], $context: ChatContextInput) { startChatRun(threadId: $threadId, runId: $runId, message: $message, history: $history, context: $context) { runId status } }`

/** Extension of the foundation contract (added during integration) for the territory map. */
export const GEO_ACTIVITY_QUERY = /* GraphQL */ `
  query GeoActivity($from: AWSDate, $to: AWSDate, $filters: InsightFiltersInput) {
    geoActivity(from: $from, to: $to, filters: $filters) {
      from
      to
      dataThrough
      scopeLabel
      territories {
        territoryId
        name
        regionId
        regionName
        countryCode
        countryName
        subdivisionCode
        subdivisionName
        latitude
        longitude
        isOwn
        distinctCalls
        suppressed
      }
      countries {
        countryCode
        countryName
        territoryCount
        distinctCalls
        suppressed
      }
    }
  }
`

export const ACTIVITY_TRENDS_QUERY = /* GraphQL */ `
  query ActivityTrends($months: Int) {
    activityTrends(months: $months) { from to channels totalDistinctCalls totalDistinctEngagedHcps dataThrough scopeLabel months { month distinctCalls distinctEngagedHcps isPartial channels { channel distinctCalls } } }
  }
`

export const INSIGHT_DISCOVERY_QUERY = /* GraphQL */ `
  query InsightDiscovery($filters: InsightFiltersInput) {
    insightDiscovery(filters: $filters) {
      scopeLabel
      options { territories { value label } molecules { value label } landscapes { value label } studies { value label } surveys { value label } questions { value label } }
      distributions { questionId questionText parentQuestionId response count denominator percentage }
      questions { questionId questionText topic molecule tumorType study survey status effectiveFrom effectiveTo applicability }
      themes { name responseCount excerpt recordId questionText }
      followUpTopics { topic evidenceCount excerpt recordId }
    }
  }
`
export const SEMANTIC_INSIGHT_SEARCH_QUERY = `query SemanticInsightSearch($query: String!, $limit: Int) { semanticInsightSearch(query: $query, limit: $limit) { responseId questionText responseText interactionDate territoryId score } }`

export const ACTIVITY_EVIDENCE_QUERY = /* GraphQL */ `
  query ActivityEvidence($metric: ActivityMetric!, $month: AWSDate!, $channel: String, $limit: Int) {
    activityEvidence(metric: $metric, month: $month, channel: $channel, limit: $limit) { metric month channel total truncated latestInteractionDate latestLoadedAt dataThrough scopeLabel records { recordId kind hcpId hcpName territoryId channel callCount interactionDate loadedAt } }
  }
`

const FLAG_FIELDS = `flagId kind targetType targetId note status createdAt updatedAt scopeLabel dataThrough`
export const MY_FLAGS_QUERY = /* GraphQL */ `
  query MyFlags {
    myFlags {
      ${FLAG_FIELDS}
    }
  }
`

export const FLAG_ISSUE_MUTATION = /* GraphQL */ `
  mutation FlagIssue($input: FlagInput!) {
    flagIssue(input: $input) {
      ${FLAG_FIELDS}
    }
  }
`

export const ADMIN_ACCESS_OVERVIEW_QUERY = /* GraphQL */ `
  query AdminAccessOverview {
    adminAccessOverview {
      identityMatches { userId displayName identityStatus rosterSourceRowId rosterName exactEmailCandidateCount candidateRosterSourceRowIds flag }
      availablePermissions { permissionCode description }
      roleMatrix { roleId roleName permissions { permissionCode description } }
      scopeAssignments { assignmentId userId displayName territoryId assignmentType effectiveFrom effectiveTo unresolvedTerritory }
    }
  }
`

export const ACCESS_AUDIT_QUERY = /* GraphQL */ `
  query AccessAudit($filter: AccessAuditFilter) {
    accessAudit(filter: $filter) {
      eventId actorUserId action resourceType resourceId outcome occurredAt
    }
  }
`

export const CREATE_SCOPE_ASSIGNMENT_MUTATION = /* GraphQL */ `
  mutation CreateScopeAssignment($input: ScopeAssignmentInput!) {
    createScopeAssignment(input: $input) {
      assignmentId userId displayName territoryId assignmentType effectiveFrom effectiveTo unresolvedTerritory
    }
  }
`

export const SET_ROLE_PERMISSIONS_MUTATION = /* GraphQL */ `
  mutation SetRolePermissions($input: RolePermissionInput!) {
    setRolePermissions(input: $input) {
      roleId roleName permissions { permissionCode description }
    }
  }
`

export const APPROVE_IDENTITY_MAPPING_MUTATION = /* GraphQL */ `
  mutation ApproveIdentityMapping($input: IdentityMappingInput!) {
    approveIdentityMapping(input: $input) {
      userId displayName identityStatus rosterSourceRowId rosterName exactEmailCandidateCount candidateRosterSourceRowIds flag
    }
  }
`
export const SAVED_VIEWS_QUERY = /* GraphQL */ `query SavedViews { savedViews { savedViewId name reportKind createdAt filters { from to territoryId molecule landscape study survey questionId } } }`
export const SAVE_VIEW_MUTATION = /* GraphQL */ `mutation SaveView($input: SaveViewInput!) { saveView(input: $input) { savedViewId name reportKind createdAt filters { from to territoryId molecule landscape study survey questionId } } }`
export const MY_APPEARANCE_QUERY = /* GraphQL */ `query MyAppearance { myAppearance { style mode density updatedAt } }`
export const SET_APPEARANCE_MUTATION = /* GraphQL */ `mutation SetAppearance($input: AppearanceInput!) { setAppearance(input: $input) { style mode density updatedAt } }`
const POST_CALL_DRAFT_FIELDS = `draftId notes structuredLines status createdAt`
const FOLLOW_UP_TASK_FIELDS = `taskId description ownerUserId dueDate status sourceDraftId createdAt`
const TOPIC_ALERT_RULE_FIELDS = `ruleId topic threshold periodDays createdAt`
export const POST_CALL_DRAFTS_QUERY = /* GraphQL */ `query PostCallDrafts { postCallDrafts { ${POST_CALL_DRAFT_FIELDS} } }`
export const CREATE_POST_CALL_DRAFT_MUTATION = /* GraphQL */ `mutation CreatePostCallDraft($input: PostCallDraftInput!) { createPostCallDraft(input: $input) { ${POST_CALL_DRAFT_FIELDS} } }`
export const CONFIRM_POST_CALL_DRAFT_MUTATION = /* GraphQL */ `mutation ConfirmPostCallDraft($draftId: ID!) { confirmPostCallDraft(draftId: $draftId) { ${POST_CALL_DRAFT_FIELDS} } }`
export const MY_FOLLOW_UP_TASKS_QUERY = /* GraphQL */ `query MyFollowUpTasks { myFollowUpTasks { ${FOLLOW_UP_TASK_FIELDS} } }`
export const CONFIRM_FOLLOW_UP_TASKS_MUTATION = /* GraphQL */ `mutation ConfirmFollowUpTasks($input: [ConfirmFollowUpTaskInput!]!) { confirmFollowUpTasks(input: $input) { ${FOLLOW_UP_TASK_FIELDS} } }`
export const TOPIC_ALERT_RULES_QUERY = /* GraphQL */ `query TopicAlertRules { topicAlertRules { ${TOPIC_ALERT_RULE_FIELDS} } }`
export const CREATE_TOPIC_ALERT_RULE_MUTATION = /* GraphQL */ `mutation CreateTopicAlertRule($input: TopicAlertRuleInput!) { createTopicAlertRule(input: $input) { ${TOPIC_ALERT_RULE_FIELDS} } }`
export const TOPIC_ALERTS_QUERY = /* GraphQL */ `query TopicAlerts { topicAlerts { ruleId topic threshold periodDays count evidenceResponseIds } }`
export const ADMIN_DATA_QUALITY_QUERY = /* GraphQL */ `
  query AdminDataQuality {
    adminDataQuality {
      ingestionRuns { runId sourceId sourceName status startedAt completedAt recordsLoaded errorSummary }
      identities { matched unmatched }
      duplicateKeyCount
      recordGrain { callProductRows distinctCalls }
      issues { issueId category severity title summary affectedCount records { recordId sourceTable sourceRecordId label } }
      questionGraph { missingParentCount duplicateKeyCount cycleCount nodes { questionId parentQuestionId state } }
    }
  }
`
export const AUTHORIZATION_VERIFICATION_GRID_QUERY = /* GraphQL */ `
  query AuthorizationVerificationGrid {
    authorizationVerificationGrid {
      suiteId localOnly total passed
      results { testId persona accessPath scopeScenario expectation status }
    }
  }
`

const TERRITORY_ROW_FIELDS = `territoryId name regionId regionName distinctCalls distinctEngagedHcps callProductRows responseCount reportingMembers rosteredMembers callsPerReportingMember reportingCompleteness latestLoadDate coverage { status targetHcps engagedTargetHcps percentage }`
export const DIRECTOR_OVERVIEW_QUERY = /* GraphQL */ `
  query DirectorOverview($from: AWSDate, $to: AWSDate) {
    directorOverview(from: $from, to: $to) {
      from to dataThrough scopeLabel definitionVersion
      definitions { key label text }
      kpis { distinctCalls distinctEngagedHcps callProductRows responseCount reportingMembers territoriesInScope territoriesWithActivity unattributedCalls reportingCompleteness }
      months { month isPartial distinctCalls distinctEngagedHcps }
      territories { ${TERRITORY_ROW_FIELDS} }
      members { memberId name linkedToRoster territoryIds distinctCalls activeMonths expectedMonths reportingCompleteness months { month distinctCalls } }
      mix { dimension label totalDistinctCalls valueTotal valuesOverlap values { value distinctCalls callProductRows months { month distinctCalls } } }
      coverage { status targetHcps engagedTargetHcps percentage territoriesWithTargets territoriesInScope asOf }
      notes { code message }
    }
  }
`

export const TERRITORY_COMPARISON_QUERY = /* GraphQL */ `
  query TerritoryComparison($territoryIds: [ID!]!, $from: AWSDate, $to: AWSDate) {
    territoryComparison(territoryIds: $territoryIds, from: $from, to: $to) {
      from to dataThrough scopeLabel definitionVersion
      definitions { key label text }
      territories { ${TERRITORY_ROW_FIELDS} }
      populationsUnequal
      disclosures { code message }
    }
  }
`

const BRIEF_FIELDS = `
  briefId hcpId hcpName{value state} objective ownerUserId scopeLabel scopeTerritoryIds dataThrough generatedAt updatedAt
  modelMode numberCheck droppedStatements stale staleReasons currentDataThrough lastInteractionDate
  facts{label value evidenceIds}
  engagement{statementId text evidenceIds} perspectives{statementId text evidenceIds} followUps{statementId text evidenceIds}
  prompts{itemId text detail evidenceIds origin edited} agenda{itemId text detail evidenceIds origin edited}
  missing{code message} evidence{evidenceId dataset recordId label date} regeneratesBriefId`

export const GENERATE_BRIEF_MUTATION = /* GraphQL */ `
  mutation GenerateBrief($hcpId: ID!, $objective: String!, $regeneratesBriefId: ID) {
    generateBrief(hcpId: $hcpId, objective: $objective, regeneratesBriefId: $regeneratesBriefId) {${BRIEF_FIELDS}}
  }
`
export const PRE_CALL_BRIEF_QUERY = /* GraphQL */ `
  query PreCallBrief($briefId: ID!) { preCallBrief(briefId: $briefId) {${BRIEF_FIELDS}} }
`
export const MY_BRIEFS_QUERY = /* GraphQL */ `
  query MyBriefs { myBriefs { briefId hcpId hcpName{value state} objective generatedAt dataThrough accessible stale } }
`
export const SAVE_BRIEF_EDITS_MUTATION = /* GraphQL */ `
  mutation SaveBriefEdits($input: BriefEditInput!) { saveBriefEdits(input: $input) {${BRIEF_FIELDS}} }
`
const BRIEF_EXPORT_FIELDS = `
  briefId hcpName objective scopeLabel dateRangeFrom dateRangeTo dataThrough generatedAt exportedAt
  facts{label value evidenceIds}
  engagement{statementId text evidenceIds} perspectives{statementId text evidenceIds} followUps{statementId text evidenceIds}
  prompts{itemId text detail evidenceIds origin edited} agenda{itemId text detail evidenceIds origin edited}
  missing{code message} citations{evidenceId dataset recordId label date}`
export const EXPORT_BRIEF_MUTATION = /* GraphQL */ `
  mutation ExportBrief($briefId: ID!) { exportBrief(briefId: $briefId) {${BRIEF_EXPORT_FIELDS}} }
`
const COUNT = "{ value suppressed }"
const EXECUTIVE_UNIT_FIELDS = `rank id name level regionId regionName territoriesInScope calls ${COUNT} responses ${COUNT} engagedHcps ${COUNT} callsPerTerritory reportingCompleteness`
export const EXECUTIVE_OVERVIEW_QUERY = /* GraphQL */ `
  query ExecutiveOverview($from: AWSDate, $to: AWSDate, $rankBy: ExecutiveRankBy) {
    executiveOverview(from: $from, to: $to, rankBy: $rankBy) {
      from to dataThrough scopeLabel accessLevel drilldownAllowed definitionVersion rankBy
      definitions { key label text }
      disclosure { minCell text suppressedCells applied }
      kpis { calls ${COUNT} responses ${COUNT} engagedHcps ${COUNT} regionsInScope territoriesInScope reportingCompleteness }
      freshness { status callsLoadedThrough responsesLoadedThrough sourceLagDays monthsShown }
      months { month isPartial calls ${COUNT} responses ${COUNT} engagedHcps ${COUNT} territoriesReporting territoriesInScope reportingCompleteness }
      regions { ${EXECUTIVE_UNIT_FIELDS} }
      territories { ${EXECUTIVE_UNIT_FIELDS} }
      engagement {
        engagedHcps ${COUNT} callsPerEngagedHcp
        depth { band hcps ${COUNT} }
        channels { channel calls ${COUNT} }
        coverage { status percentage territoriesWithTargets territoriesInScope }
      }
      notes { code message }
    }
  }
`

export const EXECUTIVE_DRILLDOWN_QUERY = /* GraphQL */ `
  query ExecutiveDrilldown($scopeId: ID!, $kind: ExecutiveDrilldownKind!, $month: AWSDate!, $limit: Int) {
    executiveDrilldown(scopeId: $scopeId, kind: $kind, month: $month, limit: $limit) {
      scopeId kind month total truncated dataThrough scopeLabel
      records { recordId kind territoryId hcpId hcpName detail responseText interactionDate loadedAt }
    }
  }
`
