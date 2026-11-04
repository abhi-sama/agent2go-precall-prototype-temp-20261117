"use client"

import * as React from "react"
import { presetRange } from "@/lib/dates"
import type { InsightFilters } from "@/lib/data/types"

const DEFAULT_FILTERS: InsightFilters = presetRange("30d")

type FilterContextValue = {
  filters: InsightFilters
  setFilters: React.Dispatch<React.SetStateAction<InsightFilters>>
  resetFilters: () => void
}

const FilterContext = React.createContext<FilterContextValue | null>(null)

/** Lives in the app shell so a selection survives navigation between persona views. */
export function SharedFilterProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = React.useState<InsightFilters>(DEFAULT_FILTERS)
  const resetFilters = React.useCallback(() => setFilters(DEFAULT_FILTERS), [])
  const value = React.useMemo(() => ({ filters, setFilters, resetFilters }), [filters, resetFilters])
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useSharedFilters() {
  const context = React.useContext(FilterContext)
  if (!context) throw new Error("useSharedFilters must be used inside SharedFilterProvider")
  return context
}
