"use client"

import * as React from "react"
import { MAX_FIGURES, type PageFigure } from "@/lib/chat/page-state"

/**
 * The headline figures on the page the person is looking at, for the agent to read as context (docs/adr/0019).
 *
 * Each headline tile (`KpiTile`) registers what it prints while it is on screen and unregisters when it goes, so the
 * list is always what is visible and no page has to know about the chat. The store never re-renders a tile: only the
 * chat reads it, through `useVisibleFigures`. These are the page's printed text. They are context for understanding a
 * question, never evidence: the agent counts every figure it states from RLS-scoped SQL.
 */
export interface FiguresStore {
  register(figure: PageFigure): () => void
  subscribe(listener: () => void): () => void
  snapshot(): PageFigure[]
}

export function createFiguresStore(): FiguresStore {
  const figures = new Map<string, PageFigure>()
  const listeners = new Set<() => void>()
  let cached: PageFigure[] = []
  const publish = () => {
    cached = [...figures.values()].slice(0, MAX_FIGURES)
    for (const listener of listeners) listener()
  }
  return {
    register(figure) {
      figures.set(figure.id, figure)
      publish()
      return () => {
        // A newer registration of the same id (the tile re-rendered with a new value) is not removed by the old cleanup.
        if (figures.get(figure.id) === figure) {
          figures.delete(figure.id)
          publish()
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    snapshot: () => cached,
  }
}

const FiguresContext = React.createContext<FiguresStore | null>(null)
const NONE: PageFigure[] = []

export function PageFiguresProvider({ children }: { children: React.ReactNode }) {
  const [store] = React.useState(createFiguresStore)
  return <FiguresContext.Provider value={store}>{children}</FiguresContext.Provider>
}

/** Register one printed figure while the calling component is mounted. A no-op outside the provider (the design page). */
export function useRegisterFigure(figure: PageFigure | null) {
  const store = React.useContext(FiguresContext)
  const id = figure?.id
  const label = figure?.label
  const value = figure?.value
  const definition = figure?.definition
  React.useEffect(() => {
    if (!store || !id || !label || !value) return
    return store.register({ id, label, value, ...(definition ? { definition } : {}) })
  }, [store, id, label, value, definition])
}

/** The figures on the page now, in the order they appear. */
export function useVisibleFigures(): PageFigure[] {
  const store = React.useContext(FiguresContext)
  return React.useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    store?.snapshot ?? (() => NONE),
    () => NONE,
  )
}
