"use client"

import { CalendarRange, CircleHelp, LayoutDashboard, MapPin, MessageSquarePlus, Sparkles, X } from "lucide-react"
import { usePathname } from "next/navigation"
import * as React from "react"
import { ChatConversation } from "@/components/chat/chat-conversation"
import { useChatSession } from "@/components/chat/chat-provider"
import { STARTERS } from "@/components/chat/chat-panel"
import { Button } from "@/components/ui/button"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { useChatPresentation } from "@/hooks/use-chat-presentation"
import { startersFor } from "@/lib/chat/context"
import type { ContextChip } from "@/lib/chat/screen-context"
import { cn } from "@/lib/utils"

const CHIP_ICONS: Record<ContextChip["kind"], React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  screen: LayoutDashboard,
  range: CalendarRange,
  territory: MapPin,
  question: CircleHelp,
}

/** Header button that opens the panel over whatever screen the person is on. The full `/chat` page is the same conversation, so it has no button. */
export function ChatTrigger() {
  const pathname = usePathname()
  const { open, setOpen, running } = useChatSession()
  if (pathname === "/chat") return null
  return (
    <Button
      variant="outline"
      data-testid="chat-open"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen(true)}
    >
      <span className="relative inline-flex">
        <Sparkles className="text-ai" aria-hidden />
        {running && !open && (
          <span data-testid="chat-running" className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" aria-hidden />
        )}
      </span>
      <span>Ask AI</span>
      {running && !open && <span className="sr-only">An answer is being written</span>}
    </Button>
  )
}

/** What the agent will be told about the screen: the route and the filters on it. Nothing here is hidden from the person. */
function ContextChips({ chips }: { chips: ContextChip[] }) {
  return (
    <section aria-label="Context the agent will use" data-testid="chat-chips" className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2.5">
      <span className="text-xs font-medium text-muted-foreground">Asking about</span>
      {chips.map((chip) => {
        const Icon = CHIP_ICONS[chip.kind]
        return (
          <span
            key={chip.kind}
            data-testid="chat-chip"
            data-kind={chip.kind}
            className="inline-flex min-h-7 items-center gap-1.5 rounded-full border bg-muted px-2.5 text-sm text-foreground"
          >
            <Icon className="size-3.5 text-muted-foreground" aria-hidden />
            {chip.label}
          </span>
        )
      })}
    </section>
  )
}

/**
 * The slide-in chat. A panel from the right edge on laptops and landscape iPads, a full-screen sheet from the
 * bottom on an iPad held upright. Closing it keeps the conversation (it lives in `ChatProvider`).
 */
export function ChatDrawer() {
  const pathname = usePathname()
  const { open, setOpen, turns, running, reset, screen } = useChatSession()
  const presentation = useChatPresentation()
  const input = React.useRef<HTMLElement>(null)
  if (pathname === "/chat") return null
  const sheet = presentation === "sheet"
  const starters = startersFor(screen.context, STARTERS)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side={sheet ? "bottom" : "right"}
        showCloseButton={false}
        data-testid="chat-drawer"
        data-presentation={presentation}
        // A touch screen keeps its keyboard down until the person taps the composer.
        initialFocus={(openType) => (openType === "touch" ? true : input.current)}
        className={cn(
          "gap-0 overflow-hidden p-0",
          sheet
            ? "data-[side=bottom]:h-dvh data-[side=bottom]:w-full data-[side=bottom]:border-t-0"
            : "data-[side=right]:w-full data-[side=right]:sm:w-(--chat-panel-w) data-[side=right]:sm:max-w-none",
        )}
      >
        <header className="safe-pt flex items-center gap-2 border-b px-4 pb-3 pt-3">
          <Sparkles className="size-5 text-ai" aria-hidden />
          <SheetTitle className="text-base font-semibold">Ask the agent</SheetTitle>
          <SheetDescription className="sr-only">
            Ask about the screen you are on. Numbers are counted from your data; the AI only explains them.
          </SheetDescription>
          <div className="ml-auto flex items-center gap-1">
            {turns.length > 0 && (
              <Button variant="ghost" size="icon" data-testid="chat-new" aria-label="New conversation" disabled={running} onClick={reset}>
                <MessageSquarePlus aria-hidden />
              </Button>
            )}
            <SheetClose render={<Button variant="ghost" size="icon" data-testid="chat-close" aria-label="Close chat" />}>
              <X aria-hidden />
            </SheetClose>
          </div>
        </header>
        <ContextChips chips={screen.chips} />
        <ChatConversation context={screen.context} starters={starters} layout="panel" inputRef={input} />
      </SheetContent>
    </Sheet>
  )
}
