"use client"

import { Heading } from "@astryxdesign/core/Heading"
import { Tab, TabList } from "@astryxdesign/core/TabList"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import * as React from "react"
import { ChartsSection, ProvenanceSection, RulesSection, StatesSection } from "./app-patterns"
import { ControlsSection, DataSection, FeedbackSection, NavigationSection } from "./components-in-use"
import { ColourSection, ScaleSection, ThemesSection, TypographySection } from "./foundations"

const CHAPTERS = [
  ["themes", "Themes"],
  ["colour", "Colour"],
  ["type", "Type"],
  ["scale", "Space and motion"],
  ["controls", "Controls"],
  ["data", "Data"],
  ["feedback", "Feedback"],
  ["navigation", "Navigation"],
  ["provenance", "AI content"],
  ["charts", "Charts"],
  ["states", "States"],
  ["rules", "Rules"],
] as const

/**
 * A living style guide: every swatch, type sample and component below is rendered by the same Astryx theme the app
 * uses, so switching the theme or colour scheme restyles the guide itself. Synthetic data only.
 */
export function DesignSystemShowcase() {
  const [chapter, setChapter] = React.useState<string>(CHAPTERS[0][0])
  return (
    <VStack data-testid="design-showcase" gap={6} paddingBlockEnd={8} className="min-w-0">
      <VStack as="header" gap={3}>
        <Heading level={1} type="display-3">Design system</Heading>
        <VStack className="max-w-3xl">
          <Text type="large" color="secondary" as="p" display="block">
            agent2go is built on Astryx. This page is the system as the product uses it: the seven themes, the tokens they set, and the components and patterns every screen is made from. Synthetic data only.
          </Text>
        </VStack>
        <nav aria-label="Style guide chapters" className="min-w-0">
          <TabList value={chapter} onChange={setChapter} hasDivider overflow="scroll">
            {CHAPTERS.map(([id, label]) => (
              <Tab key={id} value={id} label={label} href={`#ds-${id}`} />
            ))}
          </TabList>
        </nav>
      </VStack>
      <ThemesSection />
      <ColourSection />
      <TypographySection />
      <ScaleSection />
      <ControlsSection />
      <DataSection />
      <FeedbackSection />
      <NavigationSection />
      <ProvenanceSection />
      <ChartsSection />
      <StatesSection />
      <RulesSection />
    </VStack>
  )
}
