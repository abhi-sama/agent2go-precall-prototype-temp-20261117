"use client"

/**
 * The A2UI surfaces of one answer (docs/adr/0017), drawn by the official v1.0 renderer with the answer catalog.
 *
 * Each mounted slot owns one `MessageProcessor`, fed only operations that passed the allow-list gate
 * (`lib/chat/a2ui/protocol.ts`). A surface whose messages the processor rejects is not shown at all. An action
 * leaves only as a chat question through `onAction` (the same AppSync path as typing), never to any other address.
 * This module is the lazy chunk: it, the renderer and the catalog load with the first answer that has a surface.
 */

import * as React from "react"
import { A2uiSurface, type ReactCatalogComponent } from "@a2ui/react"
import { MessageProcessor, type ActionPayload, type SurfaceModel } from "@a2ui/web_core/v1_0"
import { VStack } from "@astryxdesign/core/VStack"
import { SurfaceStateContext, answerCatalog } from "@/lib/chat/a2ui/catalog"
import { adaptForSdk, describeAction, isAllowedAction, type SurfaceAction, type SurfaceItem } from "@/lib/chat/a2ui/protocol"
import { log } from "@/lib/log/logger"

export interface AnswerSurfacesProps {
  surfaces: SurfaceItem[]
  /** False while another answer runs: the controls stay visible but cannot send. */
  canAct: boolean
  onAction: (action: SurfaceAction, question: string) => void
}

/** The processor and what it has been given, as an external store React subscribes to. */
class SurfaceStore {
  readonly processor: MessageProcessor<ReactCatalogComponent>
  private readonly applied = new Map<string, SurfaceItem>()
  private readonly byId = new Map<string, SurfaceItem>()
  private readonly failed = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private version = 0
  /** The surface whose action is the answer now running. */
  sending: string | null = null
  /** Where an action goes: the chat's own send, kept current by the component. */
  private send: (action: SurfaceAction, question: string) => void = () => undefined

  constructor() {
    this.processor = new MessageProcessor<ReactCatalogComponent>([answerCatalog], (payload) => this.act(payload), {
      // v1.0 on the wire; errors are reported here rather than thrown, and nothing is sent to an agent directly.
      version: "1.0",
      reportErrorsOnly: true,
    })
  }

  setSender(send: (action: SurfaceAction, question: string) => void) {
    this.send = send
  }

  /** The answer an action asked for has ended (or another one runs): no button shows progress any more. */
  settle() {
    if (this.sending === null) return
    this.sending = null
    this.changed()
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  getSnapshot = () => this.version
  private changed() {
    this.version++
    for (const listener of this.listeners) listener()
  }

  /** Apply the answer's surfaces that are new or replaced since the last call. */
  sync(surfaces: SurfaceItem[]) {
    let changed = false
    for (const item of surfaces) {
      const previous = this.applied.get(item.messageId)
      if (previous === item) continue
      const messages = [
        // A newer snapshot of the same activity replaces the old surface (AG-UI `replace: true`).
        ...(previous && this.processor.getSurfaces().has(previous.surfaceId) ? [{ version: "1.0", deleteSurface: { surfaceId: previous.surfaceId } }] : []),
        ...item.operations.map(adaptForSdk),
      ]
      const errors = this.processor.processMessagesWithErrors(messages)
      this.applied.set(item.messageId, item)
      this.byId.set(item.surfaceId, item)
      if (errors.length) {
        log.warn("a2ui surface rejected", { operation: "chat", status: "rejected", count: errors.length })
        this.failed.add(item.surfaceId)
      }
      changed = true
    }
    if (changed) this.changed()
  }

  shown(surfaces: SurfaceItem[]): { item: SurfaceItem; model: SurfaceModel<ReactCatalogComponent> }[] {
    const live = this.processor.getSurfaces()
    return surfaces.flatMap((item) => {
      const model = live.get(item.surfaceId)
      return model && !this.failed.has(item.surfaceId) ? [{ item, model }] : []
    })
  }

  private act(payload: ActionPayload) {
    const surface = this.byId.get(payload.surfaceId)
    const action: SurfaceAction = {
      name: payload.name,
      surfaceId: payload.surfaceId,
      sourceComponentId: payload.sourceComponentId,
      timestamp: payload.timestamp,
      ...(typeof payload.userMessage === "string" ? { userMessage: payload.userMessage } : {}),
      context: (payload.context ?? {}) as Record<string, unknown>,
    }
    if (!surface || !isAllowedAction(action)) return
    this.sending = action.surfaceId
    this.changed()
    this.send(action, describeAction(surface.operations, action))
  }
}

export default function AnswerSurfaces({ surfaces, canAct, onAction }: AnswerSurfacesProps) {
  const [store] = React.useState(() => new SurfaceStore())
  React.useEffect(() => {
    store.setSender(onAction)
  }, [store, onAction])
  React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  React.useEffect(() => store.sync(surfaces), [store, surfaces])
  React.useEffect(() => {
    if (canAct) store.settle()
  }, [store, canAct])

  const shown = store.shown(surfaces)
  if (shown.length === 0) return null
  return (
    <VStack gap={3} className="min-w-0">
      {shown.map(({ item, model }) => (
        <SurfaceStateContext.Provider key={item.surfaceId} value={{ disabled: !canAct, submitting: !canAct && store.sending === item.surfaceId }}>
          <VStack data-testid="a2ui-surface" data-surface-id={item.surfaceId} data-slot={item.slot} className="min-w-0">
            <A2uiSurface surface={model} />
          </VStack>
        </SurfaceStateContext.Provider>
      ))}
    </VStack>
  )
}
