import type { Metadata } from "next"
import { DirectorLanding } from "@/components/director/director-landing"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "My region" }

export default function DirectorLandingPage() {
  return (
    <RoleGate persona="director">
      <DirectorLanding />
    </RoleGate>
  )
}
