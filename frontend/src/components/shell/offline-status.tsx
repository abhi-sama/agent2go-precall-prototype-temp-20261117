"use client"

import { CloudOff, CloudUpload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useOffline } from "@/lib/offline/offline-provider"

/** A compact status, intentionally available in the shell instead of hiding offline state inside a feature. */
export function OfflineStatus() {
  const { scope, online, queueCount } = useOffline()
  if (!scope.enabled) return null
  if (!online) {
    return <Badge data-testid="offline-status" variant="outline" className="hidden min-h-8 gap-1.5 border-warning/50 text-warning sm:inline-flex"><CloudOff className="size-3.5" aria-hidden />Offline{queueCount ? ` · ${queueCount} queued` : ""}</Badge>
  }
  if (queueCount) {
    return <Badge data-testid="sync-status" variant="outline" className="hidden min-h-8 gap-1.5 border-primary/40 text-accent-text sm:inline-flex"><CloudUpload className="size-3.5" aria-hidden />Syncing {queueCount}</Badge>
  }
  return null
}
