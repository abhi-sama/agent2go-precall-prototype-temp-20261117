/**
 * Synthetic fixtures for the mock adapter. Every person here is fictional; emails use the reserved
 * `.test` TLD. Territory and persona ids are placeholders until a2g-db publishes the seed users
 * list (see PR notes), at which point only this file changes.
 */
import type { Persona } from "./types"

export interface FixtureRegion {
  id: string
  name: string
}

export interface FixtureTerritory {
  id: string
  name: string
  regionId: string
  col: number
  row: number
  /** Distinct calls per working day (synthetic). */
  callsPerWorkday: number
  hcpPool: number
  responsesPerCall: number
}

export interface FixtureUser {
  userId: string
  fullName: string
  email: string
  persona: Persona
  /** Territories this user can see. Directors: their region. Executives: all. Admins: none. */
  territoryIds: string[]
  scopeLabel: string
  /** Short line for the quick-switch list. */
  blurb: string
}

export const REGIONS: FixtureRegion[] = [
  { id: "NE", name: "Northeast" },
  { id: "SE", name: "Southeast" },
  { id: "MW", name: "Midwest" },
  { id: "WE", name: "West" },
]

const TERRITORY_NAMES: Record<string, string[]> = {
  NE: ["Boston Metro", "Hartford", "Albany", "New York North", "Philadelphia", "Pittsburgh"],
  SE: ["Atlanta", "Charlotte", "Raleigh", "Tampa Bay", "Miami", "Nashville"],
  MW: ["Chicago", "Detroit", "Minneapolis", "St. Louis", "Columbus", "Kansas City"],
  WE: ["Seattle", "Portland", "San Francisco", "Los Angeles", "Phoenix", "Denver"],
}

function hash(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

export const TERRITORIES: FixtureTerritory[] = REGIONS.flatMap((region, ri) =>
  TERRITORY_NAMES[region.id].map((name, ti) => {
    const id = `${region.id}-${String(ti + 1).padStart(2, "0")}`
    return {
      id,
      name,
      regionId: region.id,
      // 2x2 blocks of 3x2 territories: a schematic map, not geography.
      col: (ri % 2) * 3 + (ti % 3),
      row: Math.floor(ri / 2) * 2 + Math.floor(ti / 3),
      callsPerWorkday: 1.3 + hash(`${id}:calls`) * 1.4,
      hcpPool: Math.round(95 + hash(`${id}:pool`) * 70),
      responsesPerCall: 2.2 + hash(`${id}:resp`) * 0.9,
    }
  }),
)

const territoryName = (id: string) => TERRITORIES.find((t) => t.id === id)?.name ?? id
const regionName = (id: string) => REGIONS.find((r) => r.id === id)?.name ?? id
const regionTerritories = (regionId: string) => TERRITORIES.filter((t) => t.regionId === regionId).map((t) => t.id)

export const USERS: FixtureUser[] = [
  {
    userId: "u-msl-ne-01",
    fullName: "Priya Raman",
    email: "priya.raman@example.test",
    persona: "msl",
    territoryIds: ["NE-01"],
    scopeLabel: `Territory NE-01 · ${territoryName("NE-01")}`,
    blurb: "Territory NE-01",
  },
  {
    userId: "u-msl-se-03",
    fullName: "Daniel Okafor",
    email: "daniel.okafor@example.test",
    persona: "msl",
    territoryIds: ["SE-03"],
    scopeLabel: `Territory SE-03 · ${territoryName("SE-03")}`,
    blurb: "Territory SE-03",
  },
  {
    userId: "u-msl-we-04",
    fullName: "Mei Tanaka",
    email: "mei.tanaka@example.test",
    persona: "msl",
    territoryIds: ["WE-04"],
    scopeLabel: `Territory WE-04 · ${territoryName("WE-04")}`,
    blurb: "Territory WE-04",
  },
  {
    userId: "u-dir-ne",
    fullName: "Hannah Weiss",
    email: "hannah.weiss@example.test",
    persona: "director",
    territoryIds: regionTerritories("NE"),
    scopeLabel: `Region ${regionName("NE")} · 6 territories`,
    blurb: "Region Northeast",
  },
  {
    userId: "u-exec-all",
    fullName: "Marcus Bell",
    email: "marcus.bell@example.test",
    persona: "executive",
    territoryIds: TERRITORIES.map((t) => t.id),
    scopeLabel: "All regions · aggregate only",
    blurb: "All regions, aggregates",
  },
  {
    userId: "u-admin-sec",
    fullName: "Sofia Alvarez",
    email: "sofia.alvarez@example.test",
    persona: "admin",
    territoryIds: [],
    scopeLabel: "System administration · no clinical content",
    blurb: "Data and security",
  },
]

export const DEFAULT_USER_ID = "u-msl-ne-01"

export const PERSONA_HOME: Record<Persona, string> = {
  msl: "/msl",
  director: "/director",
  executive: "/executive",
  admin: "/admin",
}

export const PERSONA_LABEL: Record<Persona, string> = {
  msl: "MSL",
  director: "Director",
  executive: "Executive",
  admin: "Administrator",
}

export function findUser(userId: string | null | undefined): FixtureUser {
  return USERS.find((u) => u.userId === userId) ?? USERS.find((u) => u.userId === DEFAULT_USER_ID)!
}

export { hash as fixtureHash }
