"use client"

import "@copilotkit/react-core/v2/styles.css"
import "./copilot-chat.css"
import { CopilotKitProvider } from "@copilotkit/react-core/v2"
import * as React from "react"
import { ANSWER_RENDERERS } from "@/components/chat/answer-renderers"
import { useChatSession } from "@/components/chat/chat-session"
import { ASK_THE_AGENT } from "@/lib/chat/agent/appsync-agent"

/**
 * CopilotKit for one mounted chat (docs/adr/0018). It loads with the chat, not with every page. The person's agent is
 * registered directly, so CopilotKit needs no runtime endpoint and no key: there is no `runtimeUrl`, `publicApiKey`,
 * `publicLicenseKey` or learning configuration, and nothing is sent to CopilotKit's servers.
 */
export function CopilotRoot({ children }: { children: React.ReactNode }) {
  const { agent } = useChatSession()
  const agents = React.useMemo(() => ({ [ASK_THE_AGENT]: agent }), [agent])
  return (
    <CopilotKitProvider agentId={ASK_THE_AGENT} agents__unsafe_dev_only={agents} renderActivityMessages={ANSWER_RENDERERS} showIntelligenceIndicator={false} enableInspector={false}>
      {children}
    </CopilotKitProvider>
  )
}
