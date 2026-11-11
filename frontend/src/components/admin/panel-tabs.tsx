"use client"

import { Tab, TabList } from "@astryxdesign/core/TabList"
import { VStack } from "@astryxdesign/core/VStack"
import * as React from "react"

export interface PanelTab {
  value: string
  label: string
}

/**
 * Tabs that switch one panel in place (WAI-ARIA tabs pattern): an Astryx `TabList role="tablist"` whose tabs point at
 * the single labelled `tabpanel` below. Only the selected panel's content is mounted, so a tab that is never opened
 * never fetches. `children` is the content of the selected tab.
 */
export function PanelTabs({ tabs, value, onChange, children }: { tabs: readonly PanelTab[]; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  const panelId = React.useId()
  const current = tabs.find((tab) => tab.value === value) ?? tabs[0]
  return (
    <VStack gap={4}>
      <TabList role="tablist" value={current.value} onChange={onChange} hasDivider overflow="scroll" aria-label="Sections">
        {tabs.map((tab) => (
          <Tab key={tab.value} value={tab.value} label={tab.label} panelId={panelId} />
        ))}
      </TabList>
      <div id={panelId} role="tabpanel" aria-label={current.label} tabIndex={-1} className="min-w-0 outline-none">
        {children}
      </div>
    </VStack>
  )
}
