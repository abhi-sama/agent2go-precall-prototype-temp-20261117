import type { Metadata } from "next"
import { ExecutiveTrendsWorkspace } from "@/components/executive/trends/executive-trends"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "Trends" }

export default function ExecutiveTrendsPage() {
  return (
    <RoleGate persona="executive">
      <ExecutiveTrendsWorkspace />
    </RoleGate>
  )
}
