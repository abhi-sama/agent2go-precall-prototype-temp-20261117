"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Banner } from "@astryxdesign/core/Banner"
import { Divider } from "@astryxdesign/core/Divider"
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl"
import { Switch } from "@astryxdesign/core/Switch"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { HStack } from "@astryxdesign/core/HStack"
import { BookOpen, FileLock2 } from "lucide-react"
import { useState } from "react"
import { SectionCard } from "@/components/admin/section-card"
import { DashboardGrid, DashboardGridItem } from "@/components/layout/dashboard-grid"
import { BlockSkeleton, ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { ResponseAccessLevel } from "@/lib/data/governance"
import { useQuery } from "@/lib/data/use-query"
import { newCorrelationId } from "@/lib/log/logger"

const LEVELS: { value: ResponseAccessLevel; label: string }[] = [
  { value: "NONE", label: "None" },
  { value: "AGGREGATE_ONLY", label: "Aggregate only" },
  { value: "RECORDS", label: "Records" },
]

const isLevel = (value: string): value is ResponseAccessLevel => LEVELS.some((level) => level.value === value)

/** Two matrices, deliberately separate: catalog visibility never implies response access. */
export function VisibilityMatrices() {
  const adapter = useDataAdapter()
  const [version, setVersion] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const matrices = useQuery("adminVisibility", String(version), (ctx) => adapter.adminVisibility(ctx))

  async function change(key: string, action: () => Promise<unknown>, done: string) {
    setBusy(key); setNotice(null)
    try { await action(); setNotice(done); setVersion((v) => v + 1) }
    catch { setNotice("The change was not saved. Nothing changed.") }
    finally { setBusy(null) }
  }

  if (matrices.status === "loading") return <BlockSkeleton className="h-72" />
  if (matrices.status === "error") return <ErrorState error={matrices.error} onRetry={matrices.refetch} />
  const { catalogMatrix, responseMatrix } = matrices.data
  return (
    <VStack gap={4}>
      <Banner status="info" title="Seeing a catalog question never grants seeing its responses." description="These two matrices are saved separately, so changing one never changes the other. Every change is audited." collapsible={false} data-testid="visibility-principle" />
      <DashboardGrid>
        <DashboardGridItem area="half">
          <SectionCard title="Catalog visibility" icon={BookOpen} description="Who can see which questions exist." data-testid="catalog-matrix" className="h-full">
            <VStack gap={0}>
              {catalogMatrix.map((row, index) => (
                <div key={row.roleId}>
                  {index > 0 && <Divider />}
                  <div className="py-3">
                    <Switch
                      label={`${row.roleName} can see the question catalog`}
                      description={row.catalogVisible ? "Can see the catalog" : "Cannot see the catalog"}
                      labelPosition="start"
                      labelSpacing="spread"
                      width="100%"
                      value={row.catalogVisible}
                      isDisabled={busy !== null}
                      onChange={(checked) => change(`c-${row.roleId}`, () => adapter.setCatalogVisibility({ correlationId: newCorrelationId() }, { roleId: row.roleId, visible: checked }), "Catalog visibility saved and audited.")}
                    />
                  </div>
                </div>
              ))}
            </VStack>
          </SectionCard>
        </DashboardGridItem>
        <DashboardGridItem area="half">
          <SectionCard title="HCP-response access" icon={FileLock2} description="How much of the recorded responses a role can see, still limited to their territories." data-testid="response-matrix" className="h-full">
            <VStack gap={0}>
              {responseMatrix.map((row, index) => (
                <div key={row.roleId}>
                  {index > 0 && <Divider />}
                  <VStack gap={2} paddingBlock={3}>
                    <HStack gap={2} justify="between" align="center" wrap="wrap">
                      <Text weight="medium" className="break-words">{row.roleName}</Text>
                      <Badge variant={row.level === "NONE" ? "neutral" : "success"} label={LEVELS.find((l) => l.value === row.level)?.label ?? row.level} />
                    </HStack>
                    <SegmentedControl
                      label={`${row.roleName} response access`}
                      layout="fill"
                      value={row.level}
                      isDisabled={busy !== null}
                      onChange={(next) => {
                        if (!isLevel(next) || next === row.level) return
                        void change(`r-${row.roleId}`, () => adapter.setResponseAccess({ correlationId: newCorrelationId() }, { roleId: row.roleId, level: next }), "Response access saved and audited.")
                      }}
                    >
                      {LEVELS.map((level) => (
                        <SegmentedControlItem key={level.value} value={level.value} label={level.label} />
                      ))}
                    </SegmentedControl>
                  </VStack>
                </div>
              ))}
            </VStack>
          </SectionCard>
        </DashboardGridItem>
      </DashboardGrid>
      {notice && <Text type="supporting" as="p" role="status">{notice}</Text>}
    </VStack>
  )
}
