/** GraphQL documents shared by the real AppSync adapter. */

export const ME_QUERY = /* GraphQL */ `query Me { me { userId fullName email persona scopeLabel } }`

export const LANDING_KPIS_QUERY = /* GraphQL */ `
  query LandingKpis($from: AWSDate, $to: AWSDate, $filters: InsightFiltersInput) {
    landingKpis(from: $from, to: $to, filters: $filters) { distinctCalls distinctEngagedHcps responseCount from to dataThrough scopeLabel }
  }
`

export const SEARCH_HCPS_QUERY = `query SearchHcps($query:String!,$limit:Int){ searchHcps(query:$query,limit:$limit){ hcpId name{value state} institution{value state} territory{value state} } }`
export const HCP_PROFILE_QUERY = `query HcpProfile($hcpId:ID!){ hcpProfile(hcpId:$hcpId){ hcpId name{value state} specialty{value state} discipline{value state} type{value state} institution{value state} credentials{value state} territory{value state} } }`
export const START_CHAT_RUN_MUTATION = `mutation StartChatRun($threadId: ID!, $runId: ID!, $message: String!, $history: [ChatMessageInput!]) { startChatRun(threadId: $threadId, runId: $runId, message: $message, history: $history) { runId status } }`

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
    }
  }
`

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
