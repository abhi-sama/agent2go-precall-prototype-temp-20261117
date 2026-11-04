/**
 * Types mirroring the foundation GraphQL contract (AppSync, owned by a2g-foundation):
 *
 *   type LandingKpis { distinctCalls: Int!, distinctEngagedHcps: Int!, responseCount: Int!,
 *                      from: AWSDate!, to: AWSDate!, dataThrough: AWSDateTime, scopeLabel: String! }
 *   type Me { userId: ID!, fullName: String!, email: String!, persona: String!, scopeLabel: String! }
 *   type Query { me: Me!, landingKpis(from: AWSDate, to: AWSDate): LandingKpis! }
 */

export const PERSONAS = ["msl", "director", "executive", "admin"] as const
export type Persona = (typeof PERSONAS)[number]

/** AWSDate: `YYYY-MM-DD`. */
export type IsoDate = string
/** AWSDateTime: ISO 8601 with offset. */
export type IsoDateTime = string

export interface Me {
  userId: string
  fullName: string
  email: string
  /** Contract returns a string; the shell narrows it to a known persona or "unknown". */
  persona: string
  scopeLabel: string
}

export interface LandingKpis {
  distinctCalls: number
  distinctEngagedHcps: number
  responseCount: number
  from: IsoDate
  to: IsoDate
  dataThrough: IsoDateTime | null
  scopeLabel: string
}

export interface DateRange {
  from: IsoDate
  to: IsoDate
}

export interface RequestContext {
  /** Sent with every call so FE and BE logs join up. */
  correlationId: string
}

/**
 * Per-territory activity for the 3D territory visual (`territoryActivity` query, added to the
 * contract during integration). The AppSync API returns only in-scope territories; the mock may
 * also return locked out-of-scope tiles.
 */
export interface TerritoryActivity {
  territoryId: string
  name: string
  regionId: string
  regionName: string
  /** Layout slot in the schematic map, not geography. */
  col: number
  row: number
  /** False means the viewer's scope excludes it: drawn as a locked tile, with no metrics. */
  inScope: boolean
  isOwn: boolean
  distinctCalls: number
  distinctEngagedHcps: number
  responseCount: number
}

export type DataErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NO_SCOPE"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "UNKNOWN"

export class DataError extends Error {
  readonly code: DataErrorCode
  readonly correlationId?: string
  constructor(code: DataErrorCode, message: string, correlationId?: string) {
    super(message)
    this.name = "DataError"
    this.code = code
    this.correlationId = correlationId
  }
}

export function toDataError(err: unknown, correlationId?: string): DataError {
  if (err instanceof DataError) return err
  return new DataError("UNKNOWN", "Something went wrong while loading data.", correlationId)
}
