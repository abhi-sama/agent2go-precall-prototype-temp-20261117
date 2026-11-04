import { describe, expect, it } from "vitest"
import {
  BAR_WIDTH,
  MIN_HEIGHT,
  PITCH,
  POLAR_MAX,
  POLAR_MIN,
  clampOrbit,
  cubicBezier,
  describeField,
  easeOut,
  fitBox,
  fitDistance,
  labelStride,
  layoutBars,
  maxBarHeight,
  mixHex,
  nearestPoint,
  offsetToOrbit,
  orbitToOffset,
  stepOrbit,
} from "./bar-field-model"

const cells = [
  { rowId: "a", colId: "x", value: 10 },
  { rowId: "a", colId: "y", value: 5 },
  { rowId: "b", colId: "x", value: 0 },
]

describe("layoutBars", () => {
  const bars = layoutBars(["a", "b"], ["x", "y"], cells, 10)

  it("makes one bar per row and column, row-major, even where a cell has no data", () => {
    expect(bars.map((b) => `${b.rowId}${b.colId}`)).toEqual(["ax", "ay", "bx", "by"])
    expect(bars.map((b) => b.index)).toEqual([0, 1, 2, 3])
  })

  it("centres the grid on the origin with one unit between bars, and the bars never touch", () => {
    expect(bars.map((b) => [b.x, b.z])).toEqual([[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]])
    expect(PITCH - BAR_WIDTH).toBeGreaterThan(0.2)
  })

  it("scales height with the value against the maximum, and keeps an empty cell as a flat tile", () => {
    const H = maxBarHeight(2, 2)
    expect(bars[0].height).toBeCloseTo(H)
    expect(bars[1].height).toBeCloseTo(H / 2)
    expect(bars[2].value).toBe(0)
    expect(bars[2].height).toBe(MIN_HEIGHT)
    expect(bars[3].height).toBe(MIN_HEIGHT)
  })

  it("clamps the colour fraction to 0..1 and survives a zero maximum", () => {
    expect(layoutBars(["a"], ["x"], [{ rowId: "a", colId: "x", value: 99 }], 10)[0].t).toBe(1)
    expect(layoutBars(["a"], ["x"], [{ rowId: "a", colId: "x", value: 3 }], 0)[0].t).toBe(0)
    expect(layoutBars([], [], [], 1)).toEqual([])
  })

  it("keeps a wide grid from becoming needles", () => {
    expect(maxBarHeight(2, 2)).toBe(2.4)
    expect(maxBarHeight(14, 24)).toBeCloseTo(7.2)
  })
})

describe("easeOut", () => {
  it("is anchored at both ends, front-loaded, and monotonic", () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    expect(easeOut(0.2)).toBeGreaterThan(0.5)
    let last = 0
    for (let t = 0; t <= 1; t += 0.05) {
      const v = easeOut(t)
      expect(v).toBeGreaterThanOrEqual(last - 1e-9)
      last = v
    }
  })

  it("matches the linear curve when the control points lie on the diagonal", () => {
    const linear = cubicBezier(0.25, 0.25, 0.75, 0.75)
    for (const t of [0.1, 0.4, 0.8]) expect(linear(t)).toBeCloseTo(t, 4)
  })
})

describe("fitDistance", () => {
  it("backs the camera off further for a narrow (portrait) viewport", () => {
    const wide = fitDistance(1200, 500, 6, 35)
    const narrow = fitDistance(400, 600, 6, 35)
    expect(narrow).toBeGreaterThan(wide)
  })

  it("keeps the sphere inside the vertical field of view when the viewport is wide", () => {
    const d = fitDistance(1600, 400, 5, 40)
    expect(Math.asin(5 / d)).toBeCloseTo((40 * Math.PI) / 360, 5)
  })

  it("survives a zero-height viewport", () => {
    expect(Number.isFinite(fitDistance(300, 0, 5, 35))).toBe(true)
  })
})

describe("fitBox", () => {
  const fits = (distance: number, az: number, pol: number, hw: number, hd: number, h: number, ty: number, w: number, vh: number, fov: number) => {
    const aspect = w / vh
    const tanV = Math.tan((fov * Math.PI) / 360)
    const tanH = tanV * aspect
    const dir = [Math.sin(pol) * Math.sin(az), Math.cos(pol), Math.sin(pol) * Math.cos(az)]
    const right = [Math.cos(az), 0, -Math.sin(az)]
    const up = [-Math.cos(pol) * Math.sin(az), Math.sin(pol), -Math.cos(pol) * Math.cos(az)]
    let worst = 0
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, h]) {
      const p = [sx * hw, y - ty, sz * hd]
      const d = (a: number[]) => a[0] * p[0] + a[1] * p[1] + a[2] * p[2]
      const depth = distance - d(dir)
      worst = Math.max(worst, Math.abs(d(right)) / (depth * tanH), Math.abs(d(up)) / (depth * tanV))
    }
    return worst
  }

  it("puts every corner of the field inside the view, with a little margin", () => {
    for (const [w, h] of [[900, 440], [400, 560], [1300, 480]]) {
      const d = fitBox(-0.5, 0.85, 3.3, 7.3, 4.2, 1.4, w, h, 35)
      const worst = fits(d, -0.5, 0.85, 3.3, 7.3, 4.2, 1.4, w, h, 35)
      expect(worst).toBeLessThanOrEqual(0.95)
      expect(worst).toBeGreaterThan(0.85)
    }
  })

  it("sits closer than the bounding sphere for a long, low field", () => {
    const sphere = fitDistance(900, 440, Math.hypot(3.3, 7.3, 2.1), 35)
    expect(fitBox(-0.5, 0.85, 3.3, 7.3, 4.2, 1.4, 900, 440, 35)).toBeLessThan(sphere)
  })
})

describe("orbit", () => {
  it("round-trips between an orbit and a camera offset", () => {
    const o = { azimuth: -0.5, polar: 0.85, distance: 12 }
    const back = offsetToOrbit(orbitToOffset(o))
    expect(back.azimuth).toBeCloseTo(o.azimuth)
    expect(back.polar).toBeCloseTo(o.polar)
    expect(back.distance).toBeCloseTo(o.distance)
  })

  it("never goes below the floor or straight overhead, and limits zoom", () => {
    const c = clampOrbit({ azimuth: 1, polar: 3, distance: 1 }, 4, 30)
    expect(c.polar).toBe(POLAR_MAX)
    expect(c.distance).toBe(4)
    expect(clampOrbit({ azimuth: 0, polar: -1, distance: 99 }, 4, 30)).toMatchObject({ polar: POLAR_MIN, distance: 30 })
  })

  it("steps by key: arrows rotate, plus and minus zoom, zero resets, other keys are ignored", () => {
    const o = { azimuth: 0, polar: 1, distance: 10 }
    expect(stepOrbit(o, "ArrowLeft")).toMatchObject({ azimuth: -0.2 })
    expect(stepOrbit(o, "ArrowRight")).toMatchObject({ azimuth: 0.2 })
    expect(stepOrbit(o, "ArrowUp")).toMatchObject({ polar: 0.8 })
    expect(stepOrbit(o, "ArrowDown")).toMatchObject({ polar: 1.2 })
    expect((stepOrbit(o, "+") as { distance: number }).distance).toBeLessThan(10)
    expect((stepOrbit(o, "-") as { distance: number }).distance).toBeGreaterThan(10)
    expect(stepOrbit(o, "0")).toBe("home")
    expect(stepOrbit(o, "a")).toBeNull()
  })
})

describe("nearestPoint", () => {
  const pts = [
    { x: 100, y: 100, visible: true },
    { x: 130, y: 100, visible: true },
    { x: 100, y: 140, visible: false },
  ]

  it("takes the closest bar within the radius", () => {
    expect(nearestPoint(pts, 125, 102, 22)).toBe(1)
    expect(nearestPoint(pts, 104, 96, 22)).toBe(0)
  })

  it("returns -1 when the tap lands in empty floor, and ignores bars behind the camera", () => {
    expect(nearestPoint(pts, 300, 300, 22)).toBe(-1)
    expect(nearestPoint(pts, 100, 140, 22)).toBe(-1)
  })
})

describe("labels and description", () => {
  it("shows every label when they fit, and every n-th when they do not", () => {
    expect(labelStride(80, 60)).toBe(1)
    expect(labelStride(20, 60)).toBe(3)
    expect(labelStride(0, 60)).toBe(1)
  })

  it("describes the shape and the top cells in words, and says where the full data is", () => {
    const bars = layoutBars(["a", "b"], ["x", "y"], cells, 10)
    const text = describeField(bars, (id) => `Row ${id}`, (id) => `Col ${id}`, "%")
    expect(text).toContain("2 rows by 2 columns")
    expect(text).toContain("Row a in Col x, 10.0%")
    expect(text).toContain("table view")
    expect(describeField([], String, String, "%")).toContain("no data")
  })
})

describe("mixHex", () => {
  it("blends like color-mix in sRGB", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080")
    expect(mixHex("#ea580c", "#ffffff", 1)).toBe("#ea580c")
    expect(mixHex("#ea580c", "#ffffff", 0)).toBe("#ffffff")
  })
})
