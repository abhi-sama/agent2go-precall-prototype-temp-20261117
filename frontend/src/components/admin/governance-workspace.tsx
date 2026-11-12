"use client"

import { VStack } from "@astryxdesign/core/VStack"
import { useState } from "react"
import { AccessTimelineView } from "@/components/admin/access-timeline"
import { AuthorizationVerificationGrid } from "@/components/admin/authorization-verification-grid"
import { DefinitionCatalog, IssueAssistant, LifecycleQueue, MetadataReconciliation } from "@/components/admin/governance-catalog"
import { HierarchyView } from "@/components/admin/hierarchy-view"
import { AdminPageHeader } from "@/components/admin/page-header"
import { PanelTabs, type PanelTab } from "@/components/admin/panel-tabs"
import { VisibilityMatrices } from "@/components/admin/visibility-matrices"
import { useSession } from "@/lib/session/session-provider"

const TABS: readonly PanelTab[] = [
  { value: "hierarchy", label: "Hierarchy" },
  { value: "timeline", label: "Access timeline" },
  { value: "visibility", label: "Catalog and responses" },
  { value: "verification", label: "Authorization checks" },
  { value: "metadata", label: "Metadata reconciliation" },
  { value: "definitions", label: "Definitions" },
  { value: "lifecycle", label: "Lifecycle queue" },
  { value: "assistant", label: "Issue assistant" },
]

const PANELS: Record<string, () => React.JSX.Element> = {
  hierarchy: HierarchyView,
  timeline: AccessTimelineView,
  visibility: VisibilityMatrices,
  verification: AuthorizationVerificationGrid,
  metadata: MetadataReconciliation,
  definitions: DefinitionCatalog,
  lifecycle: LifecycleQueue,
  assistant: IssueAssistant,
}

/** Hierarchy, effective-dated coverage and visibility governance for administrators. */
export function GovernanceWorkspace() {
  const { user } = useSession()
  const [tab, setTab] = useState("hierarchy")
  const Panel = PANELS[tab] ?? HierarchyView
  return (
    <VStack gap={6} paddingBlockEnd={8}>
      <AdminPageHeader
        title="Data governance workspace"
        description="Validate access and source quality, reconcile metadata deliberately, govern definitions, and work lifecycle requests with a complete audit trail."
        scopeLabel={user.scopeLabel}
      />
      <PanelTabs tabs={TABS} value={tab} onChange={setTab}>
        <Panel />
      </PanelTabs>
    </VStack>
  )
}
