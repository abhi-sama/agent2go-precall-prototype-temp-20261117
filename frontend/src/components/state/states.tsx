import { AlertTriangle, CalendarSearch, Lock, RefreshCw, WifiOff } from "lucide-react"
import type * as React from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { DataError } from "@/lib/data/types"
import { cn } from "@/lib/utils"

function StateShell({
  icon,
  title,
  children,
  actions,
  tone = "neutral",
  testId,
  className,
}: {
  icon: React.ReactNode
  title: string
  children?: React.ReactNode
  actions?: React.ReactNode
  tone?: "neutral" | "danger" | "locked"
  testId: string
  className?: string
}) {
  return (
    <div
      data-testid={testId}
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center",
        tone === "danger" && "border-destructive/40 bg-destructive/5",
        tone === "locked" && "border-ink/30 bg-fact-soft",
        tone === "neutral" && "border-border bg-muted/40",
        className,
      )}
    >
      <span
        className={cn(
          "grid size-12 place-items-center rounded-2xl",
          tone === "danger" ? "bg-destructive/10 text-destructive" : tone === "locked" ? "bg-ink/10 text-fact" : "bg-accent text-accent-text",
        )}
      >
        {icon}
      </span>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      {children && <p className="max-w-prose text-sm text-muted-foreground">{children}</p>}
      {actions && <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({
  title = "No activity in this range",
  children = "No calls were recorded for your scope in these dates. Try a wider range.",
  actions,
}: {
  title?: string
  children?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <StateShell testId="state-empty" icon={<CalendarSearch className="size-6" aria-hidden />} title={title} actions={actions}>
      {children}
    </StateShell>
  )
}

const ERROR_COPY: Record<DataError["code"], { title: string; body: string; locked?: boolean }> = {
  UNAUTHENTICATED: { title: "Session expired", body: "Sign in again to continue." },
  FORBIDDEN: { title: "No access to this view", body: "Your role does not include this data. Nothing was loaded.", locked: true },
  BAD_REQUEST: { title: "That could not be sent", body: "The request was not accepted. Check what you entered and try again." },
  NO_SCOPE: { title: "No territory assigned", body: "Your account has no active territory assignment. Ask an administrator to check it.", locked: true },
  UNAVAILABLE: { title: "Data is unavailable", body: "We could not reach the data service. Your access is unchanged." },
  TIMEOUT: { title: "That took too long", body: "The request timed out. Try again." },
  UNKNOWN: { title: "Something went wrong", body: "We could not load this. Try again." },
}

export function ErrorState({ error, onRetry }: { error: DataError; onRetry?: () => void }) {
  const copy = ERROR_COPY[error.code]
  const retryable = error.code !== "FORBIDDEN" && error.code !== "NO_SCOPE" && error.code !== "UNAUTHENTICATED"
  return (
    <StateShell
      testId="state-error"
      tone={copy.locked ? "locked" : "danger"}
      icon={copy.locked ? <Lock className="size-6" aria-hidden /> : error.code === "UNAVAILABLE" ? <WifiOff className="size-6" aria-hidden /> : <AlertTriangle className="size-6" aria-hidden />}
      title={copy.title}
      actions={
        onRetry && retryable ? (
          <Button variant="outline" onClick={onRetry}>
            <RefreshCw aria-hidden /> Try again
          </Button>
        ) : undefined
      }
    >
      {copy.body}
      {error.correlationId && (
        <span className="mt-2 block font-mono text-xs opacity-70">Reference {error.correlationId.slice(0, 8)}</span>
      )}
    </StateShell>
  )
}

export function KpiSkeleton() {
  return (
    <div data-testid="state-loading" aria-busy="true" aria-label="Loading" className="rounded-2xl border bg-card p-5 shadow-card">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-5 h-10 w-24" />
      <Skeleton className="mt-4 h-3 w-40" />
    </div>
  )
}

export function BlockSkeleton({ className }: { className?: string }) {
  return <Skeleton aria-hidden className={cn("rounded-2xl", className)} />
}
