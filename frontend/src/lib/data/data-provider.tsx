"use client"

import * as React from "react"
import { useSession } from "@/lib/session/session-provider"
import { createDefaultAdapter, type DataAdapter } from "./index"

const DataContext = React.createContext<DataAdapter | null>(null)

export function DataProvider({ children, adapter }: { children: React.ReactNode; adapter?: DataAdapter }) {
  const { getUserId } = useSession()
  const value = React.useMemo(() => adapter ?? createDefaultAdapter(getUserId), [adapter, getUserId])
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useDataAdapter(): DataAdapter {
  const ctx = React.useContext(DataContext)
  if (!ctx) throw new Error("useDataAdapter must be used inside <DataProvider>")
  return ctx
}
