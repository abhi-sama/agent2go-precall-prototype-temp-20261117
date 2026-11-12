import { Grid, GridSpan } from "@astryxdesign/core/Grid"
import { VStack } from "@astryxdesign/core/VStack"
import type { ReactNode } from "react"

export type DashboardArea = "primary" | "secondary" | "focus" | "detail" | "half" | "full"

/**
 * A component-scoped dashboard skeleton. Its container query promotes the grid to twelve tracks only when the
 * content region has enough room, so a docked inspector cannot make dashboard cards illegible.
 */
export function DashboardGrid({ children }: { children: ReactNode }) {
  return (
    <VStack className="a2g-dashboard-scope" gap={4}>
      <Grid className="a2g-dashboard-grid" columns={1} gap={4} data-testid="dashboard-grid">
        {children}
      </Grid>
    </VStack>
  )
}

/** A semantic span for a reusable dashboard region; CSS owns its adaptive placement. */
export function DashboardGridItem({ area, children }: { area: DashboardArea; children: ReactNode }) {
  return (
    <GridSpan columns="full" className={`a2g-dashboard-item a2g-dashboard-item--${area}`}>
      {children}
    </GridSpan>
  )
}
