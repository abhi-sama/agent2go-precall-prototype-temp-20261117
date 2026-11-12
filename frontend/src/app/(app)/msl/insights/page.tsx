import type { Metadata } from "next"
import { MslInsightsWorkspace } from "@/components/msl/insights/page"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "Insights" }

export default function MslInsightsPage() {
  return <RoleGate persona="msl"><MslInsightsWorkspace /></RoleGate>
}
