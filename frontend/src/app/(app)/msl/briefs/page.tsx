import type { Metadata } from "next"
import { Suspense } from "react"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { PreCallBriefWorkspace } from "@/components/briefs/precall-brief-workspace"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "Pre-call brief" }

export default function PreCallBriefPage() {
  return (
    <RoleGate persona="msl">
      <Suspense fallback={<Skeleton aria-busy="true" height={160} radius={3} />}>
        <PreCallBriefWorkspace />
      </Suspense>
    </RoleGate>
  )
}
