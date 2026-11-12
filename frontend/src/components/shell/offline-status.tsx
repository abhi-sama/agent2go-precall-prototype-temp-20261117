"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Icon } from "@astryxdesign/core/Icon"
import { CloudOff, CloudUpload } from "lucide-react"
import { useOffline } from "@/lib/offline/offline-provider"

/** A compact status, intentionally available in the shell instead of hiding offline state inside a feature. */
export function OfflineStatus() {
  const { scope, online, queueCount } = useOffline()
  if (!scope.enabled) return null
  if (!online) {
    return <Badge data-testid="offline-status" variant="warning" className="hidden sm:inline-flex" icon={<Icon icon={CloudOff} size="xsm" />} label={`Offline${queueCount ? ` · ${queueCount} queued` : ""}`} />
  }
  if (queueCount) {
    return <Badge data-testid="sync-status" variant="neutral" className="hidden sm:inline-flex" icon={<Icon icon={CloudUpload} size="xsm" />} label={`Syncing ${queueCount}`} />
  }
  return null
}
