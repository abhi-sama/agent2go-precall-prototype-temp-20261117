import { describe, expect, it } from "vitest"
import { APPEARANCE_STORAGE_KEY, bootScript } from "./appearance-provider"

/** Runs the real inline script against a fake page, the way the browser runs it before first paint. */
function boot(opts: { cache?: object | string; userId?: string; coarse?: boolean; theme?: string; osDark?: boolean }) {
  const store: Record<string, string> = {}
  if (opts.cache !== undefined) store[APPEARANCE_STORAGE_KEY] = typeof opts.cache === "string" ? opts.cache : JSON.stringify(opts.cache)
  if (opts.userId) store["a2g.local.userId"] = opts.userId
  if (opts.theme) store.theme = opts.theme
  const dataset: Record<string, string> = {}
  const classes = new Set<string>()
  const style: Record<string, string> = {}
  const localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) }
  const run = new Function("localStorage", "document", "matchMedia", bootScript({ "u-msl-ne-01": "warm", "u-dir-ne": "clinical" }))
  const classList = { toggle: (name: string, on: boolean) => void (on ? classes.add(name) : classes.delete(name)) }
  run(localStorage, { documentElement: { dataset, classList, style } }, (q: string) => ({ matches: q.includes("dark") ? (opts.osDark ?? false) : (opts.coarse ?? false) }))
  return { dataset, theme: store.theme, dark: classes.has("dark"), colorScheme: style.colorScheme }
}

describe("appearance boot script (no flash on first paint)", () => {
  it("paints the persona style of the quick-switch user on a first visit", () => {
    expect(boot({ userId: "u-dir-ne" }).dataset.style).toBe("clinical")
    expect(boot({ userId: "u-msl-ne-01" }).dataset.style).toBe("warm")
  })

  it("an explicit saved style wins over the persona", () => {
    expect(boot({ userId: "u-dir-ne", cache: { uid: "u-dir-ne", style: "warm" } }).dataset.style).toBe("warm")
  })

  it("repeats the style shown last time when the persona is not knowable yet", () => {
    expect(boot({ cache: { uid: "x", style: "auto", resolvedStyle: "clinical" } }).dataset.style).toBe("clinical")
  })

  it("ignores another person's cached choice", () => {
    const result = boot({ userId: "u-dir-ne", theme: "dark", cache: { uid: "u-msl-ne-01", style: "warm", mode: "black", density: "compact" } })
    expect(result.dataset.style).toBe("clinical")
    expect(result.dataset.mode).toBeUndefined()
    expect(result.theme).toBe("dark")
  })

  it("maps each saved mode onto next-themes and true black", () => {
    expect(boot({ cache: { mode: "light" } })).toMatchObject({ theme: "light", dataset: {} })
    expect(boot({ cache: { mode: "device" } }).theme).toBe("system")
    const charcoal = boot({ cache: { mode: "charcoal" } })
    expect(charcoal.theme).toBe("dark")
    expect(charcoal.dataset.mode).toBeUndefined()
    const black = boot({ cache: { mode: "black" } })
    expect(black.theme).toBe("dark")
    expect(black.dataset.mode).toBe("black")
  })

  it("sets the dark class itself, so it never waits for next-themes", () => {
    expect(boot({ cache: { mode: "charcoal" } })).toMatchObject({ dark: true, colorScheme: "dark" })
    expect(boot({ cache: { mode: "light" }, osDark: true })).toMatchObject({ dark: false, colorScheme: "light" })
    expect(boot({ cache: { mode: "device" }, osDark: true }).dark).toBe(true)
    expect(boot({ cache: { mode: "device" }, osDark: false }).dark).toBe(false)
    // No saved choice: the device's theme setting (next-themes' key) decides.
    expect(boot({ theme: "dark" }).dark).toBe(true)
    expect(boot({}).dark).toBe(false)
  })

  it("true black needs dark", () => {
    expect(boot({ cache: { mode: "black" } }).dataset.mode).toBe("black")
  })

  it("reads the choice saved before D1 (black flag)", () => {
    expect(boot({ cache: { style: "clinical", black: true } }).dataset).toMatchObject({ style: "clinical", mode: "black" })
  })

  it("picks density from the device unless pinned", () => {
    expect(boot({ coarse: true }).dataset.density).toBe("comfortable")
    expect(boot({ coarse: false }).dataset.density).toBe("compact")
    expect(boot({ coarse: false, cache: { density: "comfortable" } }).dataset.density).toBe("comfortable")
  })

  it("survives corrupt storage", () => {
    expect(() => boot({ cache: "{not json" })).not.toThrow()
  })
})
