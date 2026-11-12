"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { ToggleButton } from "@astryxdesign/core/ToggleButton"
import { VStack } from "@astryxdesign/core/VStack"
import { AlertOctagon } from "lucide-react"
import * as React from "react"
import { EmptyState, ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import type { DirectorException, ExceptionCategoryCode } from "@/lib/data/director-insights"
import type { DateRange } from "@/lib/data/types"
import { useQuery } from "@/lib/data/use-query"
import { useSession } from "@/lib/session/session-provider"
import { InsightSection, num, PanelLoading, PanelMeta } from "./shared"

const SEVERITY = {
  high: { label: "High", icon: AlertOctagon, variant: "error" },
  medium: { label: "Medium", icon: "warning", variant: "warning" },
  low: { label: "Low", icon: "info", variant: "neutral" },
} as const

/**
 * Exceptions in your scope: stale or failed loads, missing joins, unresolved identities, duplicate keys and status
 * differences. Each row names the fixed rule that found it. A finding says data is missing or ambiguous, never that
 * a person did something wrong.
 */
export function ExceptionsPanel({ range }: { range: DateRange }) {
  const adapter = useDataAdapter()
  const { userId, ready } = useSession()
  const [category, setCategory] = React.useState<ExceptionCategoryCode | "ALL">("ALL")
  const query = useQuery("directorExceptions", `${userId}:${range.from}:${range.to}`, (ctx) => adapter.directorExceptions(ctx, range), ready)
  const data = query.status === "success" ? query.data : null
  const rows = data ? data.exceptions.filter((e) => category === "ALL" || e.category === category) : []

  return (
    <InsightSection
      id="exceptions"
      title="Exceptions"
      note="Data problems inside your scope that can change how far a number can be trusted."
      meta={data && <PanelMeta from={data.from} to={data.to} dataThrough={data.dataThrough}><span data-testid="exception-total">{num(data.exceptions.length)} exceptions</span></PanelMeta>}
    >
      {query.status === "error" ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : !data ? (
        <PanelLoading testId="exceptions-loading" height={288} />
      ) : (
        <VStack gap={4}>
          <HStack gap={2} wrap="wrap" role="group" aria-label="Filter by category">
            <Chip id="ALL" label="All" count={data.exceptions.length} selected={category === "ALL"} onSelect={() => setCategory("ALL")} />
            {data.categories.map((c) => <Chip key={c.category} id={c.category} label={c.label} count={c.count} selected={category === c.category} onSelect={() => setCategory(c.category)} />)}
          </HStack>
          {rows.length === 0 ? (
            <EmptyState title="No exceptions in this category">Nothing was detected by the rules below.</EmptyState>
          ) : (
            <Table data-testid="exceptions-table" aria-label="Exceptions in your approved scope">
              <TableHeader>
                <TableRow isHeaderRow>
                  <TableHeaderCell scope="col" className="w-28! max-w-none!">Severity</TableHeaderCell>
                  <TableHeaderCell scope="col" className="w-28! max-w-none!">Category</TableHeaderCell>
                  <TableHeaderCell scope="col" className="w-24! max-w-none!">Territory</TableHeaderCell>
                  <TableHeaderCell scope="col">Finding</TableHeaderCell>
                  <TableHeaderCell scope="col" className="w-20! max-w-none! text-right">Affected</TableHeaderCell>
                  <TableHeaderCell scope="col" className="w-48! max-w-none!">Sample records</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => <Row key={row.exceptionId} row={row} />)}
              </TableBody>
            </Table>
          )}
          <Card role="region" aria-label="How exceptions are detected" data-testid="exception-rules">
            <VStack gap={2}>
              <Heading level={3}>How each exception is detected</Heading>
              <dl className="grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
                {data.categories.map((c) => (
                  <div key={c.category}><dt className="font-medium">{c.label}</dt><dd className="text-muted-foreground">{c.rule}</dd></div>
                ))}
              </dl>
              <Text type="supporting" as="p">{data.note}</Text>
            </VStack>
          </Card>
        </VStack>
      )}
    </InsightSection>
  )
}

function Chip({ id, label, count, selected, onSelect }: { id: string; label: string; count: number; selected: boolean; onSelect: () => void }) {
  return (
    <ToggleButton isPressed={selected} onPressedChange={onSelect} data-testid={`exception-filter-${id}`} label={`${label} ${count}`}>
      {label} <span className="tabular-nums">{count}</span>
    </ToggleButton>
  )
}

function Row({ row }: { row: DirectorException }) {
  const sev = SEVERITY[row.severity]
  return (
    <TableRow data-testid="exception-row" data-category={row.category} data-severity={row.severity}>
      <TableCell><Badge variant={sev.variant} label={sev.label} icon={<Icon icon={sev.icon} size="xsm" />} /></TableCell>
      <TableCell><Text weight="medium">{row.categoryLabel}</Text></TableCell>
      <TableCell className="tabular-nums">{row.territoryId ?? <Text color="secondary">All</Text>}</TableCell>
      <TableCell><VStack gap={1}><Text weight="medium" as="p">{row.title}</Text><Text type="supporting" as="p">{row.detail}</Text></VStack></TableCell>
      <TableCell className="text-right tabular-nums">{row.affectedCount > 0 ? num(row.affectedCount) : "—"}</TableCell>
      <TableCell>
        <ul className="flex flex-wrap gap-1">{row.sampleRecordIds.map((id) => <li key={id}><Badge variant="neutral" label={id} /></li>)}</ul>
        {row.sourceTable && <Text type="supporting" as="p">{row.sourceTable}</Text>}
      </TableCell>
    </TableRow>
  )
}
