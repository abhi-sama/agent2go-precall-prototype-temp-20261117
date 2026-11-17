"use client"

/**
 * "What the agent remembers" (docs/adr/0022): the person's saved preferences (how they like to work), each with a
 * delete, and a clear-all. Reachable from Ask the agent in the top-bar panel, the docked view and the full screen. The
 * list is read fresh each time it opens, and the BE reads it again for every question, so a deletion applies to the
 * next one. It lists preferences only: data about HCPs, calls and figures is never remembered.
 */

import { AlertDialog } from "@astryxdesign/core/AlertDialog"
import { Badge } from "@astryxdesign/core/Badge"
import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Drawer, DrawerHeader } from "@astryxdesign/core/Drawer"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { Layout, LayoutContent } from "@astryxdesign/core/Layout"
import { List, ListItem } from "@astryxdesign/core/List"
import { Skeleton } from "@astryxdesign/core/Skeleton"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { Brain, Trash2 } from "lucide-react"
import * as React from "react"
import { useKeepMounted } from "@/components/chat/use-keep-mounted"
import { ErrorState } from "@/components/state/states"
import { useAppToast } from "@/components/state/use-app-toast"
import { useDataAdapter } from "@/lib/data/data-provider"
import { useQuery } from "@/lib/data/use-query"
import { newCorrelationId } from "@/lib/log/logger"
import { useSession } from "@/lib/session/session-provider"
import type { AgentMemoryCategory } from "@/lib/data/types"

const CATEGORY_LABEL: Record<AgentMemoryCategory, string> = { FORMAT: "Format", LENGTH: "Length", DATE_RANGE: "Date range", FOCUS: "Focus", OTHER: "Other" }

export const MEMORY_PANEL_LABEL = "What the agent remembers"

function MemoryBody({ onClose }: { onClose: () => void }) {
  const adapter = useDataAdapter()
  const toast = useAppToast()
  const { userId, ready } = useSession()
  const items = useQuery("myAgentMemory", userId, (ctx) => adapter.myAgentMemory(ctx), ready)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [confirmClear, setConfirmClear] = React.useState(false)
  // A deleted row or a closed confirmation takes the focused button with it; focus goes to the panel's intro, never to the page behind.
  const introRef = React.useRef<HTMLDivElement>(null)
  const keepFocus = () => requestAnimationFrame(() => introRef.current?.focus({ preventScroll: true }))

  const remove = async (memoryId: string) => {
    setBusy(memoryId)
    try {
      await adapter.deleteAgentMemory({ correlationId: newCorrelationId() }, memoryId)
      toast.success("Removed. It stops applying with your next question.", { id: "agent-memory" })
      items.refetch()
      keepFocus()
    } catch {
      toast.error("That could not be removed", { id: "agent-memory" })
    } finally {
      setBusy(null)
    }
  }
  const clearAll = async () => {
    setBusy("all")
    try {
      await adapter.clearAgentMemory({ correlationId: newCorrelationId() })
      toast.success("Cleared. The agent remembers nothing about how you work.", { id: "agent-memory" })
      items.refetch()
      keepFocus()
    } catch {
      toast.error("That could not be cleared", { id: "agent-memory" })
    } finally {
      setBusy(null)
      setConfirmClear(false)
    }
  }

  const list = items.status === "success" ? items.data : []
  return (
    <Layout
      header={<DrawerHeader title={MEMORY_PANEL_LABEL} subtitle="How you like to work" onOpenChange={(next) => !next && onClose()} hasDivider />}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <div ref={introRef} tabIndex={-1} className="outline-none" data-testid="memory-intro">
            <Text as="p" type="supporting" data-testid="memory-explainer">
              Say “remember I prefer tables” and the agent asks you first. It remembers preferences, such as formats, lengths and date ranges, never data about HCPs, calls or figures: those are always read fresh from your data. Delete one and it stops applying with your next question. After you ask for the same thing a few times the agent may suggest one; nothing is saved unless you choose Remember.
            </Text>
            </div>
            {items.status === "loading" && <Skeleton data-testid="memory-loading" height="6rem" width="100%" radius={4} />}
            {items.status === "error" && <ErrorState error={items.error} onRetry={items.refetch} />}
            {items.status === "success" && list.length === 0 && (
              <Banner data-testid="memory-empty" role="status" status="info" title="Nothing yet" description="Tell the agent “remember I prefer tables” or “remember to default to 90 days”." collapsible={false} />
            )}
            {list.length > 0 && (
              <List hasDividers header={<Text weight="semibold">{list.length === 1 ? "1 thing remembered" : `${list.length} things remembered`}</Text>} data-testid="memory-list">
                {list.map((item) => (
                  <ListItem
                    key={item.memoryId}
                    itemKey={item.memoryId}
                    data-testid="memory-item"
                    label={<Text data-testid="memory-text" style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{item.text}</Text>}
                    description={<Badge variant="neutral" label={CATEGORY_LABEL[item.category]} />}
                    endContent={
                      <Button
                        variant="ghost"
                        size="sm"
                        isIconOnly
                        icon={<Icon icon={Trash2} />}
                        label={`Delete: ${item.text}`}
                        tooltip="Delete"
                        data-testid="memory-delete"
                        isDisabled={busy !== null}
                        onClick={() => void remove(item.memoryId)}
                      />
                    }
                  />
                ))}
              </List>
            )}
            {list.length > 0 && (
              <HStack justify="end">
                <Button variant="secondary" label="Clear all" data-testid="memory-clear" isDisabled={busy !== null} onClick={() => setConfirmClear(true)} />
              </HStack>
            )}
          </VStack>
          <AlertDialog
            isOpen={confirmClear}
            onOpenChange={(next) => !next && setConfirmClear(false)}
            title="Clear everything the agent remembers?"
            description="All saved preferences are deleted and the suggestions you dismissed are forgotten. The agent stops applying them with your next question. This cannot be undone."
            actionLabel="Clear all"
            cancelLabel="Keep them"
            isActionLoading={busy === "all"}
            onAction={() => void clearAll()}
          />
        </LayoutContent>
      }
    />
  )
}

/**
 * The control and its panel: an Astryx `Drawer` (a native modal `<dialog>`: top layer, focus containment, Esc and
 * scrim to close, focus back to this button). `variant="icon"` suits a panel header; `"pill"` the full page's.
 */
export function AgentMemoryControl({ variant }: { variant: "icon" | "pill" }) {
  const [open, setOpen] = React.useState(false)
  const mounted = useKeepMounted(open)
  const triggerClass =
    variant === "icon"
      ? "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:size-11"
      : "inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
  return (
    <>
      <button type="button" aria-label={MEMORY_PANEL_LABEL} title={MEMORY_PANEL_LABEL} data-testid="chat-memory" aria-haspopup="dialog" onClick={() => setOpen(true)} className={triggerClass}>
        <Brain aria-hidden className="size-4" />
        {variant === "pill" && <span>What the agent remembers</span>}
      </button>
      {mounted && (
        // Escape closes the panel (and the confirmation inside it) and nothing behind it: CopilotKit's popup closes on any
        // Escape that reaches the window, so it is stopped here, after the drawer has handled it.
        <div className="contents" onKeyDown={(event) => event.key === "Escape" && event.stopPropagation()}>
          <Drawer isOpen={open} onOpenChange={setOpen} label={MEMORY_PANEL_LABEL} width="26rem" data-testid={open ? "memory-sheet" : undefined}>
            {mounted && <MemoryBody onClose={() => setOpen(false)} />}
          </Drawer>
        </div>
      )}
    </>
  )
}
