"use client"

import { Lightbulb } from "lucide-react"
import Link from "next/link"
import { Button } from "@astryxdesign/core/Button"
import { LandingSection } from "@/components/landing/landing-section"
import { DirectorOverview } from "./director-overview"

/** The Director landing: the shared map, KPIs and filters, with the team overview in between. */
export function DirectorLanding() {
  return (
    <LandingSection
      title="My region"
      description="Team activity, mix, engagement and territory comparisons across the territories you are approved to see."
    >
      {({ range }) => (
        <>
          <Button
            as={Link}
            href="/director/insights"
            data-testid="insights-link"
            label="Open Director insights: themes, emerging topics, exceptions"
            icon={<Lightbulb aria-hidden />}
            size="lg"
            variant="secondary"
          />
          <DirectorOverview range={range} />
        </>
      )}
    </LandingSection>
  )
}
