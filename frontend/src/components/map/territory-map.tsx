"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs"
import { Button } from "@astryxdesign/core/Button"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Text } from "@astryxdesign/core/Text"
import { ToggleButton } from "@astryxdesign/core/ToggleButton"
import { VStack } from "@astryxdesign/core/VStack"
import { Globe2, Lock, MapPin, Navigation } from "lucide-react"
import dynamic from "next/dynamic"
import * as React from "react"
import { BlockSkeleton } from "@/components/state/states"
import { useDocumentTheme, useThemeSignature } from "@/hooks/use-document-theme"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import type { GeoActivity, GeoCountry, GeoTerritory, Persona } from "@/lib/data/types"
import { formatRange } from "@/lib/dates"
import { detectWebGL } from "@/lib/webgl"
import { loadUsStates, loadWorld, boxOfFeatures, framing, nearPoints, unionBox } from "@/lib/geo/shapes"
import { log } from "@/lib/log/logger"
import { tokenMs } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { FlatMap, type FlatMarker, type FlatRegion } from "./flat-map"
import { readMapColors, type MapColors } from "./map-colors"
import {
  countryAnchor,
  describeCalls,
  extentOf,
  formatCount,
  initialView,
  rampColor,
  territoriesIn,
  validView,
  type MapEntry,
  type MapView,
} from "./map-model"

const GlobeView = dynamic(() => import("./globe-view"), {
  ssr: false,
  loading: () => <BlockSkeleton className="size-full" />,
})

type Shapes = Awaited<ReturnType<typeof loadWorld>>

/** Rank of each map level, so a move to a lower rank is a zoom out (the new map settles back) and a higher one a zoom in. */
const LEVEL_RANK = { world: 0, country: 1, territory: 2 } as const

class GlobeBoundary extends React.Component<{ onError: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** Shapes load on demand and stay cached; the US states only when a US map is wanted. */
function useShapes(needStates: boolean) {
  const [world, setWorld] = React.useState<Shapes | null>(null)
  const [states, setStates] = React.useState<Shapes | null>(null)
  React.useEffect(() => {
    let live = true
    loadWorld().then((s) => live && setWorld(s))
    return () => {
      live = false
    }
  }, [])
  React.useEffect(() => {
    if (!needStates) return
    let live = true
    loadUsStates().then((s) => live && setStates(s))
    return () => {
      live = false
    }
  }, [needStates])
  return { world, states }
}

interface MapData {
  mapKey: string
  shapes: Shapes
  regions: FlatRegion[]
  markers: FlatMarker[]
  frame: { zoom: number; center: [number, number] } | null
  ariaLabel: string
}

function shade(item: Pick<GeoTerritory | GeoCountry, "distinctCalls" | "suppressed">, extent: ReturnType<typeof extentOf>, c: MapColors): string {
  return item.distinctCalls === null || item.suppressed ? rampColor(extent.min, extent, c.land, c.high) : rampColor(item.distinctCalls, extent, c.low, c.high)
}

/**
 * The territory map. Executives open on a 3D globe with a marker per country; tapping a country
 * flies in and swaps to a flat real-world map of that country (US states, or the country outline
 * with its territories), and tapping a state or territory opens it. MSLs and Directors open directly
 * on the flat map of their own scope. Where WebGL is missing or the person prefers reduced motion,
 * everyone gets the flat map and nothing animates.
 */
export function TerritoryMap({ activity, persona, className }: { activity: GeoActivity; persona: Persona; className?: string }) {
  const reducedMotion = useReducedMotion()
  const theme = useDocumentTheme()
  const themeSignature = useThemeSignature()
  // The Astryx theme and the scheme are both invalidation keys: either changes the resolved map colours.
  const colors = React.useMemo(() => {
    void themeSignature
    return readMapColors(theme)
  }, [theme, themeSignature])
  const webgl = React.useSyncExternalStore(
    () => () => {},
    detectWebGL,
    () => null,
  )
  const [globeFailed, setGlobeFailed] = React.useState(false)
  const entry: MapEntry = persona === "executive" ? "globe" : "flat"
  const renderer: "globe" | "flat" = entry === "globe" && webgl === true && !reducedMotion && !globeFailed ? "globe" : "flat"

  const [chosen, setChosen] = React.useState<MapView | null>(null)
  const view = React.useMemo(() => validView(chosen ?? initialView(activity, entry), activity), [chosen, activity, entry])
  const [flyTo, setFlyTo] = React.useState<{ code: string; lat: number; lng: number; nonce: number } | null>(null)
  // After the camera lands, the globe stays mounted just long enough to fade out under the incoming flat map.
  const [handoff, setHandoff] = React.useState(false)
  // Which way the last level change went, so the incoming map grows in (drill down) or settles back (drill up).
  const [levelMove, setLevelMove] = React.useState<{ level: MapView["level"]; dir: "in" | "out" }>({ level: view.level, dir: "in" })
  if (levelMove.level !== view.level) setLevelMove({ level: view.level, dir: LEVEL_RANK[view.level] < LEVEL_RANK[levelMove.level] ? "out" : "in" })

  const country = view.level === "world" ? null : (activity.countries.find((c) => c.countryCode === view.countryCode) ?? null)
  const territory = view.level === "territory" ? (activity.territories.find((t) => t.territoryId === view.territoryId) ?? null) : null
  const needStates = country?.countryCode === "US"
  const { world, states } = useShapes(needStates)

  React.useEffect(() => {
    if (webgl !== null) log.info("territory map ready", { renderer, webgl: webgl === true, reduced_motion: reducedMotion })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webgl, renderer])

  // The fly-in finishes, then the flat map takes over while the globe fades out beneath it.
  React.useEffect(() => {
    if (!flyTo) return
    const timer = setTimeout(() => {
      setChosen({ level: "country", countryCode: flyTo.code })
      setFlyTo(null)
      setHandoff(true)
    }, tokenMs("--duration-fly", 560))
    return () => clearTimeout(timer)
  }, [flyTo])
  React.useEffect(() => {
    if (!handoff) return
    const timer = setTimeout(() => setHandoff(false), tokenMs("--duration-drill", 220))
    return () => clearTimeout(timer)
  }, [handoff])

  const go = React.useCallback((next: MapView) => {
    log.info("territory map view", { view: next.level })
    setFlyTo(null)
    setHandoff(false)
    setChosen(next)
  }, [])

  const openCountry = React.useCallback(
    (code: string) => {
      if (renderer === "globe" && view.level === "world") {
        const anchor = countryAnchor(activity, code)
        if (anchor) {
          setFlyTo({ code, lat: anchor.lat, lng: anchor.lng, nonce: Date.now() })
          return
        }
      }
      go({ level: "country", countryCode: code })
    },
    [activity, go, renderer, view.level],
  )

  const openTerritory = React.useCallback((t: GeoTerritory) => go({ level: "territory", countryCode: t.countryCode, territoryId: t.territoryId }), [go])

  const extent = React.useMemo(() => {
    if (view.level === "world") return extentOf(activity.countries.map((c) => c.distinctCalls))
    return extentOf(territoriesIn(activity, view.countryCode).map((t) => t.distinctCalls))
  }, [activity, view])

  const flat = useFlatMapData({ activity, view, world, states, extent, colors, onlyForRenderer: renderer })

  const lit = view.level === "world" ? activity.countries.filter((c) => !c.suppressed).map((c) => c.countryCode) : territoriesIn(activity, view.countryCode).filter((t) => !t.suppressed).map((t) => t.territoryId)
  const anySuppressed = activity.territories.some((t) => t.suppressed) || activity.countries.some((c) => c.suppressed)
  const globeCountries = React.useMemo(
    () =>
      activity.countries.map((c) => {
        const anchor = countryAnchor(activity, c.countryCode) ?? { lat: 0, lng: 0 }
        return {
          code: c.countryCode,
          name: c.countryName,
          color: shade(c, extent, colors),
          lat: anchor.lat,
          lng: anchor.lng,
          label: c.countryCode,
          // The marker visibly reads the ISO code; retain it at the start of the accessible name so the
          // visual label and spoken label describe the same control.
          aria: `${c.countryCode}. ${c.countryName}: ${describeCalls(c)}. Open its map.`,
        }
      }),
    [activity, colors, extent],
  )
  const showGlobe = renderer === "globe" && view.level === "world"
  const globeMounted = showGlobe || (renderer === "globe" && handoff)

  const onRegionClick = (name: string) => {
    if (view.level === "world") {
      if (activity.countries.some((c) => c.countryCode === name)) openCountry(name)
      return
    }
    const inCountry = territoriesIn(activity, view.countryCode)
    const matches = inCountry.filter((t) => (view.countryCode === "US" ? t.subdivisionName === name : view.countryCode === name))
    const pick = matches.find((t) => t.isOwn) ?? matches[0]
    if (pick && (view.countryCode === "US" || matches.length === 1)) openTerritory(pick)
  }

  const crumbs: Array<{ id: string; label: string; to: MapView | null }> = [{ id: "world", label: "World", to: { level: "world" } }]
  if (country) crumbs.push({ id: "country", label: country.countryName, to: { level: "country", countryCode: country.countryCode } })
  if (territory) crumbs.push({ id: "territory", label: territory.name, to: null })

  return (
    <section
      aria-label="Territory map"
      data-testid="territory-map"
      data-renderer={renderer}
      data-view={view.level}
      data-country={country?.countryCode ?? ""}
      data-territory={territory?.territoryId ?? ""}
      data-lit={lit.join(",")}
      data-flying={flyTo ? flyTo.code : ""}
      className={cn("overflow-hidden rounded-2xl border bg-card shadow-card", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3">
        <VStack gap={0.5} className="min-w-0">
          <Heading level={2}>Territory map</Heading>
          <Breadcrumbs label="Map level" variant="supporting" separator={<Icon icon="chevronRight" size="xsm" />}>
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1
              return c.to && !last ? (
                <BreadcrumbItem key={c.id} data-testid={`crumb-${c.id}`} onClick={() => go(c.to!)}>
                  {c.label}
                </BreadcrumbItem>
              ) : (
                <BreadcrumbItem key={c.id} data-testid={c.to ? `crumb-${c.id}` : undefined} isCurrent>
                  {c.label}
                </BreadcrumbItem>
              )
            })}
          </Breadcrumbs>
        </VStack>
        <Text type="supporting" data-testid="map-range">
          Distinct calls · {formatRange({ from: activity.from, to: activity.to })}
        </Text>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="relative h-[22rem] bg-hero-glow sm:h-[30rem]">
          {globeMounted && (
            <div
              data-testid="globe"
              data-handoff={handoff ? "true" : undefined}
              role="application"
              aria-label="Interactive 3D globe. Drag to rotate. Each country with activity has a button; the same countries are listed beside the globe."
              aria-hidden={handoff ? true : undefined}
              className={cn(
                "size-full touch-none motion-safe:animate-in motion-safe:fade-in motion-safe:duration-(--duration-drill) motion-safe:ease-(--ease-out)",
                // Landed: the globe stays under the incoming flat map for one drill beat, fading out and no longer taking taps.
                handoff && "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-(--duration-drill) ease-(--ease-out)",
              )}
            >
              <GlobeBoundary
                onError={() => {
                  setGlobeFailed(true)
                  log.warn("globe failed", { renderer: "globe", status: "error" })
                }}
              >
                <GlobeView
                  shapes={world?.features ?? []}
                  countries={globeCountries}
                  colors={colors}
                  focus={flyTo}
                  onSelectCountry={openCountry}
                  onInterrupt={() => setFlyTo(null)}
                />
              </GlobeBoundary>
            </div>
          )}
          {!showGlobe &&
            (webgl === null || !flat ? (
              !handoff && <BlockSkeleton className="size-full rounded-none" />
            ) : (
              <div key={flat.mapKey} data-testid="flat-map" data-dir={levelMove.dir} className="drill-in relative z-10 size-full">
                <FlatMap
                  mapKey={flat.mapKey}
                  shapes={flat.shapes}
                  regions={flat.regions}
                  markers={flat.markers}
                  frame={flat.frame}
                  colors={colors}
                  animate={!reducedMotion}
                  ariaLabel={flat.ariaLabel}
                  onRegionClick={onRegionClick}
                  onMarkerClick={(id) => {
                    const t = activity.territories.find((x) => x.territoryId === id)
                    if (t) openTerritory(t)
                  }}
                />
              </div>
            ))}
        </div>

        <aside className="flex flex-col gap-4 border-t p-4 lg:border-t-0 lg:border-l" data-testid="map-panel" aria-live="polite">
          <div key={`${view.level}:${country?.countryCode ?? ""}:${territory?.territoryId ?? ""}`} data-dir={levelMove.dir} className="drill-in flex flex-col gap-4">
            <PanelContent
              activity={activity}
              view={view}
              country={country}
              territory={territory}
              onCountry={openCountry}
              onTerritory={openTerritory}
            />
          </div>
          <div className="mt-auto flex flex-col gap-2 border-t pt-3 text-xs text-muted-foreground">
            <Legend extent={extent} colors={colors} />
            {anySuppressed && (
              <HStack gap={1.5} align="center" data-testid="suppression-note">
                <Icon icon={Lock} size="sm" />
                <Text type="supporting">Groups of fewer than 5 calls are hidden for aggregate-only access.</Text>
              </HStack>
            )}
            <Text as="p" type="supporting" display="block">{activity.scopeLabel}</Text>
          </div>
        </aside>
      </div>
    </section>
  )
}

function Legend({ extent, colors }: { extent: ReturnType<typeof extentOf>; colors: MapColors }) {
  return (
    <div data-testid="map-legend" className="flex flex-col gap-1">
      <Text type="supporting" weight="medium" color="primary">Distinct calls</Text>
      <span
        aria-hidden
        className="h-2.5 w-full rounded-full border"
        style={{ background: `linear-gradient(to right, ${colors.low}, ${colors.high})` }}
      />
      <span className="flex justify-between tabular-nums">
        <span>{formatCount(Math.round(extent.min))}</span>
        <span>{formatCount(Math.round(extent.max))}</span>
      </span>
    </div>
  )
}

function Row({ name: textName, label, value, selected, onClick, testId }: { name: string; label: React.ReactNode; value: string; selected?: boolean; onClick: () => void; testId: string }) {
  const content = (
    <HStack justify="between" align="center" gap={3} className="w-full min-w-0">
      <span className="truncate">{label}</span>
      <Text color="inherit" hasTabularNumbers>{value}</Text>
    </HStack>
  )
  // The accessible name is the visible text: the row label and its count.
  const name = `${textName} ${value}`
  return selected === undefined ? (
    <Button data-testid={testId} label={name} width="100%" onClick={onClick}>
      {content}
    </Button>
  ) : (
    <ToggleButton data-testid={testId} label={name} isPressed={selected} onPressedChange={() => onClick()} className="w-full">
      {content}
    </ToggleButton>
  )
}

function PanelContent({
  activity,
  view,
  country,
  territory,
  onCountry,
  onTerritory,
}: {
  activity: GeoActivity
  view: MapView
  country: GeoCountry | null
  territory: GeoTerritory | null
  onCountry: (code: string) => void
  onTerritory: (t: GeoTerritory) => void
}) {
  if (view.level === "world") {
    return (
      <div className="flex flex-col gap-2">
        <HStack gap={1.5} align="center">
          <Icon icon={Globe2} size="sm" color="secondary" />
          <Text type="label" color="secondary" className="uppercase">Countries</Text>
        </HStack>
        <Text as="p" type="supporting" display="block">Tap a country to open its map.</Text>
        <ul className="flex flex-col gap-1.5">
          {activity.countries.map((c) => (
            <li key={c.countryCode}>
              <Row
                testId={`country-option-${c.countryCode}`}
                name={c.countryName}
                label={c.countryName}
                value={c.suppressed || c.distinctCalls === null ? "hidden" : formatCount(c.distinctCalls)}
                onClick={() => onCountry(c.countryCode)}
              />
            </li>
          ))}
        </ul>
      </div>
    )
  }
  const inCountry = territoriesIn(activity, view.countryCode)
  return (
    <div className="flex flex-col gap-4">
      {territory ? (
        <div data-testid="territory-detail" className="flex flex-col gap-1">
          <Text as="p" type="label" color="secondary" display="block" className="uppercase">{territory.regionName}</Text>
          <Text as="p" type="large" weight="semibold" display="block">
            {territory.name}{" "}
            <Text type="code" color="secondary">{territory.territoryId}</Text>
          </Text>
          <HStack gap={1} align="center">
            <Icon icon={MapPin} size="sm" color="secondary" />
            <Text type="supporting">{territory.subdivisionName}, {territory.countryName}</Text>
          </HStack>
          <Text as="p" type="display-2" weight="semibold" hasTabularNumbers display="block" className="mt-2" data-testid="territory-calls">
            {territory.suppressed || territory.distinctCalls === null ? "Hidden" : formatCount(territory.distinctCalls)}
          </Text>
          <Text as="p" type="supporting" display="block">{territory.suppressed ? "Fewer than 5 distinct calls" : "Distinct calls"}</Text>
          {territory.isOwn && (
            <div className="mt-1 w-fit">
              <Badge variant="info" icon={<Icon icon={Navigation} size="xsm" />} label="Your territory" />
            </div>
          )}
        </div>
      ) : (
        country && (
          <div data-testid="country-detail" className="flex flex-col gap-1">
            <Text as="p" type="large" weight="semibold" display="block">{country.countryName}</Text>
            <Text as="p" type="display-2" weight="semibold" hasTabularNumbers display="block" data-testid="country-calls">
              {country.suppressed || country.distinctCalls === null ? "Hidden" : formatCount(country.distinctCalls)}
            </Text>
            <Text as="p" type="supporting" display="block">
              Distinct calls across {country.territoryCount} {country.territoryCount === 1 ? "territory" : "territories"}
            </Text>
          </div>
        )
      )}
      <div className="flex flex-col gap-2">
        <Text as="p" type="label" color="secondary" display="block" className="uppercase">Territories</Text>
        <ul className="flex flex-col gap-1.5">
          {inCountry.map((t) => (
            <li key={t.territoryId}>
              <Row
                testId={`territory-option-${t.territoryId}`}
                name={`${t.name} ${t.subdivisionCode}`}
                label={
                  <>
                    {t.name} <Text type="supporting">· {t.subdivisionCode}</Text>
                  </>
                }
                value={t.suppressed || t.distinctCalls === null ? "hidden" : formatCount(t.distinctCalls)}
                selected={territory?.territoryId === t.territoryId}
                onClick={() => onTerritory(t)}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** What the flat map draws for the current level; null until the needed shapes have loaded. */
function useFlatMapData({
  activity,
  view,
  world,
  states,
  extent,
  colors,
  onlyForRenderer,
}: {
  activity: GeoActivity
  view: MapView
  world: Shapes | null
  states: Shapes | null
  extent: ReturnType<typeof extentOf>
  colors: MapColors
  onlyForRenderer: "globe" | "flat"
}): MapData | null {
  const worldBox = React.useMemo(() => (world ? boxOfFeatures(world.features) : null), [world])
  const usBox = React.useMemo(() => (states ? boxOfFeatures(states.features) : null), [states])

  const countryShape = React.useMemo(() => {
    if (view.level === "world" || view.countryCode === "US" || !world) return null
    const base = world.features.find((f) => f.properties.name === view.countryCode)
    if (!base) return null
    const points = territoriesIn(activity, view.countryCode).map((t) => [t.longitude, t.latitude] as const)
    return { type: "FeatureCollection" as const, features: [nearPoints(base, points)] }
  }, [activity, view, world])

  const worldFrame = React.useMemo(() => {
    if (!world || !worldBox || view.level !== "world") return null
    const boxes = activity.countries.flatMap((c) => {
      const base = world.features.find((f) => f.properties.name === c.countryCode)
      if (!base) return []
      const points = territoriesIn(activity, c.countryCode).map((t) => [t.longitude, t.latitude] as const)
      const b = boxOfFeatures([nearPoints(base, points, 20)])
      return b ? [b] : []
    })
    const target = unionBox(boxes)
    return target ? framing(worldBox, target, 0.8, 6) : null
  }, [activity, view.level, world, worldBox])

  return React.useMemo<MapData | null>(() => {
    if (onlyForRenderer === "globe" && view.level === "world") return null
    if (view.level === "world") {
      if (!world) return null
      return {
        mapKey: "a2g-world",
        shapes: world,
        regions: activity.countries.map((c) => ({
          name: c.countryCode,
          color: shade(c, extent, colors),
          label: c.countryCode,
          tooltip: `${c.countryName}: ${describeCalls(c)}`,
        })),
        markers: [],
        frame: worldFrame,
        ariaLabel: `Map of the world. Countries with activity: ${activity.countries.map((c) => `${c.countryName}, ${describeCalls(c)}`).join("; ")}.`,
      }
    }
    const own = territoriesIn(activity, view.countryCode)
    const selectedId = view.level === "territory" ? view.territoryId : null
    if (view.countryCode === "US") {
      if (!states || !usBox) return null
      const lit = new Set(own.map((t) => t.subdivisionName))
      const picked = own.find((t) => t.territoryId === selectedId)
      // Drilling into a territory zooms onto its state; otherwise frame everything in scope.
      const boxes = boxOfFeatures(states.features.filter((f) => (picked ? f.properties.name === picked.subdivisionName : lit.has(f.properties.name))))
      return {
        mapKey: "a2g-us",
        shapes: states,
        regions: own.map((t) => ({
          name: t.subdivisionName,
          color: shade(t, extent, colors),
          label: t.subdivisionCode,
          selected: t.territoryId === selectedId,
          tooltip: `${t.name}, ${t.subdivisionName}: ${describeCalls(t)}`,
        })),
        markers: [],
        frame: boxes ? (picked ? framing(usBox, boxes, 0.55, 9) : framing(usBox, boxes, 0.7, 4.5)) : null,
        ariaLabel: `Map of the United States. States with activity: ${own.map((t) => `${t.subdivisionName}, ${describeCalls(t)}`).join("; ")}.`,
      }
    }
    if (!countryShape) return null
    const country = activity.countries.find((c) => c.countryCode === view.countryCode)
    const picked = own.find((t) => t.territoryId === selectedId)
    return {
      mapKey: `a2g-country-${view.countryCode}`,
      shapes: countryShape,
      regions: country ? [{ name: view.countryCode, color: shade(country, extent, colors), tooltip: `${country.countryName}: ${describeCalls(country)}` }] : [],
      markers: own.map((t) => ({
        id: t.territoryId,
        name: t.name,
        lon: t.longitude,
        lat: t.latitude,
        color: colors.popover,
        selected: t.territoryId === selectedId,
        tooltip: `${t.name}, ${t.subdivisionName}: ${describeCalls(t)}`,
      })),
      frame: picked ? { zoom: 3, center: [picked.longitude, picked.latitude] } : null,
      ariaLabel: `Map of ${country?.countryName ?? view.countryCode}. Territories: ${own.map((t) => `${t.name}, ${describeCalls(t)}`).join("; ")}.`,
    }
  }, [activity, colors, countryShape, extent, onlyForRenderer, states, usBox, view, world, worldFrame])
}
