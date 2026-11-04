/**
 * Pure geometry for the 3D bar field (rows x columns of bars on a floor). No three.js import, so it is unit-tested in
 * node. The scene (`bar-field-scene.tsx`) only turns these numbers into meshes.
 */

/** One cell of the grid. `value` is null when the cell has no data (drawn as a flat tile, never as a missing bar). */
export interface FieldCell {
  rowId: string
  colId: string
  value: number | null
}

export interface BarLayout {
  index: number
  rowId: string
  colId: string
  row: number
  col: number
  value: number
  /** Centre of the bar's footprint on the floor. */
  x: number
  z: number
  /** Bar height in world units; at least `MIN_HEIGHT` so an empty cell stays visible as a tile. */
  height: number
  /** 0 to 1, for the colour ramp. */
  t: number
}

export const PITCH = 1
export const BAR_WIDTH = 0.72
export const MIN_HEIGHT = 0.05

/** Tallest bar in world units: scales with the grid so a wide grid does not become a field of needles. */
export const maxBarHeight = (rows: number, cols: number) => Math.max(2.4, 0.3 * Math.max(rows, cols))

export function layoutBars(rowIds: readonly string[], colIds: readonly string[], cells: readonly FieldCell[], max: number): BarLayout[] {
  const byKey = new Map(cells.map((c) => [`${c.rowId}\u0000${c.colId}`, c.value]))
  const H = maxBarHeight(rowIds.length, colIds.length)
  const out: BarLayout[] = []
  rowIds.forEach((rowId, row) => {
    colIds.forEach((colId, col) => {
      const value = byKey.get(`${rowId}\u0000${colId}`) ?? 0
      const t = max > 0 ? Math.min(1, Math.max(0, (value ?? 0) / max)) : 0
      out.push({
        index: out.length,
        rowId,
        colId,
        row,
        col,
        value: value ?? 0,
        x: (col - (colIds.length - 1) / 2) * PITCH,
        z: (row - (rowIds.length - 1) / 2) * PITCH,
        height: Math.max(MIN_HEIGHT, t * H),
        t,
      })
    })
  })
  return out
}

/** The floor's size, a little larger than the bars so they sit on a plinth. */
export const floorSize = (rows: number, cols: number) => ({ width: cols * PITCH + 0.6, depth: rows * PITCH + 0.6 })

/** The cubic-bezier easing used everywhere in the app (`--ease-out`), solved for t. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let s = x
    for (let i = 0; i < 8; i++) {
      const err = sampleX(s) - x
      if (Math.abs(err) < 1e-6) return sampleY(s)
      const d = slopeX(s)
      if (Math.abs(d) < 1e-6) break
      s -= err / d
    }
    let lo = 0, hi = 1
    s = x
    for (let i = 0; i < 24; i++) {
      const v = sampleX(s)
      if (Math.abs(v - x) < 1e-6) break
      if (v < x) lo = s
      else hi = s
      s = (lo + hi) / 2
    }
    return sampleY(s)
  }
}

/** `--ease-out` from globals.css. */
export const easeOut = cubicBezier(0.23, 1, 0.32, 1)
/** The chart draw-in duration (`--duration-slow`), the same as every other chart. */
export const INTRO_MS = 450

/** Camera distance that fits a bounding sphere in a viewport, using the narrower of the two field-of-view angles. */
export function fitDistance(width: number, height: number, radius: number, fovDeg: number): number {
  const aspect = height > 0 ? width / height : 1
  const v = (fovDeg * Math.PI) / 180
  const h = 2 * Math.atan(Math.tan(v / 2) * aspect)
  return radius / Math.sin(Math.min(v, h) / 2)
}

/**
 * The closest camera distance at which the whole field (a box from the floor up to `height`, aimed at `targetY`) fits
 * the viewport when seen from this angle. Tighter than a bounding sphere, which wastes half the canvas on a long,
 * low field.
 */
export function fitBox(azimuth: number, polar: number, halfWidth: number, halfDepth: number, height: number, targetY: number, width: number, viewHeight: number, fovDeg: number, margin = 1.06): number {
  const aspect = viewHeight > 0 ? width / viewHeight : 1
  const tanV = Math.tan((fovDeg * Math.PI) / 360)
  const tanH = tanV * aspect
  const dir: [number, number, number] = [Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth)]
  const right: [number, number, number] = [Math.cos(azimuth), 0, -Math.sin(azimuth)]
  const up: [number, number, number] = [-Math.cos(polar) * Math.sin(azimuth), Math.sin(polar), -Math.cos(polar) * Math.cos(azimuth)]
  const dot = (a: [number, number, number], b: [number, number, number]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  let need = 0
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const y of [0, height]) {
        const p: [number, number, number] = [sx * halfWidth, y - targetY, sz * halfDepth]
        const lateral = Math.max(Math.abs(dot(p, right)) / tanH, Math.abs(dot(p, up)) / tanV)
        need = Math.max(need, dot(p, dir) + lateral)
      }
    }
  }
  return need * margin
}

export interface Orbit {
  /** Radians around the vertical axis. */
  azimuth: number
  /** Radians from straight up; 0 looks down, pi/2 looks along the floor. */
  polar: number
  distance: number
}

/** First view: from the front-left, about 50 degrees above the floor. */
export const HOME_ORBIT: Pick<Orbit, "azimuth" | "polar"> = { azimuth: -0.5, polar: 0.85 }
export const POLAR_MIN = 0.12
/** Never below the floor, never looking along it. */
export const POLAR_MAX = Math.PI / 2 - 0.06

export const clampOrbit = (o: Orbit, minDistance: number, maxDistance: number): Orbit => ({
  azimuth: o.azimuth,
  polar: Math.min(POLAR_MAX, Math.max(POLAR_MIN, o.polar)),
  distance: Math.min(maxDistance, Math.max(minDistance, o.distance)),
})

export const orbitToOffset = (o: Orbit): [number, number, number] => [
  o.distance * Math.sin(o.polar) * Math.sin(o.azimuth),
  o.distance * Math.cos(o.polar),
  o.distance * Math.sin(o.polar) * Math.cos(o.azimuth),
]

export const offsetToOrbit = ([x, y, z]: [number, number, number]): Orbit => {
  const distance = Math.hypot(x, y, z) || 1
  return { azimuth: Math.atan2(x, z), polar: Math.acos(Math.min(1, Math.max(-1, y / distance))), distance }
}

export type FieldKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "+" | "=" | "-" | "_" | "0" | "Home"
export const KEY_STEP = 0.2

/** One keyboard or button step. Returns null for keys the field does not use, and "home" for reset. */
export function stepOrbit(o: Orbit, key: string): Orbit | "home" | null {
  switch (key) {
    case "ArrowLeft": return { ...o, azimuth: o.azimuth - KEY_STEP }
    case "ArrowRight": return { ...o, azimuth: o.azimuth + KEY_STEP }
    case "ArrowUp": return { ...o, polar: o.polar - KEY_STEP }
    case "ArrowDown": return { ...o, polar: o.polar + KEY_STEP }
    case "+": case "=": return { ...o, distance: o.distance * 0.85 }
    case "-": case "_": return { ...o, distance: o.distance / 0.85 }
    case "0": case "Home": return "home"
    default: return null
  }
}

export interface ScreenPoint {
  x: number
  y: number
  /** False when the point is behind the camera. */
  visible: boolean
}

/**
 * Pick the bar nearest to a tap. A ray hit on a bar always wins (the caller checks that first); this is the forgiving
 * second chance for a fingertip that lands beside a slim bar: the closest bar centre within `radius` px, so a tap
 * target is at least `2 * radius` wide (44pt on iPad).
 */
export function nearestPoint(points: readonly ScreenPoint[], px: number, py: number, radius: number): number {
  let best = -1
  let bestD = radius * radius
  points.forEach((p, i) => {
    if (!p.visible) return
    const d = (p.x - px) ** 2 + (p.y - py) ** 2
    if (d <= bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/** Show every n-th label so neighbours never overlap: n = how many label widths fit between two neighbours. */
export const labelStride = (spacingPx: number, labelPx: number): number => (spacingPx <= 0 ? 1 : Math.max(1, Math.ceil(labelPx / spacingPx)))

/** Text for screen readers: the field's shape and its biggest cells. The data table is the full equivalent. */
export function describeField(bars: readonly BarLayout[], rowLabel: (id: string) => string, colLabel: (id: string) => string, unit: string): string {
  if (bars.length === 0) return "3D bar chart with no data."
  const rows = new Set(bars.map((b) => b.rowId)).size
  const cols = new Set(bars.map((b) => b.colId)).size
  const top = [...bars].sort((a, b) => b.value - a.value).slice(0, 3).filter((b) => b.value > 0)
  const lead = top.map((b) => `${rowLabel(b.rowId)} in ${colLabel(b.colId)}, ${b.value.toFixed(1)}${unit}`).join("; ")
  return `3D bar chart of ${rows} rows by ${cols} columns.${lead ? ` Highest: ${lead}.` : ""} Open the table view for every value.`
}

const hex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0")

/** `t` of colour `a` over colour `b`, in sRGB like CSS `color-mix`: the same ramp the 2D heatmap's legend shows. */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
  const [ar, ag, ab] = parse(a)
  const [br, bg, bb] = parse(b)
  return `#${hex(br + (ar - br) * t)}${hex(bg + (ag - bg) * t)}${hex(bb + (ab - bb) * t)}`
}
