"use client"

import { Lightbulb } from "lucide-react"
import Link from "next/link"
import { LandingSection } from "@/components/landing/landing-section"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
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
          <Link href="/director/insights" data-testid="insights-link" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-fit")}>
            <Lightbulb aria-hidden /> Open Director insights: themes, emerging topics, exceptions
          </Link>
          <DirectorOverview range={range} />
        </>
      )}
    </LandingSection>
  )
}
