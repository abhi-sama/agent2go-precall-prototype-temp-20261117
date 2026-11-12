"use client"

import * as React from "react"

/**
 * `docked`: a supporting pane that makes the page reflow on desktop. `sheet`: a touch-first bottom sheet for
 * portrait iPad and phone. `drawer`: a transient side panel between those two widths.
 */
// Portrait leaves too little inline room for a useful inspector on iPad as well as on phones. Orientation is more
// reliable than pointer capability in embedded and automated tablet browsers, where touch can report as fine.
const SHEET_QUERY = "(max-width: 639px), (orientation: portrait)"
const DOCKED_QUERY = "(min-width: 1366px)"

function subscribe(onChange: () => void) {
  const queries = [window.matchMedia(SHEET_QUERY), window.matchMedia(DOCKED_QUERY)]
  for (const query of queries) query.addEventListener("change", onChange)
  return () => { for (const query of queries) query.removeEventListener("change", onChange) }
}

export type ChatPresentation = "docked" | "drawer" | "sheet"

export function useChatPresentation(): ChatPresentation {
  const presentation = React.useSyncExternalStore<ChatPresentation>(
    subscribe,
    () => window.matchMedia(DOCKED_QUERY).matches ? "docked" : window.matchMedia(SHEET_QUERY).matches ? "sheet" : "drawer",
    () => "drawer",
  )
  return presentation
}
