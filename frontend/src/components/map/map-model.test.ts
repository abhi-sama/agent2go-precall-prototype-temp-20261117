import { describe, expect, it } from "vitest"
import type { GeoActivity, GeoCountry, GeoTerritory } from "@/lib/data/types"
import { countryAnchor, describeCalls, extentOf, initialView, mixHex, rampColor, territoriesIn, validView } from "./map-model"

const country = (countryCode: string, over: Partial<GeoCountry> = {}): GeoCountry => ({
  countryCode, countryName: countryCode, territoryCount: 1, distinctCalls: 10, suppressed: false, ...over,
})
const territory = (territoryId: string, countryCode: string, over: Partial<GeoTerritory> = {}): GeoTerritory => ({
  territoryId, name: territoryId, regionId: "R", regionName: "R", countryCode, countryName: countryCode,
  subdivisionCode: "XX", subdivisionName: "Xx", latitude: 40, longitude: -100, isOwn: false, distinctCalls: 5, suppressed: false, ...over,
})
const activity = (countries: GeoCountry[], territories: GeoTerritory[]): Pick<GeoActivity, "countries" | "territories"> => ({ countries, territories })

describe("initialView", () => {
  const one = activity([country("US")], [territory("T1", "US")])
  const many = activity([country("US"), country("CA")], [territory("T1", "US"), territory("T2", "CA")])
  it("opens an executive on the world, even when the scope is one country", () => {
    expect(initialView(one, "globe")).toEqual({ level: "world" })
    expect(initialView(many, "globe")).toEqual({ level: "world" })
  })
  it("opens a flat-map persona on their country when the scope sits in one", () => {
    expect(initialView(one, "flat")).toEqual({ level: "country", countryCode: "US" })
  })
  it("opens a flat-map persona on the world when the scope spans countries", () => {
    expect(initialView(many, "flat")).toEqual({ level: "world" })
  })
})

describe("validView", () => {
  const a = activity([country("US")], [territory("T1", "US")])
  it("keeps views that still match the data", () => {
    const v = { level: "territory", countryCode: "US", territoryId: "T1" } as const
    expect(validView(v, a)).toBe(v)
  })
  it("falls back when the country or territory disappears", () => {
    expect(validView({ level: "country", countryCode: "CA" }, a)).toEqual({ level: "world" })
    expect(validView({ level: "territory", countryCode: "US", territoryId: "T9" }, a)).toEqual({ level: "country", countryCode: "US" })
  })
})

describe("colour scale", () => {
  it("ignores suppressed counts and never returns an empty range", () => {
    expect(extentOf([null, null])).toEqual({ min: 0, max: 1 })
    expect(extentOf([5, null, 25])).toEqual({ min: 5, max: 25 })
    const single = extentOf([40])
    expect(single.max).toBeGreaterThan(single.min)
    const same = extentOf([7, 7])
    expect(same.max).toBeGreaterThan(same.min)
  })
  it("ramps from a light tint to the full accent", () => {
    const e = { min: 0, max: 100 }
    expect(rampColor(100, e, "#ffffff", "#ea580c")).toBe("#ea580c")
    expect(rampColor(0, e, "#ffffff", "#000000")).not.toBe("#ffffff")
    expect(rampColor(1000, e, "#ffffff", "#ea580c")).toBe("#ea580c")
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080")
  })
})

describe("labels and anchors", () => {
  it("never prints a suppressed count", () => {
    expect(describeCalls({ distinctCalls: null, suppressed: true })).toMatch(/Hidden/)
    expect(describeCalls({ distinctCalls: 1234, suppressed: false })).toBe("1,234 distinct calls")
  })
  it("anchors a known country at its centre and any other at the mean of its territories, across the antimeridian too", () => {
    const a = activity([country("US")], [territory("A", "US", { latitude: 30, longitude: -80 }), territory("B", "US", { latitude: 50, longitude: -100 })])
    expect(countryAnchor(a, "US")).toEqual({ lat: 39.8, lng: -98.6 })
    const xx = activity([country("XX")], [territory("A", "XX", { latitude: 30, longitude: -80 }), territory("B", "XX", { latitude: 50, longitude: -100 })])
    const anchor = countryAnchor(xx, "XX")!
    expect(anchor.lat).toBeCloseTo(40)
    expect(anchor.lng).toBeLessThan(-80)
    const fiji = activity([], [territory("A", "FJ", { latitude: -17, longitude: 179 }), territory("B", "FJ", { latitude: -17, longitude: -179 })])
    expect(Math.abs(countryAnchor(fiji, "FJ")!.lng)).toBeGreaterThan(178)
    expect(countryAnchor(a, "ZZ")).toBeNull()
    expect(territoriesIn(a, "US")).toHaveLength(2)
  })
})
