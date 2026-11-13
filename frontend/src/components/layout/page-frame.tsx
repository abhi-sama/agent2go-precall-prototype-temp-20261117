import { Layout, LayoutContent } from "@astryxdesign/core/Layout"
import { VStack } from "@astryxdesign/core/VStack"
import type { ReactNode } from "react"

/**
 * Shared application page frame. Dashboard views retain the available region; text-centric pages may add an inner
 * Layout with a narrower contentWidth rather than making the whole shell narrow.
 *
 * The page gutter lives here, once, for every signed-in page: the stack that holds the page is padded (spacing `4`),
 * so no title, filter bar or card touches the sidebar or the screen edge. It is deliberately a padded stack and not
 * the Layout's own `padding`: Astryx publishes a Layout's padding as a container inset that `Table` and `Section`
 * bleed back out into, which would put every page-level table flush against the edge again. LayoutContent therefore
 * stays at `padding={0}`.
 */
export function PageFrame({ children }: { children: ReactNode }) {
  return (
    <Layout
      contentWidth={1440}
      padding={4}
      content={
        <LayoutContent padding={0} isScrollable={false}>
          <VStack gap={6} padding={4} data-testid="page-frame">{children}</VStack>
        </LayoutContent>
      }
    />
  )
}
