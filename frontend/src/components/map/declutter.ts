export interface LatLng {
  lat: number
  lng: number
}

const RAD = Math.PI / 180

const toVector = ({ lat, lng }: LatLng): [number, number, number] => [
  Math.cos(lat * RAD) * Math.cos(lng * RAD),
  Math.cos(lat * RAD) * Math.sin(lng * RAD),
  Math.sin(lat * RAD),
]

const toLatLng = ([x, y, z]: [number, number, number]): LatLng => ({
  lat: Math.asin(Math.max(-1, Math.min(1, z))) / RAD,
  lng: Math.atan2(y, x) / RAD,
})

/** Great-circle angle in radians between two points given in degrees. */
export function angleBetween(a: LatLng, b: LatLng): number {
  const [ax, ay, az] = toVector(a)
  const [bx, by, bz] = toVector(b)
  return Math.acos(Math.min(1, Math.max(-1, ax * bx + ay * by + az * bz)))
}

/**
 * Nudges points apart on the sphere until no two are closer than `minAngle` radians (or `iterations` run out),
 * so tap targets that would otherwise sit on top of each other (DE / FR / GB on a globe) stay separately tappable.
 * Points that already clear each other do not move. Order and length of the input are preserved.
 */
export function declutter(points: LatLng[], minAngle: number, iterations = 60): LatLng[] {
  const v = points.map(toVector)
  const touched = new Set<number>()
  for (let step = 0; step < iterations; step++) {
    let moved = false
    for (let i = 0; i < v.length; i++) {
      for (let j = i + 1; j < v.length; j++) {
        const dot = v[i][0] * v[j][0] + v[i][1] * v[j][1] + v[i][2] * v[j][2]
        const angle = Math.acos(Math.min(1, Math.max(-1, dot)))
        if (angle >= minAngle) continue
        moved = true
        touched.add(i)
        touched.add(j)
        // Push along the chord between them; identical points get an arbitrary but stable direction.
        let dx = v[i][0] - v[j][0], dy = v[i][1] - v[j][1], dz = v[i][2] - v[j][2]
        let len = Math.hypot(dx, dy, dz)
        if (len < 1e-9) { dx = 1; dy = 0; dz = 0; len = 1 }
        const push = ((minAngle - angle) / 2) * 1.02 / len
        v[i] = normalize([v[i][0] + dx * push, v[i][1] + dy * push, v[i][2] + dz * push])
        v[j] = normalize([v[j][0] - dx * push, v[j][1] - dy * push, v[j][2] - dz * push])
      }
    }
    if (!moved) break
  }
  return v.map((vec, i) => (touched.has(i) ? toLatLng(vec) : points[i]))
}

function normalize([x, y, z]: [number, number, number]): [number, number, number] {
  const len = Math.hypot(x, y, z) || 1
  return [x / len, y / len, z / len]
}
