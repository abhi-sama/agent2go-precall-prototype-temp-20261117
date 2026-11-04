import type { Metadata } from "next"
import { AdminLanding } from "@/components/landing/admin-landing"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "Administration" }

export default function AdminLandingPage() {
  return (
    <RoleGate persona="admin">
      <AdminLanding />
    </RoleGate>
  )
}
