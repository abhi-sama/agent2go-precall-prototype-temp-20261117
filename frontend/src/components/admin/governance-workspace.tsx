"use client"

import { AccessTimelineView } from "@/components/admin/access-timeline"
import { HierarchyView } from "@/components/admin/hierarchy-view"
import { VisibilityMatrices } from "@/components/admin/visibility-matrices"
import { AuthorizationVerificationGrid } from "@/components/admin/authorization-verification-grid"
import { DefinitionCatalog, IssueAssistant, LifecycleQueue, MetadataReconciliation } from "@/components/admin/governance-catalog"
import { ScopeLabel } from "@/components/shell/scope-label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useSession } from "@/lib/session/session-provider"

const TRIGGER = "min-h-11 px-3"

/** Hierarchy, effective-dated coverage and visibility governance for administrators. */
export function GovernanceWorkspace() {
  const { user } = useSession()
  return (
    <div className="flex flex-col gap-6 pb-8">
      <header className="flex flex-col gap-3 border-b pb-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Data governance workspace</h1>
        <p className="max-w-3xl text-muted-foreground">Validate access and source quality, reconcile metadata deliberately, govern definitions, and work lifecycle requests with a complete audit trail.</p>
        <div><ScopeLabel label={user.scopeLabel} /></div>
      </header>
      <Tabs defaultValue="hierarchy">
        <TabsList className="h-auto! w-full flex-wrap gap-1 sm:w-fit">
          <TabsTrigger value="hierarchy" className={TRIGGER}>Hierarchy</TabsTrigger>
          <TabsTrigger value="timeline" className={TRIGGER}>Access timeline</TabsTrigger>
          <TabsTrigger value="visibility" className={TRIGGER}>Catalog and responses</TabsTrigger>
          <TabsTrigger value="verification" className={TRIGGER}>Authorization checks</TabsTrigger>
          <TabsTrigger value="metadata" className={TRIGGER}>Metadata reconciliation</TabsTrigger>
          <TabsTrigger value="definitions" className={TRIGGER}>Definitions</TabsTrigger>
          <TabsTrigger value="lifecycle" className={TRIGGER}>Lifecycle queue</TabsTrigger>
          <TabsTrigger value="assistant" className={TRIGGER}>Issue assistant</TabsTrigger>
        </TabsList>
        <TabsContent value="hierarchy" className="pt-4"><HierarchyView /></TabsContent>
        <TabsContent value="timeline" className="pt-4"><AccessTimelineView /></TabsContent>
        <TabsContent value="visibility" className="pt-4"><VisibilityMatrices /></TabsContent>
          <TabsContent value="verification" className="pt-4"><AuthorizationVerificationGrid /></TabsContent>
          <TabsContent value="metadata" className="pt-4"><MetadataReconciliation /></TabsContent>
          <TabsContent value="definitions" className="pt-4"><DefinitionCatalog /></TabsContent>
          <TabsContent value="lifecycle" className="pt-4"><LifecycleQueue /></TabsContent>
          <TabsContent value="assistant" className="pt-4"><IssueAssistant /></TabsContent>
      </Tabs>
    </div>
  )
}
