"use client"

import * as React from "react"

const ATTRIBUTES = ["class", "data-astryx-theme", "data-color-scheme", "data-theme"]

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ATTRIBUTES })
  // A page that follows the device changes scheme without any attribute changing.
  const mql = window.matchMedia("(prefers-color-scheme: dark)")
  mql.addEventListener("change", onChange)
  return () => {
    observer.disconnect()
    mql.removeEventListener("change", onChange)
  }
}

function resolvedScheme(): "light" | "dark" {
  const root = document.documentElement
  const pinned = root.getAttribute("data-color-scheme") ?? root.getAttribute("data-theme")
  if (pinned === "dark" || pinned === "light") return pinned
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

/**
 * The colour scheme actually on screen, observed on <html>. Canvas-based libraries use this to pick fallbacks;
 * pair it with `useThemeSignature` to know when to re-read design tokens.
 */
export function useDocumentTheme(): "light" | "dark" {
  return React.useSyncExternalStore(subscribe, resolvedScheme, () => "light")
}

/**
 * Changes whenever the Astryx theme or the colour scheme on screen changes (`"<theme>:<scheme>"`). Charts, maps and
 * WebGL scenes put it in their effect dependencies so they re-read tokens with `resolveCssColor` after a switch.
 */
export function useThemeSignature(): string {
  return React.useSyncExternalStore(
    subscribe,
    () => `${document.documentElement.getAttribute("data-astryx-theme") ?? "default"}:${resolvedScheme()}`,
    () => "default:light",
  )
}
