import type { Metadata } from "next"
import { ExecutiveLanding } from "@/components/executive/executive-landing"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "Overview" }

export default function ExecutiveLandingPage() {
  return (
    <RoleGate persona="executive">
      <ExecutiveLanding />
    </RoleGate>
  )
}
