"use client"

import { CalendarSearch, RefreshCw } from "lucide-react"
import { LockKeyhole } from "lucide-react"
import Link from "next/link"
import { PERSONA_CONFIG } from "@/components/shell/persona-config"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button"
import { useSession } from "@/lib/session/session-provider"

export function ResetFiltersAction() {
  return (
    <Button variant="outline" onClick={() => window.location.assign(window.location.pathname)}>
      <CalendarSearch aria-hidden />
      Clear filters
    </Button>
  )
}

export function ReloadAction({ onRetry }: { onRetry?: () => void }) {
  return (
    <Button variant="outline" onClick={onRetry ?? (() => window.location.reload())}>
      <RefreshCw aria-hidden />
      Try again
    </Button>
  )
}

export function WorkspaceAction({ actionLabel }: { actionLabel: string }) {
  const { user } = useSession()
  return (
    <Link href={PERSONA_CONFIG[user.persona].home} className={buttonVariants({ variant: "outline" })}>
      <LockKeyhole aria-hidden />
      {actionLabel}
    </Link>
  )
}
