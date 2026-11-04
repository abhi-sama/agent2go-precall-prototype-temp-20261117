import type { Metadata } from "next"
import { OptionalWorkspace } from "@/components/post-call/optional-workspace"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "Post-call workflow" }

export default function FollowUpPage() {
  return <RoleGate persona="msl"><OptionalWorkspace /></RoleGate>
}
