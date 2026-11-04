"use client"

import { FlaskConical } from "lucide-react"
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
    <section aria-labelledby="seeded-heading" data-testid="seeded-logins" className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-lg bg-warning/15 px-3 py-2 text-xs font-medium text-foreground">
        <FlaskConical className="size-4 shrink-0 text-warning" aria-hidden />
        <span id="seeded-heading">Local build only: sign in as a seeded synthetic user.</span>
      </div>
      {PERSONAS.map((persona) => {
        const people = seeded.users.filter((u) => u.persona === persona)
        if (people.length === 0) return null
        return (
          <div key={persona} className="flex flex-col gap-1.5">
            <p className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {PERSONA_CONFIG[persona].label}
            </p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {people.map((u) => (
                <button
                  key={u.userId}
                  type="button"
                  disabled={busy !== null}
                  data-testid={`seeded-login-${u.userId}`}
                  onClick={() => onPick(u.userId, u.email, seeded.password!)}
                  className="flex min-h-12 flex-col items-start justify-center rounded-xl border bg-card px-3 py-2 text-left transition-colors hover:bg-muted disabled:opacity-60"
                >
                  <span className="truncate text-sm font-medium">{busy === u.userId ? "Signing in…" : u.fullName}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {u.territoryId}
                    {u.identityStatus !== "matched" && " · unresolved identity"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}
