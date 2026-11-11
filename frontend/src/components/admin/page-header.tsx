import { Heading } from "@astryxdesign/core/Heading"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import type * as React from "react"
import { ScopeLabel } from "@/components/shell/scope-label"

/**
 * The title block shared by the administrator pages: one `h1`, a sentence on what the page is for, and the scope
 * the viewer is allowed to see. AppShell owns the `main` landmark, so the page starts here.
 */
export function AdminPageHeader({ title, description, scopeLabel, children }: { title: string; description: React.ReactNode; scopeLabel?: string; children?: React.ReactNode }) {
  return (
    <VStack as="header" gap={3} paddingBlockEnd={5}>
      <Heading level={1} type="display-3">{title}</Heading>
      <div className="max-w-3xl">
        <Text type="large" color="secondary" as="p">{description}</Text>
      </div>
      {scopeLabel !== undefined && <div><ScopeLabel label={scopeLabel} /></div>}
      {children}
    </VStack>
  )
}
