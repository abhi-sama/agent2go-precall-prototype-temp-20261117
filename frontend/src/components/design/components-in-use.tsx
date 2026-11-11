"use client"

import { AlertDialog } from "@astryxdesign/core/AlertDialog"
import { Badge } from "@astryxdesign/core/Badge"
import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput"
import { DateTimeInput } from "@astryxdesign/core/DateTimeInput"
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog"
import { EmptyState } from "@astryxdesign/core/EmptyState"
import { Grid } from "@astryxdesign/core/Grid"
import { HStack } from "@astryxdesign/core/HStack"
import { IconButton } from "@astryxdesign/core/IconButton"
import { List, ListItem } from "@astryxdesign/core/List"
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList"
import { Pagination } from "@astryxdesign/core/Pagination"
import { ProgressBar } from "@astryxdesign/core/ProgressBar"
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl"
import { Selector } from "@astryxdesign/core/Selector"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { StatusDot } from "@astryxdesign/core/StatusDot"
import { Switch } from "@astryxdesign/core/Switch"
import { Tab, TabList } from "@astryxdesign/core/TabList"
import { Table } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { TextInput } from "@astryxdesign/core/TextInput"
import { Tooltip } from "@astryxdesign/core/Tooltip"
import { VStack } from "@astryxdesign/core/VStack"
import { Inbox, Plus, RefreshCw, Search, Settings } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { GuideGroup, GuideSection } from "./guide-section"

type DateTimeValue = React.ComponentProps<typeof DateTimeInput>["value"]

const ROLE_OPTIONS = [
  { value: "msl", label: "MSL", description: "Territory-level field medical" },
  { value: "director", label: "Director", description: "Region and team view" },
  { value: "executive", label: "Executive", description: "Aggregate only" },
  { value: "admin", label: "Administrator", description: "Access and data quality" },
]

export function ControlsSection() {
  const [name, setName] = React.useState("")
  const [role, setRole] = React.useState("msl")
  const [when, setWhen] = React.useState<DateTimeValue>(undefined)
  const [on, setOn] = React.useState(true)
  const [checked, setChecked] = React.useState(false)
  return (
    <GuideSection
      id="controls"
      title="Controls"
      description="Buttons, fields and switches are Astryx components used straight from their own entries. They render their own labels, keep 44px targets on touch, and stay focusable when disabled so they can say why."
      code={`import {Button} from "@astryxdesign/core/Button"
import {TextInput} from "@astryxdesign/core/TextInput"
import {Selector} from "@astryxdesign/core/Selector"

<Button label="Save grants" variant="primary" isLoading={saving} />
<TextInput label="User ID" value={id} onChange={setId} isRequired />`}
    >
      <Grid columns={{ minWidth: 300, max: 2 }} gap={4}>
        <Card padding={4}>
          <GuideGroup title="Buttons">
            <HStack gap={2} wrap="wrap">
              <Button label="Primary" variant="primary" />
              <Button label="Secondary" variant="secondary" />
              <Button label="Ghost" variant="ghost" />
              <Button label="Destructive" variant="destructive" />
              <Button label="Disabled" isDisabled />
              <Button label="Loading" isLoading />
            </HStack>
            <HStack gap={2} wrap="wrap" align="center">
              <Button label="Small" size="sm" variant="secondary" />
              <Button label="Large" size="lg" variant="secondary" />
              <Button label="Add draft" icon={<Plus />} variant="secondary" />
              <IconButton label="Refresh checks" icon={<RefreshCw />} variant="ghost" tooltip="Refresh checks" />
              <IconButton label="Settings" icon={<Settings />} variant="secondary" tooltip="Settings" />
              <Tooltip content="Tooltips name icon-only controls">
                <Button label="Hover or focus" variant="ghost" />
              </Tooltip>
            </HStack>
          </GuideGroup>
        </Card>
        <Card padding={4}>
          <GuideGroup title="Fields">
            <VStack gap={3}>
              <TextInput label="User ID" value={name} onChange={setName} placeholder="msl-t01-01" startIcon={Search} hasClear />
              <Selector label="Persona" value={role} onChange={setRole} options={ROLE_OPTIONS} />
              <DateTimeInput label="Effective from" value={when} onChange={setWhen} />
            </VStack>
          </GuideGroup>
        </Card>
        <Card padding={4}>
          <GuideGroup title="Settings" note="A switch applies at once; a checkbox waits for a Save.">
            <VStack gap={3}>
              <Switch label="Catalog visible to this role" description="Saved and audited on change" value={on} onChange={setOn} />
              {/* Disabled controls are exempt from AA (WCAG 1.4.3); this one is shown disabled on purpose. */}
              <div data-contrast-ok>
                <Switch label="Locked setting" value={false} isDisabled disabledMessage="Only another administrator can change this." />
              </div>
              <CheckboxInput label="Include expired assignments" value={checked} onChange={setChecked} />
            </VStack>
          </GuideGroup>
        </Card>
        <Card padding={4}>
          <GuideGroup title="Progress">
            {/* The indeterminate bar slides a segment wider than its track and clips it: that is the animation, not a layout fault. */}
            <VStack gap={3} data-layout-ok="clip">
              <ProgressBar label="Questions scored" value={34} max={40} hasValueLabel />
              <ProgressBar label="Loading" isIndeterminate />
            </VStack>
          </GuideGroup>
        </Card>
      </Grid>
    </GuideSection>
  )
}

interface RunRow extends Record<string, unknown> {
  id: string
  source: string
  status: "completed" | "stale" | "failed"
  rows: number
}

const RUNS: RunRow[] = [
  { id: "r1", source: "Call activity", status: "completed", rows: 41820 },
  { id: "r2", source: "HCP raw insights", status: "stale", rows: 9312 },
  { id: "r3", source: "Question tag", status: "failed", rows: 0 },
]

/** A StatusDot only names itself to assistive tech, so the visible word sits beside it. */
function Status({ variant, text, isPulsing }: { variant: React.ComponentProps<typeof StatusDot>["variant"]; text: string; isPulsing?: boolean }) {
  return (
    <HStack gap={2} align="center">
      <StatusDot variant={variant} label={text} isPulsing={isPulsing} />
      <Text>{text}</Text>
    </HStack>
  )
}

const STATUS_BADGE = { completed: "success", stale: "warning", failed: "error" } as const

export function DataSection() {
  return (
    <GuideSection
      id="data"
      title="Data display"
      description="Dense records go in a Table or List, not a stack of Cards. Statuses are a Badge or StatusDot with a word, so colour is never the only signal."
      code={`import {Table} from "@astryxdesign/core/Table"
import {Badge} from "@astryxdesign/core/Badge"

<Table<Row> data={rows} idKey="id" hasHover columns={[
  {key: "source", header: "Source"},
  {key: "status", header: "Status", renderCell: r => <Badge label={r.status} variant="success" />},
]} />`}
    >
      <Table<RunRow>
        data={RUNS}
        idKey="id"
        hasHover
        columns={[
          { key: "source", header: "Source" },
          { key: "status", header: "Status", renderCell: (r) => <Badge label={r.status} variant={STATUS_BADGE[r.status]} /> },
          { key: "rows", header: "Rows", align: "end", renderCell: (r) => <Text hasTabularNumbers>{r.rows.toLocaleString()}</Text> },
        ]}
      />
      <Grid columns={{ minWidth: 280, max: 3 }} gap={4}>
        <Card padding={4}>
          <GuideGroup title="Badge and StatusDot">
            <HStack gap={2} wrap="wrap">
              <Badge label="Neutral" />
              <Badge label="Info" variant="info" />
              <Badge label="Success" variant="success" />
              <Badge label="Warning" variant="warning" />
              <Badge label="Error" variant="error" />
            </HStack>
            <VStack gap={1}>
              <Status variant="success" text="Live" />
              <Status variant="warning" text="Stale" />
              <Status variant="error" text="Failed" />
              <Status variant="accent" text="Running" isPulsing />
            </VStack>
          </GuideGroup>
        </Card>
        <Card padding={4}>
          <GuideGroup title="MetadataList">
            <MetadataList title="Assignment">
              <MetadataListItem label="Territory">T01-02</MetadataListItem>
              <MetadataListItem label="Type">Temporary coverage</MetadataListItem>
              <MetadataListItem label="Status"><Status variant="success" text="Active" /></MetadataListItem>
            </MetadataList>
          </GuideGroup>
        </Card>
        <Card padding={4}>
          <GuideGroup title="List">
            <List hasDividers>
              <ListItem label="Dana Whitfield" description="Primary · REGION-NE" endContent={<Badge label="Active" variant="success" />} />
              <ListItem label="Priya Raman" description="Temporary · T01-02" endContent={<Badge label="Scheduled" variant="info" />} />
            </List>
          </GuideGroup>
        </Card>
      </Grid>
    </GuideSection>
  )
}

export function FeedbackSection() {
  const [dialog, setDialog] = React.useState(false)
  const [alert, setAlert] = React.useState(false)
  return (
    <GuideSection
      id="feedback"
      title="Feedback and overlays"
      description="Banner for a standing message, Skeleton while loading, EmptyState when there is nothing, Dialog for a focused task and AlertDialog only for a destructive or irreversible action. Transient confirmations use the app Toaster."
      code={`import {Banner} from "@astryxdesign/core/Banner"
import {AlertDialog} from "@astryxdesign/core/AlertDialog"

<Banner status="warning" title="Pipeline attention required" description="Two sources are stale." />
<AlertDialog isOpen={open} onOpenChange={setOpen} title="Revoke access?" description="…" actionLabel="Revoke access" onAction={revoke} />`}
    >
      <Grid columns={{ minWidth: 300, max: 2 }} gap={4}>
        <VStack gap={2}>
          <Banner status="info" title="Source values stay side by side" description="Nothing is selected or overwritten here." />
          <Banner status="warning" title="Pipeline attention required" description="Two monitored loads are stale." />
          <Banner status="error" title="The grants could not be saved" description="Nothing changed." />
          <Banner status="success" title="Saved and audited" />
        </VStack>
        <Card padding={4}>
          <VStack gap={3}>
            <Text type="label">Loading</Text>
            <HStack gap={3} align="center">
              <Skeleton width={48} height={48} radius={4} />
              <VStack gap={2}>
                <Skeleton width={200} height={14} index={0} />
                <Skeleton width={140} height={14} index={1} />
              </VStack>
            </HStack>
            <Text type="label">Dialogs and toast</Text>
            <HStack gap={2} wrap="wrap">
              <Button label="Open dialog" variant="secondary" onClick={() => setDialog(true)} />
              <Button label="Open confirmation" variant="secondary" onClick={() => setAlert(true)} />
              <Button label="Show toast" variant="ghost" onClick={() => toast("Saved and audited")} />
            </HStack>
          </VStack>
        </Card>
      </Grid>
      <Card padding={2}>
        <EmptyState icon={<Inbox />} title="No requests yet" description="Requests for transfers and temporary coverage appear here." actions={<Button label="New request" icon={<Plus />} variant="secondary" />} />
      </Card>
      <Dialog isOpen={dialog} onOpenChange={setDialog} width={420}>
        <DialogHeader title="Request coverage" subtitle="A second administrator approves it" onOpenChange={setDialog} />
        <VStack gap={3} padding={4}>
          <Text>Temporary coverage always has an end date and stops on its own at that moment.</Text>
          <HStack gap={2}>
            <Button label="Request" variant="primary" onClick={() => setDialog(false)} />
            <Button label="Cancel" variant="ghost" onClick={() => setDialog(false)} />
          </HStack>
        </VStack>
      </Dialog>
      <AlertDialog
        isOpen={alert}
        onOpenChange={setAlert}
        title="Revoke this assignment?"
        description="The person loses access to the territory immediately. The change is audited."
        actionLabel="Revoke assignment"
        onAction={() => setAlert(false)}
      />
    </GuideSection>
  )
}

export function NavigationSection() {
  const [tab, setTab] = React.useState("hierarchy")
  const [view, setView] = React.useState("records")
  const [page, setPage] = React.useState(2)
  return (
    <GuideSection
      id="navigation"
      title="Navigation and filters"
      description="TabList switches between views of one task, SegmentedControl picks one of a few modes, Pagination moves through a long result. The app shell, sidebar and header follow the same rules and are not repeated here."
      code={`import {Tab, TabList} from "@astryxdesign/core/TabList"
import {SegmentedControl, SegmentedControlItem} from "@astryxdesign/core/SegmentedControl"

<TabList value={tab} onChange={setTab} hasDivider>
  <Tab value="hierarchy" label="Hierarchy" />
</TabList>`}
    >
      <VStack gap={4}>
        <TabList value={tab} onChange={setTab} hasDivider>
          <Tab value="hierarchy" label="Hierarchy" />
          <Tab value="timeline" label="Access timeline" />
          <Tab value="definitions" label="Definitions" />
        </TabList>
        <HStack gap={4} wrap="wrap" align="center">
          <SegmentedControl label="Response access" value={view} onChange={setView}>
            <SegmentedControlItem value="none" label="None" />
            <SegmentedControlItem value="aggregate" label="Aggregate only" />
            <SegmentedControlItem value="records" label="Records" />
          </SegmentedControl>
          <Pagination page={page} onChange={setPage} totalPages={9} hasFirstLast label="Audit pages" />
        </HStack>
      </VStack>
    </GuideSection>
  )
}
