import type { Metadata } from "next"
import { IngestionRuns } from "@/components/admin/ingestion-runs"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "Ingestion runs" }

export default function AdminIngestionRunsPage() {
  return (
    <RoleGate persona="admin">
      <IngestionRuns />
    </RoleGate>
  )
}
