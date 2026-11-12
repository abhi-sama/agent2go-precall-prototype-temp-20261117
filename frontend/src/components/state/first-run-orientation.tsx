"use client"

import { Button } from "@astryxdesign/core/Button"
import { VStack } from "@astryxdesign/core/VStack"
import NextLink from "next/link"
import * as React from "react"
import { PERSONA_CONFIG } from "@/components/shell/persona-config"
import { FirstRunState } from "@/components/state/states"
import { useSession } from "@/lib/session/session-provider"

const FIRST_RUN_STORAGE_PREFIX = "a2g.first-run.v1"
const firstRunClaimByUser = new Map<string, boolean>()

function storageKey(userId: string) {
  return `${FIRST_RUN_STORAGE_PREFIX}:${userId}`
}

function claimFirstRun(userId: string) {
  const cached = firstRunClaimByUser.get(userId)
  if (cached !== undefined) return cached
  try {
    const key = storageKey(userId)
    const show = window.localStorage.getItem(key) === null
    if (show) window.localStorage.setItem(key, "seen")
    firstRunClaimByUser.set(userId, show)
    return show
  } catch {
    // A storage-restricted browser still receives the orientation for this visit.
    firstRunClaimByUser.set(userId, true)
    return true
  }
}

/** A deliberately non-blocking, once-per-user orientation that shares the state family's look. */
export function FirstRunOrientation() {
  const { user, userId, ready } = useSession()
  const [dismissedUserId, setDismissedUserId] = React.useState<string | null>(null)
  const visible = ready && claimFirstRun(userId) && dismissedUserId !== userId

  if (!visible) return null
  const workspace = PERSONA_CONFIG[user.persona]
  return (
    <VStack paddingBlockEnd={6} data-testid="first-run-orientation">
      <FirstRunState
        action={
          <Button
            as={NextLink}
            href={workspace.home}
            variant="primary"
            label={`Open ${workspace.label} workspace`}
            onClick={() => setDismissedUserId(userId)}
          />
        }
      />
    </VStack>
  )
}
