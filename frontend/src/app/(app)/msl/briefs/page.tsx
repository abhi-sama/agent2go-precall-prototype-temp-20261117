import type { Metadata } from "next"
import { Suspense } from "react"
import { PreCallBriefWorkspace } from "@/components/briefs/precall-brief-workspace"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "Pre-call brief" }

export default function PreCallBriefPage() {
  return (
    <RoleGate persona="msl">
      <Suspense fallback={<div aria-busy="true" className="h-40 animate-pulse rounded-2xl bg-muted/50" />}>
        <PreCallBriefWorkspace />
      </Suspense>
    </RoleGate>
  )
}
