"use client"

import type { DataAdapter } from "@/lib/data/adapter"
import { DataError, type BriefEditInput, type BriefItem, type BriefItemInput, type BriefSummary, type Flag, type FlagInput, type HcpProfile, type PreCallBrief, type RequestContext } from "@/lib/data/types"
import { cacheOfflineValue, deleteQueuedMutation, enqueueOfflineMutation, offlineQueuedMutations, queuedMutationInput, readOfflineValue, type OfflineScope } from "./cache"

export interface OfflineAdapterOptions {
  scope: OfflineScope
  online: boolean
  onQueueChange: () => void
}

function unavailable(ctx: RequestContext) {
  return new DataError("UNAVAILABLE", "This item is not available offline. Connect to continue.", ctx.correlationId)
}

function savedItem(input: BriefItemInput, prior?: BriefItem): BriefItem {
  return {
    itemId: input.itemId ?? prior?.itemId ?? `offline-${crypto.randomUUID()}`,
    text: input.text,
    detail: input.detail ?? null,
    evidenceIds: prior?.evidenceIds ?? [],
    origin: prior?.origin ?? "USER",
    edited: true,
  }
}

function optimisticBrief(brief: PreCallBrief, input: BriefEditInput): PreCallBrief {
  const byId = (items: BriefItem[]) => new Map(items.map((item) => [item.itemId, item]))
  return {
    ...brief,
    ...(input.objective !== undefined ? { objective: input.objective } : {}),
    ...(input.prompts ? { prompts: input.prompts.map((item) => savedItem(item, byId(brief.prompts).get(item.itemId ?? ""))) } : {}),
    ...(input.agenda ? { agenda: input.agenda.map((item) => savedItem(item, byId(brief.agenda).get(item.itemId ?? ""))) } : {}),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Only whitelisted reads and idempotent mutations cross the encrypted offline boundary. Everything
 * else, especially chat, keeps its normal adapter behavior and therefore cannot read offline data.
 */
export function createOfflineAdapter(adapter: DataAdapter, options: OfflineAdapterOptions): DataAdapter {
  if (!options.scope.enabled) return adapter
  const { scope } = options
  return new Proxy(adapter, {
    get(target, property, receiver) {
      if (property === "preCallBrief") return async (ctx: RequestContext, briefId: string) => {
        if (!options.online) return (await readOfflineValue<PreCallBrief>(scope, "brief", briefId)) ?? Promise.reject(unavailable(ctx))
        try {
          const brief = await target.preCallBrief(ctx, briefId)
          await cacheOfflineValue(scope, "brief", briefId, brief)
          return brief
        } catch (error) {
          const cached = await readOfflineValue<PreCallBrief>(scope, "brief", briefId)
          if (cached) return cached
          throw error
        }
      }
      if (property === "myBriefs") return async (ctx: RequestContext) => {
        if (!options.online) return (await readOfflineValue<BriefSummary[]>(scope, "brief-list", "mine")) ?? Promise.reject(unavailable(ctx))
        try {
          const briefs = await target.myBriefs(ctx)
          await cacheOfflineValue(scope, "brief-list", "mine", briefs)
          return briefs
        } catch (error) {
          const cached = await readOfflineValue<BriefSummary[]>(scope, "brief-list", "mine")
          if (cached) return cached
          throw error
        }
      }
      if (property === "hcpProfile") return async (ctx: RequestContext, hcpId: string) => {
        if (!options.online) return (await readOfflineValue<HcpProfile>(scope, "hcp", hcpId)) ?? Promise.reject(unavailable(ctx))
        try {
          const hcp = await target.hcpProfile(ctx, hcpId)
          await cacheOfflineValue(scope, "hcp", hcpId, hcp)
          return hcp
        } catch (error) {
          const cached = await readOfflineValue<HcpProfile>(scope, "hcp", hcpId)
          if (cached) return cached
          throw error
        }
      }
      if (property === "saveBriefEdits") return async (ctx: RequestContext, input: BriefEditInput) => {
        if (options.online) {
          const updated = await target.saveBriefEdits(ctx, input)
          await cacheOfflineValue(scope, "brief", updated.briefId, updated)
          return updated
        }
        const queued = await enqueueOfflineMutation(scope, "saveBriefEdits", input)
        if (!queued) throw unavailable(ctx)
        const cached = await readOfflineValue<PreCallBrief>(scope, "brief", input.briefId)
        if (!cached) throw unavailable(ctx)
        const updated = optimisticBrief(cached, input)
        await cacheOfflineValue(scope, "brief", updated.briefId, updated)
        options.onQueueChange()
        return updated
      }
      if (property === "flagIssue") return async (ctx: RequestContext, input: FlagInput) => {
        if (options.online) return target.flagIssue(ctx, input)
        const queued = await enqueueOfflineMutation(scope, "flagIssue", input)
        if (!queued) throw unavailable(ctx)
        options.onQueueChange()
        const stamp = new Date(queued.createdAt).toISOString()
        return {
          flagId: `queued-${queued.id}`, kind: input.kind, targetType: input.targetType, targetId: input.targetId,
          note: input.note?.trim() || null, status: "OPEN", createdAt: stamp, updatedAt: stamp, scopeLabel: scope.scopeLabel, dataThrough: null,
        } satisfies Flag
      }
      const original = Reflect.get(target, property, receiver)
      // No cache, no offline fallback: chat and every other live surface are intentionally unavailable.
      if (!options.online && typeof original === "function") {
        return (ctx: RequestContext) => Promise.reject(unavailable(ctx))
      }
      return original
    },
  })
}

/** Delivers in creation order. Brief edit and flag endpoints are server-idempotent, so a retry never duplicates a user action. */
export async function flushOfflineQueue(adapter: DataAdapter, scope: OfflineScope, onQueueChange: () => void) {
  if (!scope.enabled || typeof navigator === "undefined" || !navigator.onLine) return
  for (const item of await offlineQueuedMutations(scope)) {
    const input = await queuedMutationInput<FlagInput | BriefEditInput>(scope, item)
    if (!input) { await deleteQueuedMutation(item.id); continue }
    try {
      const ctx = { correlationId: crypto.randomUUID() }
      if (item.operation === "flagIssue") await adapter.flagIssue(ctx, input as FlagInput)
      else await adapter.saveBriefEdits(ctx, input as BriefEditInput)
      await deleteQueuedMutation(item.id)
    } catch {
      break
    }
  }
  onQueueChange()
}
