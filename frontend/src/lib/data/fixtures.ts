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
  /** Primary city. */
  name: string
  regionId: string
  countryCode: string
  countryName: string
  subdivisionCode: string
  subdivisionName: string
  latitude: number
  longitude: number
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

type Place = readonly [city: string, countryCode: string, subdivisionCode: string, subdivisionName: string, latitude: number, longitude: number]

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States", CA: "Canada", GB: "United Kingdom", DE: "Germany", FR: "France", JP: "Japan", BR: "Brazil",
}

/**
 * Real places, mirroring the seeded database: each territory is one real US state or one real
 * country, and every region spans more than one country so an executive's globe has several.
 */
const PLACES: Record<string, Place[]> = {
  NE: [
    ["Boston Metro", "US", "MA", "Massachusetts", 42.36, -71.06],
    ["New York", "US", "NY", "New York", 40.71, -74.01],
    ["Philadelphia", "US", "PA", "Pennsylvania", 39.95, -75.17],
    ["Hartford", "US", "CT", "Connecticut", 41.76, -72.67],
    ["Newark", "US", "NJ", "New Jersey", 40.74, -74.17],
    ["Toronto", "CA", "ON", "Ontario", 43.65, -79.38],
  ],
  SE: [
    ["Atlanta", "US", "GA", "Georgia", 33.75, -84.39],
    ["Charlotte", "US", "NC", "North Carolina", 35.23, -80.84],
    ["Miami", "US", "FL", "Florida", 25.76, -80.19],
    ["Nashville", "US", "TN", "Tennessee", 36.16, -86.78],
    ["Houston", "US", "TX", "Texas", 29.76, -95.37],
    ["London", "GB", "ENG", "England", 51.51, -0.13],
  ],
  MW: [
    ["Chicago", "US", "IL", "Illinois", 41.88, -87.63],
    ["Detroit", "US", "MI", "Michigan", 42.33, -83.05],
    ["Minneapolis", "US", "MN", "Minnesota", 44.98, -93.27],
    ["Columbus", "US", "OH", "Ohio", 39.96, -83.0],
    ["Munich", "DE", "BY", "Bavaria", 48.14, 11.58],
    ["Paris", "FR", "IDF", "Ile-de-France", 48.86, 2.35],
  ],
  WE: [
    ["Seattle", "US", "WA", "Washington", 47.61, -122.33],
    ["Portland", "US", "OR", "Oregon", 45.52, -122.68],
    ["San Francisco", "US", "CA", "California", 37.77, -122.42],
    ["Phoenix", "US", "AZ", "Arizona", 33.45, -112.07],
    ["Tokyo", "JP", "13", "Tokyo", 35.68, 139.69],
    ["Sao Paulo", "BR", "SP", "Sao Paulo", -23.55, -46.63],
  ],
}

function hash(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

export const TERRITORIES: FixtureTerritory[] = REGIONS.flatMap((region) =>
  PLACES[region.id].map(([name, countryCode, subdivisionCode, subdivisionName, latitude, longitude], ti) => {
    const id = `${region.id}-${String(ti + 1).padStart(2, "0")}`
    return {
      id,
      name,
      regionId: region.id,
      countryCode,
      countryName: COUNTRY_NAMES[countryCode],
      subdivisionCode,
      subdivisionName,
      latitude,
      longitude,
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
