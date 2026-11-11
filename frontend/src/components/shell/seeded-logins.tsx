"use client"

import { Banner } from "@astryxdesign/core/Banner"
import { List, ListItem } from "@astryxdesign/core/List"
import { VStack } from "@astryxdesign/core/VStack"
import { PERSONA_CONFIG } from "@/components/shell/persona-config"
import { localSeededUsers } from "@/lib/amplify/config"
import { PERSONAS } from "@/lib/data/types"

/**
 * LOCAL BUILDS ONLY: one-tap sign-in as a seeded synthetic Cognito user (the persona quick-switch
 * screen). Render it only behind the build-time `IS_LOCAL_BUILD` constant so deployed bundles drop
 * it entirely; `scripts/check-local-only.mjs` verifies that.
 */
export function SeededLogins({
  busy,
  onPick,
}: {
  busy: string | null
  onPick: (userId: string, email: string, password: string) => void
}) {
  const seeded = localSeededUsers()
  if (seeded.users.length === 0 || !seeded.password) return null
  return (
    <VStack as="section" gap={3} aria-label="Seeded sign-in" data-testid="seeded-logins">
      <Banner status="warning" title="Local build only" description="Sign in as a seeded synthetic user." collapsible={false} />
      {PERSONAS.map((persona) => {
        const people = seeded.users.filter((u) => u.persona === persona)
        if (people.length === 0) return null
        return (
          <List key={persona} header={PERSONA_CONFIG[persona].label} hasDividers density="spacious">
            {people.map((u) => (
              <ListItem
                key={u.userId}
                data-testid={`seeded-login-${u.userId}`}
                label={busy === u.userId ? "Signing in…" : u.fullName}
                description={`${u.territoryId}${u.identityStatus !== "matched" ? " · unresolved identity" : ""}`}
                isDisabled={busy !== null}
                onClick={() => onPick(u.userId, u.email, seeded.password!)}
              />
            ))}
          </List>
        )
      })}
    </VStack>
  )
}
