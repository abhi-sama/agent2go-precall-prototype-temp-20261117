"use client"

import { ChevronRight, Lock, MessageSquareText } from "lucide-react"
import Link from "next/link"
import * as React from "react"
import { HcpTimeline } from "@/components/hcps/hcp-timeline"
import { EmptyState, ErrorState } from "@/components/state/states"
import { Button, buttonVariants } from "@/components/ui/button"
import { chatLink } from "@/lib/chat/context"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { DirectorDrilldown, DrillChild, DrilldownLevel } from "@/lib/data/director-insights"
import type { DateRange } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { useSession } from "@/lib/session/session-provider"
import { cn } from "@/lib/utils"
import { InsightSection, num, PanelLoading, PanelMeta } from "./shared"

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
      <div className="flex flex-col gap-4">
        <p data-testid="drilldown-limit" className="flex items-start gap-2 rounded-xl border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          Drill-down stops at records you are permitted to see. Anything outside your approved scope is not listed and cannot be opened.
        </p>
        {query.status === "error" && !data ? (
          <ErrorState error={query.error} onRetry={query.refetch} />
        ) : !data ? (
          <PanelLoading testId="drilldown-loading" height="h-64" />
        ) : (
          <div className="flex flex-col gap-4" aria-busy={query.status === "loading"}>
            <nav aria-label="Drill-down path" data-testid="drill-breadcrumb">
              <ol className="flex flex-wrap items-center gap-1 text-sm">
                {data.breadcrumb.map((crumb, i) => {
                  const last = i === data.breadcrumb.length - 1 && !hcp
                  return (
                    <li key={`${crumb.level}:${crumb.id}`} className="flex items-center gap-1">
                      {i > 0 && <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
                      <button type="button" disabled={last} aria-current={last ? "page" : undefined} onClick={() => go(i === 0 ? { level: "ROOT", id: "" } : { level: crumb.level as DrilldownLevel, id: crumb.id })} className={cn("min-h-11 rounded-lg px-2.5 font-medium", last ? "text-foreground" : "text-primary hover:bg-muted")}>
                        {crumb.label}
                      </button>
                    </li>
                  )
                })}
                {hcp && (
                  <li className="flex items-center gap-1"><ChevronRight className="size-4 text-muted-foreground" aria-hidden /><span aria-current="page" className="px-2.5 font-medium">{hcp.id}</span></li>
                )}
              </ol>
            </nav>

            {data.children.length === 0 ? (
              <EmptyState title="Nothing to show here">No records were recorded at this level in this period.</EmptyState>
            ) : (
              <div className="overflow-x-auto rounded-xl border" role="region" aria-label="Drill-down rows, scrolls sideways" tabIndex={0}>
                <table data-testid="drill-table" data-level={data.level} className="w-full min-w-[36rem] border-collapse text-sm">
                  <caption className="sr-only">{data.level === "ROOT" ? "Regions" : data.level === "REGION" ? "Territories" : "HCPs"} in your approved scope</caption>
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th scope="col" className="px-3 py-2 font-medium">{data.level === "ROOT" ? "Region" : data.level === "REGION" ? "Territory" : "HCP"}</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">Calls</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">HCPs</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">Responses</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium"><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.children.map((child) => (
                      <tr key={child.id} data-testid="drill-row" data-id={child.id} data-level={child.level} className="border-b last:border-b-0">
                        <th scope="row" className="px-3 py-1.5 text-left font-medium">
                          {child.label}
                          <span className="block text-xs font-normal text-muted-foreground">{child.level === "HCP" ? (child.lastInteractionDate ? `Last interaction ${child.lastInteractionDate}` : "") : `${num(child.childCount)} ${child.childLabel}`}</span>
                        </th>
                        <td className="px-2 py-1.5 text-right tabular-nums">{num(child.distinctCalls)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{num(child.distinctEngagedHcps)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{num(child.responses)}</td>
                        <td className="px-3 py-1 text-right">
                          <Button variant="outline" size="sm" data-testid="drill-open" onClick={() => open(child)} aria-label={`${child.level === "HCP" ? "View timeline for" : "Open"} ${child.label}`}>
                            {child.level === "HCP" ? "Timeline" : "Open"} <ChevronRight aria-hidden />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.truncated && <p data-testid="drill-truncated" className="text-sm text-muted-foreground">Showing {data.children.length} of {num(data.totalChildren)}. The busiest are listed first.</p>}

            {data.level === "TERRITORY" && (
              <div>
                <Link href={chatLink({ view: "director-insights", territoryId: data.id, from: range.from, to: range.to })} data-testid="ask-agent-territory" className={cn(buttonVariants({ variant: "outline" }))}>
                  <MessageSquareText aria-hidden /> Ask the agent about {data.id}
                </Link>
              </div>
            )}

            {hcp && (
              <section data-testid="drill-hcp" aria-label={`Interactions for ${hcp.id}`} className="rounded-2xl border bg-card p-4">
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold">Interactions and responses for {hcp.id}</h3>
                  <Button variant="ghost" size="sm" onClick={() => setHcp(null)}>Close</Button>
                </header>
                <p className="mt-1 text-sm text-muted-foreground">This is the last level. It shows only the records you are permitted to see for this HCP.</p>
                <HcpTimeline hcpId={hcp.id} />
              </section>
            )}
          </div>
        )}
      </div>
    </InsightSection>
  )
}
