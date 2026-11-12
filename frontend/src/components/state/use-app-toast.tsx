"use client"

import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { useToast } from "@astryxdesign/core/Toast"
import * as React from "react"

type ToastDetail = { description?: string; id?: string }

/**
 * Transient confirmations and failures on Astryx `Toast` (`useToast`). Same call shape the app used with sonner:
 * `toast.success("Saved", { description })`. Errors persist until dismissed (Astryx default for `type: "error"`);
 * a repeated `id` replaces the earlier toast instead of stacking. Toasts confirm or report; never put names, emails
 * or HCP text in one.
 */
export function useAppToast() {
  const showToast = useToast()
  return React.useMemo(() => {
    const show = (type: "info" | "error", title: string, detail?: ToastDetail) =>
      showToast({
        type,
        // Errors auto-hide too (Astryx default is to persist them): a transient report, as before.
        isAutoHide: true,
        uniqueID: detail?.id,
        body: detail?.description ? (
          <VStack gap={1}>
            <Text weight="semibold">{title}</Text>
            <Text type="supporting">{detail.description}</Text>
          </VStack>
        ) : (
          title
        ),
      })
    return {
      info: (title: string, detail?: ToastDetail) => show("info", title, detail),
      success: (title: string, detail?: ToastDetail) => show("info", title, detail),
      error: (title: string, detail?: ToastDetail) => show("error", title, detail),
    }
  }, [showToast])
}
