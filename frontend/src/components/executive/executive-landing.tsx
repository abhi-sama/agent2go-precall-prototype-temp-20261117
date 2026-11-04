"use client"

import { LandingSection } from "@/components/landing/landing-section"
import { ExecutiveOverview } from "./executive-overview"

/** The Executive landing: the shared map and filters, with the aggregate-only enterprise overview in between. */
export function ExecutiveLanding() {
  return (
    <LandingSection
      title="Overview"
      description="Aggregate activity across the regions you are explicitly authorized for. Small groups are withheld, and records open only with separate permission."
    >
      {() => <ExecutiveOverview />}
    </LandingSection>
  )
}
