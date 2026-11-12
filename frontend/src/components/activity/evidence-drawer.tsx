"use client"

import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Drawer, DrawerHeader } from "@astryxdesign/core/Drawer"
import { EmptyState as AstryxEmptyState } from "@astryxdesign/core/EmptyState"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { IconButton } from "@astryxdesign/core/IconButton"
import { Layout, LayoutContent } from "@astryxdesign/core/Layout"
import { Pagination } from "@astryxdesign/core/Pagination"
import { Selector } from "@astryxdesign/core/Selector"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Table } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton"
import { VStack } from "@astryxdesign/core/VStack"
import { Flag as FlagIcon } from "lucide-react"
import * as React from "react"
import { DataThroughBadge } from "@/components/landing/data-through-badge"
import { ErrorState } from "@/components/state/states"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import type { ActivityMetric, ActivityTrends, EvidenceRecord, Flag } from "@/lib/data/types"
import { formatDay, formatInstant, formatMonth } from "@/lib/dates"
import { channelLabel } from "./format"
import { FlagForm, type FlagPreset } from "./flag-form"

export type DrawerState =
  | { view: "evidence"; metric: ActivityMetric; month: string; channel: string | null }
  | { view: "flag"; preset?: FlagPreset }

const METRIC_LABEL: Record<ActivityMetric, string> = { CALLS: "Distinct calls", HCPS: "Distinct engaged HCPs" }
/** The Selector has no empty-string option value, so "all channels" travels as this sentinel. */
const ALL_CHANNELS = "__all__"

/**
 * Evidence behind a chart point, and the flag form. One drawer with two views so the user never
 * stacks modals on an iPad. The evidence view shows what the number is made of and keeps the two
 * dates apart: the interaction date is when the exchange happened, the load date is when the record
 * reached this system.
 */
export function EvidenceDrawer({
  state,
  onStateChange,
  onClose,
  trends,
  onFlagged,
}: {
  state: DrawerState | null
  onStateChange: (next: DrawerState) => void
  onClose: () => void
  trends: ActivityTrends
  onFlagged: (flag: Flag) => void
}) {
  // Keep the last view mounted while the drawer slides out, so the content does not vanish mid-exit.
  const [shown, setShown] = React.useState<DrawerState | null>(state)
  if (state !== null && state !== shown) setShown(state)
  const view = state ?? shown
  const flagging = view?.view === "flag"

  return (
    <Drawer
      isOpen={state !== null}
      onOpenChange={(open) => !open && onClose()}
      label={flagging ? "Flag an issue" : "Evidence"}
      purpose={flagging ? "form" : "info"}
      width="42rem"
      data-testid="evidence-drawer"
    >
      {view?.view === "evidence" && <EvidenceView state={view} onStateChange={onStateChange} onClose={onClose} trends={trends} />}
      {view?.view === "flag" && (
        <Layout
          header={
            <DrawerHeader
              title="Flag an issue"
              subtitle="Report an incorrect summary, identifier or territory assignment. You can follow its review status afterwards."
              onOpenChange={(open) => !open && onClose()}
            />
          }
          content={
            <LayoutContent>
              <FlagForm preset={view.preset} onFlagged={onFlagged} onDone={onClose} />
            </LayoutContent>
          }
        />
      )}
    </Drawer>
  )
}

function EvidenceView({
  state,
  onStateChange,
  onClose,
  trends,
}: {
  state: Extract<DrawerState, { view: "evidence" }>
  onStateChange: (next: DrawerState) => void
  onClose: () => void
  trends: ActivityTrends
}) {
  const adapter = useDataAdapter()
  const { metric, month, channel } = state
  const [page, setPage] = React.useState(1)
  const pageSize = 10
  const evidence = useQuery("activityEvidence", `${metric}:${month}:${channel ?? "all"}`, (ctx) =>
    adapter.activityEvidence(ctx, { metric, month, channel, limit: 50 }),
  )
  const months = trends.months.map((m) => m.month)
  const index = months.indexOf(month)
  const go = (delta: number) => {
    const next = months[index + delta]
    if (next) onStateChange({ ...state, month: next })
  }
  const flagRecord = (r: EvidenceRecord) =>
    onStateChange({
      view: "flag",
      preset: {
        targetType: r.kind === "CALL" ? "CALL" : "HCP",
        targetId: r.recordId,
        label: r.hcpName ?? undefined,
      },
    })

  const totalPages = evidence.status === "success" ? Math.max(1, Math.ceil(evidence.data.records.length / pageSize)) : 1
  const activePage = Math.min(page, totalPages)
  const visibleRecords = evidence.status === "success" ? evidence.data.records.slice((activePage - 1) * pageSize, activePage * pageSize) : []

  const noun = metric === "CALLS" ? "distinct calls" : "distinct HCPs"

  return (
    <Layout
      header={
        <DrawerHeader
          title={`Evidence · ${METRIC_LABEL[metric]}`}
          subtitle={`The records counted in ${formatMonth(month)}${channel ? ` under ${channelLabel(channel)}` : ""}. Calls are counted once however many product rows they have.`}
          onOpenChange={(open) => !open && onClose()}
        />
      }
      content={
        <LayoutContent>
          <VStack gap={4}>
            <HStack gap={2} wrap="wrap" align="center" justify="between">
              <HStack gap={2} align="center">
                <IconButton label="Previous month" tooltip="Previous month" variant="secondary" icon={<Icon icon="chevronLeft" />} isDisabled={index <= 0} onClick={() => go(-1)} />
                <Text data-testid="evidence-month" weight="semibold" size="base">
                  {formatMonth(month)}
                </Text>
                <IconButton
                  label="Next month"
                  tooltip="Next month"
                  variant="secondary"
                  icon={<Icon icon="chevronRight" />}
                  isDisabled={index < 0 || index >= months.length - 1}
                  onClick={() => go(1)}
                />
              </HStack>
              <HStack gap={2} wrap="wrap" align="center">
                <ToggleButtonGroup
                  label="Metric"
                  value={metric}
                  onChange={(next) => {
                    if (next === "CALLS" || next === "HCPS") onStateChange({ ...state, metric: next, channel: next === "HCPS" ? null : channel })
                  }}
                >
                  <ToggleButton value="CALLS" label="Calls" />
                  <ToggleButton value="HCPS" label="HCPs" />
                </ToggleButtonGroup>
                {metric === "CALLS" && trends.channels.length > 1 && (
                  <Selector
                    label="Channel"
                    isLabelHidden
                    data-testid="evidence-channel"
                    value={channel ?? ALL_CHANNELS}
                    onChange={(next) => onStateChange({ ...state, channel: next === ALL_CHANNELS ? null : next })}
                    options={[{ value: ALL_CHANNELS, label: "All channels" }, ...trends.channels.map((c) => ({ value: c, label: channelLabel(c) }))]}
                    width="12rem"
                  />
                )}
              </HStack>
            </HStack>

            {evidence.status === "loading" && (
              <VStack gap={2} data-testid="evidence-loading" aria-busy="true">
                <Skeleton height="5rem" radius={4} />
                <Skeleton height="2.5rem" radius={3} />
                <Skeleton height="2.5rem" radius={3} />
                <Skeleton height="2.5rem" radius={3} />
              </VStack>
            )}
            {evidence.status === "error" && <ErrorState error={evidence.error} onRetry={evidence.refetch} />}
            {evidence.status === "success" && (
              <>
                <Card data-testid="evidence-freshness" variant="blue" padding={4}>
                  <section aria-label="Freshness">
                    <VStack gap={3}>
                      <HStack gap={4} wrap="wrap" align="start">
                        <VStack gap={1}>
                          <Text type="label" color="secondary">
                            Interaction date
                          </Text>
                          <Text data-testid="evidence-latest-interaction" as="p">
                            Latest exchange in this set:{" "}
                            <Text weight="semibold">{evidence.data.latestInteractionDate ? formatDay(evidence.data.latestInteractionDate, true) : "none"}</Text>
                          </Text>
                          <Text type="supporting" as="p" size="xsm">
                            When the exchange took place.
                          </Text>
                        </VStack>
                        <VStack gap={1}>
                          <Text type="label" color="secondary">
                            Load date
                          </Text>
                          <Text data-testid="evidence-latest-load" as="p">
                            Latest record loaded:{" "}
                            <Text weight="semibold">{evidence.data.latestLoadedAt ? formatInstant(evidence.data.latestLoadedAt) : "unknown"}</Text>
                          </Text>
                          <Text type="supporting" as="p" size="xsm">
                            When the record reached this system. It is usually after the interaction.
                          </Text>
                        </VStack>
                      </HStack>
                      <DataThroughBadge dataThrough={evidence.data.dataThrough} />
                    </VStack>
                  </section>
                </Card>

                <Text data-testid="evidence-count" type="supporting" as="p">
                  {evidence.data.truncated
                    ? `Showing the latest ${evidence.data.records.length} of ${evidence.data.total.toLocaleString("en-US")} ${noun}.`
                    : `${evidence.data.total.toLocaleString("en-US")} ${noun}.`}
                </Text>

                {evidence.data.records.length === 0 ? (
                  <AstryxEmptyState
                    data-testid="evidence-empty"
                    isCompact
                    headingLevel={3}
                    title="No records for this month"
                    description="That means none were recorded in your scope, not that access is missing."
                  />
                ) : (
                  <VStack gap={4} data-testid="evidence-table">
                    <Table<EvidenceRecord & Record<string, unknown>>
                      data={visibleRecords as Array<EvidenceRecord & Record<string, unknown>>}
                      idKey={(record) => `${record.kind}:${record.recordId}`}
                      density="compact"
                      dividers="rows"
                      hasHover
                      rowIndexStart={(activePage - 1) * pageSize + 1}
                      rowCount={evidence.data.records.length}
                      columns={[
                        { key: "recordId", header: metric === "CALLS" ? "Call" : "HCP", renderCell: (record) => <Text type="code" data-testid="evidence-row">{record.recordId}</Text> },
                        {
                          key: "hcpId",
                          header: metric === "CALLS" ? "HCP" : "Calls",
                          renderCell: (record) => (
                            <VStack gap={0.5} align="start">
                              {metric === "CALLS" ? <Text type="code">{record.hcpId}</Text> : <Text>{record.callCount}</Text>}
                              {record.hcpName && <Text type="supporting" size="xsm">{record.hcpName}</Text>}
                            </VStack>
                          ),
                        },
                        { key: "interactionDate", header: "Interaction date", renderCell: (record) => <Text data-testid="evidence-interaction-date">{formatDay(record.interactionDate, true)}</Text> },
                        { key: "loadedAt", header: "Loaded", renderCell: (record) => <Text type="supporting" data-testid="evidence-loaded">{record.loadedAt ? formatInstant(record.loadedAt) : "Unknown"}</Text> },
                        {
                          key: "action",
                          header: "Actions",
                          renderCell: (record) => (
                            <Button label="Flag" aria-label={`Flag ${record.recordId}`} variant="ghost" size="sm" icon={<Icon icon={FlagIcon} />} onClick={() => flagRecord(record)} data-testid="evidence-flag" />
                          ),
                        },
                      ]}
                    />
                    {evidence.data.records.length > pageSize ? (
                      <Pagination page={activePage} onChange={setPage} totalItems={evidence.data.records.length} pageSize={pageSize} variant="pages" size="sm" label="Evidence pages" />
                    ) : null}
                  </VStack>
                )}
              </>
            )}
          </VStack>
        </LayoutContent>
      }
    />
  )
}
