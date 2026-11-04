import * as React from "react"
import type { Persona } from "@/lib/data/types"

/** What the shell needs to know about the signed-in person. */
export interface SessionUser {
  userId: string
  fullName: string
  email: string
  persona: Persona
  scopeLabel: string
  /** Short line for the quick-switch list. */
  blurb: string
}

export interface SessionValue {
  kind: "fixture" | "cognito"
  /** Fixture identity (mock builds) or Cognito claims enriched by the BE `me` query (appsync builds). */
  user: SessionUser
  userId: string
  /** Stable accessor for adapters that must read the current identity at call time. */
  getUserId: () => string
  /** Local builds only; a no-op elsewhere. */
  switchUser: (userId: string) => void | Promise<void>
  canSwitch: boolean
  /** People the local quick-switch offers (fixtures, or the seeded Cognito users). */
  switchableUsers: SessionUser[]
  /** False during server render, hydration, sign-in and switching, so pages do not fetch for the wrong user. */
  ready: boolean
  /** Cognito sessions only. */
  signOut: (() => Promise<void>) | null
  /** Re-read the identity (after a sign-in). Resolves once the session reflects it. */
  refresh: () => Promise<void>
}

export const SessionContext = React.createContext<SessionValue | null>(null)
