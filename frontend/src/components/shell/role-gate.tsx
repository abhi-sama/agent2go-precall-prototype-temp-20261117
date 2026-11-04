"use client"

import { Lock } from "lucide-react"
import Link from "next/link"
import type * as React from "react"
import { PERSONA_CONFIG } from "@/components/shell/persona-config"
import { buttonVariants } from "@/components/ui/button"
import type { Persona } from "@/lib/data/types"
import { useSession } from "@/lib/session/session-provider"
import { cn } from "@/lib/utils"

/**
 * Client-side courtesy check so a persona does not see another persona's empty page. It is NOT the
 * security boundary: the server decides (Cognito group + RLS) and the data layer returns FORBIDDEN.
 */
export function RoleGate({ persona, children }: { persona: Persona; children: React.ReactNode }) {
  const { user, ready } = useSession()
  if (!ready) return <div aria-busy="true" className="h-40 animate-pulse rounded-2xl bg-muted/50" />
  if (user.persona === persona) return <>{children}</>
  const own = PERSONA_CONFIG[user.persona]
  return (
    <div data-testid="role-gate" role="status" className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-2xl border border-dashed bg-fact-soft px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-ink/10 text-fact"><Lock className="size-6" aria-hidden /></span>
      <h1 className="text-xl font-semibold tracking-tight">This is the {PERSONA_CONFIG[persona].label} workspace</h1>
      <p className="text-sm text-muted-foreground">You are signed in as {own.label}. Your workspace has its own view.</p>
      <Link href={own.home} className={cn(buttonVariants({ size: "lg" }), "mt-2")}>Go to {own.label} workspace</Link>
    </div>
  )
}
