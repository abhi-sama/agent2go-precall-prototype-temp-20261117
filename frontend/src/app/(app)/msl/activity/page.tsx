import type { Metadata } from "next"
import { ActivityTrendsSection } from "@/components/activity/activity-trends"
import { RoleGate } from "@/components/shell/role-gate"

export const metadata: Metadata = { title: "My activity" }

export default function MslActivityPage() {
  return (
    <RoleGate persona="msl">
      <ActivityTrendsSection />
    </RoleGate>
  )
}
