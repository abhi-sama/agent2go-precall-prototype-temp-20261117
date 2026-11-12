"use client"

import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { Lock, MessageSquareText } from "lucide-react"
import NextLink from "next/link"
import * as React from "react"
import { HcpTimeline } from "@/components/hcps/hcp-timeline"
import { DashboardGrid, DashboardGridItem } from "@/components/layout/dashboard-grid"
import { EmptyState, ErrorState } from "@/components/state/states"
import { chatLink } from "@/lib/chat/context"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { DirectorDrilldown, DrillChild, DrilldownLevel } from "@/lib/data/director-insights"
import type { DateRange } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { useSession } from "@/lib/session/session-provider"
import { InsightSection, num, PanelLoading, PanelMeta } from "./shared"

const LEVEL_RANK: Record<DrilldownLevel, number> = { ROOT: 0, REGION: 1, TERRITORY: 2 }

interface Node {
  level: DrilldownLevel
  id: string
}

/**
 * Region -> territory -> permitted HCP -> interactions and responses. Each level lists only what the database lets the
 * Director read; a region or territory outside the scope answers exactly like one that does not exist. The HCP level is
 * the last step: it opens the HCP's own timeline and goes no deeper.
 */
export function DrilldownPanel({ range }: { range: DateRange }) {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const [node, setNode] = React.useState<Node>({ level: "ROOT", id: "" })
  const [hcp, setHcp] = React.useState<DrillChild | null>(null)
  const query = useQuery("directorDrilldown", `${userId}:${range.from}:${range.to}:${node.level}:${node.id}`, (ctx) => adapter.directorDrilldown(ctx, { level: node.level, id: node.id || null, range }), ready)
  const [kept, setKept] = React.useState<{ userId: string; data: DirectorDrilldown } | null>(null)
  if (query.status === "success" && kept?.data !== query.data) setKept({ userId, data: query.data })
  const data = query.status === "success" ? query.data : kept?.userId === userId ? kept.data : null
  // Which way the last level change went, so the new rows grow in (drill down) or settle back (drill up).
  const [shown, setShown] = React.useState<{ level: DrilldownLevel; dir: "in" | "out" }>({ level: "ROOT", dir: "in" })
  if (data && shown.level !== data.level) setShown({ level: data.level, dir: LEVEL_RANK[data.level] < LEVEL_RANK[shown.level] ? "out" : "in" })

  const go = (next: Node) => {
    setHcp(null)
    setNode(next)
  }
  const open = (child: DrillChild) => {
    if (child.level === "HCP") setHcp(child)
    else go({ level: child.level, id: child.id })
  }

  return (
    <InsightSection
      id="drilldown"
      title="Drill down to the evidence"
      note="Region, then territory, then an HCP, then that HCP's interactions and responses."
      meta={data && <PanelMeta from={data.from} to={data.to} dataThrough={data.dataThrough} />}
    >
      <VStack gap={4}>
        <Card variant="muted" padding={3} data-testid="drilldown-limit" className="border border-dashed">
          <HStack gap={2} align="start">
            <Icon icon={Lock} size="sm" color="secondary" className="mt-0.5" />
            <Text type="supporting">Drill-down stops at records you are permitted to see. Anything outside your approved scope is not listed and cannot be opened.</Text>
          </HStack>
        </Card>
        {query.status === "error" && !data ? (
          <ErrorState error={query.error} onRetry={query.refetch} />
        ) : !data ? (
          <PanelLoading testId="drilldown-loading" height={256} />
        ) : (
          <VStack key={`${data.level}:${data.id}`} data-dir={shown.dir} gap={4} aria-busy={query.status === "loading"}>
            <Breadcrumbs label="Drill-down path" data-testid="drill-breadcrumb" separator={<Icon icon="chevronRight" size="sm" color="secondary" />}>
              {data.breadcrumb.map((crumb, i) => {
                const last = i === data.breadcrumb.length - 1 && !hcp
                return (
                  <BreadcrumbItem key={`${crumb.level}:${crumb.id}`} isCurrent={last} onClick={last ? undefined : () => go(i === 0 ? { level: "ROOT", id: "" } : { level: crumb.level as DrilldownLevel, id: crumb.id })}>
                    {crumb.label}
                  </BreadcrumbItem>
                )
              })}
              {hcp && <BreadcrumbItem isCurrent>{hcp.id}</BreadcrumbItem>}
            </Breadcrumbs>

            <DashboardGrid>
              <DashboardGridItem area={hcp ? "focus" : "full"}>
                <VStack gap={4}>
                  {data.children.length === 0 ? (
                    <EmptyState title="Nothing to show here">No records were recorded at this level in this period.</EmptyState>
                  ) : (
                    <Table data-testid="drill-table" data-level={data.level} aria-label={`${data.level === "ROOT" ? "Regions" : data.level === "REGION" ? "Territories" : "HCPs"} in your approved scope`}>
                      <TableHeader>
                        <TableRow isHeaderRow>
                          <TableHeaderCell scope="col">{data.level === "ROOT" ? "Region" : data.level === "REGION" ? "Territory" : "HCP"}</TableHeaderCell>
                          <TableHeaderCell scope="col" className="text-right">Calls</TableHeaderCell>
                          <TableHeaderCell scope="col" className="text-right">HCPs</TableHeaderCell>
                          <TableHeaderCell scope="col" className="text-right">Responses</TableHeaderCell>
                          <TableHeaderCell scope="col" className="text-right"><span className="sr-only">Open</span></TableHeaderCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.children.map((child) => (
                          <TableRow key={child.id} data-testid="drill-row" data-id={child.id} data-level={child.level}>
                            <TableCell scope="row">
                              <VStack gap={1}>
                                <Text weight="medium" as="div">{child.label}</Text>
                                <Text type="supporting" as="div">{child.level === "HCP" ? (child.lastInteractionDate ? `Last interaction ${child.lastInteractionDate}` : "") : `${num(child.childCount)} ${child.childLabel}`}</Text>
                              </VStack>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{num(child.distinctCalls)}</TableCell>
                            <TableCell className="text-right tabular-nums">{num(child.distinctEngagedHcps)}</TableCell>
                            <TableCell className="text-right tabular-nums">{num(child.responses)}</TableCell>
                            <TableCell className="text-right">
                              <Button variant="secondary" size="sm" data-testid="drill-open" onClick={() => open(child)} label={`${child.level === "HCP" ? "View timeline for" : "Open"} ${child.label}`} endContent={<Icon icon="chevronRight" />}>
                                {child.level === "HCP" ? "Timeline" : "Open"}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  {data.truncated && <Text type="supporting" as="p" data-testid="drill-truncated">Showing {data.children.length} of {num(data.totalChildren)}. The busiest are listed first.</Text>}

                  {data.level === "TERRITORY" && (
                    <HStack>
                      <Button href={chatLink({ view: "director-insights", territoryId: data.id, from: range.from, to: range.to })} as={NextLink} data-testid="ask-agent-territory" variant="secondary" label={`Ask the agent about ${data.id}`} icon={<Icon icon={MessageSquareText} />} />
                    </HStack>
                  )}
                </VStack>
              </DashboardGridItem>

              {hcp && (
                <DashboardGridItem area="detail">
                  <Card key={hcp.id} data-testid="drill-hcp" role="region" aria-label={`Interactions for ${hcp.id}`}>
                    <VStack gap={1}>
                      <HStack gap={2} align="center" justify="between" wrap="wrap">
                        <Heading level={3}>Interactions and responses for {hcp.id}</Heading>
                        <Button variant="ghost" size="sm" label="Close" onClick={() => setHcp(null)} />
                      </HStack>
                      <Text type="supporting" as="p">This is the last level. It shows only the records you are permitted to see for this HCP.</Text>
                      <HcpTimeline hcpId={hcp.id} />
                    </VStack>
                  </Card>
                </DashboardGridItem>
              )}
            </DashboardGrid>
          </VStack>
        )}
      </VStack>
    </InsightSection>
  )
}
