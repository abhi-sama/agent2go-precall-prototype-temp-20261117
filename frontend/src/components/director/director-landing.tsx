"use client"

import { LandingSection } from "@/components/landing/landing-section"
import { DirectorOverview } from "./director-overview"

/** The Director landing: the shared map, KPIs and filters, with the team overview in between. */
export function DirectorLanding() {
  return (
    <LandingSection
      title="My region"
      description="Team activity, mix, engagement and territory comparisons across the territories you are approved to see."
    >
      {({ range }) => <DirectorOverview range={range} />}
    </LandingSection>
  )
}
