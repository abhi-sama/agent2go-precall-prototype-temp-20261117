import type { Metadata } from "next"
import { LandingSection } from "@/components/landing/landing-section"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "Overview" }

export default function ExecutiveLandingPage() {
  return (
    <RoleGate persona="executive">
      <LandingSection
        title="Overview"
        description="Aggregate activity across all regions. Individual responses and HCP-level detail are not shown to this role."
      />
    </RoleGate>
  )
}
