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

/** Chat (ticket 02). The answer streams back as AG-UI events read by polling `chatEvents`. */
export const START_CHAT_RUN_MUTATION = /* GraphQL */ `
  mutation StartChatRun($threadId: ID!, $runId: ID!, $message: String!, $history: [ChatMessageInput!]) {
    startChatRun(threadId: $threadId, runId: $runId, message: $message, history: $history) {
      runId
      status
    }
  }
`

export const CHAT_EVENTS_QUERY = /* GraphQL */ `
  query ChatEvents($runId: ID!, $after: Int) {
    chatEvents(runId: $runId, after: $after) {
      events {
        seq
        data
      }
      done
      status
    }
  }
`

export const CHAT_CITATION_QUERY = /* GraphQL */ `
  query ChatCitation($dataset: String!, $recordId: ID!) {
    chatCitation(dataset: $dataset, recordId: $recordId) {
      dataset
      recordId
      title
      fields {
        label
        value
      }
      dataThrough
    }
  }
`
