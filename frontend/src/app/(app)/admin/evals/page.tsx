import type { Metadata } from "next"
import { EvalPanel } from "@/components/admin/evals/eval-panel"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "AI evaluation" }

export default function AdminEvalsPage() {
  return (
    <RoleGate persona="admin">
      <EvalPanel />
    </RoleGate>
  )
}
