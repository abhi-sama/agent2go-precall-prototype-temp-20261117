"use client"

import { BottomSheet } from "@astryxdesign/core/BottomSheet"
import { Button } from "@astryxdesign/core/Button"
import { ChatComposerDrawer } from "@astryxdesign/core/Chat"
import { Drawer, DrawerHeader } from "@astryxdesign/core/Drawer"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { IconButton } from "@astryxdesign/core/IconButton"
import { Layout, LayoutContent, LayoutHeader } from "@astryxdesign/core/Layout"
import { Token } from "@astryxdesign/core/Token"
import { VStack } from "@astryxdesign/core/VStack"
import { CalendarRange, CircleHelp, LayoutDashboard, MapPin, MessageSquarePlus, Pill, Sparkles, X } from "lucide-react"
import { usePathname } from "next/navigation"
import * as React from "react"
import { ChatConversation } from "@/components/chat/chat-conversation"
import { useChatSession } from "@/components/chat/chat-provider"
import { STARTERS } from "@/components/chat/chat-panel"
import { useChatPresentation } from "@/hooks/use-chat-presentation"
import { startersFor } from "@/lib/chat/context"
import type { ContextChip } from "@/lib/chat/screen-context"
import type { ChatContext } from "@/lib/data/director-insights"

const CHIP_ICONS: Record<ContextChip["kind"], React.ComponentType<{ "aria-hidden"?: boolean }>> = {
  screen: LayoutDashboard,
  range: CalendarRange,
  territory: MapPin,
  product: Pill,
  question: CircleHelp,
}

/** The single global entry point. It is intentionally absent on the dedicated full-chat route. */
export function ChatTrigger() {
  const pathname = usePathname()
  const { open, setOpen, running } = useChatSession()
  const presentation = useChatPresentation()
  if (pathname === "/chat") return null
  return (
    <Button
      label="Ask the agent"
      variant="secondary"
      size="sm"
      data-testid="chat-open"
      aria-haspopup={presentation === "docked" ? undefined : "dialog"}
      aria-expanded={open}
      icon={<Sparkles aria-hidden />}
      onClick={() => setOpen(true)}
      aria-description={running && !open ? "An answer is being written" : undefined}
    />
  )
}

function contextWithout(hidden: Set<ContextChip["kind"]>, context: ChatContext): ChatContext | undefined {
  const next: ChatContext = {}
  if (!hidden.has("screen")) next.view = context.view
  if (!hidden.has("range")) { next.from = context.from; next.to = context.to }
  if (!hidden.has("territory")) next.territoryId = context.territoryId
  if (!hidden.has("question")) next.questionId = context.questionId
  return Object.keys(next).length ? next : undefined
}

function ContextTokens({ chips, hidden, onRemove }: { chips: ContextChip[]; hidden: Set<ContextChip["kind"]>; onRemove: (kind: ContextChip["kind"]) => void }) {
  const visible = chips.filter((chip) => !hidden.has(chip.kind))
  if (!visible.length) return null
  return (
    <ChatComposerDrawer count={visible.length} label="Question context" defaultIsCollapsed={false}>
      <HStack data-testid="chat-chips" gap={1} wrap="wrap">
        {visible.map((chip) => {
          const Icon = CHIP_ICONS[chip.kind]
          return (
            <Token
              key={chip.kind}
              data-testid="chat-chip"
              data-kind={chip.kind}
              label={chip.label}
              icon={<Icon aria-hidden />}
              onRemove={() => onRemove(chip.kind)}
              description="Remove from this question's context"
              size="sm"
            />
          )
        })}
      </HStack>
    </ChatComposerDrawer>
  )
}

/** Reused body for the docked inspector and the two overlay presentations. */
export function ChatSurface({ onClose, docked = false }: { onClose?: () => void; docked?: boolean }) {
  const { turns, running, reset, screen } = useChatSession()
  const [hidden, setHidden] = React.useState<Set<ContextChip["kind"]>>(() => new Set())
  const context = React.useMemo(() => contextWithout(hidden, screen.context), [screen, hidden])
  const starters = startersFor(context, STARTERS)
  const remove = React.useCallback((kind: ContextChip["kind"]) => setHidden((current) => new Set([...current, kind])), [])
  const actions = (
    <HStack gap={1} vAlign="center">
      <Button label="Open full chat" href="/chat" variant="ghost" size="sm" />
      {docked && onClose && <IconButton label="Close" tooltip="Close" variant="ghost" size="sm" icon={<X aria-hidden />} onClick={onClose} />}
      {turns.length > 0 && (
        <IconButton
          data-testid="chat-new"
          label="New conversation"
          tooltip="New conversation"
          variant="ghost"
          size="sm"
          icon={<MessageSquarePlus aria-hidden />}
          isDisabled={running}
          onClick={reset}
        />
      )}
    </HStack>
  )
  const content = (
    <LayoutContent padding={4} isScrollable={false}>
      <VStack height="100%" gap={0}>
        <ChatConversation
          context={context}
          starters={starters}
          layout="panel"
          composerDrawer={<ContextTokens chips={screen.chips} hidden={hidden} onRemove={remove} />}
        />
      </VStack>
    </LayoutContent>
  )

  return (
    <Layout
      height="fill"
      defaultHasDividers
      header={
        docked ? (
          <LayoutHeader hasDivider>
            <HStack hAlign="between" vAlign="center" gap={2} wrap="wrap">
              <HStack gap={2} vAlign="center"><Sparkles aria-hidden /><Heading level={2}>Ask the agent</Heading></HStack>
              {actions}
            </HStack>
          </LayoutHeader>
        ) : (
          <DrawerHeader title="Ask the agent" onOpenChange={() => onClose?.()} endContent={actions} hasDivider />
        )
      }
      content={content}
    />
  )
}

/** Full-height overlay at intermediate widths, tall bottom sheet in compact/portrait contexts. */
export function ChatDrawer() {
  const pathname = usePathname()
  const { open, setOpen } = useChatSession()
  const presentation = useChatPresentation()
  if (pathname === "/chat" || presentation === "docked") return null
  if (presentation === "sheet") {
    return (
      <BottomSheet isOpen={open} onOpenChange={setOpen} label="Ask the agent" height="tall" padding={0} data-testid="chat-drawer" data-presentation="sheet">
        <ChatSurface onClose={() => setOpen(false)} />
      </BottomSheet>
    )
  }
  return (
    <Drawer isOpen={open} onOpenChange={setOpen} label="Ask the agent" width={420} data-testid="chat-drawer" data-presentation="drawer">
      <ChatSurface onClose={() => setOpen(false)} />
    </Drawer>
  )
}

/** The supporting pane that reflows the workspace at desktop width. */
export function ChatDock() {
  const { open, setOpen } = useChatSession()
  if (!open) return null
  return <ChatSurface docked onClose={() => setOpen(false)} />
}
