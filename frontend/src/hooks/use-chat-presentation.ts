"use client"

import * as React from "react"

/**
 * `sheet`: a full-screen sheet, on an iPad held upright (portrait, touch) and on phone-width windows.
 * `panel`: the slide-in panel from the right, everywhere else. Capability queries, never a device guess.
 */
const SHEET_QUERY = "(max-width: 639px), (orientation: portrait) and (pointer: coarse)"

function subscribe(onChange: () => void) {
  const query = window.matchMedia(SHEET_QUERY)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

export type ChatPresentation = "panel" | "sheet"

export function useChatPresentation(): ChatPresentation {
  const sheet = React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(SHEET_QUERY).matches,
    () => false,
  )
  return sheet ? "sheet" : "panel"
}
