"use client"

import { Check, FlaskConical, UserRound } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"
import { PERSONA_CONFIG } from "@/components/shell/persona-config"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { PERSONA_HOME, PERSONA_LABEL, USERS } from "@/lib/data/fixtures"
import { PERSONAS } from "@/lib/data/types"
import { IS_LOCAL_BUILD } from "@/lib/env"
import { useSession } from "@/lib/session/session-provider"
import { cn } from "@/lib/utils"

/**
 * LOCAL BUILDS ONLY. Lets a developer or reviewer act as any seeded persona without signing in.
 * `IS_LOCAL_BUILD` is inlined at build time, so deployed builds render nothing and ship no switch.
 */
export function PersonaSwitcher() {
  const { user, switchUser } = useSession()
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  if (!IS_LOCAL_BUILD) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-testid="persona-switch"
        render={
          <Button variant="outline" className="max-w-[16rem] justify-start gap-2.5" aria-label="Switch persona (local build)" />
        }
      >
        <UserRound aria-hidden className="text-accent-text" />
        <span className="flex min-w-0 flex-col items-start leading-tight">
          <span className="truncate text-sm">{PERSONA_LABEL[user.persona]}</span>
          <span className="hidden truncate text-[0.7rem] font-normal text-muted-foreground sm:block">{user.fullName}</span>
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] gap-3 p-3">
        <div className="flex items-center gap-2 rounded-lg bg-warning/15 px-3 py-2 text-xs font-medium text-foreground">
          <FlaskConical className="size-4 shrink-0 text-warning" aria-hidden />
          Local build only. Synthetic people; no sign-in.
        </div>
        <div className="flex max-h-[60dvh] flex-col gap-3 overflow-y-auto">
          {PERSONAS.map((persona) => {
            const people = USERS.filter((u) => u.persona === persona)
            if (people.length === 0) return null
            return (
              <div key={persona} className="flex flex-col gap-1">
                <p className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {PERSONA_CONFIG[persona].label}
                </p>
                {people.map((u) => {
                  const active = u.userId === user.userId
                  return (
                    <button
                      key={u.userId}
                      type="button"
                      data-testid={`persona-option-${u.userId}`}
                      aria-pressed={active}
                      onClick={() => {
                        switchUser(u.userId)
                        setOpen(false)
                        router.push(PERSONA_HOME[u.persona])
                      }}
                      className={cn(
                        "flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
                        active ? "border-primary/60 bg-accent" : "border-transparent hover:bg-muted",
                      )}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">{u.fullName}</span>
                        <span className="truncate text-xs text-muted-foreground">{u.blurb}</span>
                      </span>
                      {active && <Check className="size-4 shrink-0 text-accent-text" aria-hidden />}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
