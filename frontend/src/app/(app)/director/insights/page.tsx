import type { Metadata } from "next"
import { DirectorInsights } from "@/components/director/insights/director-insights"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "Director insights" }

export default function DirectorInsightsPage() {
  return (
    <RoleGate persona="director">
      <DirectorInsights />
    </RoleGate>
  )
}
