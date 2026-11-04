import { describe, expect, it } from "vitest"
import { alpha2ForNumeric } from "./countries"
import { boxOfFeatures, boxOfPolygon, framing, loadUsStates, loadWorld, nearPoints, unionBox } from "./shapes"

describe("bundled public-domain shapes", () => {
  it("has every country the seed uses, keyed by ISO alpha-2", async () => {
    const world = await loadWorld()
    const names = new Set(world.features.map((f) => f.properties.name))
    for (const code of ["US", "CA", "GB", "DE", "FR", "JP", "BR"]) expect(names.has(code), code).toBe(true)
  })

  it("has the 50 states and DC, keyed by name, with y pointing up", async () => {
    const states = await loadUsStates()
    const names = new Set(states.features.map((f) => f.properties.name))
    for (const n of ["Massachusetts", "California", "Texas", "Hawaii", "Alaska", "District of Columbia"]) expect(names.has(n), n).toBe(true)
    const byName = (n: string) => boxOfFeatures([states.features.find((f) => f.properties.name === n)!])!
    // After flipping, Washington (north-west) sits above Florida (south-east): larger y, smaller x.
    expect(byName("Washington")[3]).toBeGreaterThan(byName("Florida")[3])
    expect(byName("Washington")[0]).toBeLessThan(byName("Florida")[0])
  })

  it("maps numeric ids to alpha-2 and unknown ids to nothing", () => {
    expect(alpha2ForNumeric("840")).toBe("US")
    expect(alpha2ForNumeric(76)).toBe("BR")
    expect(alpha2ForNumeric("999")).toBeUndefined()
  })

  it("drops far-away parts of a country (French Guiana) but keeps the mainland", async () => {
    const world = await loadWorld()
    const france = world.features.find((f) => f.properties.name === "FR")!
    const whole = boxOfFeatures([france])!
    const near = boxOfFeatures([nearPoints(france, [[2.35, 48.86]])])!
    expect(whole[0]).toBeLessThan(-40)
    expect(near[0]).toBeGreaterThan(-10)
    expect(boxOfFeatures([nearPoints(france, [])])).toEqual(whole)
  })

  it("frames a target inside the whole with a sane zoom", () => {
    const whole = [0, 0, 100, 50] as const
    expect(framing(whole, whole).zoom).toBeGreaterThanOrEqual(1)
    const f = framing(whole, [10, 10, 20, 15])
    expect(f.zoom).toBeGreaterThan(3)
    expect(f.center).toEqual([15, 12.5])
    expect(framing(whole, [10, 10, 10.0001, 10.0001]).zoom).toBeLessThanOrEqual(14)
    expect(unionBox([])).toBeNull()
    expect(boxOfPolygon([[[1, 2], [3, 4], [1, 4]]])).toEqual([1, 2, 3, 4])
  })
})
