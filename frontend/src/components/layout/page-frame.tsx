import { Layout, LayoutContent } from "@astryxdesign/core/Layout"
import { VStack } from "@astryxdesign/core/VStack"
import type { ReactNode } from "react"

/**
 * Shared application page frame. Dashboard views retain the available region; text-centric pages may add an inner
 * Layout with a narrower contentWidth rather than making the whole shell narrow.
 */
export function PageFrame({ children }: { children: ReactNode }) {
  return (
    <Layout
      contentWidth={1440}
      padding={4}
      content={
        <LayoutContent padding={0} isScrollable={false}>
          <VStack gap={6}>{children}</VStack>
        </LayoutContent>
      }
    />
  )
}
