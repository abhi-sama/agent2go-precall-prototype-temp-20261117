/** GraphQL documents matching the foundation contract exactly. Used by the AppSync adapter. */

export const ME_QUERY = /* GraphQL */ `
  query Me {
    me {
      userId
      fullName
      email
      persona
      scopeLabel
    }
  }
`

export const LANDING_KPIS_QUERY = /* GraphQL */ `
  query LandingKpis($from: AWSDate, $to: AWSDate) {
    landingKpis(from: $from, to: $to) {
      distinctCalls
      distinctEngagedHcps
      responseCount
      from
      to
      dataThrough
      scopeLabel
    }
  }
`

export const SEARCH_HCPS_QUERY = `query SearchHcps($query:String!,$limit:Int){ searchHcps(query:$query,limit:$limit){ hcpId name{value state} institution{value state} territory{value state} } }`
export const HCP_PROFILE_QUERY = `query HcpProfile($hcpId:ID!){ hcpProfile(hcpId:$hcpId){ hcpId name{value state} specialty{value state} discipline{value state} type{value state} institution{value state} credentials{value state} territory{value state} } }`

/** Extension of the foundation contract (added during integration) for the territory map. */
export const GEO_ACTIVITY_QUERY = /* GraphQL */ `
  query GeoActivity($from: AWSDate, $to: AWSDate) {
    geoActivity(from: $from, to: $to) {
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
    activityTrends(months: $months) {
      from
      to
      channels
      totalDistinctCalls
      totalDistinctEngagedHcps
      dataThrough
      scopeLabel
      months {
        month
        distinctCalls
        distinctEngagedHcps
        isPartial
        channels {
          channel
          distinctCalls
        }
      }
    }
  }
`

export const ACTIVITY_EVIDENCE_QUERY = /* GraphQL */ `
  query ActivityEvidence($metric: ActivityMetric!, $month: AWSDate!, $channel: String, $limit: Int) {
    activityEvidence(metric: $metric, month: $month, channel: $channel, limit: $limit) {
      metric
      month
      channel
      total
      truncated
      latestInteractionDate
      latestLoadedAt
      dataThrough
      scopeLabel
      records {
        recordId
        kind
        hcpId
        hcpName
        territoryId
        channel
        callCount
        interactionDate
        loadedAt
      }
    }
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
