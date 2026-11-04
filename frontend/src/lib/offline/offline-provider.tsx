"use client"

import * as React from "react"
import { useSession } from "@/lib/session/session-provider"
import { clearOfflineDataForOwner, offlineQueueCount, purgeExpiredOfflineData, type OfflineScope } from "./cache"

export interface OfflineValue {
  scope: OfflineScope
  online: boolean
  queueCount: number
  refreshQueue: () => void
}

const OfflineContext = React.createContext<OfflineValue | null>(null)

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback)
  window.addEventListener("offline", callback)
  return () => {
    window.removeEventListener("online", callback)
    window.removeEventListener("offline", callback)
  }
}

function onlineSnapshot() { return typeof navigator === "undefined" ? true : navigator.onLine }

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
  }
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { user, ready } = useSession()
  const online = React.useSyncExternalStore(subscribeOnline, onlineSnapshot, () => true)
  const scope = React.useMemo<OfflineScope>(
    () => ({ ownerId: user.userId, scopeLabel: user.scopeLabel, enabled: ready && user.persona === "msl" && Boolean(user.userId) && Boolean(user.scopeLabel) }),
    [ready, user.persona, user.scopeLabel, user.userId],
  )
  const [queueCount, setQueueCount] = React.useState(0)
  const previous = React.useRef<OfflineScope | null>(null)

  const refreshQueue = React.useCallback(() => {
    void offlineQueueCount(scope).then(setQueueCount).catch(() => setQueueCount(0))
  }, [scope])

  React.useEffect(() => {
    registerServiceWorker()
  }, [])

  React.useEffect(() => {
    const before = previous.current
    previous.current = scope
    if (before?.enabled && (before.ownerId !== scope.ownerId || before.scopeLabel !== scope.scopeLabel)) {
      void clearOfflineDataForOwner(before.ownerId)
    }
    void purgeExpiredOfflineData()
    refreshQueue()
  }, [scope, refreshQueue])

  const value = React.useMemo(() => ({ scope, online, queueCount, refreshQueue }), [scope, online, queueCount, refreshQueue])
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
}

export function useOffline(): OfflineValue {
  const value = React.useContext(OfflineContext)
  if (!value) throw new Error("useOffline must be used inside OfflineProvider")
  return value
}
