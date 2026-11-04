import type { Metadata } from "next"
import { Suspense } from "react"
import { ChatPanel } from "@/components/chat/chat-panel"

export const metadata: Metadata = { title: "Ask the agent" }

export default function ChatPage() {
  // The panel reads the screen it was opened from out of the link's query.
  return (
    <Suspense fallback={null}>
      <ChatPanel />
    </Suspense>
  )
}
