import type { Metadata } from "next"
import { LandingSection } from "@/components/landing/landing-section"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "My region" }

export default function DirectorLandingPage() {
  return (
    <RoleGate persona="director">
      <LandingSection
        title="My region"
        description="Activity across the territories in your region. Region-level themes and team views arrive in later releases."
      />
    </RoleGate>
  )
}
