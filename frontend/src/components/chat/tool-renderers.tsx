"use client"

/**
 * Named CopilotKit generative-UI renderers for the deterministic tools the Ask the agent runtime exposes.
 *
 * Tool arguments and results deliberately stay out of these cards: the event-log adapter only emits the tool name
 * and the fixed completion result, while the separately screened evidence activities render the SQL-backed data.
 * This gives people useful progress without turning a tool result into an untrusted data-rendering path.
 */

import { useRenderTool } from "@copilotkit/react-core/v2"
import * as React from "react"
import { z } from "zod"
import { ToolActivity } from "@/components/chat/chat-thread"
import { ASK_THE_AGENT } from "@/lib/chat/agent/appsync-agent"

const toolParameters = z.object({}).passthrough()

const TOOL_NAMES = [
  "get_activity_summary",
  "search_recorded_responses",
  "get_my_scope",
  "show_chart",
  "show_answer_distribution",
  "get_topic_trends",
  "get_question_breakdown",
  "get_executive_activity",
  "get_org_themes",
  "get_region_topic_matrix",
  "suggest_follow_ups",
] as const

/** Register every allow-listed server tool by name, not as one catch-all, so a new tool cannot silently inherit UI. */
export function ChatToolRenderers() {
  return TOOL_NAMES.map((name) => <NamedToolRenderer key={name} name={name} />)
}

function NamedToolRenderer({ name }: { name: (typeof TOOL_NAMES)[number] }) {
  // Tool arguments are intentionally not parsed or displayed. They are model-controlled and are not evidence.
  useRenderTool(
    {
      name,
      parameters: toolParameters,
      agentId: ASK_THE_AGENT,
      render: ({ status }) => <ToolActivity name={name} status={status} />,
    },
    [],
  )
  return null
}
