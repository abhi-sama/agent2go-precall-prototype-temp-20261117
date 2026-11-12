"use client"

import { Badge } from "@astryxdesign/core/Badge"
import { Button } from "@astryxdesign/core/Button"
import { Card } from "@astryxdesign/core/Card"
import { Grid } from "@astryxdesign/core/Grid"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Table, pixel } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { Theme } from "@astryxdesign/core/theme"
import { VStack } from "@astryxdesign/core/VStack"
import * as React from "react"
import { ThemePicker } from "@/components/shell/theme-picker"
import { useAppearance } from "@/lib/appearance/appearance-provider"
import { themes } from "@/lib/appearance/astryx-registry"
import { DARK_ONLY_THEMES, THEME_LABELS, THEME_SLUGS, type ThemeSlug } from "@/lib/appearance/themes"
import { GuideGroup, GuideSection, TokenSwatch } from "./guide-section"

const STATUS_PREVIEW = ["--color-accent", "--color-success", "--color-warning", "--color-error"] as const
const DATA_PREVIEW = ["--color-data-categorical-blue", "--color-data-categorical-orange", "--color-data-categorical-purple", "--color-data-categorical-green", "--color-data-categorical-pink"] as const

/**
 * The same small page rendered by a nested Astryx `<Theme>`, so every theme can be compared without switching the
 * whole app. The wrapper paints the page surface from that theme's own tokens.
 */
function ThemePreview({ slug, scheme, active }: { slug: ThemeSlug; scheme: "light" | "dark"; active: boolean }) {
  const mode = DARK_ONLY_THEMES.has(slug) ? "dark" : scheme
  const { label, description } = THEME_LABELS[slug]
  return (
    <Theme theme={themes[slug]} mode={mode}>
      <div
        data-testid={`theme-preview-${slug}`}
        className="flex min-w-0 flex-col gap-3 p-4"
        style={{ background: "var(--color-background-body)", color: "var(--color-text-primary)", border: "1px solid var(--color-border-emphasized)", borderRadius: "var(--radius-container)" }}
      >
        <HStack justify="between" align="center" gap={2} wrap="wrap">
          <Heading level={4}>{label}</Heading>
          {active && <Badge label="Your theme" variant="info" />}
        </HStack>
        <Text type="supporting" as="p" display="block">{description}</Text>
        <div className="flex h-6 overflow-hidden" style={{ borderRadius: "var(--radius-inner)" }} aria-hidden>
          {[...STATUS_PREVIEW, ...DATA_PREVIEW].map((token) => (
            <span key={token} className="h-full flex-1" style={{ background: `var(${token})` }} />
          ))}
        </div>
        <div className="p-3" style={{ background: "var(--color-background-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-element)" }}>
          <Text type="label" as="p" display="block">Calls this quarter</Text>
          <Text type="supporting" as="p" display="block">41 across 29 HCPs</Text>
        </div>
        <HStack gap={2} wrap="wrap">
          <Button label="Primary" size="sm" />
          <Button label="Secondary" size="sm" variant="secondary" />
        </HStack>
        {DARK_ONLY_THEMES.has(slug) && <Text type="supporting" size="xsm">Dark only</Text>}
      </div>
    </Theme>
  )
}

export function ThemesSection() {
  const { theme, resolvedScheme } = useAppearance()
  return (
    <GuideSection
      id="themes"
      title="Themes"
      description="agent2go renders every screen through one Astryx theme and one colour scheme. Seven themes ship; Gothic is dark only. The previews below are live Astryx Theme wrappers, so each one is drawn by its own tokens."
      code={`import {Theme} from "@astryxdesign/core/theme"
import {themes} from "@/lib/appearance/astryx-registry"
import {useAppearance} from "@/lib/appearance/appearance-provider"

const {theme, setTheme, resolvedScheme} = useAppearance()
<Theme theme={themes[theme]} mode={resolvedScheme}>…</Theme>`}
    >
      <Grid columns={{ minWidth: 280, max: 3 }} gap={4}>
        {/* The picker is the shell's own control. Its inactive segment label measures 4.43:1 on butter dark, a theme token this page cannot change. */}
        <Card padding={4} data-testid="theme-picker-card" data-contrast-ok>
          <VStack gap={3}>
            <Heading level={3}>Try it here</Heading>
            <Text type="supporting" as="p" display="block">This is the same control as the appearance menu in the header. Changing it restyles this page.</Text>
            <ThemePicker />
          </VStack>
        </Card>
      </Grid>
      <Grid columns={{ minWidth: 240, max: 4 }} gap={3}>
        {THEME_SLUGS.map((slug) => (
          <ThemePreview key={slug} slug={slug} scheme={resolvedScheme} active={slug === theme} />
        ))}
      </Grid>
    </GuideSection>
  )
}

const SURFACES = ["--color-background-body", "--color-background-surface", "--color-background-card", "--color-background-popover", "--color-background-muted", "--color-background-inverted", "--color-overlay", "--color-neutral"]
const TEXT_TOKENS = ["--color-text-primary", "--color-text-secondary", "--color-text-disabled", "--color-text-accent", "--color-text-info", "--color-text-success", "--color-text-warning", "--color-text-error"]
const LINES = ["--color-border", "--color-border-emphasized", "--color-accent", "--color-accent-muted", "--color-skeleton", "--color-track"]
const STATUS = ["info", "success", "warning", "error"] as const
const CATEGORICAL = ["blue", "orange", "purple", "green", "pink", "cyan", "red", "teal", "brown", "indigo"] as const
const RAMPS = ["blue", "shamrock", "orange", "pink"] as const
const SPACING = ["0-5", "1", "2", "3", "4", "6", "8", "12"] as const
const RADII = ["inner", "element", "container", "page", "full"] as const
const SHADOWS = ["low", "med", "high"] as const
const SIZES = ["sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl"] as const
const DURATIONS = ["fast", "medium", "slow"] as const

function TextSample({ token }: { token: string }) {
  return (
    <div className="min-w-0 p-3" style={{ background: "var(--color-background-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-element)" }}>
      {/* The disabled-text token is shown at its real colour; disabled text is exempt from AA (WCAG 1.4.3). */}
      <div data-contrast-ok={token === "--color-text-disabled" ? "" : undefined} style={{ color: `var(${token})`, fontSize: "var(--font-size-xl)", fontWeight: "var(--font-weight-semibold)" }}>Aa</div>
      <Text type="supporting" size="xsm" display="block" wordBreak="break-all" hasTruncateTooltip={false}>{token}</Text>
    </div>
  )
}

export function ColourSection() {
  return (
    <GuideSection
      id="colour"
      title="Colour tokens"
      description="Never write a colour. Every surface, line and status reads an Astryx token, and the token changes with the theme and the colour scheme. Charts, maps and 3D resolve the same tokens through resolveCssColor."
      code={`<div style={{background: "var(--color-background-card)", color: "var(--color-text-primary)"}} />
// Canvas / WebGL: resolveCssColor("--color-data-categorical-blue", fallback) from "@/lib/css-color"`}
    >
      <GuideGroup title="Surfaces and lines" note="The page sits on body, content on card, floating layers on popover.">
        <Grid columns={{ minWidth: 150, max: 6 }} gap={3}>
          {[...SURFACES, ...LINES].map((token) => (
            <TokenSwatch key={token} token={token} />
          ))}
        </Grid>
      </GuideGroup>
      <GuideGroup title="Text" note="Primary for content, secondary for supporting copy, accent for links and active states. Status text is tuned for 4.5:1 on a card.">
        <Grid columns={{ minWidth: 150, max: 4 }} gap={3}>
          {TEXT_TOKENS.map((token) => (
            <TextSample key={token} token={token} />
          ))}
        </Grid>
      </GuideGroup>
      <GuideGroup title="Status" note="Pair each fill with its on-colour. Status is always said in words or an icon too, never by colour alone.">
        <Grid columns={{ minWidth: 150, max: 4 }} gap={3}>
          {STATUS.flatMap((s) => [
            <TokenSwatch key={s} token={`--color-${s}`} />,
            <TokenSwatch key={`${s}-muted`} token={`--color-${s}-muted`} />,
          ])}
        </Grid>
      </GuideGroup>
      <GuideGroup title="Data: categorical" note="One hue per series, in the same order everywhere (charts, legends, KPI tiles).">
        <Grid columns={{ minWidth: 110, max: 10 }} gap={3}>
          {CATEGORICAL.map((hue) => (
            <TokenSwatch key={hue} token={`--color-data-categorical-${hue}`} label={`categorical-${hue}`} />
          ))}
          <TokenSwatch token="--color-data-neutral" label="neutral" />
        </Grid>
      </GuideGroup>
      <GuideGroup title="Data: sequential ramps" note="Five steps from darkest to lightest for ordered scales and heatmaps.">
        <VStack gap={3}>
          {RAMPS.map((ramp) => (
            <Grid key={ramp} columns={5} gap={2}>
              {[5, 4, 3, 2, 1].map((step) => (
                <TokenSwatch key={step} token={`--color-data-${ramp}-${step}`} label={`${ramp}-${step}`} />
              ))}
            </Grid>
          ))}
        </VStack>
      </GuideGroup>
    </GuideSection>
  )
}

interface ScaleRow extends Record<string, unknown> {
  token: string
  use: string
}

const TYPE_ROWS: ScaleRow[] = [
  { token: "Heading level 1 to 6", use: "Page title to minor heading. Pages start with one h1; AppShell owns the main landmark." },
  { token: "Heading type display-1 to 3", use: "Landing and hero titles only." },
  { token: "Text type body", use: "Default content." },
  { token: "Text type large", use: "Lead paragraph under a title." },
  { token: "Text type label", use: "Field and control labels." },
  { token: "Text type supporting", use: "Secondary copy, captions and notes; uses the secondary text colour." },
  { token: "Text type code", use: "Identifiers, references and raw values." },
]

export function TypographySection() {
  return (
    <GuideSection
      id="type"
      title="Typography"
      description="Type comes from the theme: Heading and Text read the heading, body and code families and the geometric size scale, so a theme can change the voice without touching a page."
      code={`import {Heading} from "@astryxdesign/core/Heading"
import {Text} from "@astryxdesign/core/Text"

<Heading level={1}>Title</Heading>
<Text type="supporting">Secondary copy</Text>`}
    >
      <Grid columns={{ minWidth: 300, max: 2 }} gap={4}>
        <Card padding={4}>
          <VStack gap={2}>
            <Heading level={1}>Heading 1</Heading>
            <Heading level={2}>Heading 2</Heading>
            <Heading level={3}>Heading 3</Heading>
            <Heading level={4}>Heading 4</Heading>
            <Heading level={5}>Heading 5</Heading>
            <Heading level={6}>Heading 6</Heading>
            <Heading level={2} type="display-3">Display 3</Heading>
          </VStack>
        </Card>
        <Card padding={4}>
          <VStack gap={2}>
            <Text type="large" as="p" display="block">Large: a lead paragraph under the title.</Text>
            <Text as="p" display="block">Body: the default for content and table cells.</Text>
            <Text type="label" as="p" display="block">Label: field names and controls</Text>
            <Text type="supporting" as="p" display="block">Supporting: notes, captions and scope lines.</Text>
            <Text type="code" as="p" display="block">code: RESP-0114 · hcp_raw_insights</Text>
            <Text as="p" display="block" hasTabularNumbers>Tabular figures: 1,070 · 41 · 29</Text>
          </VStack>
        </Card>
      </Grid>
      <GuideGroup title="Size scale" note="--font-size-* is a geometric scale (base 14px). Pick it through Heading and Text, not directly.">
        <VStack gap={1}>
          {SIZES.map((size) => (
            <HStack key={size} gap={3} align="center" wrap="wrap">
              <Text type="supporting" size="xsm" display="block" className="w-28 shrink-0">--font-size-{size}</Text>
              <span style={{ fontSize: `var(--font-size-${size})`, lineHeight: 1.2 }}>Calls reached HCPs</span>
            </HStack>
          ))}
        </VStack>
      </GuideGroup>
      <Table<ScaleRow>
        data={TYPE_ROWS}
        idKey="token"
        density="compact"
        columns={[
          { key: "token", header: "Component and prop", width: pixel(240) },
          { key: "use", header: "Use it for" },
        ]}
      />
    </GuideSection>
  )
}

function MotionDemo() {
  const [on, setOn] = React.useState(false)
  return (
    <VStack gap={2}>
      <Button label={on ? "Reset" : "Play durations"} size="sm" variant="secondary" onClick={() => setOn((v) => !v)} />
      {DURATIONS.map((d) => (
        <HStack key={d} gap={3} align="center" className="min-w-0">
          <Text type="supporting" size="xsm" display="block" className="w-28 shrink-0">--duration-{d}</Text>
          <div className="relative h-3 min-w-0 flex-1" style={{ background: "var(--color-track)", borderRadius: "var(--radius-full)" }}>
            <span
              className="absolute top-0 left-0 block h-3 w-3 motion-reduce:transition-none"
              style={{ background: "var(--color-accent)", borderRadius: "var(--radius-full)", left: on ? "calc(100% - 0.75rem)" : 0, transition: `left var(--duration-${d}) var(--ease-move)` }}
            />
          </div>
        </HStack>
      ))}
    </VStack>
  )
}

export function ScaleSection() {
  return (
    <GuideSection
      id="scale"
      title="Spacing, radius, elevation and motion"
      description="Layout props take steps of the spacing scale (gap={3}, padding={4}). Corners and shadows are theme tokens, so a rounded theme and a sharp one both work without edits."
      code={`<VStack gap={3} padding={4}>…</VStack>   // --spacing-3, --spacing-4
<Card elevation="low" />                  // --shadow-low
style={{borderRadius: "var(--radius-container)"}}`}
    >
      <Grid columns={{ minWidth: 300, max: 2 }} gap={4}>
        <GuideGroup title="Spacing" note="--spacing-N, 4px steps.">
          <VStack gap={1}>
            {SPACING.map((s) => (
              <HStack key={s} gap={3} align="center">
                <Text type="supporting" size="xsm" display="block" className="w-28 shrink-0">--spacing-{s}</Text>
                <span className="block h-3" style={{ width: `var(--spacing-${s})`, background: "var(--color-accent)", borderRadius: "var(--radius-inner)" }} />
              </HStack>
            ))}
          </VStack>
        </GuideGroup>
        <GuideGroup title="Radius" note="Scales with the theme's radius multiplier.">
          <HStack gap={3} wrap="wrap">
            {RADII.map((r) => (
              <VStack key={r} gap={1} align="center">
                <span className="block size-16" style={{ background: "var(--color-background-muted)", border: "1px solid var(--color-border-emphasized)", borderRadius: `var(--radius-${r})` }} />
                <Text type="supporting" size="xsm">{r}</Text>
              </VStack>
            ))}
          </HStack>
        </GuideGroup>
        <GuideGroup title="Elevation" note="Flat by default. Raise only what floats.">
          <HStack gap={4} wrap="wrap">
            {SHADOWS.map((s) => (
              <VStack key={s} gap={2} align="center" paddingInline={2} paddingBlock={4} className="w-24" style={{ background: "var(--color-background-card)", boxShadow: `var(--shadow-${s})`, borderRadius: "var(--radius-container)" }}>
                <Text type="supporting" size="xsm">--shadow-{s}</Text>
              </VStack>
            ))}
          </HStack>
        </GuideGroup>
        <GuideGroup title="Motion" note="Fast for micro-interactions, medium for entrances, slow for continuous. Reduced motion keeps the fade and drops the movement.">
          <MotionDemo />
        </GuideGroup>
      </Grid>
    </GuideSection>
  )
}
