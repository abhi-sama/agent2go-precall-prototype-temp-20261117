import type { Metadata } from "next"
import { ExecutiveThemesWorkspace } from "@/components/executive/themes/executive-themes"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "Themes & summaries" }

export default function ExecutiveThemesPage() {
  return (
    <RoleGate persona="executive">
      <ExecutiveThemesWorkspace />
    </RoleGate>
  )
}
