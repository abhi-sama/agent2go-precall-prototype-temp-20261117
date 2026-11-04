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

/** Extension of the foundation contract (added during integration) for the territory visual. */
export const TERRITORY_ACTIVITY_QUERY = /* GraphQL */ `
  query TerritoryActivity($from: AWSDate, $to: AWSDate) {
    territoryActivity(from: $from, to: $to) {
      territoryId
      name
      regionId
      regionName
      col
      row
      inScope
      isOwn
      distinctCalls
      distinctEngagedHcps
      responseCount
    }
  }
`
