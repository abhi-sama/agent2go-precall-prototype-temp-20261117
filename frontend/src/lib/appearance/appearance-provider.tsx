"use client"

import { LinkProvider } from "@astryxdesign/core/Link"
import { Theme } from "@astryxdesign/core/theme"
import NextLink from "next/link"
import * as React from "react"
import { toast } from "sonner"
import { themes } from "./astryx-registry"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { AppearanceChoice, DensityPref, ModePref, StylePref } from "@/lib/data/types"
import { log, newCorrelationId } from "@/lib/log/logger"
import { useSession } from "@/lib/session/session-provider"
import {
  DARK_ONLY_THEMES,
  DEFAULT_THEME,
  THEME_SLUGS,
  isThemeSlug,
  type ColorSchemePref,
  type ResolvedScheme,
  type ThemeSlug,
} from "./themes"

export type { DensityPref, ModePref, StylePref }
export type ResolvedDensity = "comfortable" | "compact"

/**
 * Device-local copy of one person's saved choice. The server (FE DynamoDB) is the record for mode and density;
 * the Astryx theme is a device-local preference kept here, per person.
 */
export const APPEARANCE_STORAGE_KEY = "a2g.appearance"
/** The look last applied on this device, whoever chose it. Paints signed-out pages and anyone whose choice is not known yet. */
export const DEVICE_APPEARANCE_KEY = "a2g.device-appearance"
/** Each person's Astryx theme on this device, `{ [userId]: slug }`, so it survives someone else using the device. */
export const THEME_BY_USER_KEY = "a2g.themes"
/** Local builds keep the quick-switch identity here; the boot script reads it to pick the right person's cache. */
const LOCAL_USER_KEY = "a2g.local.userId"

interface Cached extends AppearanceChoice {
  /** Whose choice this is. A different signed-in person never inherits it. */
  uid: string | null
  /** The Astryx theme. Null means the default theme. */
  theme: ThemeSlug | null
}

interface DeviceAppearance {
  theme: ThemeSlug
  scheme: ColorSchemePref
  density: DensityPref
}

const DEFAULTS: AppearanceChoice = { style: "auto", mode: "device", density: "auto" }
const EMPTY: Cached = { ...DEFAULTS, uid: null, theme: null }
const DEVICE_DEFAULT: DeviceAppearance = { theme: DEFAULT_THEME, scheme: "system", density: "auto" }

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

/** The saved server mode as the scheme the page shows. Charcoal and the retired true black are both dark. */
export const schemeFromMode = (mode: ModePref): ColorSchemePref => (mode === "light" ? "light" : mode === "device" ? "system" : "dark")
/** The scheme a person picks, as the server's mode value. Dark keeps a saved true black instead of overwriting it. */
const modeFromScheme = (scheme: ColorSchemePref, current: ModePref): ModePref =>
  scheme === "light" ? "light" : scheme === "system" ? "device" : current === "black" || current === "charcoal" ? current : "charcoal"

function parse(raw: string | null): Cached {
  if (!raw) return EMPTY
  try {
    const v = JSON.parse(raw) as Record<string, unknown>
    // `black: true` is the pre-D1 shape.
    const legacyBlack = v.mode === undefined && v.black === true
    return {
      uid: typeof v.uid === "string" ? v.uid : null,
      style: oneOf(v.style, ["auto", "warm", "clinical"] as const, "auto"),
      density: oneOf(v.density, ["auto", "comfortable", "compact"] as const, "auto"),
      mode: legacyBlack ? "black" : oneOf(v.mode, ["device", "light", "charcoal", "black"] as const, "device"),
      theme: isThemeSlug(v.theme) ? v.theme : null,
    }
  } catch {
    return EMPTY
  }
}

function parseDevice(raw: string | null): DeviceAppearance | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Record<string, unknown>
    return {
      theme: isThemeSlug(v.theme) ? v.theme : DEFAULT_THEME,
      scheme: oneOf(v.scheme, ["system", "light", "dark"] as const, "system"),
      density: oneOf(v.density, ["auto", "comfortable", "compact"] as const, "auto"),
    }
  } catch {
    return null
  }
}

/**
 * Runs before first paint (inline at the top of <body>), so the saved theme, colour scheme and density apply with no
 * flash (Modern Web Guidance: dark-mode-toggle). It writes, on <html>:
 *   data-astryx-theme   the Astryx theme slug (the root <Theme> wrapper copies it, see THEME_ROOT_SCRIPT)
 *   data-color-scheme   "light" | "dark" when the person pinned one; absent follows the device
 *   class "dark"        the resolved scheme, for code that reads it (charts, legacy tests)
 *   data-density        "comfortable" | "compact"
 * It reads the person's own cached choice when the local quick-switch identity proves whose it is, else the look last
 * applied on this device. Another person's cached choice is never used. The theme is the person's own entry in
 * THEME_BY_USER_KEY when the quick-switch identity is known.
 */
export function bootScript() {
  return `try{var L=localStorage,d=document.documentElement,T=${JSON.stringify(THEME_SLUGS)},a=JSON.parse(L.getItem("${APPEARANCE_STORAGE_KEY}")||"{}")||{},D=JSON.parse(L.getItem("${DEVICE_APPEARANCE_KEY}")||"null"),u=L.getItem("${LOCAL_USER_KEY}"),m=u&&a.uid===u?a:D?D:!u||!a.uid?a:{},k=m.scheme||(m.mode==="light"?"light":m.mode==="charcoal"||m.mode==="black"||(m.mode===undefined&&m.black===true)?"dark":"system"),P=JSON.parse(L.getItem("${THEME_BY_USER_KEY}")||"{}")||{},t=u&&T.indexOf(P[u])>=0?P[u]:T.indexOf(m.theme)>=0?m.theme:"${DEFAULT_THEME}";if(${JSON.stringify([...DARK_ONLY_THEMES])}.indexOf(t)>=0)k="dark";d.setAttribute("data-astryx-theme",t);if(k==="light"||k==="dark")d.setAttribute("data-color-scheme",k);else d.removeAttribute("data-color-scheme");d.classList.toggle("dark",k==="dark"||(k!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches));d.dataset.density=m.density==="comfortable"||m.density==="compact"?m.density:(matchMedia("(pointer: coarse)").matches?"comfortable":"compact")}catch(e){}`
}

export const APPEARANCE_BOOT_SCRIPT = bootScript()

/**
 * The first child of the root <Theme> wrapper. The server renders that wrapper with the default theme; this copies the
 * boot script's theme onto it while the HTML is still parsing, so the first paint already uses the saved theme. The
 * client's hydration render reads the same value (`readBootTheme`), so the attributes match and React keeps them.
 */
export const THEME_ROOT_SCRIPT = `try{var p=document.currentScript&&document.currentScript.parentElement,t=document.documentElement.getAttribute("data-astryx-theme");if(p&&t)p.setAttribute("data-astryx-theme",t)}catch(e){}`

function readBootTheme(): ThemeSlug {
  if (typeof document === "undefined") return DEFAULT_THEME
  const value = document.documentElement.getAttribute("data-astryx-theme")
  return isThemeSlug(value) ? value : DEFAULT_THEME
}

// The device-local copies as external stores: server render and hydration see the defaults, the client then reads storage.
const listeners = new Set<() => void>()
const rawCache = new Map<string, string | null | undefined>()
let lastParsed: Cached = EMPTY
let lastDevice: DeviceAppearance | null = null

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
function snapshot(): Cached {
  const raw = readRaw(APPEARANCE_STORAGE_KEY)
  if (raw !== rawCache.get(APPEARANCE_STORAGE_KEY)) {
    rawCache.set(APPEARANCE_STORAGE_KEY, raw)
    lastParsed = parse(raw)
  }
  return lastParsed
}
let lastThemes: Record<string, ThemeSlug> = {}
function themesSnapshot(): Record<string, ThemeSlug> {
  const raw = readRaw(THEME_BY_USER_KEY)
  if (raw !== rawCache.get(THEME_BY_USER_KEY)) {
    rawCache.set(THEME_BY_USER_KEY, raw)
    try {
      const parsed = JSON.parse(raw ?? "{}") as Record<string, unknown>
      lastThemes = Object.fromEntries(Object.entries(parsed ?? {}).filter((entry): entry is [string, ThemeSlug] => isThemeSlug(entry[1])))
    } catch {
      lastThemes = {}
    }
  }
  return lastThemes
}
const NO_THEMES: Record<string, ThemeSlug> = {}
function deviceSnapshot(): DeviceAppearance | null {
  const raw = readRaw(DEVICE_APPEARANCE_KEY)
  if (raw !== rawCache.get(DEVICE_APPEARANCE_KEY)) {
    rawCache.set(DEVICE_APPEARANCE_KEY, raw)
    lastDevice = parseDevice(raw)
  }
  return lastDevice
}
function subscribe(cb: () => void) {
  listeners.add(cb)
  // Another tab changing the look keeps this one in sync (MWG dark-mode-toggle).
  window.addEventListener("storage", cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener("storage", cb)
  }
}
function write(key: string, value: object) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode: the choice lasts for this visit only.
    rawCache.set(key, undefined)
    if (key === APPEARANCE_STORAGE_KEY) lastParsed = value as Cached
    else if (key === THEME_BY_USER_KEY) lastThemes = value as Record<string, ThemeSlug>
    else lastDevice = value as DeviceAppearance
  }
  listeners.forEach((cb) => cb())
}

const COARSE = "(pointer: coarse)"
const DARK_QUERY = "(prefers-color-scheme: dark)"
/**
 * Pointer capability is the density source of truth, but iPad Safari can recalculate media capabilities while a
 * viewport rotates. Subscribe to those viewport events as well as the media-query event.
 */
function subscribeDensity(onChange: () => void) {
  const mql = window.matchMedia(COARSE)
  mql.addEventListener("change", onChange)
  window.addEventListener("resize", onChange)
  window.addEventListener("orientationchange", onChange)
  return () => {
    mql.removeEventListener("change", onChange)
    window.removeEventListener("resize", onChange)
    window.removeEventListener("orientationchange", onChange)
  }
}
/** The device scheme can change at any time (many devices switch at dusk), so it is a live subscription. */
function subscribeDeviceDark(onChange: () => void) {
  const mql = window.matchMedia(DARK_QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}
const noopSubscribe = () => () => {}

interface AppearanceValue {
  /** The Astryx theme in use. */
  theme: ThemeSlug
  /** The scheme the person chose; `system` follows the device. Locked to dark for a dark-only theme. */
  colorScheme: ColorSchemePref
  /** What is on screen now. */
  resolvedScheme: ResolvedScheme
  /** What the device prefers, shown beside "System" so the choice is concrete. */
  deviceScheme: ResolvedScheme
  /** True when the active theme only exists in dark. */
  isDarkOnly: boolean
  density: DensityPref
  resolvedDensity: ResolvedDensity
  setTheme: (theme: ThemeSlug) => void
  setColorScheme: (scheme: ColorSchemePref) => void
  setDensity: (density: DensityPref) => void
}

const AppearanceContext = React.createContext<AppearanceValue | null>(null)

/**
 * Owns the look of the app: the Astryx theme, light/dark/system and density. Renders the root Astryx `<Theme>`, so
 * every Astryx component and every legacy token alias (globals.css) follows the choice.
 */
export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const { userId, ready } = useSession()
  const adapter = useDataAdapter()
  const cached = React.useSyncExternalStore(subscribe, snapshot, () => EMPTY)
  const device = React.useSyncExternalStore(subscribe, deviceSnapshot, () => null)
  const themesByUser = React.useSyncExternalStore(subscribe, themesSnapshot, () => NO_THEMES)
  const coarse = React.useSyncExternalStore(subscribeDensity, () => window.matchMedia(COARSE).matches, () => false)
  const deviceDark = React.useSyncExternalStore(subscribeDeviceDark, () => window.matchMedia(DARK_QUERY).matches, () => false)
  const hydrated = React.useSyncExternalStore(noopSubscribe, () => true, () => false)
  // What the boot script painted. The hydration render must use it, so the wrapper's attributes match the page.
  const [bootTheme] = React.useState(readBootTheme)

  // The cache belongs to one person. Anyone else (or nobody yet) sees the look last applied on this device.
  const mine = cached.uid === userId || (cached.uid === null && cached !== EMPTY)
  const known = mine && cached !== EMPTY
  const fallback = device ?? DEVICE_DEFAULT
  const theme: ThemeSlug = (userId ? themesByUser[userId] : undefined) ?? (known ? (cached.theme ?? DEFAULT_THEME) : fallback.theme)
  const isDarkOnly = DARK_ONLY_THEMES.has(theme)
  const chosenScheme: ColorSchemePref = known ? schemeFromMode(cached.mode) : fallback.scheme
  const colorScheme: ColorSchemePref = isDarkOnly ? "dark" : chosenScheme
  const resolvedScheme: ResolvedScheme = colorScheme === "system" ? (deviceDark ? "dark" : "light") : colorScheme
  const density: DensityPref = known ? cached.density : fallback.density
  const resolvedDensity: ResolvedDensity = density === "auto" ? (coarse ? "comfortable" : "compact") : density
  // A choice made before any session exists (the sign-in page) applies at once.
  const [chosenWhileSignedOut, setChosenWhileSignedOut] = React.useState(false)
  // Before hydration and until the session is known, keep what the boot script painted.
  const live = hydrated && (ready || chosenWhileSignedOut)

  // The adapter saves for whoever is signed in when the request goes out, so a save is dropped if the person changed
  // while it waited (a quick persona switch must never write one person's choice onto another).
  const currentUser = React.useRef(userId)
  React.useEffect(() => {
    currentUser.current = userId
  }, [userId])
  // Saves are queued one at a time and the newest wins, so quick successive taps never save out of order.
  const saving = React.useRef<{ running: boolean; next: { choice: AppearanceChoice; owner: string } | null }>({ running: false, next: null })
  const save = React.useCallback(
    async (choice: AppearanceChoice, owner: string) => {
      const slot = saving.current
      slot.next = { choice, owner }
      if (slot.running) return
      slot.running = true
      let failed = false
      while (slot.next) {
        const { choice: sending, owner: sendingFor } = slot.next
        slot.next = null
        if (sendingFor !== currentUser.current) continue
        const correlationId = newCorrelationId()
        try {
          await adapter.setAppearance({ correlationId }, sending)
          failed = false
        } catch (err) {
          failed = true
          log.child(correlationId).warn("appearance save failed", { error_code: (err as { code?: string }).code ?? "UNKNOWN" })
        }
      }
      slot.running = false
      if (failed) toast.error("Couldn't save your appearance. It still applies on this device.", { id: "appearance-save-failed" })
    },
    [adapter],
  )

  const update = React.useCallback(
    (patch: Partial<Cached>, sendToServer: boolean) => {
      const base = snapshot()
      const owned = base.uid === userId || (base.uid === null && base !== EMPTY)
      const dev = deviceSnapshot() ?? DEVICE_DEFAULT
      // Someone with no cached choice yet starts from what this device shows, so one change does not reset the rest.
      const from: Cached = owned ? base : { ...EMPTY, uid: userId, theme: dev.theme, mode: modeFromScheme(dev.scheme, "device"), density: dev.density }
      const next: Cached = { ...from, ...patch, uid: userId }
      if (!ready) setChosenWhileSignedOut(true)
      write(APPEARANCE_STORAGE_KEY, next)
      // Signed out (the sign-in page) there is no account to save to; the choice stays on this device.
      if (sendToServer && userId) void save({ style: next.style, mode: next.mode, density: next.density }, userId)
    },
    [save, userId, ready],
  )

  // Load this person's saved choice once the session knows who they are. A saved choice from this device that was
  // never uploaded (made before it could be saved) is uploaded once.
  React.useEffect(() => {
    if (!ready || !userId) return
    let cancelled = false
    const correlationId = newCorrelationId()
    adapter
      .myAppearance({ correlationId })
      .then((saved) => {
        if (cancelled) return
        const base = snapshot()
        const owned = base.uid === userId || (base.uid === null && base !== EMPTY)
        if (saved) {
          write(APPEARANCE_STORAGE_KEY, { ...(owned ? base : EMPTY), style: saved.style, mode: saved.mode, density: saved.density, uid: userId })
        } else if (owned && (base.style !== "auto" || base.density !== "auto" || base.mode !== "device")) {
          write(APPEARANCE_STORAGE_KEY, { ...base, uid: userId })
          void save({ style: base.style, mode: base.mode, density: base.density }, userId)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        log.child(correlationId).warn("appearance load failed", { error_code: (err as { code?: string }).code ?? "UNKNOWN" })
      })
    return () => {
      cancelled = true
    }
  }, [adapter, ready, userId, save])

  // Apply to <html>. Not before the session is ready: the boot script has already painted the right look, and the
  // placeholder session must not overwrite it. The root <Theme> owns data-astryx-theme and data-theme itself.
  React.useEffect(() => {
    if (!live) return
    const root = document.documentElement
    if (colorScheme === "system") root.removeAttribute("data-color-scheme")
    else root.setAttribute("data-color-scheme", colorScheme)
    root.classList.toggle("dark", resolvedScheme === "dark")
    root.dataset.density = resolvedDensity
  }, [live, colorScheme, resolvedScheme, resolvedDensity])

  // Remember the look this device shows, so the next load (and a signed-out page) paints it before the session loads.
  React.useEffect(() => {
    if (!live) return
    const current = deviceSnapshot()
    if (current && current.theme === theme && current.scheme === chosenScheme && current.density === density) return
    write(DEVICE_APPEARANCE_KEY, { theme, scheme: chosenScheme, density } satisfies DeviceAppearance)
  }, [live, theme, chosenScheme, density])

  const value = React.useMemo<AppearanceValue>(
    () => ({
      theme,
      colorScheme,
      resolvedScheme,
      deviceScheme: deviceDark ? "dark" : "light",
      isDarkOnly,
      density,
      resolvedDensity,
      setTheme: (next) => {
        if (userId) write(THEME_BY_USER_KEY, { ...themesSnapshot(), [userId]: next })
        update({ theme: next }, false)
      },
      setColorScheme: (next) => update({ mode: modeFromScheme(next, snapshot().mode) }, true),
      setDensity: (next) => update({ density: next }, true),
    }),
    [theme, colorScheme, resolvedScheme, deviceDark, isDarkOnly, density, resolvedDensity, update, userId],
  )

  const renderTheme = live ? theme : bootTheme
  // Hydration renders "system" (the server cannot know the choice); globals.css pins the wrapper to the boot
  // script's data-color-scheme until then, so nothing flashes.
  const renderMode = live ? colorScheme : "system"

  return (
    <AppearanceContext.Provider value={value}>
      <Theme theme={themes[renderTheme]} mode={renderMode}>
        <script dangerouslySetInnerHTML={{ __html: THEME_ROOT_SCRIPT }} />
        {/* Every Astryx link (SideNavItem, Button href, Link) navigates client-side through Next.js. */}
        <LinkProvider component={NextLink}>{children}</LinkProvider>
      </Theme>
    </AppearanceContext.Provider>
  )
}

export function useAppearance(): AppearanceValue {
  const value = React.useContext(AppearanceContext)
  if (!value) throw new Error("useAppearance must be used inside AppearanceProvider")
  return value
}
