"use client"

import { fetchAuthSession, signIn, signOut } from "aws-amplify/auth"
import { Hub } from "aws-amplify/utils"
import { usePathname, useRouter } from "next/navigation"
import * as React from "react"
import { configureAmplify, localSeededUsers } from "@/lib/amplify/config"
import { appsyncTransport } from "@/lib/data/appsync-transport"
import { PERSONA_HOME } from "@/lib/data/fixtures"
import { createGraphQLAdapter } from "@/lib/data/graphql-adapter"
import type { Persona } from "@/lib/data/types"
import { IS_LOCAL_BUILD } from "@/lib/env"
import { log, newCorrelationId } from "@/lib/log/logger"
import { SessionContext, type SessionUser, type SessionValue } from "./context"

/** Cognito group -> persona. Exactly one is expected; the BE enforces the same rule. */
const GROUP_PERSONA: Record<string, Persona> = {
  MSL: "msl",
  Director: "director",
  Executive: "executive",
  Administrator: "admin",
}

export const LOGIN_PATH = "/login"

type State =
  | { status: "loading" }
  | { status: "signedOut"; reason?: "no_persona" }
  | { status: "signedIn"; user: SessionUser }

const PLACEHOLDER: SessionUser = { userId: "", fullName: "", email: "", persona: "msl", scopeLabel: "", blurb: "" }

function personaFromGroups(groups: unknown): Persona | null {
  const list = Array.isArray(groups) ? groups : []
  const known = list.map((g) => GROUP_PERSONA[String(g)]).filter(Boolean)
  return known.length === 1 ? known[0] : null
}

function seededSwitchList(): SessionUser[] {
  return localSeededUsers()
    .users.filter((u) => u.persona in PERSONA_HOME)
    .map((u) => ({
      userId: u.userId,
      fullName: u.fullName,
      email: u.email,
      persona: u.persona as Persona,
      scopeLabel: u.territoryId,
      blurb: u.identityStatus === "matched" ? u.territoryId : `${u.territoryId} · unresolved identity`,
    }))
}

const adapter = createGraphQLAdapter(appsyncTransport)

/** Session backed by Cognito through Amplify. Identity comes from the ID token; scope from the BE. */
export function CognitoSessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<State>({ status: "loading" })
  const [switching, setSwitching] = React.useState(false)
  // A quick-switch signs out then in; the intermediate signed-out state must not redirect.
  const switchingRef = React.useRef(false)
  const router = useRouter()
  const pathname = usePathname()
  const userRef = React.useRef<SessionUser>(PLACEHOLDER)

  const load = React.useCallback(async () => {
    if (!configureAmplify()) {
      setState({ status: "signedOut" })
      return
    }
    try {
      const idToken = (await fetchAuthSession()).tokens?.idToken
      if (!idToken) {
        setState({ status: "signedOut" })
        return
      }
      const claims = idToken.payload
      const persona = personaFromGroups(claims["cognito:groups"])
      if (!persona) {
        await signOut()
        setState({ status: "signedOut", reason: "no_persona" })
        return
      }
      const base: SessionUser = {
        userId: String(claims.sub ?? ""),
        fullName: typeof claims.name === "string" ? claims.name : "",
        email: typeof claims.email === "string" ? claims.email : "",
        persona,
        scopeLabel: "",
        blurb: "",
      }
      // The BE owns the application user id and the territory scope; claims cannot supply them.
      try {
        const me = await adapter.me({ correlationId: newCorrelationId() })
        base.userId = me.userId
        base.fullName = me.fullName || base.fullName
        base.scopeLabel = me.scopeLabel
      } catch {
        log.warn("me query failed after sign-in", { operation: "me" })
      }
      userRef.current = base
      setState({ status: "signedIn", user: base })
    } catch {
      setState({ status: "signedOut" })
    }
  }, [])

  React.useEffect(() => {
    // Initial session read and every later Amplify auth event (sign-in, sign-out, token refresh).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() only sets state after awaiting Amplify
    void load()
    return Hub.listen("auth", () => {
      if (!switchingRef.current) void load()
    })
  }, [load])

  React.useEffect(() => {
    if (state.status === "signedOut" && pathname !== LOGIN_PATH && !switchingRef.current) {
      router.replace(`${LOGIN_PATH}?next=${encodeURIComponent(pathname)}`)
    }
  }, [state.status, pathname, router])

  const switchUser = React.useCallback(
    async (userId: string) => {
      if (!IS_LOCAL_BUILD) return
      const { users, password } = localSeededUsers()
      const target = users.find((u) => u.userId === userId)
      if (!target || !password) return
      switchingRef.current = true
      setSwitching(true)
      try {
        await signOut()
        await signIn({ username: target.email, password })
        log.info("persona switched", { persona: target.persona, user_id: target.userId })
        await load()
      } finally {
        switchingRef.current = false
        setSwitching(false)
      }
    },
    [load],
  )

  const doSignOut = React.useCallback(async () => {
    await signOut()
    setState({ status: "signedOut" })
  }, [])

  const user = state.status === "signedIn" ? state.user : PLACEHOLDER
  const value = React.useMemo<SessionValue>(
    () => ({
      kind: "cognito",
      user,
      userId: user.userId,
      getUserId: () => userRef.current.userId,
      switchUser,
      canSwitch: IS_LOCAL_BUILD && localSeededUsers().users.length > 0,
      switchableUsers: seededSwitchList(),
      ready: state.status === "signedIn" && !switching,
      signOut: doSignOut,
      refresh: load,
    }),
    [user, switchUser, state.status, switching, doSignOut, load],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/** Sign in with email and password (Cognito SRP). Returns an error code for the form, or null. */
export async function signInWithPassword(email: string, password: string): Promise<string | null> {
  if (!configureAmplify()) return "not_configured"
  try {
    await signOut()
    const result = await signIn({ username: email, password })
    return result.isSignedIn ? null : "next_step_required"
  } catch (err) {
    const name = err instanceof Error ? err.name : "unknown"
    log.warn("sign-in failed", { operation: "signIn", error_code: name })
    return name
  }
}
