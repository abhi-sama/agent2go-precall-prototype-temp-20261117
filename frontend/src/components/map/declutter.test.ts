import { describe, expect, it } from "vitest"
import { angleBetween, declutter } from "./declutter"

const MIN = 0.3

describe("declutter", () => {
  it("leaves points that already clear each other where they are", () => {
    const points = [{ lat: 40, lng: -100 }, { lat: 35, lng: 139 }]
    expect(declutter(points, MIN)).toEqual(points)
  })

  it("separates crowded neighbours to at least the minimum angle, keeping order", () => {
    const eu = [{ lat: 51, lng: 10 }, { lat: 46, lng: 2 }, { lat: 54, lng: -2 }]
    const out = declutter(eu, MIN)
    expect(out).toHaveLength(3)
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(angleBetween(out[i], out[j])).toBeGreaterThanOrEqual(MIN - 1e-3)
    // Each marker stays near its country: nudged, not relocated.
    out.forEach((p, i) => expect(angleBetween(p, eu[i])).toBeLessThan(MIN))
  })

  it("separates identical points", () => {
    const out = declutter([{ lat: 10, lng: 10 }, { lat: 10, lng: 10 }], MIN)
    expect(angleBetween(out[0], out[1])).toBeGreaterThanOrEqual(MIN - 1e-3)
  })
})
