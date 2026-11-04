import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from "geojson"
import type { GeometryCollection, Topology } from "topojson-specification"
import { alpha2ForNumeric } from "./countries"

/**
 * Bundled public-domain shapes: Natural Earth countries (world-atlas) and US Census states
 * (us-atlas). They ship inside the JavaScript bundle, so the map needs no tile server, no API
 * key and no network once the page is loaded. Feature `properties.name` is the key the map
 * data refers to: the ISO alpha-2 code for countries, the full name for US states.
 */

export type Box = readonly [minX: number, minY: number, maxX: number, maxY: number]

type Shapes = FeatureCollection<Polygon | MultiPolygon, { name: string }>

let worldCache: Promise<Shapes> | undefined
let statesCache: Promise<Shapes> | undefined

async function toFeatures(topology: unknown, objectName: string, flipY = false): Promise<Shapes> {
  const { feature } = await import("topojson-client")
  const topo = topology as Topology
  const fc = feature(topo, topo.objects[objectName] as GeometryCollection) as FeatureCollection<Polygon | MultiPolygon, { name?: string }>
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => ({
      ...f,
      properties: { name: (flipY ? f.properties?.name : alpha2ForNumeric(f.id) ?? f.properties?.name) ?? String(f.id ?? "") },
      geometry: flipY ? flipGeometryY(f.geometry) : f.geometry,
    })),
  }
}

export function loadWorld(): Promise<Shapes> {
  worldCache ??= import("world-atlas/countries-110m.json").then((m) => toFeatures(m.default, "countries"))
  return worldCache
}

/**
 * US states in the Albers USA projection (Alaska and Hawaii as insets). The shapes come
 * pre-projected in screen pixels (y grows downward) while ECharts expects y to grow upward, so y is negated.
 */
export function loadUsStates(): Promise<Shapes> {
  statesCache ??= import("us-atlas/states-albers-10m.json").then((m) => toFeatures(m.default, "states", true))
  return statesCache
}

function flipRing(ring: Position[]): Position[] {
  return ring.map(([x, y]) => [x, -y])
}

export function flipGeometryY<G extends Polygon | MultiPolygon>(g: G): G {
  if (g.type === "Polygon") return { ...g, coordinates: g.coordinates.map(flipRing) }
  return { ...g, coordinates: g.coordinates.map((poly) => poly.map(flipRing)) }
}

export function polygonsOf(g: Geometry): Position[][][] {
  if (g.type === "Polygon") return [g.coordinates]
  if (g.type === "MultiPolygon") return g.coordinates
  return []
}

export function boxOfPolygon(poly: Position[][]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of poly[0] ?? []) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX, maxY]
}

export function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ]
}

export function boxOfFeatures(features: ReadonlyArray<Feature<Geometry>>): Box | null {
  return unionBox(features.flatMap((f) => polygonsOf(f.geometry).map(boxOfPolygon)))
}

/**
 * Keeps only the parts of a country near its territories, so an overseas department or a far
 * island does not shrink the country on the screen (France without French Guiana, for example).
 * With no points the shape is returned whole.
 */
export function nearPoints(
  feature: Feature<Polygon | MultiPolygon, { name: string }>,
  points: ReadonlyArray<readonly [lon: number, lat: number]>,
  windowDeg = 15,
): Feature<Polygon | MultiPolygon, { name: string }> {
  if (points.length === 0) return feature
  const kept = polygonsOf(feature.geometry).filter((poly) => {
    const [x0, y0, x1, y1] = boxOfPolygon(poly)
    return points.some(([lon, lat]) => x1 >= lon - windowDeg && x0 <= lon + windowDeg && y1 >= lat - windowDeg && y0 <= lat + windowDeg)
  })
  if (kept.length === 0) return feature
  return { ...feature, geometry: { type: "MultiPolygon", coordinates: kept } }
}

/** ECharts `zoom` and `center` that frame `target` inside `whole` with some padding. */
export function framing(whole: Box, target: Box, padding = 0.78, maxZoom = 14): { zoom: number; center: [number, number] } {
  const ww = whole[2] - whole[0]
  const wh = whole[3] - whole[1]
  const tw = Math.max(target[2] - target[0], ww / maxZoom)
  const th = Math.max(target[3] - target[1], wh / maxZoom)
  const zoom = Math.min(maxZoom, Math.max(1, Math.min(ww / tw, wh / th) * padding))
  return { zoom, center: [(target[0] + target[2]) / 2, (target[1] + target[3]) / 2] }
}
