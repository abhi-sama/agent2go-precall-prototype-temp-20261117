"use client"

import { Canvas, useFrame, useThree } from "@react-three/fiber"
import * as React from "react"
import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  MOUSE,
  Object3D,
  type PerspectiveCamera,
  Raycaster,
  TOUCH,
  Vector2,
  Vector3,
} from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import {
  BAR_WIDTH,
  HOME_ORBIT,
  INTRO_MS,
  PITCH,
  clampOrbit,
  cubicBezier,
  easeOut,
  fitBox,
  floorSize,
  labelStride,
  maxBarHeight,
  nearestPoint,
  offsetToOrbit,
  orbitToOffset,
  stepOrbit,
  type BarLayout,
  type Orbit,
  type ScreenPoint,
} from "./bar-field-model"

const FOV = 35
const TAP_SLOP_PX = 10
const TAP_MAX_MS = 600
const TOUCH_PICK_RADIUS = 24
const MOUSE_PICK_RADIUS = 12
const STEP_MS = 200
const easeInOut = cubicBezier(0.77, 0, 0.175, 1)

export interface FieldColors {
  low: string
  high: string
  zero: string
  floor: string
  grid: string
  ink: string
}

/** What the page can ask the scene to do (the zoom and reset buttons, the arrow keys). */
export interface FieldControls {
  key: (key: string) => boolean
  home: () => void
}

export interface FieldStats {
  frames: number
  drawCalls: number
  triangles: number
  azimuth: number
  polar: number
  distance: number
  intro: "running" | "done"
}

export interface BarFieldSceneProps {
  bars: BarLayout[]
  rows: number
  cols: number
  colors: FieldColors
  selected: number | null
  reducedMotion: boolean
  /** Labels the scene positions each frame (DOM elements, so text stays crisp and selectable by screen readers' table twin). */
  rowLabels: React.RefObject<(HTMLElement | null)[]>
  colLabels: React.RefObject<(HTMLElement | null)[]>
  controlsRef: React.RefObject<FieldControls | null>
  onPick: (index: number) => void
  onHover: (index: number | null) => void
  onStats: (stats: FieldStats) => void
  /** Local builds only: where each bar's top is on screen, for tests that need to tap a particular bar. */
  onProbe?: (points: ScreenPoint[]) => void
  onLost: () => void
}

/**
 * The 3D bar field: one instanced mesh (a single draw call however many bars), a floor with a grid, an orbit camera.
 * Rendering is on demand (`frameloop="demand"`): nothing is drawn while the scene is still, which keeps an iPad cool and
 * is also what "reduced motion" asks for. Touch: one finger rotates, two fingers pinch to zoom and pan.
 */
export default function BarFieldScene(props: BarFieldSceneProps) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      flat
      camera={{ fov: FOV, near: 0.1, far: 200, position: [6, 8, 10] }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ touchAction: "none" }}
    >
      <Scene {...props} />
    </Canvas>
  )
}

function Scene({ bars, rows, cols, colors, selected, reducedMotion, rowLabels, colLabels, controlsRef, onPick, onHover, onStats, onProbe, onLost }: BarFieldSceneProps) {
  const { camera, gl, invalidate, size } = useThree()
  const mesh = React.useRef<InstancedMesh>(null)
  const controls = React.useRef<OrbitControls | null>(null)
  const frames = React.useRef(0)
  const intro = React.useRef<{ start: number | null; done: boolean; scale: number }>({ start: null, done: reducedMotion, scale: reducedMotion ? 1 : 0 })
  const tween = React.useRef<{ from: Orbit; to: Orbit; start: number } | null>(null)
  const fit = React.useRef<{ distance: number; zoom: number } | null>(null)
  const sizeRef = React.useRef({ width: size.width, height: size.height })

  const floor = floorSize(rows, cols)
  const H = maxBarHeight(rows, cols)
  const target = React.useMemo(() => new Vector3(0, H / 3, 0), [H])
  const radius = Math.hypot(floor.width / 2, floor.depth / 2, H / 2)
  const maxPan = React.useMemo(() => ({ x: floor.width / 2, z: floor.depth / 2 }), [floor.width, floor.depth])

  const pickers = React.useRef({ onPick, onHover, onLost, onStats, onProbe })
  React.useEffect(() => {
    pickers.current = { onPick, onHover, onLost, onStats, onProbe }
  })

  // --- Instances: matrices (height, with the intro scale) and colours -----------------------------------------
  const dummy = React.useMemo(() => new Object3D(), [])
  const tint = React.useMemo(() => new Color(), [])
  const paletteLow = React.useMemo(() => new Color(colors.low), [colors.low])
  const paletteHigh = React.useMemo(() => new Color(colors.high), [colors.high])
  const paletteZero = React.useMemo(() => new Color(colors.zero), [colors.zero])

  const writeMatrices = React.useCallback(
    (scale: number) => {
      const m = mesh.current
      if (!m) return
      for (const b of bars) {
        const h = Math.max(0.001, b.height * scale)
        dummy.position.set(b.x, h / 2, b.z)
        dummy.scale.set(1, h, 1)
        dummy.updateMatrix()
        m.setMatrixAt(b.index, dummy.matrix)
      }
      m.instanceMatrix.needsUpdate = true
    },
    [bars, dummy],
  )

  React.useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    m.count = bars.length
    for (const b of bars) m.setColorAt(b.index, b.value <= 0 ? paletteZero : tint.copy(paletteLow).lerp(paletteHigh, b.t))
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    // Full-size boxes for the bounding sphere (ray picking skips an instanced mesh whose sphere is stale), then the drawn scale.
    writeMatrices(1)
    m.computeBoundingSphere()
    writeMatrices(intro.current.scale)
    invalidate()
  }, [bars, paletteLow, paletteHigh, paletteZero, tint, writeMatrices, invalidate])

  // --- Camera and controls ---------------------------------------------------------------------------------------
  const applyOrbit = React.useCallback(
    (o: Orbit) => {
      const [x, y, z] = orbitToOffset(o)
      camera.position.set(target.x + x, target.y + y, target.z + z)
      camera.lookAt(target)
      controls.current?.update()
      invalidate()
    },
    [camera, target, invalidate],
  )

  const currentOrbit = React.useCallback((): Orbit => offsetToOrbit([camera.position.x - target.x, camera.position.y - target.y, camera.position.z - target.z]), [camera, target])

  /** Room for the labels: a gutter on the left for row names and a strip below for column names. */
  const gutters = React.useCallback((width: number) => ({ left: Math.min(150, Math.round(width * 0.26)), bottom: 30 }), [])

  const refit = React.useCallback(() => {
    const { width, height } = sizeRef.current
    if (width <= 0 || height <= 0) return
    const g = gutters(width)
    const distance = fitBox(HOME_ORBIT.azimuth, HOME_ORBIT.polar, floor.width / 2, floor.depth / 2, H, target.y, width - g.left, height - g.bottom, FOV)
    const perspective = camera as PerspectiveCamera
    perspective.setViewOffset(width, height, -g.left / 2, g.bottom / 2, width, height)
    const c = controls.current
    const previous = fit.current
    const zoom = previous ? currentOrbit().distance / previous.distance : 1
    fit.current = { distance, zoom }
    if (c) {
      c.minDistance = radius * 0.7
      c.maxDistance = distance * 2
    }
    const o = previous ? currentOrbit() : { ...HOME_ORBIT, distance }
    applyOrbit(clampOrbit({ ...o, distance: previous ? distance * zoom : distance }, radius * 0.7, distance * 2))
  }, [camera, radius, floor.width, floor.depth, H, target, gutters, applyOrbit, currentOrbit])

  React.useEffect(() => {
    const el = gl.domElement
    // Scrolling the page must keep working when the pointer is over the chart: only Ctrl or Cmd + wheel (what a
    // trackpad pinch sends) zooms. This listener goes first so OrbitControls sees the flag. A finger always can pinch.
    const wheel = (e: WheelEvent) => {
      if (controls.current) controls.current.enableZoom = e.ctrlKey || e.metaKey
    }
    el.addEventListener("wheel", wheel, { passive: true, capture: true })
    const c = new OrbitControls(camera, el)
    controls.current = c
    c.enablePan = true
    c.screenSpacePanning = false
    c.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }
    c.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }
    c.minPolarAngle = 0.12
    c.maxPolarAngle = Math.PI / 2 - 0.06
    c.zoomSpeed = 0.7
    c.rotateSpeed = 0.7
    c.target.copy(target)
    const onChange = () => {
      c.target.x = Math.max(-maxPan.x, Math.min(maxPan.x, c.target.x))
      c.target.z = Math.max(-maxPan.z, Math.min(maxPan.z, c.target.z))
      invalidate()
    }
    c.addEventListener("change", onChange)
    const down = () => {
      c.enableZoom = true
      tween.current = null
    }
    el.addEventListener("pointerdown", down, { passive: true })
    const lost = (e: Event) => {
      e.preventDefault()
      pickers.current.onLost()
    }
    el.addEventListener("webglcontextlost", lost)
    refit()
    return () => {
      el.removeEventListener("wheel", wheel, { capture: true })
      el.removeEventListener("pointerdown", down)
      el.removeEventListener("webglcontextlost", lost)
      c.removeEventListener("change", onChange)
      c.dispose()
      controls.current = null
    }
    // Controls are created once per canvas; later changes are applied through refs and the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, gl])

  // Damping keeps the view gliding after a flick; reduced motion stops it dead where the finger left it.
  React.useEffect(() => {
    const c = controls.current
    if (!c) return
    c.enableDamping = !reducedMotion
    c.dampingFactor = 0.12
  }, [reducedMotion])

  React.useEffect(() => {
    sizeRef.current = { width: size.width, height: size.height }
    refit()
  }, [size.width, size.height, refit])

  React.useEffect(() => {
    const c = controls.current
    if (c) c.target.copy(target)
  }, [target])

  // --- The page's handle: arrow keys, zoom buttons, reset ---------------------------------------------------------
  React.useEffect(() => {
    const go = (to: Orbit) => {
      const f = fit.current
      if (!f) return
      const clamped = clampOrbit(to, radius * 0.7, f.distance * 2)
      if (reducedMotion) {
        applyOrbit(clamped)
        return
      }
      tween.current = { from: currentOrbit(), to: clamped, start: performance.now() }
      invalidate()
    }
    controlsRef.current = {
      key: (key) => {
        const next = stepOrbit(currentOrbit(), key)
        if (next === null) return false
        if (next === "home") {
          target.set(0, H / 3, 0)
          controls.current?.target.copy(target)
          go({ ...HOME_ORBIT, distance: fit.current?.distance ?? 10 })
        } else go(next)
        return true
      },
      home: () => {
        controls.current?.target.copy(target)
        go({ ...HOME_ORBIT, distance: fit.current?.distance ?? 10 })
      },
    }
    return () => {
      controlsRef.current = null
    }
  }, [controlsRef, applyOrbit, currentOrbit, invalidate, radius, reducedMotion, target, H])

  // --- Tap to pick, and hover ----------------------------------------------------------------------------------------
  const raycaster = React.useMemo(() => new Raycaster(), [])
  const scratch = React.useMemo(() => ({ v: new Vector3(), ndc: new Vector2() }), [])

  const project = React.useCallback(
    (x: number, y: number, z: number, out: ScreenPoint) => {
      const { width, height } = sizeRef.current
      scratch.v.set(x, y, z).project(camera)
      out.x = ((scratch.v.x + 1) / 2) * width
      out.y = ((1 - scratch.v.y) / 2) * height
      out.visible = scratch.v.z > -1 && scratch.v.z < 1
      return out
    },
    [camera, scratch],
  )

  const pick = React.useCallback(
    (clientX: number, clientY: number, radiusPx: number): number | null => {
      const m = mesh.current
      if (!m) return null
      const rect = gl.domElement.getBoundingClientRect()
      const px = clientX - rect.left
      const py = clientY - rect.top
      scratch.ndc.set((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1)
      camera.updateMatrixWorld()
      raycaster.setFromCamera(scratch.ndc, camera)
      const hit = raycaster.intersectObject(m)[0]
      if (hit?.instanceId !== undefined) return hit.instanceId
      // A fingertip is wider than a slim bar: take the nearest bar centre within the touch radius.
      const centres = bars.map((b) => project(b.x, b.height / 2, b.z, { x: 0, y: 0, visible: false }))
      const i = nearestPoint(centres, px, py, radiusPx)
      return i >= 0 ? bars[i].index : null
    },
    [bars, camera, gl, project, raycaster, scratch],
  )

  React.useEffect(() => {
    const el = gl.domElement
    let down: { x: number; y: number; t: number; type: string } | null = null
    let multi = false
    let touches = 0
    let hoverFrame = 0
    const onDown = (e: PointerEvent) => {
      touches++
      if (touches > 1) multi = true
      else down = { x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType }
    }
    const onUp = (e: PointerEvent) => {
      touches = Math.max(0, touches - 1)
      const d = down
      if (touches === 0) {
        down = null
        const tapped = d && !multi && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= TAP_SLOP_PX && performance.now() - d.t <= TAP_MAX_MS
        multi = false
        if (tapped) {
          const hit = pick(e.clientX, e.clientY, d.type === "mouse" ? MOUSE_PICK_RADIUS : TOUCH_PICK_RADIUS)
          if (hit !== null) pickers.current.onPick(hit)
        }
      }
    }
    const onCancel = () => {
      touches = 0
      down = null
      multi = false
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons !== 0) return
      cancelAnimationFrame(hoverFrame)
      hoverFrame = requestAnimationFrame(() => pickers.current.onHover(pick(e.clientX, e.clientY, 0)))
    }
    const onLeave = () => pickers.current.onHover(null)
    el.addEventListener("pointerdown", onDown, { passive: true })
    el.addEventListener("pointerup", onUp, { passive: true })
    el.addEventListener("pointercancel", onCancel, { passive: true })
    el.addEventListener("pointermove", onMove, { passive: true })
    el.addEventListener("pointerleave", onLeave, { passive: true })
    return () => {
      cancelAnimationFrame(hoverFrame)
      el.removeEventListener("pointerdown", onDown)
      el.removeEventListener("pointerup", onUp)
      el.removeEventListener("pointercancel", onCancel)
      el.removeEventListener("pointermove", onMove)
      el.removeEventListener("pointerleave", onLeave)
    }
  }, [gl, pick])

  // --- Frame: intro, tween, damping, labels, stats ------------------------------------------------------------------
  const lastStats = React.useRef("")
  // Label widths, measured once per data set (reading them every frame would force a layout each time).
  const labelWidth = React.useRef<{ col: number; key: unknown } | null>(null)
  const point = React.useMemo<ScreenPoint>(() => ({ x: 0, y: 0, visible: false }), [])

  useFrame(({ gl: renderer }) => {
    frames.current++
    const now = performance.now()

    if (!intro.current.done) {
      if (intro.current.start === null) intro.current.start = now
      const t = Math.min(1, (now - intro.current.start) / INTRO_MS)
      intro.current.scale = easeOut(t)
      writeMatrices(intro.current.scale)
      if (t >= 1) intro.current.done = true
      else invalidate()
    }

    const tw = tween.current
    if (tw) {
      const t = Math.min(1, (now - tw.start) / STEP_MS)
      const k = easeInOut(t)
      applyOrbit({ azimuth: tw.from.azimuth + (tw.to.azimuth - tw.from.azimuth) * k, polar: tw.from.polar + (tw.to.polar - tw.from.polar) * k, distance: tw.from.distance + (tw.to.distance - tw.from.distance) * k })
      if (t >= 1) tween.current = null
    }
    // Damping needs update() every frame; it raises "change" (and so the next frame) until the glide ends.
    controls.current?.update()
    camera.updateMatrixWorld()

    // Labels follow the floor edges nearest the camera.
    const o = currentOrbit()
    const sx = Math.cos(o.azimuth) >= 0 ? 1 : -1
    const frontZ = sx * (floor.depth / 2 + 0.55)
    const leftX = -sx * (floor.width / 2 + 0.55)
    const gutter = gutters(sizeRef.current.width).left
    const colEls = colLabels.current ?? []
    const rowEls = rowLabels.current ?? []
    const first = project(-((cols - 1) / 2) * PITCH, 0, frontZ, { x: 0, y: 0, visible: false })
    const second = project(-((cols - 1) / 2 - 1) * PITCH, 0, frontZ, { x: 0, y: 0, visible: false })
    if (labelWidth.current?.key !== bars) labelWidth.current = { key: bars, col: Math.max(0, ...colEls.map((el) => el?.offsetWidth ?? 0)) + 4 }
    const colStride = labelStride(Math.hypot(second.x - first.x, second.y - first.y), labelWidth.current.col)
    const rowA = project(leftX, 0, -((rows - 1) / 2) * PITCH, { x: 0, y: 0, visible: false })
    const rowB = project(leftX, 0, -((rows - 1) / 2 - 1) * PITCH, { x: 0, y: 0, visible: false })
    const rowStride = labelStride(Math.hypot(rowB.x - rowA.x, rowB.y - rowA.y), 17)
    colEls.forEach((el, c) => {
      if (!el) return
      project((c - (cols - 1) / 2) * PITCH, 0, frontZ, point)
      const show = c % colStride === 0 && point.visible
      el.style.visibility = show ? "visible" : "hidden"
      el.style.transform = `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px) translate(-50%, 0)`
    })
    const onLeft = sx > 0
    rowEls.forEach((el, r) => {
      if (!el) return
      project(leftX, 0, (r - (rows - 1) / 2) * PITCH, point)
      const show = r % rowStride === 0 && point.visible
      el.style.visibility = show ? "visible" : "hidden"
      // As wide as the room to the label's left (or right) allows, never past a readable measure.
      const room = onLeft ? point.x - 8 : sizeRef.current.width - point.x - 8
      el.style.maxWidth = `${Math.max(gutter, Math.min(260, room)).toFixed(0)}px`
      el.style.textAlign = onLeft ? "right" : "left"
      el.style.transform = `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px) translate(${onLeft ? "-100%" : "0"}, -50%)`
    })

    const info = renderer.info
    const stats: FieldStats = {
      frames: frames.current,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      azimuth: Number(o.azimuth.toFixed(2)),
      polar: Number(o.polar.toFixed(2)),
      distance: Number(o.distance.toFixed(2)),
      intro: intro.current.done ? "done" : "running",
    }
    const key = `${stats.drawCalls}|${stats.azimuth}|${stats.polar}|${stats.distance}|${stats.intro}|${stats.frames}`
    if (key !== lastStats.current) {
      lastStats.current = key
      pickers.current.onStats(stats)
    }
    if (pickers.current.onProbe) {
      pickers.current.onProbe(bars.map((b) => ({ ...project(b.x, b.height, b.z, { x: 0, y: 0, visible: false }) })))
    }
  })

  // Bars drawn the frame after a data, colour or selection change.
  React.useEffect(() => {
    invalidate()
  }, [bars, colors, selected, invalidate])

  const selectedBar = selected === null ? null : bars[selected]
  const outline = React.useMemo(() => new MeshBasicMaterial({ color: colors.ink, side: BackSide }), [colors.ink])
  const barGeometry = React.useMemo(() => new BoxGeometry(BAR_WIDTH, 1, BAR_WIDTH), [])
  const hullGeometry = React.useMemo(() => new BoxGeometry(BAR_WIDTH + 0.16, 1, BAR_WIDTH + 0.16), [])
  const gridGeometry = React.useMemo(() => {
    const g = new BufferGeometry()
    const pts: number[] = []
    for (let c = 0; c <= cols; c++) pts.push((c - cols / 2) * PITCH, 0.004, -(rows * PITCH) / 2, (c - cols / 2) * PITCH, 0.004, (rows * PITCH) / 2)
    for (let r = 0; r <= rows; r++) pts.push(-(cols * PITCH) / 2, 0.004, (r - rows / 2) * PITCH, (cols * PITCH) / 2, 0.004, (r - rows / 2) * PITCH)
    g.setAttribute("position", new Float32BufferAttribute(pts, 3))
    return g
  }, [rows, cols])

  return (
    <>
      <ambientLight intensity={1.35} />
      <directionalLight position={[5, 10, 7]} intensity={1.6} />
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.002, 0]}>
        <planeGeometry args={[floor.width, floor.depth]} />
        <meshBasicMaterial color={colors.floor} />
      </mesh>
      <lineSegments geometry={gridGeometry}>
        <lineBasicMaterial color={colors.grid} />
      </lineSegments>
      <instancedMesh ref={mesh} args={[barGeometry, undefined, Math.max(1, bars.length)]} frustumCulled={false}>
        <meshLambertMaterial />
      </instancedMesh>
      {selectedBar && (
        <mesh geometry={hullGeometry} material={outline} position={[selectedBar.x, selectedBar.height / 2, selectedBar.z]} scale={[1, selectedBar.height + 0.14, 1]} />
      )}
    </>
  )
}
