"use client"

import { ArrowRight, Sparkles } from "lucide-react"
import Link from "next/link"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { Icon } from "@astryxdesign/core/Icon"
import { Stack } from "@astryxdesign/core/Stack"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
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
        <VStack gap={6}>
          <Card padding={4} elevation="low">
            <Stack direction="horizontal" hAlign="between" vAlign="center" gap={3}>
              <Stack direction="horizontal" vAlign="center" gap={3}>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-accent-text"><Icon icon={Sparkles} size="md" /></span>
                <span>
                  <Heading level={2}>Themes &amp; summaries</Heading>
                  <Text as="p" type="supporting" display="block">Theme cards, topics rising across regions, and a leadership summary you can save and export.</Text>
                </span>
              </Stack>
              <Button as={Link} href="/executive/themes" data-testid="themes-link" label="Open themes and summaries" icon={<Icon icon={ArrowRight} />} variant="secondary" />
            </Stack>
          </Card>
          <ExecutiveOverview />
        </VStack>
      )}
    </LandingSection>
  )
}
