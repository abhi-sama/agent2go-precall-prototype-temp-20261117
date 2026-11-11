import { describe, expect, it } from "vitest"
import { APPEARANCE_STORAGE_KEY, DEVICE_APPEARANCE_KEY, THEME_BY_USER_KEY, THEME_ROOT_SCRIPT, bootScript } from "./appearance-provider"

/** Runs the real inline script against a fake page, the way the browser runs it before first paint. */
function boot(opts: { cache?: object | string; device?: object; themes?: object; userId?: string; coarse?: boolean; osDark?: boolean }) {
  const store: Record<string, string> = {}
  if (opts.cache !== undefined) store[APPEARANCE_STORAGE_KEY] = typeof opts.cache === "string" ? opts.cache : JSON.stringify(opts.cache)
  if (opts.device) store[DEVICE_APPEARANCE_KEY] = JSON.stringify(opts.device)
  if (opts.themes) store[THEME_BY_USER_KEY] = JSON.stringify(opts.themes)
  if (opts.userId) store["a2g.local.userId"] = opts.userId
  const dataset: Record<string, string> = {}
  const attrs: Record<string, string> = {}
  const classes = new Set<string>()
  const localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) }
  const documentElement = {
    dataset,
    classList: { toggle: (name: string, on: boolean) => void (on ? classes.add(name) : classes.delete(name)) },
    setAttribute: (k: string, v: string) => void (attrs[k] = v),
    removeAttribute: (k: string) => void delete attrs[k],
  }
  const run = new Function("localStorage", "document", "matchMedia", bootScript())
  run(localStorage, { documentElement }, (q: string) => ({ matches: q.includes("dark") ? (opts.osDark ?? false) : (opts.coarse ?? false) }))
  return { theme: attrs["data-astryx-theme"], scheme: attrs["data-color-scheme"], dark: classes.has("dark"), density: dataset.density }
}

describe("appearance boot script (no flash on first paint)", () => {
  it("paints the default theme and follows the device with nothing saved", () => {
    expect(boot({})).toMatchObject({ theme: "neutral", scheme: undefined, dark: false })
    expect(boot({ osDark: true })).toMatchObject({ theme: "neutral", scheme: undefined, dark: true })
  })

  it("paints the person's own saved theme and scheme", () => {
    const result = boot({ userId: "u-dir-ne", cache: { uid: "u-dir-ne", theme: "matcha", mode: "charcoal" } })
    expect(result).toMatchObject({ theme: "matcha", scheme: "dark", dark: true })
  })

  it("maps each saved server mode onto a colour scheme", () => {
    expect(boot({ cache: { mode: "light" }, osDark: true })).toMatchObject({ scheme: "light", dark: false })
    expect(boot({ cache: { mode: "device" }, osDark: true })).toMatchObject({ scheme: undefined, dark: true })
    expect(boot({ cache: { mode: "charcoal" } })).toMatchObject({ scheme: "dark", dark: true })
    expect(boot({ cache: { mode: "black" } })).toMatchObject({ scheme: "dark", dark: true })
    // The pre-D1 shape.
    expect(boot({ cache: { black: true } })).toMatchObject({ scheme: "dark" })
  })

  it("uses the look last applied on this device when the cache is someone else's", () => {
    const result = boot({
      userId: "u-dir-ne",
      cache: { uid: "u-msl-ne-01", theme: "butter", mode: "light", density: "compact" },
      device: { theme: "stone", scheme: "dark", density: "comfortable" },
    })
    expect(result).toMatchObject({ theme: "stone", scheme: "dark", density: "comfortable" })
  })

  it("never uses another person's cache, even with no device record", () => {
    const result = boot({ userId: "u-dir-ne", cache: { uid: "u-msl-ne-01", theme: "butter", mode: "light" } })
    expect(result).toMatchObject({ theme: "neutral", scheme: undefined })
  })

  it("keeps each person's own theme when someone else used the device last", () => {
    const result = boot({
      userId: "u-msl-ne-01",
      cache: { uid: "u-dir-ne", theme: "butter", mode: "light" },
      device: { theme: "butter", scheme: "light", density: "auto" },
      themes: { "u-msl-ne-01": "matcha", "u-dir-ne": "butter" },
    })
    expect(result.theme).toBe("matcha")
  })

  it("forces dark for a dark-only theme", () => {
    expect(boot({ device: { theme: "gothic", scheme: "light", density: "auto" } })).toMatchObject({ theme: "gothic", scheme: "dark", dark: true })
  })

  it("ignores an unknown theme", () => {
    expect(boot({ device: { theme: "not-a-theme", scheme: "system", density: "auto" } }).theme).toBe("neutral")
  })

  it("picks density from the device unless pinned", () => {
    expect(boot({ coarse: true }).density).toBe("comfortable")
    expect(boot({ coarse: false }).density).toBe("compact")
    expect(boot({ coarse: false, cache: { density: "comfortable" } }).density).toBe("comfortable")
  })

  it("survives corrupt storage", () => {
    expect(() => boot({ cache: "{not json" })).not.toThrow()
  })
})

describe("theme root script", () => {
  it("copies the boot theme onto the root Theme wrapper", () => {
    const wrapper: Record<string, string> = { "data-astryx-theme": "neutral" }
    const parentElement = { setAttribute: (k: string, v: string) => void (wrapper[k] = v) }
    const document = { currentScript: { parentElement }, documentElement: { getAttribute: () => "gothic" } }
    new Function("document", THEME_ROOT_SCRIPT)(document)
    expect(wrapper["data-astryx-theme"]).toBe("gothic")
  })
})
