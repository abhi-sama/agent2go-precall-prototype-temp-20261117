"use client"

import { Skeleton } from "@astryxdesign/core/Skeleton"
import type * as React from "react"
import { PERSONA_CONFIG } from "@/components/shell/persona-config"
import { NoAccessState } from "@/components/state/states"
import type { Persona } from "@/lib/data/types"
import { useSession } from "@/lib/session/session-provider"

/**
 * Client-side courtesy check so a persona does not see another persona's empty page. It is NOT the
 * security boundary: the server decides (Cognito group + RLS) and the data layer returns FORBIDDEN.
 */
export function RoleGate({ persona, children }: { persona: Persona; children: React.ReactNode }) {
  const { user, ready } = useSession()
  if (!ready) return <Skeleton aria-busy="true" width="100%" height={160} />
  if (user.persona === persona) return <>{children}</>
  const own = PERSONA_CONFIG[user.persona]
  return (
    <NoAccessState
      testId="role-gate"
      title={`This is the ${PERSONA_CONFIG[persona].label} workspace`}
      actionLabel={`Go to ${own.label} workspace`}
    >
      You are signed in as {own.label}. Your workspace has its own view.
    </NoAccessState>
  )
}
