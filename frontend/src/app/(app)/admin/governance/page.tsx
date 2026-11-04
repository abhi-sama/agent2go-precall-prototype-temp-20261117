import type { Metadata } from "next"
import { GovernanceWorkspace } from "@/components/admin/governance-workspace"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "Hierarchy and coverage" }

export default function AdminGovernancePage() {
  return (
    <RoleGate persona="admin">
      <GovernanceWorkspace />
    </RoleGate>
  )
}
