"use client"

import { useTheme } from "next-themes"
import * as React from "react"
import { toast } from "sonner"
import { useDataAdapter } from "@/lib/data/data-provider"
import { USERS } from "@/lib/data/fixtures"
import type { AppearanceChoice, DensityPref, ModePref, Persona, StylePref } from "@/lib/data/types"
import { IS_LOCAL_BUILD } from "@/lib/env"
import { log, newCorrelationId } from "@/lib/log/logger"
import { useSession } from "@/lib/session/session-provider"

export type { DensityPref, ModePref, StylePref }
export type ResolvedStyle = "warm" | "clinical"
export type ResolvedDensity = "comfortable" | "compact"
/** The dark flavour a Light/Dark flip goes back to. */
export type DarkMode = "charcoal" | "black"

/** Device-local copy of the saved choice. The server (FE DynamoDB) is the record; this makes first paint instant. */
export const APPEARANCE_STORAGE_KEY = "a2g.appearance"
/** Local builds keep the quick-switch identity here; the boot script reads it to pick the right persona style. */
const LOCAL_USER_KEY = "a2g.local.userId"

/** MSL works in the field and gets the warm style; the oversight personas get the clinical one. */
export const PERSONA_STYLE: Record<Persona, ResolvedStyle> = {
  msl: "warm",
  director: "clinical",
  executive: "clinical",
  admin: "clinical",
}

interface Cached extends AppearanceChoice {
  /** Whose choice this is. A different signed-in person never inherits it. */
  uid: string | null
  /** The style that was actually shown last time, so a persona default also paints correctly before the session loads. */
  resolvedStyle: ResolvedStyle | null
  /** Last dark flavour picked on this device; used when flipping from Light back to dark. */
  dark: DarkMode
}

const DEFAULTS: AppearanceChoice = { style: "auto", mode: "device", density: "auto" }
const EMPTY: Cached = { ...DEFAULTS, uid: null, resolvedStyle: null, dark: "charcoal" }

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

function parse(raw: string | null): Cached {
  if (!raw) return EMPTY
  try {
    const v = JSON.parse(raw) as Record<string, unknown>
    // `black: true` is the pre-D1 shape; the mode was then held by next-themes alone.
    const legacyBlack = v.mode === undefined && v.black === true
    const mode = legacyBlack ? "black" : oneOf(v.mode, ["device", "light", "charcoal", "black"] as const, "device")
    return {
      uid: typeof v.uid === "string" ? v.uid : null,
      style: oneOf(v.style, ["auto", "warm", "clinical"] as const, "auto"),
      density: oneOf(v.density, ["auto", "comfortable", "compact"] as const, "auto"),
      mode,
      resolvedStyle: v.resolvedStyle === "warm" || v.resolvedStyle === "clinical" ? v.resolvedStyle : null,
      dark: v.dark === "black" || mode === "black" ? "black" : "charcoal",
    }
  } catch {
    return EMPTY
  }
}

/**
 * Runs before first paint (inline in the root layout), so the saved style, mode and density apply with no flash.
 * It also sets the `dark` class itself (next-themes' own script sits later in the body and can lose the race with the first paint).
 * It picks the style from, in order: an explicit saved style, the persona of the local quick-switch user, the style
 * shown last time. It also sets next-themes' `theme` from the saved mode, because next-themes' own script reads it next.
 * Another person's cached choice (different uid) is ignored.
 */
export function bootScript(localPersonaStyles: Record<string, ResolvedStyle>) {
  return `try{var K="${APPEARANCE_STORAGE_KEY}",L=localStorage,d=document.documentElement,a=JSON.parse(L.getItem(K)||"{}"),u=L.getItem("${LOCAL_USER_KEY}"),P=${JSON.stringify(localPersonaStyles)},m=!u||!a.uid||a.uid===u?a:{},s=m.style==="warm"||m.style==="clinical"?m.style:(u&&P[u])||(m.resolvedStyle==="warm"||m.resolvedStyle==="clinical"?m.resolvedStyle:null),k=m.mode||(m.black===true?"black":null);d.dataset.density=m.density==="comfortable"||m.density==="compact"?m.density:(matchMedia("(pointer: coarse)").matches?"comfortable":"compact");if(s)d.dataset.style=s;if(k)L.setItem("theme",k==="light"?"light":k==="device"?"system":"dark");var t=L.getItem("theme"),x=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);d.classList.toggle("dark",x);d.style.colorScheme=x?"dark":"light";if(k==="black"&&x)d.dataset.mode="black"}catch(e){}`
}

export const APPEARANCE_BOOT_SCRIPT = bootScript(
  IS_LOCAL_BUILD ? Object.fromEntries(USERS.map((u) => [u.userId, PERSONA_STYLE[u.persona]])) : {},
)

// The device-local copy as an external store: server render and hydration see EMPTY, the client then reads storage.
const listeners = new Set<() => void>()
let lastRaw: string | null | undefined
let lastParsed: Cached = EMPTY

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(APPEARANCE_STORAGE_KEY)
  } catch {
    return null
  }
}
function snapshot(): Cached {
  const raw = readRaw()
  if (raw !== lastRaw) {
    lastRaw = raw
    lastParsed = parse(raw)
  }
  return lastParsed
}
function subscribe(cb: () => void) {
  listeners.add(cb)
  window.addEventListener("storage", cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener("storage", cb)
  }
}
function writeCache(next: Cached) {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Private mode: the choice lasts for this visit only.
    lastRaw = undefined
    lastParsed = next
  }
  listeners.forEach((cb) => cb())
}

const COARSE = "(pointer: coarse)"
/**
 * Pointer capability is the density source of truth, but iPad Safari can recalculate media
 * capabilities while a viewport rotates. Subscribe to those viewport events as well as the
 * media-query event so an automatic preference is always re-resolved without a reload.
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

const themeFor = (mode: ModePref) => (mode === "light" ? "light" : mode === "device" ? "system" : "dark")
const modeFromTheme = (theme: string | undefined): ModePref => (theme === "light" ? "light" : theme === "dark" ? "charcoal" : "device")

interface AppearanceValue {
  mode: ModePref
  style: StylePref
  density: DensityPref
  resolvedStyle: ResolvedStyle
  resolvedDensity: ResolvedDensity
  /** Dark flavour to return to when flipping Light -> dark. */
  darkMode: DarkMode
  setMode: (mode: ModePref) => void
  setStyle: (style: StylePref) => void
  setDensity: (density: DensityPref) => void
}

const AppearanceContext = React.createContext<AppearanceValue | null>(null)

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const { user, userId, ready } = useSession()
  const adapter = useDataAdapter()
  const { theme, setTheme } = useTheme()
  const cached = React.useSyncExternalStore(subscribe, snapshot, () => EMPTY)
  const coarse = React.useSyncExternalStore(subscribeDensity, () => window.matchMedia(COARSE).matches, () => false)

  // The cache belongs to one person. Anyone else (or nobody yet) starts from the defaults.
  const mine = cached.uid === userId || (cached.uid === null && cached !== EMPTY)
  const current = React.useMemo<Cached>(() => (mine ? cached : { ...EMPTY, uid: userId }), [mine, cached, userId])

  const resolvedStyle: ResolvedStyle = current.style === "auto" ? PERSONA_STYLE[user.persona] : current.style
  const resolvedDensity: ResolvedDensity = current.density === "auto" ? (coarse ? "comfortable" : "compact") : current.density
  // Until this person's choice is known (cache or server), the device's next-themes setting stays in charge.
  const known = mine && cached !== EMPTY
  const mode: ModePref = known ? current.mode : modeFromTheme(theme)

  // Saves are queued one at a time and the newest wins, so quick successive taps never save out of order.
  const saving = React.useRef<{ running: boolean; next: AppearanceChoice | null }>({ running: false, next: null })
  const save = React.useCallback(
    async (choice: AppearanceChoice) => {
      const slot = saving.current
      slot.next = choice
      if (slot.running) return
      slot.running = true
      let failed = false
      while (slot.next) {
        const sending = slot.next
        slot.next = null
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
    (patch: Partial<AppearanceChoice>, dark?: DarkMode) => {
      const base = snapshot()
      const owned = base.uid === userId || (base.uid === null && base !== EMPTY)
      const from: Cached = owned ? base : { ...EMPTY, uid: userId, mode: modeFromTheme(theme) }
      const next: Cached = { ...from, ...patch, uid: userId, dark: dark ?? from.dark }
      writeCache(next)
      void save({ style: next.style, mode: next.mode, density: next.density })
    },
    [save, theme, userId],
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
          writeCache({ ...(owned ? base : EMPTY), style: saved.style, mode: saved.mode, density: saved.density, uid: userId, dark: saved.mode === "black" ? "black" : saved.mode === "charcoal" ? "charcoal" : owned ? base.dark : "charcoal" })
        } else if (owned && (base.style !== "auto" || base.density !== "auto" || base.mode !== "device")) {
          writeCache({ ...base, uid: userId })
          void save({ style: base.style, mode: base.mode, density: base.density })
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

  // Apply to the page. Not before the session is ready: the boot script has already painted the right look, and the
  // placeholder persona must not overwrite it.
  React.useEffect(() => {
    if (!ready) return
    const root = document.documentElement
    root.dataset.style = resolvedStyle
    root.dataset.density = resolvedDensity
    // Device dark is always warm charcoal; true black only when the person chose it.
    if (mode === "black") root.dataset.mode = "black"
    else delete root.dataset.mode
  }, [ready, resolvedStyle, resolvedDensity, mode])

  React.useEffect(() => {
    if (!ready || !known) return
    const wanted = themeFor(mode)
    if (theme !== wanted) setTheme(wanted)
  }, [ready, known, mode, theme, setTheme])

  // Remember what was shown, so the next load paints a persona default correctly before the session is ready.
  React.useEffect(() => {
    if (!ready || !known || current.resolvedStyle === resolvedStyle) return
    writeCache({ ...current, resolvedStyle })
  }, [ready, known, current, resolvedStyle])

  const value = React.useMemo<AppearanceValue>(
    () => ({
      mode,
      style: current.style,
      density: current.density,
      resolvedStyle,
      resolvedDensity,
      darkMode: current.dark,
      setMode: (next) => update({ mode: next }, next === "black" || next === "charcoal" ? next : undefined),
      setStyle: (style) => update({ style }),
      setDensity: (density) => update({ density }),
    }),
    [mode, current.style, current.density, current.dark, resolvedStyle, resolvedDensity, update],
  )

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): AppearanceValue {
  const value = React.useContext(AppearanceContext)
  if (!value) throw new Error("useAppearance must be used inside AppearanceProvider")
  return value
}
