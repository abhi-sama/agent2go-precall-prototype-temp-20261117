import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { EmptyState as AstryxEmptyState } from "@astryxdesign/core/EmptyState"
import { Icon, type IconProps } from "@astryxdesign/core/Icon"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { CalendarSearch, LockKeyhole, Sparkles } from "lucide-react"
import NextLink from "next/link"
import type * as React from "react"
import { ReloadAction, ResetFiltersAction, WorkspaceAction } from "@/components/state/state-actions"
import type { DataError } from "@/lib/data/types"
import { cn } from "@/lib/utils"

export type StateVariant = "empty" | "access" | "error" | "first-run"

const ICON: Record<StateVariant, { icon: IconProps["icon"]; color: "accent" | "info" | "error" | "warning" }> = {
  empty: { icon: CalendarSearch, color: "accent" },
  access: { icon: LockKeyhole, color: "info" },
  error: { icon: "warning", color: "error" },
  "first-run": { icon: Sparkles, color: "accent" },
}

/**
 * One family for the four moments a view has nothing to show: a quiet empty range, an entitlement boundary, a
 * recoverable failure and first-run orientation. An Astryx `EmptyState` inside a muted `Card`, so every theme and
 * colour scheme draws it. `role` tells assistive tech whether it is a status or an alert.
 */
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
  const { icon, color } = ICON[variant]
  const text = typeof children === "string" ? children : undefined
  const extra = typeof children === "string" ? null : children
  return (
    <VStack as="section" data-testid={testId} data-state-variant={variant} role={variant === "error" ? "alert" : "status"} className={cn("mx-auto w-full max-w-2xl", className)}>
      <Card padding={4}>
        <AstryxEmptyState
          icon={<Icon icon={icon} size="lg" color={color} />}
          title={title}
          description={text}
          headingLevel={2}
          actions={actions}
        />
        {extra && (
          <VStack align="center" paddingBlockEnd={2}>
            <Text type="supporting" as="p">{extra}</Text>
          </VStack>
        )}
      </Card>
    </VStack>
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
    <StateShell variant="empty" testId="state-empty" title={title} actions={actions ?? <ResetFiltersAction />}>
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
      <NoAccessState testId="state-error" title={copy.title} actionLabel={error.code === "NO_SCOPE" ? "Go to my workspace" : "Return to my workspace"}>
        {copy.body}
      </NoAccessState>
    )
  }
  return (
    <StateShell
      testId="state-error"
      variant="error"
      title={copy.title}
      actions={retryable ? <ReloadAction onRetry={onRetry} /> : <Button href="/login" as={NextLink} variant="secondary" label="Sign in again" />}
    >
      <>
        {copy.body}
        {error.correlationId && <Text type="code" as="span" display="block">Reference {error.correlationId.slice(0, 8)}</Text>}
      </>
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
    <StateShell variant="access" testId={testId} title={title} actions={<WorkspaceAction actionLabel={actionLabel} />}>
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
    <Card data-testid="state-loading" aria-busy="true" aria-label="Loading">
      <VStack gap={4}>
        <Skeleton width={112} height={16} />
        <Skeleton width={96} height={40} />
        <Skeleton width={160} height={12} />
      </VStack>
    </Card>
  )
}

export function BlockSkeleton({ className }: { className?: string }) {
  return <Skeleton aria-hidden className={className} />
}
