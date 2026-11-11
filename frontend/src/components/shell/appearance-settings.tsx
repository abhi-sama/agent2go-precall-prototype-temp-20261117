"use client"

import { Heading } from "@astryxdesign/core/Heading"
import { IconButton } from "@astryxdesign/core/IconButton"
import { Popover } from "@astryxdesign/core/Popover"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { Palette } from "lucide-react"
import { ThemePicker } from "@/components/shell/theme-picker"
import { useSession } from "@/lib/session/session-provider"

/**
 * The header's appearance settings: theme, colour scheme and density in one popover (a bottom sheet on a phone).
 * Scheme and density are saved to the person's account; the theme is remembered on this device.
 */
export function AppearanceSettings() {
  const { userId, ready } = useSession()
  const signedIn = ready && userId !== ""
  return (
    <Popover
      label="Appearance"
      placement="below"
      alignment="end"
      padding={4}
      width={440}
      presentation="adaptive"
      content={
        <VStack gap={4}>
          <VStack gap={1}>
            <Heading level={2}>Appearance</Heading>
            <Text type="supporting">
              {signedIn
                ? "Colour scheme and density follow you to your other devices; the theme is remembered here."
                : "Remembered on this device."}
            </Text>
          </VStack>
          <ThemePicker />
        </VStack>
      }
    >
      <IconButton data-testid="appearance-settings" label="Appearance settings" tooltip="Appearance" variant="ghost" icon={<Palette aria-hidden />} />
    </Popover>
  )
}
