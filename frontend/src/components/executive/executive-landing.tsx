"use client"

import { ArrowRight, Sparkles } from "lucide-react"
import Link from "next/link"
import { LandingSection } from "@/components/landing/landing-section"
import { ExecutiveOverview } from "./executive-overview"

/** The Executive landing: the shared map and filters, with the aggregate-only enterprise overview in between. */
export function ExecutiveLanding() {
  return (
    <LandingSection
      title="Overview"
      description="Aggregate activity across the regions you are explicitly authorized for. Small groups are withheld, and records open only with separate permission."
    >
      {() => (
        <div className="flex flex-col gap-6">
          <Link
            href="/executive/themes"
            data-testid="themes-link"
            className="group flex min-h-16 items-center justify-between gap-4 rounded-2xl border bg-card p-4 shadow-card transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:p-5"
          >
            <span className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-accent-text"><Sparkles className="size-5" aria-hidden /></span>
              <span>
                <span className="block font-semibold">Themes &amp; summaries</span>
                <span className="block text-sm text-muted-foreground">Theme cards, topics rising across regions, and a leadership summary you can save and export.</span>
              </span>
            </span>
            <ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
          </Link>
          <ExecutiveOverview />
        </div>
      )}
    </LandingSection>
  )
}
