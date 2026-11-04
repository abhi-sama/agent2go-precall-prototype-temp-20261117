"use client"

import { Network } from "lucide-react"
import { AccessTimelineView } from "@/components/admin/access-timeline"
import { HierarchyView } from "@/components/admin/hierarchy-view"
import { VisibilityMatrices } from "@/components/admin/visibility-matrices"
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
        <div className="flex items-center gap-2 text-accent-text"><Network className="size-5" aria-hidden /><span className="text-sm font-medium">Hierarchy governance</span></div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Hierarchy and coverage</h1>
        <p className="max-w-3xl text-muted-foreground">Validate the territory graph, govern transfers and temporary coverage on an approved timeline, and keep catalog visibility apart from response access.</p>
        <div><ScopeLabel label={user.scopeLabel} /></div>
      </header>
      <Tabs defaultValue="hierarchy">
        <TabsList className="h-auto! w-full flex-wrap gap-1 sm:w-fit">
          <TabsTrigger value="hierarchy" className={TRIGGER}>Hierarchy</TabsTrigger>
          <TabsTrigger value="timeline" className={TRIGGER}>Access timeline</TabsTrigger>
          <TabsTrigger value="visibility" className={TRIGGER}>Catalog and responses</TabsTrigger>
        </TabsList>
        <TabsContent value="hierarchy" className="pt-4"><HierarchyView /></TabsContent>
        <TabsContent value="timeline" className="pt-4"><AccessTimelineView /></TabsContent>
        <TabsContent value="visibility" className="pt-4"><VisibilityMatrices /></TabsContent>
      </Tabs>
    </div>
  )
}
