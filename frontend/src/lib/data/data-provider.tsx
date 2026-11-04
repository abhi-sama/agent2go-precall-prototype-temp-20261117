"use client"

import * as React from "react"
import { createOfflineAdapter, flushOfflineQueue } from "@/lib/offline/adapter"
import { useOffline } from "@/lib/offline/offline-provider"
import { useSession } from "@/lib/session/session-provider"
import { createDefaultAdapter, type DataAdapter } from "./index"

const DataContext = React.createContext<DataAdapter | null>(null)

export function DataProvider({ children, adapter }: { children: React.ReactNode; adapter?: DataAdapter }) {
  const { getUserId } = useSession()
  const offline = useOffline()
  const base = React.useMemo(() => adapter ?? createDefaultAdapter(getUserId), [adapter, getUserId])
  const value = React.useMemo(
    () => createOfflineAdapter(base, { scope: offline.scope, online: offline.online, onQueueChange: offline.refreshQueue }),
    [base, offline.scope, offline.online, offline.refreshQueue],
  )

  React.useEffect(() => {
    if (offline.online) void flushOfflineQueue(base, offline.scope, offline.refreshQueue)
  }, [base, offline.online, offline.scope, offline.refreshQueue])
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useDataAdapter(): DataAdapter {
  const ctx = React.useContext(DataContext)
  if (!ctx) throw new Error("useDataAdapter must be used inside <DataProvider>")
  return ctx
}
