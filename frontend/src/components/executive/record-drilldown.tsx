"use client"

import * as React from "react"
import { Drawer, DrawerHeader } from "@astryxdesign/core/Drawer"
import { Card } from "@astryxdesign/core/Card"
import { HStack } from "@astryxdesign/core/HStack"
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl"
import { Selector } from "@astryxdesign/core/Selector"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { DataThroughBadge } from "@/components/landing/data-through-badge"
import { ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { ExecutiveDrilldownKind, ExecutiveMonth } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { formatDay, formatInstant, formatMonth } from "@/lib/dates"
import { num } from "./count"

export interface DrillTarget {
  scopeId: string
  label: string
}

/**
 * The supporting records behind one region or territory and month. It exists only for an Executive who holds
 * explicit record-level permission; the BE refuses everyone else, so a denied attempt shows the refusal.
 */
export function RecordDrilldown({ target, months, onClose }: { target: DrillTarget | null; months: ExecutiveMonth[]; onClose: () => void }) {
  // Keep the last target mounted while the drawer slides out, so the content does not vanish mid-exit.
  const [shown, setShown] = React.useState(target)
  if (target !== null && target !== shown) setShown(target)
  const view = target ?? shown
  return (
    <Drawer isOpen={target !== null} onOpenChange={(open) => !open && onClose()} label="Records" width="42rem" data-testid="drilldown-drawer">
      {view && <DrillView key={view.scopeId} target={view} months={months} onClose={onClose} />}
    </Drawer>
  )
}

function DrillView({ target, months, onClose }: { target: DrillTarget; months: ExecutiveMonth[]; onClose: () => void }) {
  const adapter = useDataAdapter()
  const complete = months.filter((m) => !m.isPartial)
  const [month, setMonth] = React.useState((complete[complete.length - 1] ?? months[months.length - 1])?.month ?? "")
  const [kind, setKind] = React.useState<ExecutiveDrilldownKind>("CALLS")
  const result = useQuery("executiveDrilldown", `${target.scopeId}:${month}:${kind}`, (ctx) => adapter.executiveDrilldown(ctx, { scopeId: target.scopeId, kind, month, limit: 50 }), month !== "")

  return (
    <>
      <DrawerHeader
        title={`Records · ${target.label}`}
        subtitle="The calls or responses counted for this month. Opened because your account holds record-level permission."
        onOpenChange={(open) => !open && onClose()}
      />
      <VStack gap={4} className="px-5 pb-6">
        <HStack gap={2} align="end" wrap="wrap">
          <Selector
            label="Month"
            data-testid="drill-month"
            value={month}
            onChange={(value) => setMonth(value)}
            options={months.map((m) => ({ value: m.month, label: `${formatMonth(m.month)}${m.isPartial ? " (partial)" : ""}` }))}
            variant="secondary"
            presentation="adaptive"
          />
          <SegmentedControl label="Record type" value={kind} onChange={(value) => setKind(value as ExecutiveDrilldownKind)} size="lg">
            {(["CALLS", "RESPONSES"] as const).map((k) => <SegmentedControlItem key={k} value={k} label={k === "CALLS" ? "Calls" : "Responses"} />)}
          </SegmentedControl>
        </HStack>
        {result.status === "loading" && (
          <VStack data-testid="drill-loading" aria-busy="true" gap={2}>
            <Skeleton width="100%" height="2.5rem" radius={3} />
            <Skeleton width="100%" height="2.5rem" radius={3} />
            <Skeleton width="100%" height="2.5rem" radius={3} />
          </VStack>
        )}
        {result.status === "error" && <ErrorState error={result.error} onRetry={result.refetch} />}
        {result.status === "success" && (
          <VStack key={`${month}:${kind}`} gap={4} className="drill-in">
            <DataThroughBadge dataThrough={result.data.dataThrough} />
            <Text as="p" type="supporting" data-testid="drill-count">
              {result.data.truncated ? `Showing ${result.data.records.length} of ${num(result.data.total)}` : num(result.data.total)} {kind === "CALLS" ? "distinct calls" : "responses"} in {formatMonth(result.data.month)}.
            </Text>
            {result.data.records.length === 0 ? (
              <Card padding={6} variant="muted">
                <Text as="p" type="supporting" display="block" className="text-center">No records for this month in this scope.</Text>
              </Card>
            ) : (
              <Card padding={0}>
                <Table data-testid="drill-table" aria-label={`${kind === "CALLS" ? "Calls" : "Responses"} counted for ${target.label}`} verticalAlign="top">
                  <TableHeader>
                    <TableRow isHeaderRow>
                      <TableHeaderCell scope="col">Record</TableHeaderCell>
                      <TableHeaderCell scope="col">Territory</TableHeaderCell>
                      <TableHeaderCell scope="col">{kind === "CALLS" ? "Channel" : "Response"}</TableHeaderCell>
                      <TableHeaderCell scope="col">Interaction · loaded</TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.data.records.map((r) => (
                      <TableRow key={r.recordId} data-testid="drill-row">
                        <TableHeaderCell scope="row"><Text className="block break-all">{r.recordId}</Text><Text type="supporting" className="block">{r.hcpName ?? r.hcpId}</Text></TableHeaderCell>
                        <TableCell>{r.territoryId}</TableCell>
                        <TableCell>{kind === "CALLS" ? r.detail : r.responseText ?? r.detail}</TableCell>
                        <TableCell><Text className="block">{r.interactionDate ? formatDay(r.interactionDate, true) : "—"}</Text><Text type="supporting" className="block">{r.loadedAt ? formatInstant(r.loadedAt) : "—"}</Text></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </VStack>
        )}
      </VStack>
    </>
  )
}
