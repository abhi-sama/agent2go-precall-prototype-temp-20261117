"use client"

import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl"
import { Selector } from "@astryxdesign/core/Selector"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { useAppearance } from "@/lib/appearance/appearance-provider"
import { THEME_LABELS, THEME_SLUGS, isThemeSlug, type ColorSchemePref } from "@/lib/appearance/themes"
import type { DensityPref } from "@/lib/data/types"
import { log } from "@/lib/log/logger"

const THEME_OPTIONS = THEME_SLUGS.map((slug) => ({ value: slug, label: THEME_LABELS[slug].label, description: THEME_LABELS[slug].description }))

const isScheme = (value: string): value is ColorSchemePref => value === "system" || value === "light" || value === "dark"
const isDensity = (value: string): value is DensityPref => value === "auto" || value === "comfortable" || value === "compact"

/**
 * The look controls: Astryx theme, colour scheme and density. A settings surface, not a persistent toggle (MWG
 * dark-mode-toggle): three explicit schemes, with "System" naming what the device shows now. Used in the shell's
 * appearance popover and on the sign-in page (`showDensity={false}`).
 */
export function ThemePicker({ showDensity = true }: { showDensity?: boolean }) {
  const { theme, colorScheme, deviceScheme, isDarkOnly, density, resolvedDensity, setTheme, setColorScheme, setDensity } = useAppearance()
  return (
    <VStack gap={4} data-testid="theme-picker">
      <Selector
        label="Theme"
        data-testid="theme-select"
        value={theme}
        options={THEME_OPTIONS}
        onChange={(value) => {
          if (!isThemeSlug(value)) return
          setTheme(value)
          log.info("appearance changed", { setting: "theme", value })
        }}
        width="100%"
      />
      <VStack gap={1.5}>
        <Text type="label" as="span">
          Colour scheme
        </Text>
        <SegmentedControl
          label="Colour scheme"
          data-testid="appearance-mode"
          value={colorScheme}
          layout="fill"
          isDisabled={isDarkOnly}
          onChange={(value) => {
            if (!isScheme(value)) return
            setColorScheme(value)
            log.info("appearance changed", { setting: "scheme", value })
          }}
        >
          <SegmentedControlItem value="system" label="System" data-testid="appearance-mode-system" />
          <SegmentedControlItem value="light" label="Light" data-testid="appearance-mode-light" />
          <SegmentedControlItem value="dark" label="Dark" data-testid="appearance-mode-dark" />
        </SegmentedControl>
        <Text type="supporting">
          {isDarkOnly ? `${THEME_LABELS[theme].label} only comes in dark.` : `System follows your device, which is ${deviceScheme} now.`}
        </Text>
      </VStack>
      {showDensity && (
        <VStack gap={1.5}>
          <Text type="label" as="span">
            Density
          </Text>
          <SegmentedControl
            label="Density"
            data-testid="appearance-density"
            value={density}
            layout="fill"
            onChange={(value) => {
              if (!isDensity(value)) return
              setDensity(value)
              log.info("appearance changed", { setting: "density", value })
            }}
          >
            <SegmentedControlItem value="auto" label="Auto" data-testid="appearance-density-auto" />
            <SegmentedControlItem value="comfortable" label="Comfortable" data-testid="appearance-density-comfortable" />
            <SegmentedControlItem value="compact" label="Compact" data-testid="appearance-density-compact" />
          </SegmentedControl>
          <Text type="supporting">{`Auto suits this device: ${resolvedDensity} now. Comfortable is for touch.`}</Text>
        </VStack>
      )}
    </VStack>
  )
}
