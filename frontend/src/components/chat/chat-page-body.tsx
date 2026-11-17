"use client"

/** The full-page chat on CopilotKit (docs/adr/0018). Loaded lazily by `ChatPanel`. */

import { CopilotChat, CopilotChatView } from "@copilotkit/react-core/v2"
import * as React from "react"
import { AskTheAgentFrame, CHAT_PROPS, STARTERS } from "@/components/chat/ask-the-agent"
import { WelcomeMessage } from "@/components/chat/chat-thread"
import { CopilotRoot } from "@/components/chat/copilot-root"
import { startersFor } from "@/lib/chat/context"
import { pageOfContext } from "@/lib/chat/screen-context"
import type { ChatContext } from "@/lib/data/director-insights"

const PageWelcome = (props: React.ComponentProps<typeof CopilotChatView.WelcomeScreen>) => <CopilotChatView.WelcomeScreen {...props} welcomeMessage={WelcomeMessage} />

export default function ChatPageBody({ context }: { context: ChatContext | undefined }) {
  const page = React.useMemo(() => pageOfContext(context, "Ask the agent"), [context])
  return (
    <CopilotRoot>
      <AskTheAgentFrame context={context} page={page} starters={startersFor(context, STARTERS)}>
        <CopilotChat {...CHAT_PROPS} welcomeScreen={PageWelcome} className="h-full" />
      </AskTheAgentFrame>
    </CopilotRoot>
  )
}
