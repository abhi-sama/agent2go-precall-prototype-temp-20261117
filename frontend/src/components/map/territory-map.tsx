"use client"

import { ChevronRight, Globe2, Lock, MapPin, Navigation } from "lucide-react"
import dynamic from "next/dynamic"
import * as React from "react"
import { BlockSkeleton } from "@/components/state/states"
import { useDocumentTheme } from "@/hooks/use-document-theme"
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
  const colors = React.useMemo(() => readMapColors(theme), [theme])
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
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">Territory map</h2>
          <nav aria-label="Map level" className="mt-0.5 flex flex-wrap items-center gap-0.5 text-sm">
            {crumbs.map((c, i) => (
              <React.Fragment key={c.id}>
                {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />}
                {c.to ? (
                  <button
                    type="button"
                    data-testid={`crumb-${c.id}`}
                    aria-current={i === crumbs.length - 1 ? "location" : undefined}
                    disabled={i === crumbs.length - 1 && crumbs.length === 1}
                    onClick={() => go(c.to!)}
                    className={cn(
                      "-mx-1 inline-flex min-h-11 items-center rounded-lg px-2 font-medium hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent",
                      i === crumbs.length - 1 ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {c.label}
                  </button>
                ) : (
                  <span aria-current="location" className="px-2 font-medium">
                    {c.label}
                  </span>
                )}
              </React.Fragment>
            ))}
          </nav>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="map-range">
          Distinct calls · {formatRange({ from: activity.from, to: activity.to })}
        </p>
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
              <p className="flex items-center gap-1.5" data-testid="suppression-note">
                <Lock className="size-3.5 shrink-0" aria-hidden />
                Groups of fewer than 5 calls are hidden for aggregate-only access.
              </p>
            )}
            <p>{activity.scopeLabel}</p>
          </div>
        </aside>
      </div>
    </section>
  )
}

function Legend({ extent, colors }: { extent: ReturnType<typeof extentOf>; colors: MapColors }) {
  return (
    <div data-testid="map-legend" className="flex flex-col gap-1">
      <span className="font-medium text-foreground">Distinct calls</span>
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

function Row({ children, selected, onClick, testId }: { children: React.ReactNode; selected?: boolean; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-3 text-left text-sm font-medium",
        selected ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted",
      )}
    >
      {children}
    </button>
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
        <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <Globe2 className="size-3.5" aria-hidden /> Countries
        </p>
        <p className="text-sm text-muted-foreground">Tap a country to open its map.</p>
        <ul className="flex flex-col gap-1.5">
          {activity.countries.map((c) => (
            <li key={c.countryCode}>
              <Row testId={`country-option-${c.countryCode}`} onClick={() => onCountry(c.countryCode)}>
                <span className="truncate">{c.countryName}</span>
                <span className="text-xs font-normal text-muted-foreground tabular-nums">{c.suppressed || c.distinctCalls === null ? "hidden" : formatCount(c.distinctCalls)}</span>
              </Row>
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
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{territory.regionName}</p>
          <p className="text-lg font-semibold tracking-tight">
            {territory.name}{" "}
            <span className="font-mono text-xs font-normal text-muted-foreground">{territory.territoryId}</span>
          </p>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="size-3.5" aria-hidden /> {territory.subdivisionName}, {territory.countryName}
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums" data-testid="territory-calls">
            {territory.suppressed || territory.distinctCalls === null ? "Hidden" : formatCount(territory.distinctCalls)}
          </p>
          <p className="text-xs text-muted-foreground">{territory.suppressed ? "Fewer than 5 distinct calls" : "Distinct calls"}</p>
          {territory.isOwn && (
            <p className="mt-1 flex w-fit items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
              <Navigation className="size-3" aria-hidden /> Your territory
            </p>
          )}
        </div>
      ) : (
        country && (
          <div data-testid="country-detail" className="flex flex-col gap-1">
            <p className="text-lg font-semibold tracking-tight">{country.countryName}</p>
            <p className="text-3xl font-semibold tracking-tight tabular-nums" data-testid="country-calls">
              {country.suppressed || country.distinctCalls === null ? "Hidden" : formatCount(country.distinctCalls)}
            </p>
            <p className="text-xs text-muted-foreground">
              Distinct calls across {country.territoryCount} {country.territoryCount === 1 ? "territory" : "territories"}
            </p>
          </div>
        )
      )}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Territories</p>
        <ul className="flex flex-col gap-1.5">
          {inCountry.map((t) => (
            <li key={t.territoryId}>
              <Row testId={`territory-option-${t.territoryId}`} selected={territory?.territoryId === t.territoryId} onClick={() => onTerritory(t)}>
                <span className="truncate">
                  {t.name} <span className="font-normal text-muted-foreground">· {t.subdivisionCode}</span>
                </span>
                <span className="text-xs font-normal text-muted-foreground tabular-nums">{t.suppressed || t.distinctCalls === null ? "hidden" : formatCount(t.distinctCalls)}</span>
              </Row>
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
