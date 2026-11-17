"use client"

import { Button } from "@astryxdesign/core/Button"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon } from "@astryxdesign/core/Icon"
import { StatusDot } from "@astryxdesign/core/StatusDot"
import { Sparkles } from "lucide-react"
import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"
import * as React from "react"
import { useChatSession } from "@/components/chat/chat-session"
import { useChatPresentation } from "@/hooks/use-chat-presentation"

/**
 * The top bar's single entry point to Ask the agent. It stays in the app's own design (the app frame is Astryx); the
 * panel it opens is CopilotKit's. It is intentionally absent on the dedicated full-chat route.
 */
export function ChatTrigger() {
  const pathname = usePathname()
  const { open, setOpen, running } = useChatSession()
  const presentation = useChatPresentation()
  if (pathname === "/chat") return null
  const writing = running && !open
  return (
    <Button
      label={writing ? "Ask the agent, an answer is being written" : "Ask the agent"}
      variant="secondary"
      size="sm"
      data-testid="chat-open"
      aria-haspopup={presentation === "docked" ? undefined : "dialog"}
      aria-expanded={open}
      icon={
        <HStack as="span" className="relative">
          <Icon icon={Sparkles} size="sm" className="text-ai" />
          {writing && <StatusDot data-testid="chat-running" variant="accent" label="An answer is being written" isPulsing className="absolute -top-0.5 -right-0.5" />}
        </HStack>
      }
      onClick={() => setOpen(true)}
    />
  )
}

/** CopilotKit and the chat load in their own chunk, the first time the panel opens (docs/adr/0018). */
const LazyPanels = dynamic(() => import("@/components/chat/chat-panels"), { ssr: false, loading: () => null })

/** The panel and the docked sidebar. Nothing of CopilotKit is loaded until the person first opens the chat. */
export function ChatPanels() {
  const pathname = usePathname()
  const { open, hydrated } = useChatSession()
  const [used, setUsed] = React.useState(false)
  if (open && !used) setUsed(true)
  // The full page has its own chat; the stored conversation must be back before CopilotKit sees the thread.
  if (!used || !hydrated || pathname === "/chat") return null
  return <LazyPanels />
}
