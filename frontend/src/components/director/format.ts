import type { Disclosure } from "@/lib/data/types"

/** `0.9167` -> `92%`. A null completeness (nobody to measure) is shown as an em dash, never as 0%. */
export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`
}

export const num = (n: number) => n.toLocaleString("en-US")

export function valueLabel(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : value
}

/** Disclosure codes that mean two territories are not like-for-like. */
export const UNEQUAL_CODES = new Set(["REPORTING_MEMBERS_DIFFER", "ROSTER_SIZE_DIFFERS", "TARGET_POPULATION_DIFFERS", "TARGET_DATA_UNEVEN", "COMPLETENESS_DIFFERS"])

export const isUnequal = (d: Disclosure) => UNEQUAL_CODES.has(d.code)
