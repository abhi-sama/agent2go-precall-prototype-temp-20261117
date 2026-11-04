"use client"

import { Html } from "@react-three/drei"
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber"
import * as React from "react"
import type * as THREE from "three"
import type { TerritoryActivity } from "@/lib/data/types"
import type { SceneColors } from "./scene-colors"

/** Mutable handle shared with the DOM wrapper so drags never cause React re-renders. */
export interface SceneControl {
  /** Target Y rotation in radians. */
  rotation: number
  /** Set by the scene; wakes the render loop when `frameloop="demand"`. */
  invalidate?: () => void
}

const PITCH = 1.05
const REGION_GAP = 0.4
const MAX_BAR = 2.3

function layout(items: TerritoryActivity[]) {
  const cols = Math.max(...items.map((t) => t.col)) + 1
  const rows = Math.max(...items.map((t) => t.row)) + 1
  const width = (cols - 1) * PITCH + (cols > 3 ? REGION_GAP : 0)
  const depth = (rows - 1) * PITCH + (rows > 2 ? REGION_GAP : 0)
  return (t: TerritoryActivity): [number, number] => [
    t.col * PITCH + (t.col >= 3 ? REGION_GAP : 0) - width / 2,
    t.row * PITCH + (t.row >= 2 ? REGION_GAP : 0) - depth / 2,
  ]
}

function Bar({
  x,
  height,
  color,
  animate,
}: {
  x: number
  height: number
  color: string
  animate: boolean
}) {
  const ref = React.useRef<THREE.Mesh>(null)
  const current = React.useRef(animate ? 0.001 : height)
  useFrame((_, dt) => {
    const mesh = ref.current
    if (!mesh) return
    if (animate) current.current += (height - current.current) * Math.min(1, dt * 5)
    else current.current = height
    mesh.scale.y = Math.max(0.001, current.current)
    mesh.position.y = 0.06 + current.current / 2
  })
  return (
    <mesh ref={ref} position={[x, 0.06 + height / 2, 0]}>
      <boxGeometry args={[0.2, 1, 0.2]} />
      <meshStandardMaterial color={color} roughness={0.45} metalness={0.05} />
    </mesh>
  )
}

function Tile({
  item,
  position,
  maxValue,
  selected,
  colors,
  animate,
  onSelect,
}: {
  item: TerritoryActivity
  position: [number, number]
  maxValue: number
  selected: boolean
  colors: SceneColors
  animate: boolean
  onSelect: (id: string) => void
}) {
  const scale = (v: number) => (maxValue > 0 ? 0.04 + (v / maxValue) * MAX_BAR : 0.04)
  const base = item.isOwn ? colors.own : item.inScope ? colors.tile : colors.tileLocked
  return (
    <group position={[position[0], 0, position[1]]}>
      <mesh
        position={[0, 0.03, 0]}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          // R3F reports pointer travel; ignore the click that ends a rotate-drag.
          if (!item.inScope || e.delta > 6) return
          e.stopPropagation()
          onSelect(item.territoryId)
        }}
        onPointerOver={(e) => {
          if (item.inScope) {
            e.stopPropagation()
            document.body.style.cursor = "pointer"
          }
        }}
        onPointerOut={() => {
          document.body.style.cursor = ""
        }}
      >
        <boxGeometry args={[0.94, 0.12, 0.94]} />
        <meshStandardMaterial
          color={base}
          roughness={0.7}
          transparent={!item.inScope}
          opacity={item.inScope ? 1 : 0.75}
          emissive={selected ? colors.selected : "#000000"}
          emissiveIntensity={selected ? 0.28 : 0}
        />
      </mesh>
      {item.inScope && (
        <>
          <Bar x={-0.27} height={scale(item.distinctCalls)} color={colors.calls} animate={animate} />
          <Bar x={0} height={scale(item.distinctEngagedHcps)} color={colors.hcps} animate={animate} />
          <Bar x={0.27} height={scale(item.responseCount)} color={colors.responses} animate={animate} />
        </>
      )}
      {selected && (
        <Html position={[0, 0.25, 0.72]} center style={{ pointerEvents: "none" }}>
          <span className="rounded-full bg-foreground px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-background shadow-lift">
            {item.name}
          </span>
        </Html>
      )}
    </group>
  )
}

function World({
  items,
  selectedId,
  onSelect,
  colors,
  controlRef,
  reducedMotion,
}: {
  items: TerritoryActivity[]
  selectedId: string | null
  onSelect: (id: string) => void
  colors: SceneColors
  controlRef: React.RefObject<SceneControl>
  reducedMotion: boolean
}) {
  const group = React.useRef<THREE.Group>(null)
  const invalidate = useThree((s) => s.invalidate)
  const place = React.useMemo(() => layout(items), [items])
  const maxValue = React.useMemo(
    () => Math.max(0, ...items.filter((t) => t.inScope).flatMap((t) => [t.distinctCalls, t.distinctEngagedHcps, t.responseCount])),
    [items],
  )

  React.useEffect(() => {
    const control = controlRef.current
    control.invalidate = invalidate
    invalidate()
    return () => {
      control.invalidate = undefined
    }
  }, [controlRef, invalidate, items, selectedId, colors])

  const current = React.useRef(0)
  useFrame(({ clock }, dt) => {
    const g = group.current
    if (!g) return
    // A gentle sway keeps the map readable (a full spin would hide the labels); none under reduced motion.
    const sway = reducedMotion ? 0 : Math.sin(clock.elapsedTime * 0.35) * 0.12
    const target = controlRef.current.rotation + sway
    current.current += (target - current.current) * (reducedMotion ? 1 : Math.min(1, dt * 6))
    g.rotation.y = current.current
  })

  return (
    <group ref={group}>
      {items.map((t) => (
        <Tile
          key={t.territoryId}
          item={t}
          position={place(t)}
          maxValue={maxValue}
          selected={t.territoryId === selectedId}
          colors={colors}
          animate={!reducedMotion}
          onSelect={onSelect}
        />
      ))}
    </group>
  )
}

export interface TerritorySceneProps {
  items: TerritoryActivity[]
  selectedId: string | null
  onSelect: (id: string) => void
  colors: SceneColors
  controlRef: React.RefObject<SceneControl>
  reducedMotion: boolean
  visible: boolean
}

/**
 * R3F scene: a schematic map (not geography) of territory tiles in four regions. In-scope tiles
 * carry three columns (calls, engaged HCPs, responses) on one shared height scale; out-of-scope
 * tiles are flat, locked and carry no data at all.
 */
export default function TerritoryScene({ items, selectedId, onSelect, colors, controlRef, reducedMotion, visible }: TerritorySceneProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      frameloop={!visible ? "never" : reducedMotion ? "demand" : "always"}
      camera={{ position: [0, 6.4, 7.6], fov: 36 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      onCreated={({ camera }) => camera.lookAt(0, 0.4, 0)}
      aria-hidden
    >
      <ambientLight intensity={1.1} />
      <hemisphereLight args={["#ffffff", "#8a7f78", 0.6]} />
      <directionalLight position={[4, 8, 5]} intensity={1.7} />
      <World items={items} selectedId={selectedId} onSelect={onSelect} colors={colors} controlRef={controlRef} reducedMotion={reducedMotion} />
    </Canvas>
  )
}
