"use client"

/** Browser capabilities available only to the local Ask-the-agent instance. */
import { useFrontendTool, useInterrupt } from "@copilotkit/react-core/v2"
import { useRouter } from "next/navigation"
import * as React from "react"
import { z } from "zod"
import { useSharedFilters } from "@/components/filters/filter-context"
import { useAppToast } from "@/components/state/use-app-toast"
import { useDataAdapter } from "@/lib/data/data-provider"
import { MEMORY_CATEGORIES } from "@/lib/data/memory-guard"
import type { AgentMemoryCategory } from "@/lib/data/types"
import { newCorrelationId } from "@/lib/log/logger"

const writeSchema = z.object({ kind: z.enum(["pre_call_brief", "post_call_output", "feedback_flag", "save_preference"]), values: z.record(z.string(), z.string()) })
const pathSchema = z.object({ path: z.enum(["/", "/dashboard", "/msl", "/msl/briefs", "/post-call", "/flags"]) })
const filterSchema = z.object({ from: z.string().date().optional(), to: z.string().date().optional(), territoryId: z.string().max(64).optional(), molecule: z.string().max(64).optional(), hcpId: z.string().max(64).optional() })

function editValue(interrupt: unknown): { title: string; message: string; values: Record<string, string> } | null {
  if (!interrupt || typeof interrupt !== "object") return null
  const metadata = (interrupt as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== "object") return null
  const item = metadata as { title?: unknown; values?: unknown }
  if (!item.values || typeof item.values !== "object") return null
  const values: Record<string, string> = Object.fromEntries(Object.entries(item.values as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
  return { title: typeof item.title === "string" ? item.title : "Approve change", message: typeof (interrupt as { message?: unknown }).message === "string" ? (interrupt as { message: string }).message : "Approve this change?", values }
}

/** Hooks must be mounted inside CopilotKit and the app's Data/Filter providers. */
export function ChatCapabilities() {
  const adapter = useDataAdapter()
  const router = useRouter()
  const { setFilters } = useSharedFilters()
  const toast = useAppToast()
  const context = React.useMemo(() => ({ correlationId: newCorrelationId() }), [])

  useInterrupt({
    enabled: (event) => Boolean(editValue(event.value)),
    render: ({ interrupt, resolve }) => <WriteApproval interrupt={interrupt} resolve={resolve} />,
  })
  useFrontendTool({
    name: "a2g_execute_write", description: "Execute a previously approved Agent2Go write.", parameters: writeSchema,
    // The run that carries the approved write is already complete: do not ask the agent for another one afterwards.
    followUp: false,
    handler: async ({ kind, values }) => {
      if (kind === "save_preference") {
        // The agent proposed it and the person approved it; the BE checks it again and refuses names, ids and figures.
        if (!(MEMORY_CATEGORIES as readonly string[]).includes(values.category)) return { status: "rejected" }
        try {
          await adapter.saveAgentMemory(context, { text: values.text, category: values.category as AgentMemoryCategory })
          toast.success("Remembered", { description: "You can review or delete it under What the agent remembers.", id: "agent-memory" })
        } catch {
          toast.error("That could not be remembered", { id: "agent-memory" })
          return { status: "rejected" }
        }
      } else if (kind === "pre_call_brief") await adapter.generateBrief(context, { hcpId: values.hcpId, objective: values.objective })
      else if (kind === "post_call_output") await adapter.createPostCallDraft(context, { notes: values.notes })
      else await adapter.flagIssue(context, { kind: values.kind as "SUMMARY" | "IDENTIFIER" | "TERRITORY_ASSIGNMENT", targetType: values.targetType as "SUMMARY" | "CALL" | "HCP" | "TERRITORY", targetId: values.targetId, note: values.note })
      return { status: "saved" }
    },
  }, [adapter, context, toast])
  useFrontendTool({ name: "a2g_navigate", description: "Navigate only to an approved Agent2Go page.", parameters: pathSchema, handler: async ({ path }) => { router.push(path); return { status: "navigated" } } }, [router])
  useFrontendTool({
    name: "a2g_set_dashboard_filters", description: "Set bounded dashboard filters without expanding data scope.", parameters: filterSchema,
    handler: async (next) => {
      if (next.from && next.to && next.from > next.to) return { status: "rejected" }
      setFilters((current) => ({ ...current, ...next }))
      return { status: "set" }
    },
  }, [setFilters])
  useFrontendTool({
    name: "a2g_open_hcp", description: "Open an HCP after the server has verified the HCP is in scope.", parameters: z.object({ hcpId: z.string().min(1).max(64) }),
    handler: async ({ hcpId }) => { await adapter.hcpProfile(context, hcpId); router.push(`/msl/briefs?hcp=${encodeURIComponent(hcpId)}`); return { status: "opened" } },
  }, [adapter, context, router])
  useFrontendTool({
    name: "a2g_copy_answer", description: "Copy a supplied answer to the user's clipboard.", parameters: z.object({ text: z.string().min(1).max(20_000) }),
    handler: async ({ text }) => { await navigator.clipboard.writeText(text); return { status: "copied" } },
  }, [])
  return null
}

function WriteApproval({ interrupt, resolve }: { interrupt: unknown; resolve: (value?: unknown) => Promise<unknown> }) {
  const proposed = editValue(interrupt)
  const [values, setValues] = React.useState<Record<string, string>>(() => proposed?.values ?? {})
  if (!proposed) return null
  const editable = ["objective", "notes", "note", "text"].filter((key) => key in values)
  return <form className="rounded-lg border border-border bg-muted/40 p-3 text-sm" onSubmit={(event) => { event.preventDefault(); void resolve({ approved: true, values }) }}>
    <p className="font-medium">{proposed.title}</p><p className="mt-1 text-muted-foreground">{proposed.message}</p>
    {editable.map((key) => <label key={key} className="mt-2 block"><span className="sr-only">Edit {key}</span><textarea value={values[key]} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} className="min-h-20 w-full rounded border border-input bg-background p-2" /></label>)}
    <div className="mt-3 flex gap-2"><button type="submit" className="rounded bg-primary px-3 py-2 text-primary-foreground">Approve and save</button><button type="button" className="rounded border border-input px-3 py-2" onClick={() => void resolve({ approved: false })}>Reject</button></div>
  </form>
}
