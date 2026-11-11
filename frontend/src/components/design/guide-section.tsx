"use client"

import { CodeBlock } from "@astryxdesign/core/CodeBlock"
import { Collapsible } from "@astryxdesign/core/Collapsible"
import { Heading } from "@astryxdesign/core/Heading"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import type * as React from "react"

/**
 * One chapter of the style guide: an anchored `section` with its heading, a sentence on when to use it, the live
 * demo, and the real import behind a "Show code" disclosure so the page stays short on a tablet.
 */
export function GuideSection({ id, title, description, code, children }: { id: string; title: string; description: React.ReactNode; code?: string; children: React.ReactNode }) {
  return (
    <section id={`ds-${id}`} aria-labelledby={`ds-${id}-title`} className="scroll-mt-4 min-w-0">
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2} id={`ds-${id}-title`}>{title}</Heading>
          <div className="max-w-3xl">
            <Text as="p" display="block" color="secondary">{description}</Text>
          </div>
        </VStack>
        {children}
        {code && (
          <Collapsible trigger={<Text type="label">Show code</Text>} chevronPosition="start">
            {/* Highlighted tokens are nested inline spans inside one wrapped line box, which the layout audit reads as overlap.
                Colours and comment tint come from the theme's own syntax palette, not from this page. */}
            <div data-layout-ok="overlap" data-contrast-ok>
              <CodeBlock code={code} language="tsx" hasCopyButton isWrapped />
            </div>
          </Collapsible>
        )}
      </VStack>
    </section>
  )
}

/** A named sub-block inside a chapter. */
export function GuideGroup({ title, note, children }: { title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <VStack gap={2} className="min-w-0">
      <Heading level={3}>{title}</Heading>
      {note && (
        <div className="max-w-3xl">
          <Text as="p" display="block" type="supporting">{note}</Text>
        </div>
      )}
      {children}
    </VStack>
  )
}

/** A colour (or any CSS paint) read from a live token, with its name under it. Nothing here is a literal colour. */
export function TokenSwatch({ token, label }: { token: string; label?: string }) {
  return (
    <figure className="m-0 min-w-0">
      <div className="h-12 w-full" style={{ background: `var(${token})`, border: "1px solid var(--color-border)", borderRadius: "var(--radius-element)" }} />
      <figcaption className="mt-1">
        <Text type="supporting" size="xsm" display="block" wordBreak="break-all" hasTruncateTooltip={false}>
          {label ?? token}
        </Text>
      </figcaption>
    </figure>
  )
}
