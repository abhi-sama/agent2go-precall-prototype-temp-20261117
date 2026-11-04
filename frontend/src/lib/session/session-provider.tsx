"use client"

import * as React from "react"
import { DEFAULT_USER_ID, findUser, USERS, type FixtureUser } from "@/lib/data/fixtures"
import { IS_LOCAL_BUILD } from "@/lib/env"
import { log } from "@/lib/log/logger"

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

interface SessionValue {
  /** Selected fixture identity. In deployed builds the wiring worker replaces this with Cognito claims. */
  user: FixtureUser
  userId: string
  /** Stable accessor for adapters that must read the current identity at call time. */
  getUserId: () => string
  /** Local builds only; a no-op elsewhere. */
  switchUser: (userId: string) => void
  canSwitch: boolean
  /** False during server render and hydration, so pages do not fetch for the wrong user. */
  ready: boolean
}

const SessionContext = React.createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const userId = React.useSyncExternalStore(subscribe, currentUserId, () => DEFAULT_USER_ID)
  const ready = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const switchUser = React.useCallback((next: string) => {
    if (!IS_LOCAL_BUILD) return
    const target = findUser(next)
    writeUserId(target.userId)
    log.info("persona switched", { persona: target.persona, user_id: target.userId })
  }, [])

  const value = React.useMemo<SessionValue>(
    () => ({ user: findUser(userId), userId, getUserId: currentUserId, switchUser, canSwitch: IS_LOCAL_BUILD, ready }),
    [userId, switchUser, ready],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const ctx = React.useContext(SessionContext)
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>")
  return ctx
}
