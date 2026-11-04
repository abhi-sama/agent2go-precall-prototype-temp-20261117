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
