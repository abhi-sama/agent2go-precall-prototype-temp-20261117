import type { Metadata } from "next"
import { HcpSearch } from "@/components/hcps/hcp-search"
import { LandingSection } from "@/components/landing/landing-section"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "My territory" }

export default function MslLandingPage() {
  return (
    <RoleGate persona="msl">
      <LandingSection
        title="My territory"
        description="Your calls, engaged HCPs and insight responses, limited to the territory you are assigned."
      />
      <div className="mt-8">
        <HcpSearch />
      </div>
    </RoleGate>
  )
}
