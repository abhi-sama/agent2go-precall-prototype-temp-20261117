import type { GeoActivity, GeoCountry, GeoTerritory } from "@/lib/data/types"
import { COUNTRY_CENTER } from "@/lib/geo/countries"

/** Where the person is in the globe, country and territory drill-down. */
export type MapView =
  | { level: "world" }
  | { level: "country"; countryCode: string }
  | { level: "territory"; countryCode: string; territoryId: string }

export type MapEntry = "globe" | "flat"

/**
 * Executives open on the globe (or the flat world when it cannot be shown). Everyone else opens
 * straight on the flat map of their own scope: the country, when the scope sits in one, otherwise the world.
 */
export function initialView(activity: Pick<GeoActivity, "countries">, entry: MapEntry): MapView {
  if (entry === "flat" && activity.countries.length === 1) return { level: "country", countryCode: activity.countries[0].countryCode }
  return { level: "world" }
}

/** A view that no longer matches the data (a different range or scope) falls back to the nearest valid one. */
export function validView(view: MapView, activity: Pick<GeoActivity, "countries" | "territories">): MapView {
  if (view.level === "world") return view
  if (!activity.countries.some((c) => c.countryCode === view.countryCode)) return { level: "world" }
  if (view.level === "territory" && !activity.territories.some((t) => t.territoryId === view.territoryId)) {
    return { level: "country", countryCode: view.countryCode }
  }
  return view
}

export function territoriesIn(activity: Pick<GeoActivity, "territories">, countryCode: string): GeoTerritory[] {
  return activity.territories.filter((t) => t.countryCode === countryCode)
}

export interface Extent {
  min: number
  max: number
}

/** Range of the visible counts, ignoring suppressed (null) ones. A single value gets a non-empty range. */
export function extentOf(values: ReadonlyArray<number | null>): Extent {
  const known = values.filter((v): v is number => v !== null)
  if (known.length === 0) return { min: 0, max: 1 }
  const min = Math.min(...known)
  const max = Math.max(...known)
  return { min: known.length > 1 ? min : 0, max: max === min && known.length > 1 ? max + 1 : Math.max(max, 1) }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

export function mixHex(from: string, to: string, t: number): string {
  const a = hexToRgb(from)
  const b = hexToRgb(to)
  const k = Math.min(1, Math.max(0, t))
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, "0")).join("")}`
}

/** Light tint of the accent for the quietest area up to the full accent for the busiest. */
export function rampColor(value: number, extent: Extent, low: string, high: string): string {
  const t = (value - extent.min) / (extent.max - extent.min || 1)
  return mixHex(low, high, 0.18 + 0.82 * Math.min(1, Math.max(0, t)))
}

export const formatCount = (n: number) => n.toLocaleString("en-US")

export function describeCalls(item: Pick<GeoTerritory | GeoCountry, "distinctCalls" | "suppressed">): string {
  return item.suppressed || item.distinctCalls === null ? "Hidden: fewer than 5 calls" : `${formatCount(item.distinctCalls)} distinct calls`
}

/**
 * Where a country's globe marker sits: its geographic centre, or the mean position of its
 * territories for a country we have no centre for.
 */
export function countryAnchor(activity: Pick<GeoActivity, "territories">, countryCode: string): { lat: number; lng: number } | null {
  const ts = territoriesIn(activity, countryCode)
  if (ts.length === 0) return null
  const center = COUNTRY_CENTER[countryCode]
  if (center) return { lat: center[0], lng: center[1] }
  // Average on the unit circle so territories either side of the antimeridian do not cancel out.
  const x = ts.reduce((n, t) => n + Math.cos((t.longitude * Math.PI) / 180), 0)
  const y = ts.reduce((n, t) => n + Math.sin((t.longitude * Math.PI) / 180), 0)
  return {
    lat: ts.reduce((n, t) => n + t.latitude, 0) / ts.length,
    lng: (Math.atan2(y, x) * 180) / Math.PI,
  }
}
