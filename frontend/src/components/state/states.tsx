import Link from "next/link"
import type * as React from "react"
import { ResetFiltersAction, ReloadAction, WorkspaceAction } from "@/components/state/state-actions"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { DataError } from "@/lib/data/types"
import { cn } from "@/lib/utils"

export type StateVariant = "empty" | "access" | "error" | "first-run"

/**
 * An illustrated scene is the baseline renderer: it works without WebGL and remains legible when
 * motion is reduced. CSS adds a little perspective where supported, without making access to the
 * state depend on a canvas or a GPU.
 */
function StateScene({ variant }: { variant: StateVariant }) {
  return (
    <div
      aria-hidden="true"
      className="state-scene"
      data-scene-fallback="illustrated-2d"
      data-state-scene={variant}
    >
      <span className="state-scene__halo" />
      <span className="state-scene__platform" />
      <span className="state-scene__panel state-scene__panel--back" />
      <span className="state-scene__panel state-scene__panel--front" />
      <span className="state-scene__signal" />
      <span className="state-scene__marker" />
    </div>
  )
}

function StateShell({
  variant,
  title,
  children,
  actions,
  testId,
  className,
}: {
  variant: StateVariant
  title: string
  children?: React.ReactNode
  actions?: React.ReactNode
  testId: string
  className?: string
}) {
  return (
    <section
      data-testid={testId}
      data-state-variant={variant}
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "state-family mx-auto flex w-full max-w-2xl flex-col items-center text-center",
        className,
      )}
    >
      <StateScene variant={variant} />
      <div className="state-family__copy">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {children && <p className="mt-2 max-w-prose text-sm text-muted-foreground">{children}</p>}
        {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
      </div>
    </section>
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
    <StateShell
      variant="empty"
      testId="state-empty"
      title={title}
      actions={actions ?? <ResetFiltersAction />}
    >
      {children}
    </StateShell>
  )
}

const ERROR_COPY: Record<DataError["code"], { title: string; body: string; locked?: boolean }> = {
  UNAUTHENTICATED: { title: "Session expired", body: "Sign in again to continue." },
  FORBIDDEN: { title: "No access to this view", body: "Your role does not include this data. Nothing was loaded.", locked: true },
  BAD_REQUEST: { title: "That could not be sent", body: "The request was not accepted. Check what you entered and try again." },
  NO_SCOPE: { title: "No territory assigned", body: "Your account has no active territory assignment. Ask an administrator to check it.", locked: true },
  NOT_FOUND: { title: "Not available", body: "That record is not available in your scope.", locked: true },
  UNAVAILABLE: { title: "Data is unavailable", body: "We could not reach the data service. Your access is unchanged." },
  TIMEOUT: { title: "That took too long", body: "The request timed out. Try again." },
  UNKNOWN: { title: "Something went wrong", body: "We could not load this. Try again." },
}

export function ErrorState({ error, onRetry }: { error: DataError; onRetry?: () => void }) {
  const copy = ERROR_COPY[error.code]
  const retryable = error.code !== "FORBIDDEN" && error.code !== "NO_SCOPE" && error.code !== "UNAUTHENTICATED"
  if (copy.locked) {
    return (
      <NoAccessState
        testId="state-error"
        title={copy.title}
        actionLabel={error.code === "NO_SCOPE" ? "Go to my workspace" : "Return to my workspace"}
      >
        {copy.body}
      </NoAccessState>
    )
  }
  return (
    <StateShell
      testId="state-error"
      variant="error"
      title={copy.title}
      actions={
        retryable ? <ReloadAction onRetry={onRetry} /> : (
          <Link href="/login" className={buttonVariants({ variant: "outline" })}>
            Sign in again
          </Link>
        )
      }
    >
      {copy.body}
      {error.correlationId && (
        <span className="mt-2 block font-mono text-xs">Reference {error.correlationId.slice(0, 8)}</span>
      )}
    </StateShell>
  )
}

export function NoAccessState({
  title = "No access to this view",
  children = "This workspace is limited to the persona and scope assigned to you. Nothing was loaded.",
  actionLabel = "Return to my workspace",
  testId = "state-no-access",
}: {
  title?: string
  children?: React.ReactNode
  actionLabel?: string
  testId?: string
}) {
  return (
    <StateShell
      variant="access"
      testId={testId}
      title={title}
      actions={
        <WorkspaceAction actionLabel={actionLabel} />
      }
    >
      {children}
    </StateShell>
  )
}

export function FirstRunState({
  title = "Start with the signal in your scope",
  children = "Your workspace brings together activity, recorded insights and the next question to explore. Begin with the view designed for your assigned scope.",
  action,
}: {
  title?: string
  children?: React.ReactNode
  action: React.ReactNode
}) {
  return (
    <StateShell variant="first-run" testId="state-first-run" title={title} actions={action}>
      {children}
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
