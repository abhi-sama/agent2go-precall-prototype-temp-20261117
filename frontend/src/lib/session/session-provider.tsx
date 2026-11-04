"use client"

import * as React from "react"
import { DEFAULT_USER_ID, findUser, USERS, type FixtureUser } from "@/lib/data/fixtures"
import { DATA_ADAPTER, IS_LOCAL_BUILD } from "@/lib/env"
import { log } from "@/lib/log/logger"
import { clearOfflineDataForOwner } from "@/lib/offline/cache"
import { CognitoSessionProvider } from "./cognito-session"
import { SessionContext, type SessionValue } from "./context"

export type { SessionUser, SessionValue } from "./context"

const STORAGE_KEY = "a2g.local.userId"

/**
 * Local identity store. The selected fixture user lives in localStorage (local builds only) with an
 * in-memory fallback, and is exposed through useSyncExternalStore so server render and hydration use
 * the default user and the client then switches to the stored one without effects or flashes.
 */
let memoryUserId: string | null = null
const listeners = new Set<() => void>()

function readStored(): string | null {
  if (memoryUserId) return memoryUserId
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function currentUserId(): string {
  const stored = IS_LOCAL_BUILD ? readStored() : null
  return stored && USERS.some((u) => u.userId === stored) ? stored : DEFAULT_USER_ID
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  window.addEventListener("storage", cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener("storage", cb)
  }
}

function writeUserId(userId: string) {
  memoryUserId = userId
  try {
    window.localStorage.setItem(STORAGE_KEY, userId)
  } catch {
    /* storage unavailable: the in-memory value still switches this page load */
  }
  listeners.forEach((cb) => cb())
}

/**
 * `appsync` builds sign in through Cognito (Amplify); `mock` builds use the fixture identities.
 * Both expose the same `useSession()` value.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  if (DATA_ADAPTER === "appsync") return <CognitoSessionProvider>{children}</CognitoSessionProvider>
  return <FixtureSessionProvider>{children}</FixtureSessionProvider>
}

function FixtureSessionProvider({ children }: { children: React.ReactNode }) {
  const userId = React.useSyncExternalStore(subscribe, currentUserId, () => DEFAULT_USER_ID)
  const ready = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const switchUser = React.useCallback((next: string) => {
    if (!IS_LOCAL_BUILD) return
    const target = findUser(next)
    void clearOfflineDataForOwner(userId)
    writeUserId(target.userId)
    log.info("persona switched", { persona: target.persona, user_id: target.userId })
  }, [userId])

  const value = React.useMemo<SessionValue>(
    () => ({
      kind: "fixture",
      user: findUser(userId),
      userId,
      getUserId: currentUserId,
      switchUser,
      canSwitch: IS_LOCAL_BUILD,
      switchableUsers: USERS as FixtureUser[],
      ready,
      signOut: null,
      refresh: async () => {},
    }),
    [userId, switchUser, ready],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = React.useContext(SessionContext)
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>")
  return ctx
}
