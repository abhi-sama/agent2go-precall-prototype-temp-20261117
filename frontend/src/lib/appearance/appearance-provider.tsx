"use client"

import { useTheme } from "next-themes"
import * as React from "react"
import type { Persona } from "@/lib/data/types"
import { useSession } from "@/lib/session/session-provider"

export type StylePref = "auto" | "warm" | "clinical"
export type DensityPref = "auto" | "comfortable" | "compact"
/** Device follows the OS (dark maps to warm charcoal); the others pin one mode. */
export type ModePref = "device" | "light" | "charcoal" | "black"
export type ResolvedStyle = "warm" | "clinical"
export type ResolvedDensity = "comfortable" | "compact"

export const APPEARANCE_STORAGE_KEY = "a2g.appearance"

/** MSL works in the field and gets the warm style; the oversight personas get the clinical one. */
export const PERSONA_STYLE: Record<Persona, ResolvedStyle> = {
  msl: "warm",
  director: "clinical",
  executive: "clinical",
  admin: "clinical",
}

interface Stored {
  style: StylePref
  density: DensityPref
  black: boolean
}
const DEFAULTS: Stored = { style: "auto", density: "auto", black: false }

function read(): Stored {
  try {
    const raw = JSON.parse(window.localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "{}") as Partial<Stored>
    return {
      style: raw.style === "warm" || raw.style === "clinical" ? raw.style : "auto",
      density: raw.density === "comfortable" || raw.density === "compact" ? raw.density : "auto",
      black: raw.black === true,
    }
  } catch {
    return DEFAULTS
  }
}

/**
 * Runs before first paint (inline in the root layout) so the saved density, style and black mode apply without a flash.
 * The persona default style cannot be known here; it is applied once the session loads.
 */
export const APPEARANCE_BOOT_SCRIPT = `try{var d=document.documentElement,a=JSON.parse(localStorage.getItem("${APPEARANCE_STORAGE_KEY}")||"{}");d.dataset.density=a.density==="comfortable"||a.density==="compact"?a.density:(matchMedia("(pointer: coarse)").matches?"comfortable":"compact");if(a.style==="warm"||a.style==="clinical")d.dataset.style=a.style;if(a.black===true&&localStorage.getItem("theme")==="dark")d.dataset.mode="black"}catch(e){}`

const COARSE = "(pointer: coarse)"
function subscribeCoarse(onChange: () => void) {
  const mql = window.matchMedia(COARSE)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

interface AppearanceValue {
  mode: ModePref
  style: StylePref
  density: DensityPref
  resolvedStyle: ResolvedStyle
  resolvedDensity: ResolvedDensity
  setMode: (mode: ModePref) => void
  setStyle: (style: StylePref) => void
  setDensity: (density: DensityPref) => void
}

const AppearanceContext = React.createContext<AppearanceValue | null>(null)

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession()
  const { theme, setTheme } = useTheme()
  // Saved choices live in localStorage: read once after hydration, never during render.
  const [stored, setStored] = React.useState<Stored>(DEFAULTS)
  React.useEffect(() => {
    const saved = read()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStored(saved)
  }, [])
  const coarse = React.useSyncExternalStore(subscribeCoarse, () => window.matchMedia(COARSE).matches, () => false)

  const resolvedStyle: ResolvedStyle = stored.style === "auto" ? PERSONA_STYLE[user.persona] : stored.style
  const resolvedDensity: ResolvedDensity = stored.density === "auto" ? (coarse ? "comfortable" : "compact") : stored.density

  React.useEffect(() => {
    const root = document.documentElement
    root.dataset.style = resolvedStyle
    root.dataset.density = resolvedDensity
    // Device dark is always warm charcoal; true black only when the person chose it.
    if (stored.black && theme === "dark") root.dataset.mode = "black"
    else delete root.dataset.mode
  }, [resolvedStyle, resolvedDensity, stored.black, theme])

  const update = React.useCallback((patch: Partial<Stored>) => {
    setStored((current) => {
      const next = { ...current, ...patch }
      try {
        window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Private mode: the choice lasts for this visit only.
      }
      return next
    })
  }, [])

  const mode: ModePref = theme === "light" ? "light" : theme === "dark" ? (stored.black ? "black" : "charcoal") : "device"

  const value = React.useMemo<AppearanceValue>(
    () => ({
      mode,
      style: stored.style,
      density: stored.density,
      resolvedStyle,
      resolvedDensity,
      setMode: (next) => {
        setTheme(next === "device" ? "system" : next === "light" ? "light" : "dark")
        // Black only changes what "dark" looks like; picking Light or Device keeps the choice for later.
        if (next === "black") update({ black: true })
        else if (next === "charcoal") update({ black: false })
      },
      setStyle: (style) => update({ style }),
      setDensity: (density) => update({ density }),
    }),
    [mode, stored.style, stored.density, resolvedStyle, resolvedDensity, setTheme, update],
  )

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): AppearanceValue {
  const value = React.useContext(AppearanceContext)
  if (!value) throw new Error("useAppearance must be used inside AppearanceProvider")
  return value
}
