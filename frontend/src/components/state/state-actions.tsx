"use client"

import { Button } from "@astryxdesign/core/Button"
import { CalendarSearch, LockKeyhole, RefreshCw } from "lucide-react"
import NextLink from "next/link"
import { PERSONA_CONFIG } from "@/components/shell/persona-config"
import { useSession } from "@/lib/session/session-provider"

export function ResetFiltersAction() {
  return <Button variant="secondary" icon={<CalendarSearch aria-hidden />} label="Clear filters" onClick={() => window.location.assign(window.location.pathname)} />
}

export function ReloadAction({ onRetry }: { onRetry?: () => void }) {
  return <Button variant="secondary" icon={<RefreshCw aria-hidden />} label="Try again" onClick={onRetry ?? (() => window.location.reload())} />
}

export function WorkspaceAction({ actionLabel }: { actionLabel: string }) {
  const { user } = useSession()
  return <Button as={NextLink} href={PERSONA_CONFIG[user.persona].home} variant="secondary" icon={<LockKeyhole aria-hidden />} label={actionLabel} />
}
