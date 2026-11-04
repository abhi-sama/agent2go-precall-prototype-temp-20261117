"use client"

import * as React from "react"

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}

/**
 * The theme actually applied to <html> (`.dark`), observed after the class changes. Canvas-based
 * libraries use this to re-read design tokens at the right moment.
 */
export function useDocumentTheme(): "light" | "dark" {
  return React.useSyncExternalStore(
    subscribe,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "light",
  )
}
