import type { Page } from "@playwright/test"

/**
 * The looks the matrix specs cover: every Astryx theme in light and dark (gothic only exists in dark). A look is
 * seeded the way the app stores a person's choice: the per-person cache (theme, and the server mode for the scheme).
 */
export const THEMES = ["neutral", "butter", "chocolate", "matcha", "stone", "gothic", "y2k"] as const
export type Theme = (typeof THEMES)[number]
export interface Look {
  theme: Theme
  scheme: "light" | "dark"
}
export const LOOKS: Look[] = THEMES.flatMap((theme): Look[] =>
  theme === "gothic" ? [{ theme, scheme: "dark" }] : [{ theme, scheme: "light" }, { theme, scheme: "dark" }],
)
/** A short set for slower specs: the default theme both ways, the dark-only theme, and a strongly styled light one. */
export const KEY_LOOKS: Look[] = [
  { theme: "neutral", scheme: "light" },
  { theme: "neutral", scheme: "dark" },
  { theme: "gothic", scheme: "dark" },
  { theme: "y2k", scheme: "light" },
]
export const lookName = (look: Look) => `${look.theme}-${look.scheme}`

/** The cache entry the app writes for a person's choice (see appearance-provider.tsx). */
export const cacheFor = (userId: string, look: Look, density = "auto") =>
  JSON.stringify({ uid: userId, theme: look.theme, mode: look.scheme === "dark" ? "charcoal" : "light", style: "auto", density })

/** Open the app as `userId` with `look` already saved on this device. */
export async function seedLook(page: Page, userId: string, look: Look, extra: Record<string, string> = {}) {
  await page.addInitScript(
    ([id, cache, more]) => {
      window.localStorage.setItem("a2g.local.userId", id as string)
      window.localStorage.setItem("a2g.appearance", cache as string)
      for (const [k, v] of Object.entries(more as Record<string, string>)) window.localStorage.setItem(k, v)
    },
    [userId, cacheFor(userId, look), extra] as const,
  )
}

/** What is applied right now: the theme on <html> and on the root Theme wrapper, and the resolved scheme. */
export const readLook = (page: Page) =>
  page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-astryx-theme"),
    wrapper: document.querySelector("body [data-astryx-theme]")?.getAttribute("data-astryx-theme") ?? null,
    dark: document.documentElement.classList.contains("dark"),
  }))
