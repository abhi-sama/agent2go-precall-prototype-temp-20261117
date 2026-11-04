/**
 * Reads a motion duration token from the stylesheet, so JS-driven motion (the globe camera, chart draw-in timers)
 * follows `globals.css` instead of carrying its own numbers. The fallback only applies before the stylesheet is
 * available (server render, unit tests) and mirrors the token's value.
 */
export function tokenMs(name: `--${string}`, fallbackMs: number): number {
  if (typeof document === "undefined") return fallbackMs
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n)) return fallbackMs
  return raw.endsWith("ms") ? n : raw.endsWith("s") ? n * 1000 : fallbackMs
}
